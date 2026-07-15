import secrets
from sqlalchemy.orm import Session
from . import models, schemas, dependencies

# User operations
def get_user(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_user_by_email(db: Session, email: str):
    return db.query(models.User).filter(models.User.email == email).first()

def create_user(db: Session, user: schemas.UserCreate):
    hashed_pwd = dependencies.get_password_hash(user.password)
    db_user = models.User(email=user.email, hashed_password=hashed_pwd)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

# Device operations
def get_device(db: Session, device_id: str):
    return db.query(models.Device).filter(models.Device.id == device_id).first()

def get_device_by_api_key(db: Session, api_key: str):
    return db.query(models.Device).filter(models.Device.api_key == api_key).first()

def get_user_devices(db: Session, user_id: int):
    return db.query(models.Device).filter(models.Device.user_id == user_id).all()

def create_device(db: Session, device: schemas.DeviceCreate, user_id: int):
    # Generate a secure 32-character API key
    api_key = f"sentinel_{secrets.token_hex(16)}"
    db_device = models.Device(
        id=device.id,
        name=device.name,
        user_id=user_id,
        api_key=api_key,
        os=device.os,
        hostname=device.hostname,
        is_online=False
    )
    db.add(db_device)
    db.commit()
    db.refresh(db_device)
    return db_device

def update_device(db: Session, device_id: str, device_update: schemas.DeviceUpdate):
    db_device = get_device(db, device_id)
    if not db_device:
        return None
    for key, value in device_update.dict(exclude_unset=True).items():
        setattr(db_device, key, value)
    db.commit()
    db.refresh(db_device)
    return db_device

def delete_device(db: Session, device_id: str):
    db_device = get_device(db, device_id)
    if db_device:
        db.delete(db_device)
        db.commit()
        return True
    return False

# Telemetry operations
def create_telemetry(db: Session, telemetry: schemas.TelemetryCreate, device_id: str):
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    
    telemetry_data = telemetry.dict()
    telemetry_data.pop("os", None)
    telemetry_data.pop("hostname", None)
    
    db_telemetry = models.Telemetry(
        device_id=device_id,
        timestamp=now,
        **telemetry_data
    )
    db.add(db_telemetry)
    
    # Update device status
    db_device = get_device(db, device_id)
    if db_device:
        db_device.last_seen = now
        db_device.is_online = True
        if telemetry.os:
            db_device.os = telemetry.os
        if telemetry.hostname:
            db_device.hostname = telemetry.hostname
        
    db.commit()
    db.refresh(db_telemetry)
    return db_telemetry

def get_device_telemetry(db: Session, device_id: str, limit: int = 100):
    return db.query(models.Telemetry)\
        .filter(models.Telemetry.device_id == device_id)\
        .order_by(models.Telemetry.timestamp.desc())\
        .limit(limit).all()

# Command operations
def create_command(db: Session, command: schemas.CommandCreate):
    db_command = models.Command(
        device_id=command.device_id,
        command_type=command.command_type,
        payload=command.payload,
        status="PENDING"
    )
    db.add(db_command)
    db.commit()
    db.refresh(db_command)
    return db_command

def get_command(db: Session, command_id: str):
    return db.query(models.Command).filter(models.Command.id == command_id).first()

def get_device_commands(db: Session, device_id: str, limit: int = 50):
    return db.query(models.Command)\
        .filter(models.Command.device_id == device_id)\
        .order_by(models.Command.created_at.desc())\
        .limit(limit).all()

def get_pending_commands(db: Session, device_id: str):
    return db.query(models.Command)\
        .filter(models.Command.device_id == device_id, models.Command.status == "PENDING")\
        .order_by(models.Command.created_at.asc()).all()

def update_command(db: Session, command_id: str, command_update: schemas.CommandUpdate):
    db_command = get_command(db, command_id)
    if not db_command:
        return None
    for key, value in command_update.dict(exclude_unset=True).items():
        setattr(db_command, key, value)
    db.commit()
    db.refresh(db_command)
    return db_command

# Notification operations
def create_notification(db: Session, notification: schemas.NotificationBase, user_id: int):
    db_notification = models.Notification(
        user_id=user_id,
        device_id=notification.device_id,
        type=notification.type,
        message=notification.message
    )
    db.add(db_notification)
    db.commit()
    db.refresh(db_notification)
    return db_notification

def get_user_notifications(db: Session, user_id: int, limit: int = 50):
    return db.query(models.Notification)\
        .filter(models.Notification.user_id == user_id)\
        .order_by(models.Notification.sent_at.desc())\
        .limit(limit).all()

def delete_command(db: Session, command_id: str):
    db_command = get_command(db, command_id)
    if db_command:
        db.delete(db_command)
        db.commit()
        return True
    return False

def delete_telemetry(db: Session, telemetry_id: int):
    db_telemetry = db.query(models.Telemetry).filter(models.Telemetry.id == telemetry_id).first()
    if db_telemetry:
        db.delete(db_telemetry)
        db.commit()
        return True
    return False

def clear_device_telemetry(db: Session, device_id: str):
    db.query(models.Telemetry).filter(models.Telemetry.device_id == device_id).delete()
    db.commit()
    return True
