#!/bin/bash
set -e

# Sentinel Agent Automated Installer & Updater
# Supported OS: Debian/Ubuntu based distributions

echo "=========================================="
echo "   Sentinel Agent Installer & Updater     "
echo "=========================================="

# Parse command line arguments
TOKEN=""
BACKEND_URL="https://sentinel.akshatparmar.dev"
BACKEND_WS_URL="wss://sentinel.akshatparmar.dev"

for i in "$@"
do
case $i in
    --token=*)
    TOKEN="${i#*=}"
    shift
    ;;
    --url=*)
    BACKEND_URL="${i#*=}"
    # Automatically derive WS url
    case "$BACKEND_URL" in
        https://*)
            BACKEND_WS_URL="wss://${BACKEND_URL#https://}"
            ;;
        http://*)
            BACKEND_WS_URL="ws://${BACKEND_URL#http://}"
            ;;
    esac
    shift
    ;;
    *)
    # unknown option
    ;;
esac
done

# Check root privileges
if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] Please run this script with sudo or as root."
  exit 1
fi

CONFIG_DIR="/etc/sentinel"
CONFIG_FILE="$CONFIG_DIR/agent.conf"
INSTALL_DIR="/opt/sentinel"

# 1. Check if registered or needs registration
if [ -f "$CONFIG_FILE" ]; then
    echo "[INFO] Existing configuration found at $CONFIG_FILE. Skipping device registration (Updates only)."
    # Load existing config to preserve values
    . "$CONFIG_FILE"
else
    echo "[INFO] No existing configuration found. Registering new device..."
    if [ -z "$TOKEN" ]; then
        echo "[ERROR] Missing registration token. Run installer with: --token=<USER_JWT_TOKEN>"
        exit 1
    fi

    # Generate device ID (SHA256 of MAC address)
    # Find active interface MAC
    MAC_ADDR=$(cat /sys/class/net/$(ip route show | awk '/default/ {print $5}')/address 2>/dev/null || cat /sys/class/net/*/address | head -n 1 | tr -d '\n')
    if [ -z "$MAC_ADDR" ]; then
        MAC_ADDR=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || hostname)
    fi
    
    DEVICE_ID=$(echo -n "$MAC_ADDR" | sha256sum | cut -c1-16)
    DEVICE_NAME=$(hostname)
    OS_NAME=$(uname -s)
    
    echo "[INFO] Registering device with ID: $DEVICE_ID, Name: $DEVICE_NAME..."
    
    # Perform API registration
    REG_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BACKEND_URL/api/devices" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "id": "'"$DEVICE_ID"'",
        "name": "'"$DEVICE_NAME"'",
        "hostname": "'"$DEVICE_NAME"'",
        "os": "'"$OS_NAME"'"
      }')

    HTTP_STATUS=$(echo "$REG_RESPONSE" | tail -n1)
    RESPONSE_BODY=$(echo "$REG_RESPONSE" | sed '$d')

    if [ "$HTTP_STATUS" -ne 200 ] && [ "$HTTP_STATUS" -ne 201 ]; then
        # Check if already registered
        if echo "$RESPONSE_BODY" | grep -q "already registered"; then
            echo "[ERROR] Device already registered in database but no local config file exists. Please delete the device from the dashboard and run this script again."
            exit 1
        else
            echo "[ERROR] Failed to register device. HTTP status: $HTTP_STATUS"
            echo "Response: $RESPONSE_BODY"
            exit 1
        fi
    fi

    # Extract API key
    DEVICE_API_KEY=$(echo "$RESPONSE_BODY" | grep -o '"api_key":"[^"]*' | grep -o '[^"]*$' | head -n 1)

    if [ -z "$DEVICE_API_KEY" ]; then
        echo "[ERROR] Could not extract API Key from registration response."
        echo "Response: $RESPONSE_BODY"
        exit 1
    fi

    # Write configuration file
    mkdir -p "$CONFIG_DIR"
    cat <<EOF > "$CONFIG_FILE"
BACKEND_URL=$BACKEND_URL
BACKEND_WS_URL=$BACKEND_WS_URL
DEVICE_ID=$DEVICE_ID
DEVICE_API_KEY=$DEVICE_API_KEY
DEVICE_NAME=$DEVICE_NAME
EOF
    chmod 600 "$CONFIG_FILE"
    echo "[SUCCESS] Device registered and config saved to $CONFIG_FILE."
fi

# 2. Stop running service if active
if systemctl is-active --quiet sentinel-agent; then
    echo "[INFO] Stopping running sentinel-agent service..."
    systemctl stop sentinel-agent
fi

# 3. Install system dependencies
echo "[INFO] Installing system dependencies..."
apt-get update -y || echo "[WARN] Package index update had warnings or errors, proceeding anyway..."
apt-get install -y python3 python3-pip python3-venv portaudio19-dev libv4l-dev ffmpeg libxext6 libsm6 scrot -y

# 4. Prepare installation directory
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 5. Create virtual environment
if [ ! -d "venv" ]; then
    echo "[INFO] Creating python virtual environment..."
    python3 -m venv venv
fi

# 6. Download latest agent files
echo "[INFO] Downloading agent execution files..."
curl -s -o requirements.txt "$BACKEND_URL/requirements.txt"
curl -s -o agent.py "$BACKEND_URL/agent.py"

# 7. Install python requirements
echo "[INFO] Installing pip dependencies..."
./venv/bin/pip3 install --upgrade pip
./venv/bin/pip3 install -r requirements.txt

# 8. Set up systemd service
echo "[INFO] Setting up systemd system service..."
cat <<EOF > /etc/systemd/system/sentinel-agent.service
[Unit]
Description=Sentinel Device Remote Administration Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
Environment=SENTINEL_CONFIG_PATH=$CONFIG_FILE
ExecStart=$INSTALL_DIR/venv/bin/python3 $INSTALL_DIR/agent.py
Restart=always
RestartSec=5
RestartPreventExitStatus=99

[Install]
WantedBy=multi-user.target
EOF

# Reload daemon and restart service
systemctl daemon-reload
systemctl enable sentinel-agent
systemctl start sentinel-agent

echo "[SUCCESS] Sentinel agent has been successfully installed and started!"
systemctl status sentinel-agent --no-pager
