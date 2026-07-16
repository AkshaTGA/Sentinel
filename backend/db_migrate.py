import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.database import engine
from sqlalchemy import text

def migrate():
    with engine.connect() as conn:
        print("Checking if devices.polling_interval column exists...")
        # MySQL/Aiven database check
        try:
            res = conn.execute(text("SHOW COLUMNS FROM devices LIKE 'polling_interval'"))
            row = res.fetchone()
            if not row:
                print("Column polling_interval not found. Adding column to MySQL devices table...")
                # Note: SQLAlchemy 2.0 connection.execute requires committing explicitly
                conn.execute(text("ALTER TABLE devices ADD COLUMN polling_interval INT DEFAULT 60"))
                try:
                    conn.commit()
                except Exception:
                    pass # SQLite or transactional connection might auto-commit or fail on commit
                print("Column polling_interval added successfully.")
            else:
                print("Column polling_interval already exists.")
        except Exception as e:
            # SQLite / fallback check
            print(f"Non-MySQL or other connection state: {e}. Trying SQLite ALTER TABLE command...")
            try:
                conn.execute(text("ALTER TABLE devices ADD COLUMN polling_interval INTEGER DEFAULT 60"))
                try:
                    conn.commit()
                except Exception:
                    pass
                print("SQLite: Column polling_interval added successfully.")
            except Exception as se:
                print(f"SQLite column already exists or migration failed: {se}")

if __name__ == "__main__":
    migrate()
