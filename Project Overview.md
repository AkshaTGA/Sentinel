# Sentinel

> **An open-source, self-hosted Linux Anti-Theft & Remote Device Management Platform**

---

# Overview

Sentinel is a self-hosted anti-theft, monitoring, and remote management platform designed specifically for Linux laptops. It enables users to remotely monitor, locate, manage, and secure their devices from anywhere in the world without relying on expensive subscription services.

Unlike commercial anti-theft solutions, Sentinel is completely self-hosted. All data remains under the owner's control and is stored on their own VPS, eliminating recurring subscription costs and third-party dependency.

The project is intended to provide a modern alternative to commercial products such as Prey while remaining completely open-source and extensible.

---

# Vision

Create the most complete open-source anti-theft solution for Linux that combines:

- Device Monitoring
- Remote Administration
- Security
- Device Recovery
- Forensics
- Telemetry
- Automation

into a single platform.

Sentinel should be simple enough for personal use while scalable enough to manage hundreds of devices.

---

# Primary Objectives

- Allow owners to remotely monitor their laptop.
- Track device activity in real time.
- Increase the chances of recovering stolen devices.
- Protect sensitive user data.
- Provide enterprise-grade architecture while remaining completely free to self-host.
- Offer a modern dashboard comparable to commercial SaaS products.
- Maintain privacy by ensuring all collected information remains on the user's own infrastructure.

---

# Key Features

## Device Monitoring

- Live online/offline status
- Heartbeat monitoring
- Device uptime
- Battery percentage
- Charging status
- CPU utilization
- RAM utilization
- Disk usage
- Hostname
- Operating System
- Network information
- Public IP
- Local IP
- MAC Address
- Wi-Fi SSID
- Nearby Wi-Fi information
- Device activity logs

---

## Location Tracking

Sentinel continuously estimates device location using:

- Public IP Geolocation
- Wi-Fi Geolocation
- Network Metadata

Features include:

- Current location
- Historical movement
- Timeline visualization
- Interactive map
- Last seen location
- Last online location

---

## Remote Commands

Authorized users can remotely execute supported actions including:

- Capture Screenshot
- Capture Webcam Photo
- Lock Screen
- Shutdown
- Restart
- Display Custom Message
- Trigger Alarm
- Request Immediate Heartbeat
- Request Device Information

Future versions will include:

- Remote Terminal
- File Browser
- Live Camera
- Microphone Recording
- Clipboard Access
- Process Management

---

## Media Capture

Sentinel supports:

- On-demand screenshots
- Webcam image capture
- Automatic image uploads
- Historical media storage
- Timestamped forensic evidence

Images are compressed before upload to reduce storage requirements.

---

## Dashboard

A responsive web dashboard provides:

- Device Overview
- Live Status
- Device Timeline
- Interactive Maps
- Screenshot Gallery
- Webcam Gallery
- Command Console
- Analytics
- Settings
- Notification Center

The dashboard is designed to resemble modern SaaS monitoring platforms.

---

## Notifications

Users receive instant alerts through Telegram.

Supported notifications include:

- Device Online
- Device Offline
- Screenshot Captured
- Webcam Captured
- Battery Low
- Wi-Fi Changed
- Unknown Network
- Failed Authentication
- New Login
- Device Registration

Additional notification providers may be added in future versions.

---

# System Architecture

Sentinel consists of four major components.

## 1. Linux Agent

Runs silently on the protected laptop.

Responsibilities:

- Collect telemetry
- Execute commands
- Capture screenshots
- Capture webcam images
- Upload reports
- Maintain secure communication
- Run automatically using systemd

---

## 2. Backend Server

Built using FastAPI.

Responsibilities:

- Authentication
- Device management
- Command processing
- Media uploads
- Database interaction
- Notification dispatch
- REST API
- WebSocket communication

---

## 3. Dashboard

Built using React.

Responsibilities:

- User Interface
- Device Management
- Monitoring
- Maps
- Analytics
- Administration

---

## 4. Database

MySQL (Aiven)

Stores:

- Users
- Devices
- Commands
- Heartbeats
- Location History
- Media Metadata
- Logs
- Notifications

Media files are stored separately on the VPS filesystem.

---

# Technology Stack

## Agent

- Python
- OpenCV
- MSS
- Requests
- psutil
- Pillow
- PyWiFi

---

## Backend

- FastAPI
- SQLAlchemy
- Alembic
- JWT Authentication
- WebSockets

---

## Dashboard

- React
- Tailwind CSS
- React Router
- Axios
- Leaflet
- Chart.js

---

## Database

- Aiven MySQL

---

## Web Server

- Nginx

---

## Deployment

- Docker
- Docker Compose
- systemd
- Ubuntu Server

---

# Communication Flow

```
Laptop Agent
        │
        │ HTTPS / WebSocket
        ▼
FastAPI Backend
        │
        ▼
MySQL Database
        │
        ▼
Dashboard
        │
        ▼
User
```

---

# Security Goals

Sentinel follows a security-first architecture.

Major security principles include:

- End-to-End HTTPS
- JWT Authentication
- Device API Keys
- Encrypted Secrets
- Secure Password Hashing
- Command Authorization
- Role-Based Access
- Rate Limiting
- Audit Logging
- Secure File Upload Validation

No sensitive credentials are stored in plain text.

---

# Privacy

Sentinel is entirely self-hosted.

No telemetry is sent to third-party servers.

The owner maintains complete control over:

- Device information
- Screenshots
- Webcam images
- Logs
- Commands
- Location history
- User accounts

---

# Scalability

Sentinel is designed to scale from:

- 1 personal device

to

- Hundreds of enterprise devices

without requiring architectural changes.

---

# Reliability

The Linux Agent is designed to:

- Start automatically at boot
- Recover after crashes
- Retry failed uploads
- Queue commands while offline
- Resume operation after reconnecting

---

# Future Roadmap

Version 2

- Remote Terminal
- File Manager
- Process Viewer
- Clipboard Sync
- Live Camera Streaming
- Remote Microphone
- Browser History
- USB Monitoring

Version 3

- Android Support
- Windows Support
- macOS Support
- Multi-Organization Support
- Device Groups
- Scheduled Commands
- Automatic Updates
- AI-powered Threat Detection

---

# Project Goals

Sentinel aims to become:

- A free alternative to commercial anti-theft software.
- A self-hosted remote monitoring platform.
- A Linux-first security solution.
- A portfolio-worthy systems project demonstrating backend engineering, networking, operating systems, cybersecurity, distributed systems, and modern web development.

---

# License

This project will be released under the MIT License unless changed in future versions.

---

# Current Development Status

**Status:** Planning & Architecture

Current Phase:

- Project Design
- System Architecture
- Software Requirement Specification (SRS)
- Database Design
- API Design

Implementation will begin after completion of the complete SRS document.

---

# Project Motto

> **"Own your device. Own your data. Own your security."**