import os
import sys
import time
import socket
import uuid
import platform
import hashlib
import json
import threading
import subprocess
import requests
# Monkeypatch requests to bypass Cloudflare Browser Integrity Check (Error 1010)
original_request = requests.sessions.Session.request
def custom_request(self, method, url, *args, **kwargs):
    headers = kwargs.get('headers') or {}
    if 'User-Agent' not in headers:
        headers['User-Agent'] = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        kwargs['headers'] = headers
    return original_request(self, method, url, *args, **kwargs)
requests.sessions.Session.request = custom_request

from pathlib import Path
from dotenv import load_dotenv
import select
cv2 = None
try:
    import cv2
except Exception as e:
    error_str = str(e)
    print(f"[INFO] Initial cv2 import failed: {e}. Attempting self-healing...")
    try:
        import subprocess
        # Use sys.executable to run pip in the current virtual environment robustly
        print("[INFO] Downgrading/Installing NumPy < 2.0.0 and reinstating OpenCV...")
        res = subprocess.run(
            [sys.executable, "-m", "pip", "install", "numpy>=1.20,<2.0.0", "opencv-python-headless"],
            capture_output=True,
            text=True
        )
        if res.returncode == 0:
            print("[INFO] Dependencies installed successfully. Restarting agent to apply changes...")
            os.execv(sys.executable, [sys.executable] + sys.argv)
        else:
            print(f"[WARN] pip install returned error: {res.stderr}")
    except Exception as inner_e:
        print(f"[WARN] Self-healing failed: {inner_e}")


# Load agent environment variables
config_path = None
possible_paths = [
    os.environ.get("SENTINEL_CONFIG_PATH"),
    "/etc/sentinel/agent.conf",
    os.path.expanduser("~/.config/sentinel/agent.conf"),
    str(Path(__file__).resolve().parent / ".env"),
    str(Path(sys.argv[0]).resolve().parent / ".env"),
    ".env"
]

for p in possible_paths:
    if p and os.path.exists(p):
        config_path = Path(p)
        break

if config_path:
    print(f"[INFO] Loading configuration from: {config_path}")
    load_dotenv(dotenv_path=config_path)
else:
    print("[WARN] No configuration file (.env or agent.conf) found. Using system environment variables.")

def handle_unauthorized():
    print("[FATAL] Device is not registered or API key is invalid on backend. Wiping configuration and shutting down.", file=sys.stderr)
    try:
        global config_path
        if config_path and os.path.exists(config_path):
            os.remove(config_path)
            print(f"[INFO] Config file {config_path} successfully deleted.", file=sys.stderr)
    except Exception as e:
        print(f"[WARN] Failed to remove config file: {e}", file=sys.stderr)
    os._exit(99)

import pty
import termios

class PersistentShell:
    def __init__(self):
        self.master_fd, self.slave_fd = pty.openpty()
        self.output_buffer = []
        
        # Set TERM environment variable for interactive commands like clear, nano, top
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"

        self.process = subprocess.Popen(
            ["/bin/bash"],
            stdin=self.slave_fd,
            stdout=self.slave_fd,
            stderr=self.slave_fd,
            text=True,
            bufsize=0,
            preexec_fn=os.setsid,
            env=env
        )
        # Close slave file descriptor in parent process to avoid hangs
        os.close(self.slave_fd)
        
        # Start PTY background reader thread
        threading.Thread(target=self._reader_loop, daemon=True).start()

    def _reader_loop(self):
        global active_ws
        while True:
            try:
                r, _, _ = select.select([self.master_fd], [], [], 0.2)
                if r:
                    data = os.read(self.master_fd, 4096).decode('utf-8', errors='replace')
                    if data:
                        self.output_buffer.append(data)
                        if len(self.output_buffer) > 2000:
                            self.output_buffer = self.output_buffer[-1000:]
                        if active_ws:
                            try:
                                active_ws.send(json.dumps({
                                    "type": "terminal_output",
                                    "output": data
                                }))
                            except Exception:
                                pass
            except Exception:
                time.sleep(0.5)

    def execute(self, command: str, timeout: float = 15.0) -> str:
        delimiter = "===SENTINEL_SHELL_DONE==="
        self.output_buffer.clear()
        
        # Write command and output boundary check
        payload = command + f"\necho '{delimiter}'\n"
        try:
            os.write(self.master_fd, payload.encode('utf-8'))
        except Exception as e:
            # If write fails, try restarting the shell session
            self.__init__()
            os.write(self.master_fd, payload.encode('utf-8'))

        start_time = time.time()
        
        while True:
            if time.time() - start_time > timeout:
                return "".join(list(self.output_buffer)) + "\n[Command execution timed out]"
            
            full_output = "".join(list(self.output_buffer))
            if delimiter in full_output:
                # Clean delimiter from output buffer
                full_output = full_output.replace(f"\r\n{delimiter}\r\n", "")
                full_output = full_output.replace(f"\n{delimiter}\n", "")
                full_output = full_output.replace(delimiter, "")
                return full_output
                
            time.sleep(0.05)


# Global shell instance and active socket reference
active_ws = None
try:
    shell_instance = PersistentShell()
except Exception as e:
    print(f"[WARN] Failed to initialize shell instance: {e}")
    shell_instance = None

# Configuration defaults
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
BACKEND_WS_URL = os.getenv("BACKEND_WS_URL", "ws://localhost:8000")
DEVICE_API_KEY = os.getenv("DEVICE_API_KEY")

if not DEVICE_API_KEY:
    print("[ERROR] DEVICE_API_KEY is not configured in .env file. Agent cannot authenticate.", file=sys.stderr)

# Initialize device credentials
def get_mac_address():
    mac = uuid.getnode()
    return ':'.join(('%012X' % mac)[i:i+2] for i in range(0, 12, 2))

def get_device_id():
    custom_id = os.getenv("DEVICE_ID")
    if custom_id:
        return custom_id
    # Default to SHA-256 hash of MAC address to keep it unique but persistent
    mac = get_mac_address()
    return hashlib.sha256(mac.encode('utf-8')).hexdigest()[:16]

def get_device_name():
    custom_name = os.getenv("DEVICE_NAME")
    if custom_name:
        return custom_name
    return socket.gethostname()

DEVICE_ID = get_device_id()
DEVICE_NAME = get_device_name()

print(f"[INFO] Initializing Sentinel Agent for Device: {DEVICE_NAME} (ID: {DEVICE_ID})")

# System Metric Collectors
def get_uptime():
    try:
        with open('/proc/uptime', 'r') as f:
            uptime_seconds = float(f.readline().split()[0])
            return int(uptime_seconds)
    except Exception:
        # Fallback using psutil
        import psutil
        return int(time.time() - psutil.boot_time())

def get_wifi_ssid():
    # Try using nmcli
    try:
        ssid = subprocess.check_output(
            "nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d':' -f2", 
            shell=True, stderr=subprocess.DEVNULL
        ).decode().strip()
        if ssid:
            return ssid
    except Exception:
        pass
    
    # Try using iwgetid
    try:
        ssid = subprocess.check_output("iwgetid -r", shell=True, stderr=subprocess.DEVNULL).decode().strip()
        if ssid:
            return ssid
    except Exception:
        pass
    
    return "Disconnected"

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Doesn't need to connect, just opens socket local interface routing
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except Exception:
        return "127.0.0.1"

