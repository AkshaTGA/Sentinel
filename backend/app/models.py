import datetime
import uuid
from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from .database import Base

def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utc_now)

    devices = relationship("Device", back_populates="owner")
    notifications = relationship("Notification", back_populates="user")

class Device(Base):
    __tablename__ = "devices"

    id = Column(String(255), primary_key=True, index=True) # Usually MAC hash or unique UUID
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(255), nullable=False)
    api_key = Column(String(255), unique=True, index=True, nullable=False)
    os = Column(String(255), nullable=True)
    hostname = Column(String(255), nullable=True)
    last_seen = Column(DateTime, nullable=True)
    is_online = Column(Boolean, default=False)
    polling_interval = Column(Integer, default=60)
    created_at = Column(DateTime, default=utc_now)

    owner = relationship("User", back_populates="devices")
    telemetries = relationship("Telemetry", back_populates="device", cascade="all, delete-orphan")
    commands = relationship("Command", back_populates="device", cascade="all, delete-orphan")

class Telemetry(Base):
    __tablename__ = "telemetry"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(255), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    uptime = Column(Integer, nullable=True) # in seconds
    battery_percent = Column(Integer, nullable=True)
    battery_charging = Column(Boolean, nullable=True)
    cpu_usage = Column(Float, nullable=True)
    ram_usage = Column(Float, nullable=True)
    disk_usage = Column(Float, nullable=True)
    public_ip = Column(String(100), nullable=True)
    local_ip = Column(String(100), nullable=True)
    mac_address = Column(String(100), nullable=True)
    wifi_ssid = Column(String(255), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    accuracy = Column(Float, nullable=True)
    network_info = Column(Text, nullable=True)
    nearby_wifi = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=utc_now)

    device = relationship("Device", back_populates="telemetries")

class Command(Base):
    __tablename__ = "commands"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    device_id = Column(String(255), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    command_type = Column(String(100), nullable=False) # SCREENSHOT, WEBCAM, LOCK, SHUTDOWN, RESTART, MESSAGE, ALARM
    payload = Column(Text, nullable=True) # JSON payload parameter
    status = Column(String(50), default="PENDING") # PENDING, SENT, EXECUTED, FAILED
    result_url = Column(Text, nullable=True) # Cloudinary media URL
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    device = relationship("Device", back_populates="commands")

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    device_id = Column(String(255), nullable=True)
    type = Column(String(100), nullable=False)
    message = Column(Text, nullable=False)
    sent_at = Column(DateTime, default=utc_now)

    user = relationship("User", back_populates="notifications")
