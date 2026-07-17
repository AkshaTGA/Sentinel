#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

# Define paths
PROJECT_DIR="/var/www/sentinel"
BACKEND_DIR="$PROJECT_DIR/backend"
DASHBOARD_DIR="$PROJECT_DIR/dashboard"

echo "=========================================="
echo "   Starting/Restarting Sentinel Platform  "
echo "=========================================="

# 1. Update backend dependencies
if [ -f "$BACKEND_DIR/requirements.txt" ]; then
    echo "[1/4] Updating backend python dependencies..."
    "$BACKEND_DIR/venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
else
    echo "[1/4] No backend requirements.txt found, skipping..."
fi

# 2. Restart backend systemd service
echo "[2/4] Restarting sentinel-backend service..."
systemctl restart sentinel-backend

# 3. Build the frontend dashboard
echo "[3/4] Building frontend application..."
cd "$DASHBOARD_DIR"
if [ -d "node_modules" ]; then
    echo "Installing any new npm dependencies..."
    npm install
else
    echo "Performing clean npm install..."
    npm ci || npm install
fi
echo "Running build command..."
npm run build

# 4. Ensure Nginx is running and reloaded
echo "[4/4] Reloading Nginx web server..."
systemctl start nginx || true
systemctl reload nginx

echo "=========================================="
echo " Sentinel has been successfully restarted! "
echo "=========================================="