def get_nearby_wifi():
    networks = []
    try:
        if sys.platform.startswith('linux'):
            # Try nmcli
            try:
                out = subprocess.check_output(
                    ["nmcli", "-t", "-f", "SSID,SIGNAL,BARS", "dev", "wifi", "list"],
                    stderr=subprocess.DEVNULL
                ).decode('utf-8', errors='ignore')
                for line in out.strip().split('\n'):
                    if not line.strip():
                        continue
                    parts = line.split(':')
                    if len(parts) >= 2 and parts[0].strip():
                        networks.append({
                            "ssid": parts[0].strip(),
                            "signal": parts[1].strip() + "%"
                        })
            except Exception:
                # Fallback: scan with iwlist if possible
                try:
                    out = subprocess.check_output(
                        ["iwlist", "wlan0", "scanning"],
                        stderr=subprocess.DEVNULL
                    ).decode('utf-8', errors='ignore')
                    import re
                    cells = out.split('Cell ')
                    for cell in cells:
                        ssid_match = re.search(r'ESSID:"([^"]+)"', cell)
                        signal_match = re.search(r'Quality=([^ ]+)', cell)
                        if ssid_match:
                            networks.append({
                                "ssid": ssid_match.group(1),
                                "signal": signal_match.group(1) if signal_match else "unknown"
                            })
                except Exception:
                    pass
    except Exception:
        pass
    # Limit to top 15 networks to keep payload reasonable
    return json.dumps(networks[:15])

def get_network_info():
    import psutil
    interfaces = {}
    try:
        for interface_name, interface_addresses in psutil.net_if_addrs().items():
            # Skip loopback
            if interface_name == 'lo' or interface_name.startswith('loop'):
                continue
            addrs = []
            for address in interface_addresses:
                family_str = "IPv4" if "AF_INET" in str(address.family) else ("IPv6" if "AF_INET6" in str(address.family) else "MAC/Other")
                addrs.append({
                    "family": family_str,
                    "address": address.address,
                    "netmask": address.netmask or ""
                })
            interfaces[interface_name] = addrs
    except Exception as e:
        interfaces["error"] = str(e)
    return json.dumps(interfaces)

def get_os_info():
    import platform
    try:
        if sys.platform.startswith('linux'):
            if os.path.exists('/etc/os-release'):
                with open('/etc/os-release') as f:
                    for line in f:
                        if line.startswith('PRETTY_NAME='):
                            return line.split('=')[1].strip().strip('"')
            return f"Linux {platform.release()}"
        return f"{platform.system()} {platform.release()}"
    except Exception:
        return platform.system()

def get_location_and_ip():
    # Fetch public IP and GeoIP coordinates
    try:
        res = requests.get("https://ipapi.co/json/", timeout=5)
        if res.status_code == 200:
            data = res.json()
            return {
                "public_ip": data.get("ip"),
                "latitude": data.get("latitude"),
                "longitude": data.get("longitude"),
                "accuracy": 1000.0, # Default estimation accuracy in meters
                "city": data.get("city")
            }
    except Exception:
        pass
    
    # Fallback ipinfo
    try:
        res = requests.get("https://ipinfo.io/json", timeout=5)
        if res.status_code == 200:
            data = res.json()
            loc = data.get("loc", "").split(",")
            lat = float(loc[0]) if len(loc) > 0 else None
            lon = float(loc[1]) if len(loc) > 1 else None
            return {
                "public_ip": data.get("ip"),
                "latitude": lat,
                "longitude": lon,
                "accuracy": 2000.0,
                "city": data.get("city")
            }
    except Exception:
        pass
        
    return {
        "public_ip": "Unknown",
        "latitude": None,
        "longitude": None,
        "accuracy": None,
        "city": None
    }

def gather_telemetry():
    import psutil
    
    battery = psutil.sensors_battery()
    battery_percent = int(battery.percent) if battery else None
    battery_charging = battery.power_plugged if battery else None
    
    loc_data = get_location_and_ip()
    
    return {
        "uptime": get_uptime(),
        "battery_percent": battery_percent,
        "battery_charging": battery_charging,
        "cpu_usage": psutil.cpu_percent(interval=None),
        "ram_usage": psutil.virtual_memory().percent,
        "disk_usage": psutil.disk_usage('/').percent,
        "public_ip": loc_data["public_ip"],
        "local_ip": get_local_ip(),
        "mac_address": get_mac_address(),
        "wifi_ssid": get_wifi_ssid(),
        "latitude": loc_data["latitude"],
        "longitude": loc_data["longitude"],
        "accuracy": loc_data["accuracy"],
        "os": get_os_info(),
        "hostname": socket.gethostname(),
        "network_info": get_network_info(),
        "nearby_wifi": get_nearby_wifi()
    }

# Upload Media to Backend Server (which proxies to Cloudinary)
def upload_to_backend(filepath, resource_type="image", command_id=None, command_type=None):
    """Upload a media file to the backend server for cloud storage.
    
    The backend will immediately mark the command as UPLOADING and then
    upload to Cloudinary in the background. Returns the command_id.
    """
    url = f"{BACKEND_URL}/api/agent/upload-media"
    headers = {"X-Device-API-Key": DEVICE_API_KEY}
    
    data = {"resource_type": resource_type}
    if command_id:
        data["command_id"] = command_id
    if command_type:
        data["command_type"] = command_type
    
    with open(filepath, 'rb') as f:
        files = {'file': (os.path.basename(filepath), f)}
        res = requests.post(url, files=files, data=data, headers=headers, timeout=60)
    res.raise_for_status()
    return res.json()

