import sys
import os
import uuid
import hashlib
import socket
from pathlib import Path
import urllib.request
import urllib.error
import urllib.parse
import json

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

def make_request(url, method="GET", data=None, headers=None, is_json=True):
    if headers is None:
        headers = {}
    
    req_data = None
    if data is not None:
        if is_json:
            req_data = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        else:
            req_data = urllib.parse.urlencode(data).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            res_json = {}
            if res_body:
                try:
                    res_json = json.loads(res_body)
                except Exception:
                    pass
            return response.status, res_body, res_json
    except urllib.error.HTTPError as e:
        res_body = e.read().decode("utf-8")
        res_json = {}
        if res_body:
            try:
                res_json = json.loads(res_body)
            except Exception:
                pass
        return e.code, res_body, res_json
    except urllib.error.URLError as e:
        print(f"[-] Network connection error: {e.reason}")
        return 0, str(e.reason), {}
    except Exception as e:
        return 0, str(e), {}

EMBEDDED_TOKEN = None  # DYNAMIC_TOKEN_PLACEHOLDER

def setup():
    print("[*] Starting Sentinel Device Setup...")
    
    token = None
    if EMBEDDED_TOKEN:
        token = EMBEDDED_TOKEN
        print("[+] Using embedded authorization token.")
    else:
        # Check if we can prompt the user interactively
        email = "test@sentinel.com"
        password = "password123"
        
        try:
            # Use /dev/tty to allow reading user input even when stdin is piped (e.g. curl | python3)
            with open('/dev/tty', 'r') as tty:
                print("\n--- Sentinel Authentication ---")
                print("Enter your Sentinel Email [default: test@sentinel.com]: ", end='', flush=True)
                input_email = tty.readline().strip()
                if input_email:
                    email = input_email
                    
                print("Enter your Sentinel Password [default: password123]: ", end='', flush=True)
                input_password = tty.readline().strip()
                if input_password:
                    password = input_password
                print("--------------------------------\n")
        except Exception:
            print("[*] Non-interactive execution or /dev/tty unavailable. Using default credentials.")

        # Register user first if they do not exist
        register_url = f"{BACKEND_URL}/api/auth/register"
        user_data = {
            "email": email,
            "password": password
        }
        status_code, text, res_json = make_request(register_url, method="POST", data=user_data)
        if status_code == 200:
            print(f"[+] Account '{email}' registered successfully.")
        elif status_code == 400 and "already registered" in res_json.get("detail", ""):
            print(f"[*] Account '{email}' already exists, logging in...")
        else:
            print(f"[-] Registration warning: {text}")

        # Login to get JWT
        print(f"[*] Authenticating '{email}'...")
        token_url = f"{BACKEND_URL}/api/auth/token"
        login_data = {
            "username": email,
            "password": password
        }
        status_code, text, res_json = make_request(token_url, method="POST", data=login_data, is_json=False)
        if status_code != 200:
            print(f"[-] Authentication failed: {text}")
            sys.exit(1)
            
        token = res_json.get("access_token")
        
    headers = {"Authorization": f"Bearer {token}"}
    print("[+] Authenticated successfully.")

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
    
    status_code, text, res_json = make_request(device_url, method="POST", data=device_payload, headers=headers)
    
    if status_code == 200:
        api_key = res_json.get("api_key")
        print(f"[+] Device registered successfully.")
    elif status_code == 400 and "already registered" in res_json.get("detail", ""):
        # If already registered, we retrieve the device list to find the API key
        print("[*] Device already registered in DB. Fetching existing API key...")
        list_url = f"{BACKEND_URL}/api/devices"
        list_status_code, list_text, list_json = make_request(list_url, method="GET", headers=headers)
        if list_status_code == 200:
            devices = list_json
            device_found = next((d for d in devices if d["id"] == device_id), None)
            if device_found:
                api_key = device_found["api_key"]
                print("[+] Retrieved existing API key.")
            else:
                print("[-] Device is registered under a DIFFERENT user account. Cannot retrieve API key.")
                sys.exit(1)
        else:
            print(f"[-] Failed to fetch device list: {list_text}")
            sys.exit(1)
    else:
        print(f"[-] Failed to register device: {text}")
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
CLOUDINARY_CLOUD_NAME=dejqi566q
CLOUDINARY_API_KEY=724646423279463
CLOUDINARY_API_SECRET=WdP2G5eSm-sLJ3pDjRqcrLaH0CA
"""
    
    # Resolve the destination .env path dynamically and robustly:
    if Path("agent").is_dir():
        env_path = Path("agent") / ".env"
    elif Path("../agent").is_dir():
        env_path = Path("../agent") / ".env"
    else:
        # Fallback to local file path resolve if __file__ is available
        try:
            env_path = Path(__file__).resolve().parent / ".env"
        except NameError:
            env_path = Path(".env")
            
    with open(env_path, "w") as f:
        f.write(env_content)
        
    print(f"[+] Successfully wrote configurations to {env_path.resolve()}")
    
    # Automatically start the agent client in the background
    import subprocess
    agent_path = env_path.parent / "agent.py"
    if agent_path.exists():
        print(f"[*] Starting Sentinel Agent client ({agent_path.resolve()})...")
        try:
            # Use the local virtual environment Python if available to ensure dependencies are loaded
            python_executable = sys.executable
            venv_python = env_path.parent / "venv" / "bin" / "python3"
            if venv_python.exists():
                python_executable = str(venv_python.resolve())
                
            # Use os.setpgrp to decouple/detach the background process so it survives terminal closures
            subprocess.Popen(
                [python_executable, str(agent_path)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                preexec_fn=os.setpgrp if sys.platform != "win32" else None
            )
            print("[+] Agent client started in the background successfully.")
        except Exception as e:
            print(f"[WARN] Failed to automatically start agent: {e}")
    else:
        print("[*] Setup complete. You can now start the agent client!")

if __name__ == "__main__":
    setup()
