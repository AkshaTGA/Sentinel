import requests
import sys
import os
import uuid
import hashlib
import socket
from pathlib import Path

# Backend endpoints
BACKEND_URL = "http://127.0.0.1:8000"

def get_mac_address():
    mac = uuid.getnode()
    return ':'.join(('%012X' % mac)[i:i+2] for i in range(0, 12, 2))

def get_device_id():
    mac = get_mac_address()
    return hashlib.sha256(mac.encode('utf-8')).hexdigest()[:16]

def get_device_name():
    return socket.gethostname()

def setup():
    print("[*] Starting Local Test Setup...")
    
    # 1. Register test user
    print("[*] Registering test user...")
    register_url = f"{BACKEND_URL}/api/auth/register"
    user_data = {
        "email": "test@sentinel.com",
        "password": "password123"
    }
    
    try:
        res = requests.post(register_url, json=user_data)
        if res.status_code == 200:
            print("[+] Test user registered successfully.")
        elif res.status_code == 400 and "already registered" in res.json().get("detail", ""):
            print("[*] Test user already exists, proceeding to login...")
        else:
            print(f"[-] Registration failed: {res.text}")
            sys.exit(1)
    except Exception as e:
        print(f"[-] Error connecting to backend: {e}")
        print("    Please ensure the backend is running on http://127.0.0.1:8000")
        sys.exit(1)

    # 2. Get Access Token
    print("[*] Logging in...")
    token_url = f"{BACKEND_URL}/api/auth/token"
    login_data = {
        "username": "test@sentinel.com",
        "password": "password123"
    }
    res = requests.post(token_url, data=login_data)
    if res.status_code != 200:
        print(f"[-] Login failed: {res.text}")
        sys.exit(1)
        
    token = res.json().get("access_token")
    headers = {"Authorization": f"Bearer {token}"}
    print("[+] Logged in successfully.")

    # 3. Register Device
    device_id = get_device_id()
    device_name = get_device_name()
    print(f"[*] Registering device '{device_name}' (ID: {device_id})...")
    
    device_url = f"{BACKEND_URL}/api/devices"
    device_payload = {
        "id": device_id,
        "name": device_name,
        "os": sys.platform,
        "hostname": socket.gethostname()
    }
    
    res = requests.post(device_url, json=device_payload, headers=headers)
    
    if res.status_code == 200:
        api_key = res.json().get("api_key")
        print(f"[+] Device registered successfully.")
    elif res.status_code == 400 and "already registered" in res.json().get("detail", ""):
        # If already registered, we retrieve the device list to find the API key
        print("[*] Device already registered in DB. Fetching existing API key...")
        list_url = f"{BACKEND_URL}/api/devices"
        list_res = requests.get(list_url, headers=headers)
        if list_res.status_code == 200:
            devices = list_res.json()
            device_found = next((d for d in devices if d["id"] == device_id), None)
            if device_found:
                api_key = device_found["api_key"]
                print("[+] Retrieved existing API key.")
            else:
                print("[-] Device not found in listing.")
                sys.exit(1)
        else:
            print(f"[-] Failed to fetch device list: {list_res.text}")
            sys.exit(1)
    else:
        print(f"[-] Failed to register device: {res.text}")
        sys.exit(1)

    # 4. Write agent/.env
    env_content = f"""# Sentinel Agent Configuration

# Device Details
DEVICE_ID={device_id}
DEVICE_NAME={device_name}

# Backend Configuration
BACKEND_URL={BACKEND_URL}
BACKEND_WS_URL=ws://127.0.0.1:8000
DEVICE_API_KEY={api_key}

# Cloudinary Integration (Required for screenshots/webcam capture)
# Add your Cloudinary credentials here if you have them:
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
"""
    
    env_path = Path(__file__).resolve().parent / ".env"
    with open(env_path, "w") as f:
        f.write(env_content)
        
    print(f"[+] Successfully wrote configurations to {env_path}")
    print("[*] Local setup complete. You can now start the agent client!")

if __name__ == "__main__":
    setup()
