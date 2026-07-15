import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

# Load env variables from root/backend/.env or current path
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

_DEFAULT_SECRET = "supersecretjwtkeyforjwttokenschangeinproduction"
SECRET_KEY = os.getenv("SECRET_KEY", _DEFAULT_SECRET)
if SECRET_KEY == _DEFAULT_SECRET:
    print("[WARNING] SECRET_KEY is using the default insecure value! Set a unique SECRET_KEY in .env for production.")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

# CORS: comma-separated origins, defaults to wildcard for development
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

DATABASE_URL = os.getenv("DATABASE_URL")
DB_SSL_CA_PATH = os.getenv("DB_SSL_CA_PATH")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME")
CLOUDINARY_API_KEY = os.getenv("CLOUDINARY_API_KEY")
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET")

