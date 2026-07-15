from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

# Token Schemas
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

# User Schemas
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

# Device Schemas
class DeviceBase(BaseModel):
    id: str
    name: str
    os: Optional[str] = None
    hostname: Optional[str] = None

class DeviceCreate(DeviceBase):
    pass

class DeviceUpdate(BaseModel):
    name: Optional[str] = None

class Device(DeviceBase):
    user_id: int
    api_key: str
    last_seen: Optional[datetime] = None
    is_online: bool
    created_at: datetime

    class Config:
        from_attributes = True

# Telemetry Schemas
class TelemetryBase(BaseModel):
    uptime: Optional[int] = None
    battery_percent: Optional[int] = None
    battery_charging: Optional[bool] = None
    cpu_usage: Optional[float] = None
    ram_usage: Optional[float] = None
    disk_usage: Optional[float] = None
    public_ip: Optional[str] = None
    local_ip: Optional[str] = None
    mac_address: Optional[str] = None
    wifi_ssid: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None
    os: Optional[str] = None
    hostname: Optional[str] = None
    network_info: Optional[str] = None
    nearby_wifi: Optional[str] = None

class TelemetryCreate(TelemetryBase):
    pass

class Telemetry(TelemetryBase):
    id: int
    device_id: str
    timestamp: datetime

    class Config:
        from_attributes = True

# Command Schemas
class CommandBase(BaseModel):
    command_type: str
    payload: Optional[str] = None

class CommandCreate(CommandBase):
    device_id: str

class CommandUpdate(BaseModel):
    status: str
    result_url: Optional[str] = None
    error_message: Optional[str] = None

class CommandAutoReport(BaseModel):
    command_type: str
    status: str
    result_url: Optional[str] = None
    error_message: Optional[str] = None

class Command(CommandBase):
    id: str
    device_id: str
    status: str
    result_url: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# Notification Schemas
class NotificationBase(BaseModel):
    device_id: Optional[str] = None
    type: str
    message: str

class Notification(NotificationBase):
    id: int
    user_id: int
    sent_at: datetime

    class Config:
        from_attributes = True