# Remote Command Execution Modules
def get_x11_env():
    env = os.environ.copy()
    uid = os.getuid()
    import pwd
    
    pids = []
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            pids.append(int(pid))
    pids.sort()
    
    # Pass 1: Look for processes owned by interactive users (UID >= 1000 and < 65534)
    # Pass 2: Fallback to any process (if uid == 0 we can read all; else only ours)
    for pass_num in (1, 2):
        for pid in pids:
            try:
                stat = os.stat(f"/proc/{pid}")
                if pass_num == 1:
                    if stat.st_uid < 1000 or stat.st_uid >= 65534:
                        continue
                elif uid != 0 and stat.st_uid != uid:
                    continue
                    
                with open(f"/proc/{pid}/environ", "rb") as f:
                    environ_bytes = f.read()
                environ_data = environ_bytes.decode("utf-8", errors="ignore")
                process_env = {}
                for item in environ_data.split("\x00"):
                    if "=" in item:
                        k, v = item.split("=", 1)
                        process_env[k] = v
                        
                if "DISPLAY" in process_env or "WAYLAND_DISPLAY" in process_env or "DBUS_SESSION_BUS_ADDRESS" in process_env:
                    found_any = False
                    for key in ["DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]:
                        if key in process_env and process_env[key]:
                            if key == "XAUTHORITY" and not os.path.exists(process_env[key]):
                                continue
                            env[key] = process_env[key]
                            found_any = True
                    if found_any:
                        try:
                            username = pwd.getpwuid(stat.st_uid).pw_name
                        except Exception:
                            username = "root"
                        return env, username
            except Exception:
                continue
                
    # Fallback to defaults if proc scanning failed
    if "DISPLAY" not in env:
        env["DISPLAY"] = ":0"
    if "XAUTHORITY" not in env:
        try:
            for p in pwd.getpwall():
                if p.pw_uid >= 1000 and p.pw_uid < 65534:
                    xauth = os.path.join(p.pw_dir, ".Xauthority")
                    if os.path.exists(xauth):
                        env["XAUTHORITY"] = xauth
                        try:
                            username = pwd.getpwuid(p.pw_uid).pw_name
                        except Exception:
                            username = "root"
                        return env, username
        except Exception:
            pass
    return env, "root"

def wrap_user_cmd(cmd, env, username):
    uid = os.getuid()
    if uid == 0 and username != "root":
        env_args = []
        for k in ["DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]:
            if k in env and env[k]:
                env_args.append(f"{k}={env[k]}")
        return ["sudo", "-u", username, "env"] + env_args + cmd
    return cmd

def resolve_user_path(path_str):
    if not path_str:
        return Path("/")
    
    # If the path starts with '~', resolve it to the interactive user's home dir if running as root
    if path_str.startswith("~"):
        try:
            env, username = get_x11_env()
            if username and username != "root":
                import pwd
                user_home = pwd.getpwnam(username).pw_dir
                path_str = path_str.replace("~", user_home, 1)
        except Exception as e:
            print(f"[WARN] Failed to resolve user home directory for path expansion: {e}")
            
    return Path(path_str).expanduser().resolve()

environ_lock = threading.Lock()

def execute_screenshot():
    filename = f"/tmp/screenshot_{int(time.time())}.png"
    env, username = get_x11_env()
    uid = os.getuid()
    
    # 1. Try gnome-screenshot (standard on GNOME systems, supports Wayland natively)
    try:
        # Disable visual flash and shutter sound before screenshot (ignore fail)
        gsettings_cmd_anim = wrap_user_cmd(["gsettings", "set", "org.gnome.desktop.interface", "enable-animations", "false"], env, username)
        gsettings_cmd_sounds = wrap_user_cmd(["gsettings", "set", "org.gnome.desktop.sound", "event-sounds", "false"], env, username)
        subprocess.run(gsettings_cmd_anim, env=env, stderr=subprocess.DEVNULL)
        subprocess.run(gsettings_cmd_sounds, env=env, stderr=subprocess.DEVNULL)

        cmd = wrap_user_cmd(["gnome-screenshot", "-f", filename], env, username)
        subprocess.run(cmd, env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.exists(filename):
            return filename
    except Exception:
        pass

    # 2. Try grim (Sway / Hyprland Wayland compositor screenshot tool)
    try:
        cmd = wrap_user_cmd(["grim", filename], env, username)
        subprocess.run(cmd, env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.exists(filename):
            return filename
    except Exception:
        pass

    # 3. Try scrot (very lightweight X11 fallback tool)
    try:
        cmd = wrap_user_cmd(["scrot", filename], env, username)
        subprocess.run(cmd, env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.exists(filename):
            return filename
    except Exception:
        pass

    # 4. Fallback to mss (for standard X11 environments)
    with environ_lock:
        import mss
        old_display = os.environ.get("DISPLAY")
        old_xauth = os.environ.get("XAUTHORITY")
        try:
            os.environ["DISPLAY"] = env.get("DISPLAY", ":0")
            if "XAUTHORITY" in env:
                os.environ["XAUTHORITY"] = env["XAUTHORITY"]
            with mss.mss() as sct:
                sct.shot(output=filename)
            if os.path.exists(filename):
                return filename
        except Exception as e:
            raise Exception(f"All screenshot methods failed. Last error: {e}")
        finally:
            if old_display is not None:
                os.environ["DISPLAY"] = old_display
            else:
                os.environ.pop("DISPLAY", None)
            if old_xauth is not None:
                os.environ["XAUTHORITY"] = old_xauth
            else:
                os.environ.pop("XAUTHORITY", None)

def execute_webcam():
    global cv2
    if cv2 is None:
        try:
            import cv2
        except Exception as e:
            raise Exception(f"OpenCV (cv2) is not available: {e}")
    if cv2 is None:
        raise Exception("OpenCV (cv2) library is not available.")
    filename = f"/tmp/webcam_{int(time.time())}.png"
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise Exception("Could not open webcam or webcam not connected.")
    
    # Warm up camera
    for _ in range(5):
        cap.read()
        
    ret, frame = cap.read()
    if not ret:
        cap.release()
        raise Exception("Failed to grab webcam frame.")
        
    cv2.imwrite(filename, frame)
    cap.release()
    return filename

def display_message(text):
    import subprocess
    env, username = get_x11_env()
    uid = os.getuid()
        
    # Attempt zenity warning (list form — no shell injection)
    try:
        cmd = wrap_user_cmd(["zenity", "--warning", f"--text={text}", "--title=Sentinel Remote System", "--timeout=30"], env, username)
        subprocess.Popen(
            cmd,
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        return True
    except Exception:
        pass
        
    # Fallback to notify-send (list form)
    try:
        cmd = wrap_user_cmd(["notify-send", "Sentinel Remote System", text], env, username)
        subprocess.Popen(
            cmd,
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        return True
    except Exception:
        return False

alarm_process = None

def trigger_alarm():
    global alarm_process
    import subprocess
    # If already running, do not spawn another instance
    if alarm_process and alarm_process.poll() is None:
        return True
    try:
        env, username = get_x11_env()
        # speaker-test should be run as the session user to access their PulseAudio/PipeWire session
        cmd = wrap_user_cmd(["speaker-test", "-t", "sine", "-f", "800"], env, username)
        alarm_process = subprocess.Popen(
            cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        return True
    except Exception:
        return False

def stop_alarm():
    global alarm_process
    import subprocess
    if alarm_process:
        try:
            alarm_process.terminate()
            alarm_process.wait(timeout=1)
        except Exception:
            pass
        alarm_process = None
    
    # Fallback to killing any remaining speaker-test processes
    try:
        subprocess.run("pkill -f speaker-test", shell=True, stderr=subprocess.DEVNULL)
    except Exception:
        pass
    return True

def execute_lock_screen():
    import subprocess
    env, username = get_x11_env()
    uid = os.getuid()
    lock_commands = [
        ["loginctl", "lock-sessions"],
        ["loginctl", "lock-session"],
        ["xdg-screensaver", "lock"],
        ["gnome-screensaver-command", "-l"],
        ["dbus-send", "--type=method_call", "--dest=org.gnome.ScreenSaver", "/org/gnome/ScreenSaver", "org.gnome.ScreenSaver.Lock"]
    ]
    for cmd in lock_commands:
        try:
            # For loginctl, running as root directly is better; for others, run as user session
            if cmd[0] != "loginctl":
                cmd = wrap_user_cmd(cmd, env, username)
            res = subprocess.run(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if res.returncode == 0:
                return True
        except Exception:
            continue
    raise Exception("No supported lock command found on system.")

def execute_command(command_type, payload, command_id=None):
    global shell_instance, is_streaming_camera, is_streaming_screen
    global is_auto_screenshot, auto_screenshot_interval
    global is_auto_webcam, auto_webcam_interval
    print(f"[INFO] Executing Remote Command: {command_type}")
    
    if command_type == "SCREENSHOT":
        filepath = execute_screenshot()
        try:
            upload_to_backend(filepath, resource_type="image", command_id=command_id, command_type="SCREENSHOT")
            os.remove(filepath)
            return {"status": "UPLOADING"}
        except Exception as e:
            if os.path.exists(filepath):
                os.remove(filepath)
            raise e
            
    elif command_type == "WEBCAM":
        filepath = execute_webcam()
        try:
            upload_to_backend(filepath, resource_type="image", command_id=command_id, command_type="WEBCAM")
            os.remove(filepath)
            return {"status": "UPLOADING"}
        except Exception as e:
            if os.path.exists(filepath):
                os.remove(filepath)
            raise e
            
    elif command_type == "LOCK":
        execute_lock_screen()
        return {"status": "EXECUTED"}
        
    elif command_type == "MESSAGE":
        msg = payload or "Remote management notification."
        success = display_message(msg)
        if not success:
            raise Exception("Failed to display notification alert on screen.")
        return {"status": "EXECUTED"}
        
    elif command_type == "ALARM":
        trigger_alarm()
        return {"status": "EXECUTED"}
        
    elif command_type == "STOP_ALARM":
        stop_alarm()
        return {"status": "EXECUTED"}
        
    elif command_type == "SHUTDOWN":
        # Run shutdown asynchronously after a slight delay to allow returning success
        def shut():
            time.sleep(2)
            os.system("sudo poweroff")
        threading.Thread(target=shut, daemon=True).start()
        return {"status": "EXECUTED"}
        
    elif command_type == "RESTART":
        # Run reboot asynchronously after a slight delay to allow returning success
        def reb():
            time.sleep(2)
            os.system("sudo reboot")
        threading.Thread(target=reb, daemon=True).start()
        return {"status": "EXECUTED"}
        
    elif command_type == "RESTART_AGENT":
        def restart_agent_runner():
            print("[INFO] Restarting agent in 2 seconds...")
            time.sleep(2)
            if shell_instance:
                try:
                    os.close(shell_instance.master_fd)
                except Exception:
                    pass
                try:
                    shell_instance.process.terminate()
                    shell_instance.process.wait(timeout=2)
                except Exception:
                    pass
            os.execv(sys.executable, [sys.executable] + sys.argv)
        threading.Thread(target=restart_agent_runner, daemon=True).start()
        return {"status": "EXECUTED"}
        
    elif command_type == "UNREGISTER_AGENT":
        def stop_agent_runner():
            print("[INFO] Unregistering agent: Wiping credentials and shutting down...")
            time.sleep(1)
            env_path = Path(__file__).resolve().parent / ".env"
            if env_path.exists():
                try:
                    with open(env_path, "r") as f:
                        lines = f.readlines()
                    
                    new_lines = []
                    for line in lines:
                        if line.startswith("DEVICE_ID=") or line.startswith("DEVICE_API_KEY="):
                            key = line.split("=", 1)[0]
                            new_lines.append(f"{key}=\n")
                        else:
                            new_lines.append(line)
                            
                    with open(env_path, "w") as f:
                        f.writelines(new_lines)
                    print("[INFO] Successfully cleared device credentials in agent/.env.")
                except Exception as e:
                    print(f"[ERROR] Failed to update agent/.env: {e}")
            os._exit(0)  # Use os._exit(0) to forcefully terminate all threads
        threading.Thread(target=stop_agent_runner, daemon=True).start()
        return {"status": "EXECUTED"}
        
    elif command_type == "TERMINAL":
        try:
            if shell_instance is None:
                shell_instance = PersistentShell()
            out = shell_instance.execute(payload or "ls -la")
            return {"status": "EXECUTED", "result_url": out}
        except Exception as e:
            return {"status": "FAILED", "error_message": str(e)}

    elif command_type == "RESTART_SHELL":
        try:
            # Close master fd of old shell gracefully
            if shell_instance:
                try:
                    os.close(shell_instance.master_fd)
                except Exception:
                    pass
                try:
                    shell_instance.process.terminate()
                    shell_instance.process.wait(timeout=2)
                except Exception:
                    pass
            shell_instance = PersistentShell()
            return {"status": "EXECUTED", "result_url": "Shell restarted successfully."}
        except Exception as e:
            return {"status": "FAILED", "error_message": str(e)}

    elif command_type == "FILE_BROWSER":
        try:
            path = resolve_user_path(payload or "/")
            if not path.exists():
                raise Exception(f"Path does not exist: {path}")
            if path.is_dir():
                items = []
                try:
                    for child in path.iterdir():
                        try:
                            items.append({
                                "name": child.name,
                                "type": "directory" if child.is_dir() else "file",
                                "size": child.stat().st_size if child.is_file() else 0,
                                "modified": child.stat().st_mtime
                            })
                        except Exception:
                            pass
                except PermissionError:
                    items = [{"name": "[Permission Denied: Cannot list directory]", "type": "error", "size": 0, "modified": time.time()}]
                except Exception as e:
                    items = [{"name": f"[Error: {e}]", "type": "error", "size": 0, "modified": time.time()}]
                return {"status": "EXECUTED", "result_url": json.dumps(items[:150])}
            else:
                try:
                    with open(path, 'r', encoding='utf-8', errors='replace') as f:
                        content = f.read(5000)
                    return {"status": "EXECUTED", "result_url": content}
                except PermissionError:
                    return {"status": "EXECUTED", "result_url": "[Permission Denied: Cannot read file contents]"}
                except Exception as e:
                    return {"status": "EXECUTED", "result_url": f"[Error reading file: {e}]"}
        except Exception as e:
            return {"status": "FAILED", "error_message": str(e)}

    elif command_type == "PROCESSES":
        try:
            import psutil
            if payload and payload.startswith("kill "):
                pid_to_kill = int(payload.split()[1])
                p = psutil.Process(pid_to_kill)
                p.terminate()
                return {"status": "EXECUTED", "result_url": f"Process {pid_to_kill} terminated."}
            else:
                proc_list = []
                for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
                    try:
                        proc_list.append(proc.info)
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                proc_list = sorted(proc_list, key=lambda x: x.get('cpu_percent') or 0, reverse=True)[:50]
                return {"status": "EXECUTED", "result_url": json.dumps(proc_list)}
        except Exception as e:
            return {"status": "FAILED", "error_message": str(e)}

    elif command_type == "CLIPBOARD":
        try:
            env, username = get_x11_env()
            uid = os.getuid()
            
            def is_binary_string(s):
                if '\x00' in s:
                    return True
                # Check for high ratio of control chars (non-printable)
                control_count = sum(1 for c in s if ord(c) < 32 and c not in '\n\r\t')
                if len(s) > 0 and (control_count / len(s)) > 0.15:
                    return True
                return False

            if payload:
                # Set clipboard (Wayland then X11)
                try:
                    cmd = wrap_user_cmd(["wl-copy"], env, username)
                    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, env=env)
                    p.communicate(input=payload.encode('utf-8'))
                    return {"status": "EXECUTED", "result_url": f"Clipboard set to: {payload[:50]}..."}
                except Exception:
                    pass
                try:
                    cmd = wrap_user_cmd(["xclip", "-selection", "clipboard"], env, username)
                    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, env=env)
                    p.communicate(input=payload.encode('utf-8'))
                    return {"status": "EXECUTED", "result_url": f"Clipboard set to: {payload[:50]}..."}
                except Exception as e:
                    raise Exception(f"Failed to set clipboard: {e}")
            else:
                # Get clipboard
                # 1. Try Wayland wl-paste (prefer text target)
                try:
                    cmd = wrap_user_cmd(["wl-paste", "-t", "text/plain"], env, username)
                    out = subprocess.check_output(cmd, env=env, stderr=subprocess.DEVNULL)
                    decoded = out.decode('utf-8', errors='replace')
                    if not is_binary_string(decoded):
                        return {"status": "EXECUTED", "result_url": decoded}
                except Exception:
                    pass
                try:
                    cmd = wrap_user_cmd(["wl-paste"], env, username)
                    out = subprocess.check_output(cmd, env=env, stderr=subprocess.DEVNULL)
                    decoded = out.decode('utf-8', errors='replace')
                    if not is_binary_string(decoded):
                        return {"status": "EXECUTED", "result_url": decoded}
                except Exception:
                    pass

                # 2. Try X11 xclip targets
                for target in ["UTF8_STRING", "TEXT", "STRING"]:
                    try:
                        cmd = wrap_user_cmd(["xclip", "-o", "-selection", "clipboard", "-t", target], env, username)
                        out = subprocess.check_output(cmd, env=env, stderr=subprocess.DEVNULL)
                        decoded = out.decode('utf-8', errors='replace')
                        if not is_binary_string(decoded):
                            return {"status": "EXECUTED", "result_url": decoded}
                    except Exception:
                        continue
                
                # Final raw fallback, with binary check
                try:
                    cmd = wrap_user_cmd(["xclip", "-o", "-selection", "clipboard"], env, username)
                    out = subprocess.check_output(cmd, env=env, stderr=subprocess.DEVNULL)
                    decoded = out.decode('utf-8', errors='replace')
                    if is_binary_string(decoded):
                        return {"status": "EXECUTED", "result_url": f"[Clipboard contains binary/non-text data ({len(out)} bytes)]"}
                    return {"status": "EXECUTED", "result_url": decoded}
                except Exception:
                    pass
                
                return {"status": "EXECUTED", "result_url": "[Clipboard is empty or contains non-text data]"}
        except Exception as e:
            return {"status": "FAILED", "error_message": str(e)}

    elif command_type == "DOWNLOAD_FILE":
        try:
            path = resolve_user_path(payload)
            if not path.exists():
                raise Exception(f"Path does not exist: {path}")
            
            is_dir = path.is_dir()
            temp_zip_path = None
            
            if is_dir:
                # Zip the directory to a temporary zip file
                import tempfile
                import shutil
                temp_dir = tempfile.gettempdir()
                zip_filename = f"{path.name}_download"
                archive_path = shutil.make_archive(os.path.join(temp_dir, zip_filename), 'zip', path)
                temp_zip_path = archive_path
                upload_filepath = archive_path
                upload_filename = f"{path.name}.zip"
            else:
                upload_filepath = str(path)
                upload_filename = path.name

            # Check size (100 MB limit)
            file_size = os.path.getsize(upload_filepath)
            if file_size > 100 * 1024 * 1024:
                if temp_zip_path and os.path.exists(temp_zip_path):
                    os.remove(temp_zip_path)
                raise Exception("File is too large to download (limit is 100MB)")

            # Upload to backend
            url = f"{BACKEND_URL}/api/devices/{get_device_id()}/upload-file"
            headers = {"X-Device-API-Key": DEVICE_API_KEY}
            
            with open(upload_filepath, 'rb') as f:
                files = {'file': (upload_filename, f, 'application/octet-stream')}
                res = requests.post(url, files=files, headers=headers, timeout=120)
                
            if temp_zip_path and os.path.exists(temp_zip_path):
                os.remove(temp_zip_path)
                
            if res.status_code != 200:
                raise Exception(f"Upload to backend failed ({res.status_code}): {res.text}")
                
            download_url = res.json().get("download_url")
            return {"status": "EXECUTED", "result_url": download_url}
        except Exception as e:
            return {"status": "FAILED", "error_message": str(e)}

    elif command_type == "RECORD_AUDIO":
        try:
            duration = int(payload) if payload and str(payload).isdigit() else 10
        except Exception:
            duration = 10
        filepath = execute_audio_recording(duration)
        try:
            upload_to_backend(filepath, resource_type="video", command_id=command_id, command_type="RECORD_AUDIO")
            os.remove(filepath)
            return {"status": "UPLOADING"}
        except Exception as e:
            if os.path.exists(filepath):
                os.remove(filepath)
            raise e
            
    elif command_type == "GET_USB_DEVICES":
        try:
            usb_devs = check_usb_devices()
            return {"status": "EXECUTED", "result_url": json.dumps(list(usb_devs.values()))}
        except Exception as e:
            return {"status": "FAILED", "error_message": str(e)}

    elif command_type == "MOUNT_USB":
        try:
            if not payload:
                raise Exception("Device partition name (e.g. sdb1) is required.")
            path = mount_usb_device(payload)
            return {"status": "EXECUTED", "result_url": path}
        except Exception as e:
            return {"status": "FAILED", "error_message": str(e)}

    elif command_type == "START_LIVE_CAMERA":
        if not is_streaming_camera:
            is_streaming_camera = True
            if active_ws:
                threading.Thread(target=stream_camera_loop, args=(active_ws,), daemon=True).start()
        return {"status": "EXECUTED"}

    elif command_type == "STOP_LIVE_CAMERA":
        is_streaming_camera = False
        return {"status": "EXECUTED"}

    elif command_type == "START_LIVE_SCREEN":
        if not is_streaming_screen:
            is_streaming_screen = True
            if active_ws:
                threading.Thread(target=stream_screen_loop, args=(active_ws,), daemon=True).start()
        return {"status": "EXECUTED"}

    elif command_type == "STOP_LIVE_SCREEN":
        is_streaming_screen = False
        return {"status": "EXECUTED"}

    elif command_type == "START_AUTO_SCREENSHOT":
        try:
            interval = int(payload) if payload and str(payload).isdigit() else 60
        except Exception:
            interval = 60
        auto_screenshot_interval = max(10, interval)
        if not is_auto_screenshot:
            is_auto_screenshot = True
            threading.Thread(target=auto_screenshot_loop, daemon=True).start()
        return {"status": "EXECUTED"}

    elif command_type == "STOP_AUTO_SCREENSHOT":
        is_auto_screenshot = False
        return {"status": "EXECUTED"}

    elif command_type == "START_AUTO_WEBCAM":
        try:
            interval = int(payload) if payload and str(payload).isdigit() else 60
        except Exception:
            interval = 60
        auto_webcam_interval = max(10, interval)
        if not is_auto_webcam:
            is_auto_webcam = True
            threading.Thread(target=auto_webcam_loop, daemon=True).start()
        return {"status": "EXECUTED"}

    elif command_type == "STOP_AUTO_WEBCAM":
        is_auto_webcam = False
        return {"status": "EXECUTED"}

    else:
        raise Exception(f"Unknown command type: {command_type}")

# Camera & Screen Stream State
is_streaming_camera = False
is_streaming_screen = False

# Auto-capture State
is_auto_screenshot = False
auto_screenshot_interval = 60  # seconds
is_auto_webcam = False
auto_webcam_interval = 60  # seconds

def auto_screenshot_loop():
    """Periodically captures a silent screenshot and uploads it as an auto-report."""
    global is_auto_screenshot, auto_screenshot_interval
    print("[INFO] Auto-screenshot loop started.")
    while is_auto_screenshot:
        try:
            ss_path = execute_screenshot()
            upload_to_backend(ss_path, resource_type="image", command_type="SCREENSHOT")
            os.remove(ss_path)
            print("[INFO] Auto-screenshot captured and sent to backend for upload.")
        except Exception as e:
            print(f"[WARN] Auto-screenshot failed: {e}")
        # Sleep in small increments so stopping is responsive
        for _ in range(auto_screenshot_interval * 10):
            if not is_auto_screenshot:
                break
            time.sleep(0.1)
    print("[INFO] Auto-screenshot loop stopped.")

def auto_webcam_loop():
    """Periodically captures a webcam frame and uploads it as an auto-report."""
    global is_auto_webcam, auto_webcam_interval
    print("[INFO] Auto-webcam loop started.")
    while is_auto_webcam:
        try:
            wc_path = execute_webcam()
            upload_to_backend(wc_path, resource_type="image", command_type="WEBCAM")
            os.remove(wc_path)
            print("[INFO] Auto-webcam captured and sent to backend for upload.")
        except Exception as e:
            print(f"[WARN] Auto-webcam failed: {e}")
        for _ in range(auto_webcam_interval * 10):
            if not is_auto_webcam:
                break
            time.sleep(0.1)
    print("[INFO] Auto-webcam loop stopped.")

def capture_screen_frame(env, username):
    """Capture a single screen frame for live streaming.

    Tries the desktop-native screenshot tools first, then falls back to mss.
    Returns JPEG bytes.
    """
    import os, subprocess
    from PIL import Image
    import io

    print("[DEBUG] capture_screen_frame invoked")
    filename = "/tmp/stream_screen_tmp.png"
    uid = os.getuid()

    # Prepare combined environment (system + X11 vars)
    combined_env = {**os.environ, **env}

    def convert_png_to_jpeg_bytes() -> bytes:
        with Image.open(filename) as img:
            img.thumbnail((640, 480))
            buffer = io.BytesIO()
            img.convert("RGB").save(buffer, format="JPEG", quality=50)
            return buffer.getvalue()

    # 1. Try gnome-screenshot (works on GNOME/X11/Wayland sessions)
    print("[DEBUG] Trying gnome-screenshot (silent)...")
    try:
        gsettings_cmd_anim = wrap_user_cmd(["gsettings", "set", "org.gnome.desktop.interface", "enable-animations", "false"], combined_env, username)
        gsettings_cmd_sounds = wrap_user_cmd(["gsettings", "set", "org.gnome.desktop.sound", "event-sounds", "false"], combined_env, username)
        subprocess.run(gsettings_cmd_anim, env=combined_env, stderr=subprocess.DEVNULL)
        subprocess.run(gsettings_cmd_sounds, env=combined_env, stderr=subprocess.DEVNULL)

        cmd = wrap_user_cmd(["gnome-screenshot", "-f", filename], combined_env, username)
        result = subprocess.run(cmd, env=combined_env, check=False,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[DEBUG] gnome-screenshot returncode: {result.returncode}")
        if os.path.exists(filename):
            data = convert_png_to_jpeg_bytes()
            os.remove(filename)
            return data
        else:
            print("[WARN] gnome-screenshot did not produce a screenshot file.")
    except Exception as e:
        print(f"[ERROR] gnome-screenshot exception: {e}")
        if os.path.exists(filename):
            os.remove(filename)

    # 2. Try Flameshot (silent, XWayland)
    print("[DEBUG] Trying Flameshot...")
    try:
        cmd = wrap_user_cmd(["flameshot", "full", "-p", filename], combined_env, username)
        result = subprocess.run(cmd, env=combined_env, check=False,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[DEBUG] Flameshot returncode: {result.returncode}")
        if os.path.exists(filename):
            data = convert_png_to_jpeg_bytes()
            os.remove(filename)
            return data
        else:
            print("[WARN] Flameshot did not produce a screenshot file.")
    except Exception as e:
        print(f"[ERROR] Flameshot exception: {e}")
        if os.path.exists(filename):
            os.remove(filename)

    # 3. Try Grim (Wayland native fallback)
    print("[DEBUG] Trying Grim...")
    try:
        cmd = wrap_user_cmd(["grim", filename], combined_env, username)
        result = subprocess.run(cmd, env=combined_env, check=False,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[DEBUG] Grim returncode: {result.returncode}")
        if os.path.exists(filename):
            data = convert_png_to_jpeg_bytes()
            os.remove(filename)
            return data
        else:
            print("[WARN] Grim did not produce a screenshot file.")
    except Exception as e:
        print(f"[ERROR] Grim exception: {e}")
        if os.path.exists(filename):
            os.remove(filename)

    # 4. Try scrot
    print("[DEBUG] Trying scrot...")
    try:
        cmd = wrap_user_cmd(["scrot", filename], combined_env, username)
        result = subprocess.run(cmd, env=combined_env, check=False,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[DEBUG] scrot returncode: {result.returncode}")
        if os.path.exists(filename):
            data = convert_png_to_jpeg_bytes()
            os.remove(filename)
            return data
        else:
            print("[WARN] scrot did not produce a screenshot file.")
    except Exception as e:
        print(f"[ERROR] scrot exception: {e}")
        if os.path.exists(filename):
            os.remove(filename)

    # 5. Fallback to mss (works when desktop tools are unavailable)
    print("[DEBUG] Trying mss fallback...")
    with environ_lock:
        try:
            import mss

            old_display = os.environ.get("DISPLAY")
            old_xauth = os.environ.get("XAUTHORITY")
            try:
                os.environ["DISPLAY"] = env.get("DISPLAY", ":0")
                if "XAUTHORITY" in env:
                    os.environ["XAUTHORITY"] = env["XAUTHORITY"]

                with mss.mss() as sct:
                    sct.shot(output=filename)

                if os.path.exists(filename):
                    data = convert_png_to_jpeg_bytes()
                    os.remove(filename)
                    return data
            finally:
                if old_display is not None:
                    os.environ["DISPLAY"] = old_display
                else:
                    os.environ.pop("DISPLAY", None)
                if old_xauth is not None:
                    os.environ["XAUTHORITY"] = old_xauth
                else:
                    os.environ.pop("XAUTHORITY", None)
        except Exception as e:
            print(f"[ERROR] mss fallback exception: {e}")
            if os.path.exists(filename):
                os.remove(filename)

    raise Exception("All capture methods failed for live screen stream.")

def stream_screen_loop(ws):
    global is_streaming_screen
    print("[INFO] Starting live screen WebSocket stream...")
    import base64
    
    env, username = get_x11_env()
    
    try:
        while is_streaming_screen:
            try:
                frame_bytes = capture_screen_frame(env, username)
                b64_data = base64.b64encode(frame_bytes).decode('utf-8')
                frame_url = f"data:image/jpeg;base64,{b64_data}"
                
                ws.send(json.dumps({
                    "type": "live_screen_frame",
                    "frame": frame_url
                }))
            except Exception as e:
                print(f"[WARN] Failed to capture or send screen frame: {e}")
                time.sleep(0.5)
                continue
                
            time.sleep(0.15)
    except Exception as e:
        print(f"[WARN] Error in live screen stream loop: {e}")
    finally:
        is_streaming_screen = False

def stream_camera_loop(ws):
    global is_streaming_camera
    print("[INFO] Starting live camera WebSocket stream...")
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[WARN] Could not open webcam for live stream.")
        is_streaming_camera = False
        return
        
    try:
        # Sensor warm up
        for _ in range(5):
            cap.read()
            
        import base64
        while is_streaming_camera:
            ret, frame = cap.read()
            if not ret:
                break
                
            # Downsample for faster streaming over socket
            frame = cv2.resize(frame, (480, 360))
            ret, jpeg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 50])
            if not ret:
                continue
                
            # Base64 encode
            b64_data = base64.b64encode(jpeg.tobytes()).decode('utf-8')
            frame_url = f"data:image/jpeg;base64,{b64_data}"
            
            try:
                ws.send(json.dumps({
                    "type": "live_camera_frame",
                    "frame": frame_url
                }))
            except Exception:
                # Connection dropped
                break
                
            # Limit rate to ~10 FPS
            time.sleep(0.1)
    finally:
        cap.release()
        is_streaming_camera = False
        print("[INFO] Live camera WebSocket stream stopped.")

# Microphone Recording Helper
def execute_audio_recording(duration_secs=10):
    filename = f"/tmp/recording_{int(time.time())}.wav"
    env, username = get_x11_env()
    uid = os.getuid()
    try:
        # Recording using arecord (standard on Linux, doesn't require PyAudio build)
        # S16_LE (16-bit little endian), 16000Hz (standard voice rate), mono
        cmd = wrap_user_cmd(["arecord", "-d", str(duration_secs), "-f", "S16_LE", "-r", "16000", "-c", "1", filename], env, username)
        subprocess.run(cmd, env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.exists(filename):
            return filename
    except Exception as e:
        raise Exception(f"arecord recording failed: {e}")
    raise Exception("arecord did not produce a file.")

# USB Storage Scanner
def check_usb_devices():
    import json
    usb_devs = {}
    try:
        out = subprocess.check_output(["lsblk", "-J", "-o", "NAME,SIZE,TYPE,MOUNTPOINT,TRAN"], stderr=subprocess.DEVNULL)
        data = json.loads(out)
        
        def traverse(devices):
            for dev in devices:
                if dev.get("tran") == "usb":
                    name = dev.get("name")
                    usb_devs[name] = {
                        "name": name,
                        "size": dev.get("size"),
                        "mountpoint": dev.get("mountpoint")
                    }
                if dev.get("children"):
                    traverse(dev["children"])
                    
        if "blockdevices" in data:
            traverse(data["blockdevices"])
    except Exception:
        pass
    return usb_devs

# USB Mounter
def mount_usb_device(device_name):
    usb_devs = check_usb_devices()
    if device_name in usb_devs and usb_devs[device_name].get("mountpoint"):
        return usb_devs[device_name]["mountpoint"]
        
    # Try mounting via udisksctl (standard user-space mounting on Ubuntu/GNOME)
    try:
        out = subprocess.check_output(["udisksctl", "mount", "-b", f"/dev/{device_name}"], stderr=subprocess.STDOUT).decode().strip()
        import re
        match = re.search(r'Mounted [^ ]+ at ([^\s\n]+)', out)
        if match:
            return match.group(1)
    except Exception:
        # Fallback to pmount
        try:
            subprocess.run(["pmount", f"/dev/{device_name}"], check=True)
            path = f"/media/{device_name}"
            if os.path.exists(path):
                return path
        except Exception:
            pass
            
    raise Exception(f"Failed to mount /dev/{device_name}. Ensure it is partition-formatted and readable.")

# USB Event Monitor Loop
def usb_monitor_loop():
    print("[INFO] Starting background USB monitoring loop...")
    last_devs = {}
    
    try:
        last_devs = check_usb_devices()
    except Exception:
        pass
        
    while True:
        time.sleep(30)
        try:
            current_devs = check_usb_devices()
            
            # Additions
            for name, dev in current_devs.items():
                if name not in last_devs:
                    event_msg = f"USB Connected: {name} ({dev['size']})"
                    if dev['mountpoint']:
                        event_msg += f" mounted at {dev['mountpoint']}"
                    else:
                        event_msg += " (Not Mounted)"
                    print(f"[INFO] {event_msg}")
                    
                    try:
                        url_report = f"{BACKEND_URL}/api/agent/commands/auto-report"
                        headers = {"X-Device-API-Key": DEVICE_API_KEY}
                        requests.post(url_report, json={
                            "command_type": "USB_EVENT",
                            "status": "EXECUTED",
                            "result_url": event_msg
                        }, headers=headers, timeout=10)
                    except Exception:
                        pass
                        
            # Removals
            for name, dev in last_devs.items():
                if name not in current_devs:
                    event_msg = f"USB Disconnected: {name} ({dev['size']})"
                    print(f"[INFO] {event_msg}")
                    
                    try:
                        url_report = f"{BACKEND_URL}/api/agent/commands/auto-report"
                        headers = {"X-Device-API-Key": DEVICE_API_KEY}
                        requests.post(url_report, json={
                            "command_type": "USB_EVENT",
                            "status": "EXECUTED",
                            "result_url": event_msg
                        }, headers=headers, timeout=10)
                    except Exception:
                        pass
                        
            last_devs = current_devs
        except Exception as e:
            print(f"[WARN] Error in USB monitoring loop: {e}")

# HTTP Polling & Heartbeat Loop
telemetry_interval = 60

def telemetry_heartbeat_loop():
    global telemetry_interval
    headers = {"X-Device-API-Key": DEVICE_API_KEY}
    
    while True:
        try:
            telemetry_data = gather_telemetry()
            url = f"{BACKEND_URL}/api/agent/telemetry"
            res = requests.post(url, json=telemetry_data, headers=headers, timeout=10)
            
            if res.status_code == 200:
                data = res.json()
                
                # Update local interval dynamically from backend configuration
                if "polling_interval" in data and data["polling_interval"] is not None:
                    telemetry_interval = max(5, int(data["polling_interval"]))
                
                # If there are any pending commands returned in HTTP response (fallback method)
                pending = data.get("pending_commands", [])
                for cmd in pending:
                    cmd_id = cmd["id"]
                    cmd_type = cmd["command_type"]
                    cmd_payload = cmd["payload"]
                    
                    try:
                        result = execute_command(cmd_type, cmd_payload, command_id=cmd_id)
                        # Respond HTTP
                        respond_url = f"{BACKEND_URL}/api/agent/commands/{cmd_id}/respond"
                        requests.post(respond_url, json={
                            "status": result.get("status", "EXECUTED"),
                            "result_url": result.get("result_url"),
                            "error_message": None
                        }, headers=headers)
                    except Exception as e:
                        respond_url = f"{BACKEND_URL}/api/agent/commands/{cmd_id}/respond"
                        requests.post(respond_url, json={
                            "status": "FAILED",
                            "result_url": None,
                            "error_message": str(e)
                        }, headers=headers)
            elif res.status_code == 401:
                handle_unauthorized()
            else:
                print(f"[WARN] Heartbeat failed with status: {res.status_code}")
                
        except Exception as e:
            print(f"[WARN] Telemetry heartbeat connection error: {e}")
            
        time.sleep(telemetry_interval)

# WebSocket Connection Manager
def websocket_loop():
    import websocket # websocket-client
    
    ws_url = f"{BACKEND_WS_URL}/api/agent/ws?api_key={DEVICE_API_KEY}"
    
    def on_message(ws, message):
        try:
            cmd = json.loads(message)
            
            # Handle real-time terminal input
            if cmd.get("type") == "terminal_input":
                input_data = cmd.get("input", "")
                if shell_instance:
                    try:
                        os.write(shell_instance.master_fd, input_data.encode('utf-8'))
                    except Exception:
                        pass
                return

            elif cmd.get("type") == "start_camera_stream":
                global is_streaming_camera
                if not is_streaming_camera:
                    is_streaming_camera = True
                    threading.Thread(target=stream_camera_loop, args=(ws,), daemon=True).start()
                return

            elif cmd.get("type") == "stop_camera_stream":
                is_streaming_camera = False
                return

            elif cmd.get("type") == "start_screen_stream":
                global is_streaming_screen
                if not is_streaming_screen:
                    is_streaming_screen = True
                    threading.Thread(target=stream_screen_loop, args=(ws,), daemon=True).start()
                return

            elif cmd.get("type") == "stop_screen_stream":
                is_streaming_screen = False
                return

            cmd_id = cmd["id"]
            cmd_type = cmd["command_type"]
            cmd_payload = cmd.get("payload")
            
            def run_and_reply():
                try:
                    result = execute_command(cmd_type, cmd_payload, command_id=cmd_id)
                    ws.send(json.dumps({
                        "command_id": cmd_id,
                        "status": result.get("status", "EXECUTED"),
                        "result_url": result.get("result_url"),
                        "error_message": None
                    }))
                except Exception as e:
                    ws.send(json.dumps({
                        "command_id": cmd_id,
                        "status": "FAILED",
                        "result_url": None,
                        "error_message": str(e)
                    }))
            
            # Execute command in separate thread so it doesn't block websocket main loop
            threading.Thread(target=run_and_reply, daemon=True).start()
            
        except Exception as e:
            print(f"[ERROR] Error processing websocket message: {e}")

    def on_error(ws, error):
        print(f"[WARN] WebSocket error: {error}")

    def on_close(ws, close_status_code, close_msg):
        print("[INFO] WebSocket connection closed.")
        global active_ws
        active_ws = None

    def on_open(ws):
        print("[INFO] WebSocket connection established with backend.")
        global active_ws
        active_ws = ws

    initial_delay = 2.0
    max_delay = 60.0
    factor = 2.0
    backoff_delay = initial_delay

    while True:
        try:
            print(f"[INFO] Connecting WebSocket to: {ws_url}")
            ws = websocket.WebSocketApp(
                ws_url,
                header=["User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"],
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close
            )
            start_time = time.time()
            ws.run_forever()
            
            # Reset backoff if we remained connected for at least 10 seconds
            if time.time() - start_time > 10.0:
                backoff_delay = initial_delay
                print("[INFO] WebSocket session was stable, resetting backoff delay.")
        except Exception as e:
            print(f"[WARN] WebSocket connection loop exception: {e}")
            
        import random
        jitter = random.uniform(0.0, 1.0)
        sleep_time = min(backoff_delay + jitter, max_delay)
        print(f"[INFO] WebSocket reconnecting in {sleep_time:.2f} seconds...")
        time.sleep(sleep_time)
        backoff_delay = min(backoff_delay * factor, max_delay)

def trigger_security_capture():
    """Captures a screenshot and a webcam photo on startup/login and uploads them to the dashboard."""
    print("[INFO] Security auto-capture triggered: Capturing screenshot and camera photo...")
    
    # 1. Capture and upload Screenshot
    try:
        ss_path = execute_screenshot()
        upload_to_backend(ss_path, resource_type="image", command_type="SCREENSHOT")
        os.remove(ss_path)
        print("[INFO] Security auto-screenshot sent to backend for upload.")
    except Exception as e:
        print(f"[WARN] Security auto-screenshot capture failed: {e}")
        
    # 2. Capture and upload Webcam
    try:
        wc_path = execute_webcam()
        upload_to_backend(wc_path, resource_type="image", command_type="WEBCAM")
        os.remove(wc_path)
        print("[INFO] Security auto-webcam sent to backend for upload.")
    except Exception as e:
        print(f"[WARN] Security auto-webcam capture failed: {e}")

if __name__ == "__main__":
    if not DEVICE_API_KEY:
        print("[FATAL] Cannot run agent without DEVICE_API_KEY. Configure it in agent/.env.")
        sys.exit(99)
        
    # Pre-flight registration check
    print("[INFO] Verifying device registration with backend...")
    headers = {"X-Device-API-Key": DEVICE_API_KEY}
    verify_url = f"{BACKEND_URL}/api/agent/telemetry"
    try:
        telemetry_data = gather_telemetry()
        res = requests.post(verify_url, json=telemetry_data, headers=headers, timeout=10)
        if res.status_code == 401:
            handle_unauthorized()
        print("[+] Device registration verified successfully.")
    except requests.exceptions.RequestException as e:
        print(f"[WARN] Connection error during pre-flight registration check: {e}. Running in offline/reconnect mode.")
        
    # Prime CPU percent tracking
    try:
        import psutil
        psutil.cpu_percent(interval=None)
    except Exception:
        pass
        
    # Start HTTP Telemetry Thread
    telemetry_thread = threading.Thread(target=telemetry_heartbeat_loop, daemon=True)
    telemetry_thread.start()
    
    # Start USB Monitor Thread
    usb_thread = threading.Thread(target=usb_monitor_loop, daemon=True)
    usb_thread.start()
    
    # Run security auto-capture in a separate thread so it doesn't block websocket connection
    capture_thread = threading.Thread(target=trigger_security_capture, daemon=True)
    capture_thread.start()
    
    # Start WebSocket Main Loop in Main Thread (keeps agent running)
    websocket_loop()
