from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base
from .routers import auth, devices, telemetry, commands
from . import config

# Create tables in the database automatically
# Alembic could be used, but for simplicity and automatic self-hosting initialization,
# creating tables directly is highly reliable.
Base.metadata.create_all(bind=engine)

def database_cleanup_loop():
    import time
    import datetime
    from . import models, database
    # Let the server bind and startup fully first
    time.sleep(5)
    while True:
        try:
            db = next(database.get_db())
            try:
                limit_date = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(days=20)
                
                # Delete old telemetry
                deleted_telemetry = db.query(models.Telemetry).filter(models.Telemetry.timestamp < limit_date).delete()
                
                # Delete old commands
                deleted_commands = db.query(models.Command).filter(models.Command.created_at < limit_date).delete()
                
                db.commit()
                print(f"[INFO] Database cleanup done. Purged {deleted_telemetry} telemetry entries and {deleted_commands} commands older than 20 days.")
            finally:
                db.close()
        except Exception as e:
            print(f"[ERROR] Database cleanup failed: {e}")
        
        # Sleep for 12 hours
        time.sleep(12 * 3600)

@asynccontextmanager
async def lifespan(app: FastAPI):
    import threading
    threading.Thread(target=database_cleanup_loop, daemon=True).start()
    yield

app = FastAPI(
    title="Sentinel API",
    description="Backend API for Sentinel Linux Anti-Theft & Device Management Platform",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware configuration
# Set CORS_ORIGINS in .env (comma-separated) for production, e.g. "https://dashboard.example.com"
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(telemetry.router)
app.include_router(commands.router)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Sentinel Backend API",
        "version": "1.0.0"
    }

@app.get("/api/agent/setup_test_device.py")
def get_setup_test_device_script(token: str = None):
    script_path = Path(__file__).resolve().parent.parent.parent / "agent" / "setup_test_device.py"
    if not script_path.exists():
        raise HTTPException(status_code=404, detail="Setup script not found")
    
    with open(script_path, "r") as f:
        content = f.read()
        
    if token:
        content = content.replace("EMBEDDED_TOKEN = None  # DYNAMIC_TOKEN_PLACEHOLDER", f'EMBEDDED_TOKEN = "{token}"')
        
    return Response(content, media_type="text/plain")
