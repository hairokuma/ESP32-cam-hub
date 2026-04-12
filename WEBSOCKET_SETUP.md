# WebSocket Setup Instructions

## Changes Made

The application has been upgraded from interval polling to real-time WebSocket updates:

### Backend Changes
- Added Flask-SocketIO for WebSocket support
- Emits real-time events when images are uploaded
- Broadcasts stats to all connected clients

### Frontend Changes
- Replaced interval-based polling with WebSocket connection
- Real-time updates for camera stats when images arrive
- Per-camera status updates with visual feedback (green flash)

## Installation

1. Install the new dependencies:
```bash
pip install -r app/requirements.txt
```

Or install individually:
```bash
pip install flask-socketio==5.3.5 simple-websocket==1.0.0
```

2. Restart the server:
```bash
docker-compose down
docker-compose up --build
```

Or if running directly:
```bash
cd app
python image_server.py
```

## Features

- ✅ **Real-time updates**: No more 10-second polling delay
- ✅ **Instant feedback**: Camera stats update immediately when ESP32 uploads an image
- ✅ **Visual indicators**: Status section flashes green when updated
- ✅ **Efficient**: Only sends updates when data changes
- ✅ **Automatic reconnection**: Socket.IO handles connection drops

## Verification

Check the browser console - you should see:
- `✓ WebSocket connected` when page loads
- `📊 Stats update received` when initial stats load
- `📷 Camera {id} updated` when a camera uploads an image

The status bar at the bottom of each camera card will briefly flash green when that camera receives a new image.
