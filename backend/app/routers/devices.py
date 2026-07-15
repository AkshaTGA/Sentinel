from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List
import os
import shutil
import uuid
from .. import crud, schemas, database, dependencies, models

router = APIRouter(prefix="/api/devices", tags=["Devices"])

@router.get("", response_model=List[schemas.Device])
def list_devices(
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    return crud.get_user_devices(db, user_id=current_user.id)

@router.post("", response_model=schemas.Device)
def register_device(
    device: schemas.DeviceCreate,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    db_device = crud.get_device(db, device_id=device.id)
    if db_device:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Device with this ID is already registered"
        )
    return crud.create_device(db=db, device=device, user_id=current_user.id)

@router.get("/{device_id}", response_model=schemas.Device)
def get_device_details(
    device_id: str,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    device = crud.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this device")
    return device

@router.put("/{device_id}", response_model=schemas.Device)
def update_device_details(
    device_id: str,
    device_update: schemas.DeviceUpdate,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    device = crud.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this device")
    return crud.update_device(db, device_id=device_id, device_update=device_update)

@router.delete("/{device_id}")
def delete_device(
    device_id: str,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    device = crud.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this device")
    crud.delete_device(db, device_id=device_id)
    return {"status": "success", "message": "Device deleted successfully"}

@router.get("/{device_id}/telemetry", response_model=List[schemas.Telemetry])
def get_device_telemetry_logs(
    device_id: str,
    limit: int = 50,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    device = crud.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this device")
    return crud.get_device_telemetry(db, device_id=device_id, limit=limit)

@router.get("/{device_id}/commands", response_model=List[schemas.Command])
def get_device_command_history(
    device_id: str,
    limit: int = 50,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    device = crud.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this device")
    return crud.get_device_commands(db, device_id=device_id, limit=limit)

@router.delete("/{device_id}/telemetry")
def clear_all_telemetry(
    device_id: str,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    device = crud.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to clear telemetry logs")
        
    crud.clear_device_telemetry(db, device_id=device_id)
    return {"status": "success", "message": "Telemetry logs cleared successfully"}

@router.delete("/{device_id}/telemetry/{telemetry_id}")
def delete_single_telemetry(
    device_id: str,
    telemetry_id: int,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    device = crud.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete telemetry log")
        
    success = crud.delete_telemetry(db, telemetry_id=telemetry_id)
    if not success:
        raise HTTPException(status_code=404, detail="Telemetry log entry not found")
        
    return {"status": "success", "message": "Telemetry entry deleted successfully"}

TEMP_DOWNLOAD_DIR = "/tmp/sentinel_downloads"
os.makedirs(TEMP_DOWNLOAD_DIR, exist_ok=True)

# Background cleanup: remove download files older than 1 hour
import threading, time as _time

def _cleanup_old_downloads():
    _time.sleep(60)  # Initial delay
    while True:
        try:
            now = _time.time()
            for entry in os.listdir(TEMP_DOWNLOAD_DIR):
                entry_path = os.path.join(TEMP_DOWNLOAD_DIR, entry)
                if os.path.isdir(entry_path):
                    # Check age by directory modification time
                    if now - os.path.getmtime(entry_path) > 3600:  # 1 hour
                        shutil.rmtree(entry_path, ignore_errors=True)
        except Exception:
            pass
        _time.sleep(600)  # Check every 10 minutes

threading.Thread(target=_cleanup_old_downloads, daemon=True).start()

def _validate_uuid(value: str) -> bool:
    """Check that value looks like a valid UUID (prevents path traversal via unique_id)."""
    import re
    return bool(re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', value))

@router.post("/{device_id}/upload-file")
def upload_device_file(
    device_id: str,
    file: UploadFile = File(...),
    device: models.Device = Depends(dependencies.get_device_by_api_key)
):
    if device.id != device_id:
        raise HTTPException(status_code=403, detail="Device ID mismatch")
        
    unique_id = str(uuid.uuid4())
    safe_filename = "".join([c for c in file.filename if c.isalnum() or c in "._-"])
    if not safe_filename:
        safe_filename = "download"
    dest_dir = os.path.join(TEMP_DOWNLOAD_DIR, unique_id)
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, safe_filename)
    
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    download_url = f"/api/devices/{device_id}/download-file/{unique_id}/{safe_filename}"
    return {"status": "success", "download_url": download_url}

@router.get("/{device_id}/download-file/{unique_id}/{filename}")
def download_device_file(
    device_id: str,
    unique_id: str,
    filename: str,
    current_user: schemas.User = Depends(dependencies.get_current_user),
    db: Session = Depends(database.get_db)
):
    device = crud.get_device(db, device_id=device_id)
    if not device or device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this device's files")
    
    # Validate unique_id is a proper UUID to prevent path traversal
    if not _validate_uuid(unique_id):
        raise HTTPException(status_code=400, detail="Invalid download ID")
    
    # Strip any path separators from filename
    safe_filename = os.path.basename(filename)
    
    file_path = os.path.realpath(os.path.join(TEMP_DOWNLOAD_DIR, unique_id, safe_filename))
    # Ensure resolved path is still inside TEMP_DOWNLOAD_DIR (prevents symlink attacks)
    if not file_path.startswith(os.path.realpath(TEMP_DOWNLOAD_DIR)):
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found or expired")
    return FileResponse(
        path=file_path,
        filename=safe_filename,
        media_type="application/octet-stream"
    )

