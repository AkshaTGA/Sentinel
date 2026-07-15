from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from . import config

# Try to connect to DATABASE_URL, fall back to SQLite on failure
db_url = "sqlite:///./sentinel.db"
connect_args = {"check_same_thread": False}

if config.DATABASE_URL:
    try:
        temp_db_url = config.DATABASE_URL
        temp_connect_args = {}
        
        # If using MySQL (pymysql) and SSL CA file is specified, pass it in connect_args
        if temp_db_url.startswith("mysql") and config.DB_SSL_CA_PATH:
            temp_connect_args = {
                "ssl": {
                    "ssl_ca": config.DB_SSL_CA_PATH
                }
            }
        elif temp_db_url.startswith("mysql") and "ssl_ca" not in temp_db_url:
            # Aiven MySQL requires SSL
            temp_connect_args = {
                "ssl": {}
            }
            
        # Test connection
        test_engine = create_engine(temp_db_url, connect_args=temp_connect_args)
        with test_engine.connect() as conn:
            pass
        
        # If connection test succeeded, commit to using it
        db_url = temp_db_url
        connect_args = temp_connect_args
        print("[INFO] Successfully connected to remote Aiven MySQL database.")
    except Exception as e:
        print(f"[WARNING] Database connection failed: {e}")
        print("[WARNING] Falling back to local SQLite database (sentinel.db) for development.")

engine = create_engine(db_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
