#!/bin/bash
set -e

echo "=========================================="
echo "        Stopping Sentinel Platform        "
echo "=========================================="

echo "Stopping sentinel-backend service..."
systemctl stop sentinel-backend

echo "Stopping Nginx web server..."
systemctl stop nginx

echo "=========================================="
echo "  Sentinel has been successfully stopped! "
echo "=========================================="
