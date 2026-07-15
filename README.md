# Sentinel Monorepo

> **An open-source, self-hosted Linux Anti-Theft & Remote Device Management Platform**

Sentinel consists of three primary components that work in sync to enable real-time tracking, metrics polling, and command orchestration for Linux machines.

```
                  +-----------------------------------+
                  |        React Dashboard            |
                  |     (Local Port: 5173 / Vite)     |
                  +-----------------+-----------------+
                                    |
                                    | REST / WebSockets
                                    v
                  +-----------------+-----------------+
                  |         FastAPI Backend           |
                  |     (Local Port: 8000 / Uvicorn)  |
                  +-----------------+-----------------+
                                    |
                                    | REST / WebSockets
                                    v
                  +-----------------+-----------------+
                  |       Target Laptop Agent         |
                  |    (Background Daemon / service)  |
                  +-----------------------------------+
```

---

## Repository Structure

- `backend/`: FastAPI application server. Manages users, device registry, command dispatch, and stores tracking database entries.
- `agent/`: Linux agent daemon. Runs in the background, gathers telemetry metrics, and executes remote commands (locking, screenshots, webcam capture, custom notifications, sirens, power controls).
- `dashboard/`: Vite React web application. Provides UI widgets, charts, Leaflet mapping integration, and command control buttons.

---

## Getting Started

### 1. Run the Backend Server

The backend requires **Python 3.8+** (compatible up to 3.12+).

1. Change directory to `backend/` and initialize a virtual environment:
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
2. Create your `.env` configuration file:
   ```bash
   cp .env.example .env
   ```
   *Note: If `DATABASE_URL` is left empty, the server automatically defaults to a local SQLite database (`sentinel.db`).*
3. Start the FastAPI development server:
   ```bash
   uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
   The backend will auto-initialize database tables and start listening on `http://127.0.0.1:8000`.

### 2. Configure & Run the Linux Agent

The agent is designed to run silently on the client device.

1. In a new terminal tab, change directory to `agent/` and initialize its environment:
   ```bash
   cd agent
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
2. Run the local test setup script to register a developer user, register your current device, and configure credentials automatically:
   ```bash
   python setup_test_device.py
   ```
   *This automatically creates `agent/.env` populated with your server URL, unique device ID, and secure API key.*
3. Run the agent daemon:
   ```bash
   python agent.py
   ```
   The agent will connect to the backend server, open a persistent WebSocket channel for instant remote commands, and dispatch telemetry updates every 60 seconds.

### 3. Run the Dashboard UI

The web dashboard is built using React and compiled via Vite.

1. Change directory to `dashboard/` and install dependencies:
   ```bash
   cd dashboard
   npm install
   ```
2. Run the Vite development server:
   ```bash
   npm run dev -- --host 127.0.0.1 --port 5173
   ```
3. Open `http://127.0.0.1:5173/` in your browser.
4. Log in using the test account registered during the agent setup step:
   - **Email**: `test@sentinel.com`
   - **Password**: `password123`

---

## Remote Commands & Features

From the dashboard panel, you can run the following remote actions in real-time:

- **Capture Screenshot**: Triggers the agent to grab the active X11 screen buffer, compress it, upload it directly to Cloudinary, and display it in the gallery.
- **Capture Webcam**: Warm up the local video device, grab a raw camera frame, upload it, and log it as visual evidence.
- **Lock Session**: Remotely lock the active graphical desktop session (`loginctl`, `xdg-screensaver`, or `gnome-screensaver`).
- **Display Warning**: Open a custom dialog warning message on the laptop screen (via `zenity` or system notification center).
- **Trigger Alarm**: Emit a 3-second diagnostic audio alert tone using internal sound channels.
- **Power Off / Reboot**: Safely reboot or shutdown the target device remotely.

---

## Design Choices & Implementation Details

- **Secure Bcrypt Hashing**: Password hashing utilizes direct `bcrypt` calls, ensuring runtime compatibility on modern Python interpreters (Python 3.12+).
- **WebSocket Fallback**: Real-time commands are delivered via persistent WebSocket connections. If connection is interrupted, the agent falls back to periodic HTTP polling.
- **Offline Telemetry Queuing**: Telemetry heartbeats are logged directly to the server. If the server is offline, the agent queues local payloads and retries when connection resumes.
- **SQLite Dev Mode & Production MySQL**: Seamless toggle between local testing (`sentinel.db`) and Aiven-hosted MySQL databases.
