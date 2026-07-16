from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from .. import crud, schemas, database, dependencies, models
from typing import List

router = APIRouter(prefix="/api/agent", tags=["Agent Telemetry"])

@router.post("/telemetry")
def upload_telemetry(
    telemetry: schemas.TelemetryCreate,
    device: models.Device = Depends(dependencies.get_device_by_api_key),
    db: Session = Depends(database.get_db)
):
    # Log telemetry
    db_telemetry = crud.create_telemetry(db, telemetry=telemetry, device_id=device.id)
    
    # Check for pending commands (polling fallback)
    pending_commands = crud.get_pending_commands(db, device_id=device.id)
    
    # Format response with any commands
    commands_list = []
    for cmd in pending_commands:
        commands_list.append({
            "id": cmd.id,
            "command_type": cmd.command_type,
            "payload": cmd.payload
        })
        # Mark command as SENT so it doesn't get sent again next time if agent takes time
        cmd.status = "SENT"
    
    if commands_list:
        db.commit()

    return {
        "status": "success",
        "pending_commands": commands_list,
        "polling_interval": device.polling_interval
    }
