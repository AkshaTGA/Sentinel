from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.orm import Session
from typing import Dict, List
import json
import datetime
from jose import jwt
from .. import crud, schemas, database, dependencies, models, config

router = APIRouter(tags=["Commands"])

# Connection manager to track active agent and dashboard WebSocket connections
class ConnectionManager:
    def __init__(self):
        # Maps device_id -> WebSocket (agent connection)
        self.active_connections: Dict[str, WebSocket] = {}
        # Maps device_id -> list of WebSockets (dashboard connections)
        self.dashboard_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, device_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[device_id] = websocket

    def disconnect(self, device_id: str):
        if device_id in self.active_connections:
            del self.active_connections[device_id]

    def connect_dashboard(self, device_id: str, websocket: WebSocket):
        if device_id not in self.dashboard_connections:
            self.dashboard_connections[device_id] = []
        self.dashboard_connections[device_id].append(websocket)

    def disconnect_dashboard(self, device_id: str, websocket: WebSocket):
        if device_id in self.dashboard_connections:
            if websocket in self.dashboard_connections[device_id]:
                self.dashboard_connections[device_id].remove(websocket)

    async def send_command(self, device_id: str, command_data: dict) -> bool:
        if device_id in self.active_connections:
            ws = self.active_connections[device_id]
            try:
                await ws.send_text(json.dumps(command_data))
                return True
            except Exception:
                self.disconnect(device_id)
                return False
        return False

manager = ConnectionManager()

# Dashboard Endpoint: Send Command to Device
@router.post("/api/commands", response_model=schemas.Command)
async def dispatch_command(
    command_in: schemas.CommandCreate,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    # Verify device belongs to user
    device = crud.get_device(db, device_id=command_in.device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to issue commands to this device")

    # Create command in DB
    db_command = crud.create_command(db, command=command_in)
    
    # Try sending via websocket
    cmd_payload = {
        "id": db_command.id,
        "command_type": db_command.command_type,
        "payload": db_command.payload
    }
    sent = await manager.send_command(device.id, cmd_payload)
    if sent:
        db_command.status = "SENT"
        db.commit()
        db.refresh(db_command)
        
    return db_command

# Agent Endpoint: Respond to Command via HTTP (Fallback)
@router.post("/api/agent/commands/{command_id}/respond")
def respond_to_command(
    command_id: str,
    response_data: schemas.CommandUpdate,
    device: models.Device = Depends(dependencies.get_device_by_api_key),
    db: Session = Depends(database.get_db)
):
    command = crud.get_command(db, command_id=command_id)
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")
    if command.device_id != device.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this command")

    updated_command = crud.update_command(db, command_id=command_id, command_update=response_data)
    return {"status": "success", "command": updated_command}

# Agent Endpoint: Log Auto-Triggered command result directly (e.g. startup captures)
@router.post("/api/agent/commands/auto-report")
def log_auto_command_report(
    report: schemas.CommandAutoReport,
    device: models.Device = Depends(dependencies.get_device_by_api_key),
    db: Session = Depends(database.get_db)
):
    import uuid
    db_command = models.Command(
        id=f"auto_{uuid.uuid4()}",
        device_id=device.id,
        command_type=report.command_type,
        payload="Auto-Triggered Startup Security Capture",
        status=report.status,
        result_url=report.result_url,
        error_message=report.error_message
    )
    db.add(db_command)
    db.commit()
    db.refresh(db_command)
    return {"status": "success", "command_id": db_command.id}

# Agent Endpoint: WebSocket Connection
@router.websocket("/api/agent/ws")
async def agent_websocket(
    websocket: WebSocket,
    api_key: str = Query(...)
):
    # We must fetch database session manually in websocket connection
    db = next(database.get_db())
    try:
        device = crud.get_device_by_api_key(db, api_key=api_key)
        if not device:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        device_id = device.id
        await manager.connect(device_id, websocket)
        
        # Update device online status
        device.is_online = True
        device.last_seen = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        db.commit()
    finally:
        db.close()

    try:
        while True:
            # Keep connection alive and listen for responses
            data = await websocket.receive_text()
            try:
                response = json.loads(data)
                
                # Check if it's a real-time terminal output or camera/screen stream message
                if response.get("type") in ["terminal_output", "live_camera_frame", "live_screen_frame"]:
                    dashboards = manager.dashboard_connections.get(device_id, [])
                    for db_ws in dashboards:
                        try:
                            await db_ws.send_text(json.dumps(response))
                        except Exception:
                            pass
                    continue

                # Check if it's a command execution response
                if "command_id" in response and "status" in response:
                    cmd_id = response["command_id"]
                    status_val = response["status"]
                    url_val = response.get("result_url")
                    err_val = response.get("error_message")
                    
                    # Fetch short-lived session to apply update
                    db_session = next(database.get_db())
                    try:
                        cmd_update = schemas.CommandUpdate(
                            status=status_val,
                            result_url=url_val,
                            error_message=err_val
                        )
                        crud.update_command(db_session, command_id=cmd_id, command_update=cmd_update)
                    finally:
                        db_session.close()
            except json.JSONDecodeError:
                pass # Invalid JSON received, ignore
                
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[ERROR] Agent WebSocket error for device {device_id}: {e}")
    finally:
        manager.disconnect(device_id)
        # Always mark device offline when connection ends
        db_dis = next(database.get_db())
        try:
            device_dis = crud.get_device(db_dis, device_id=device_id)
            if device_dis:
                device_dis.is_online = False
                device_dis.last_seen = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                db_dis.commit()
        finally:
            db_dis.close()

@router.delete("/api/commands/{command_id}")
def delete_command_log(
    command_id: str,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    command = crud.get_command(db, command_id=command_id)
    if not command:
        raise HTTPException(status_code=404, detail="Command log not found")
    
    device = crud.get_device(db, device_id=command.device_id)
    if not device or device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this command log")
        
    crud.delete_command(db, command_id=command_id)
    return {"status": "success", "message": "Command log deleted successfully"}

@router.websocket("/api/devices/{device_id}/terminal/ws")
async def dashboard_terminal_websocket(
    websocket: WebSocket,
    device_id: str,
    token: str = Query(...)
):
    try:
        # Decode token to verify auth
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=[config.ALGORITHM])
        email = payload.get("sub")
        if not email:
            print("[ERROR] Terminal WebSocket connection failed: 'sub' not found in payload")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception as e:
        print(f"[ERROR] Terminal WebSocket JWT decoding failed: {e}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
        
    db = next(database.get_db())
    try:
        device = crud.get_device(db, device_id=device_id)
        user = crud.get_user_by_email(db, email=email)
        if not device or not user or device.user_id != user.id:
            print(f"[ERROR] Terminal WebSocket auth failed: device={device is not None}, user={user is not None}, owner_match={device.user_id == user.id if device and user else False}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    finally:
        db.close()

    await websocket.accept()
    manager.connect_dashboard(device_id, websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "terminal_input":
                    # Forward to agent WebSocket
                    agent_ws = manager.active_connections.get(device_id)
                    if agent_ws:
                        await agent_ws.send_text(json.dumps({
                            "type": "terminal_input",
                            "input": msg.get("input", "")
                        }))
                elif msg.get("type") in ["start_camera_stream", "stop_camera_stream", "start_screen_stream", "stop_screen_stream"]:
                    agent_ws = manager.active_connections.get(device_id)
                    if agent_ws:
                        await agent_ws.send_text(json.dumps({
                            "type": msg.get("type")
                        }))
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect_dashboard(device_id, websocket)
