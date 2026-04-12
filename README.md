# ESP32-CAM Multi-Camera System

A complete multi-camera streaming and image capture system for ESP32-CAM modules with a modern web interface.

## Features

### ESP32 Features
- ✅ **Continuous MJPEG streaming** at QVGA (320x240)
- ✅ **Periodic high-quality captures** at UXGA (1600x1200)
- ✅ **Non-blocking uploads** using FreeRTOS tasks
- ✅ **Minimal stream interruption** (~300ms during HQ capture)
- ✅ **Auto-reconnect** and error recovery

### Web Interface Features
- ✅ **Multi-camera grid view** (desktop) or list view (mobile)
- ✅ **Live MJPEG streams** for each camera
- ✅ **Fullscreen mode** with stream/image toggle
- ✅ **Interactive timeline** to browse captured images
- ✅ **Responsive design** for mobile and desktop
- ✅ **Real-time statistics** and camera status

### Server Features
- ✅ **Automatic camera detection** by IP address
- ✅ **Per-camera folder organization** (e.g., uploads/129/)
- ✅ **Auto-cleanup** (keeps last 100 images per camera)
- ✅ **RESTful API** for integration
- ✅ **Web dashboard** and status monitoring

## Quick Start

### 1. Start the Python Server

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
python3 image_server.py
```

Or use the convenience script:
```bash
chmod +x start_server.sh
./start_server.sh
```

### 2. Configure ESP32-CAM

Update the WiFi credentials in `esp-cam4.ino`:
```cpp
const char* ssid = "your-wifi-name";
const char* password = "your-wifi-password";
const char* serverUrl = "http://192.168.2.38:5000/upload";
```

### 3. Upload to ESP32

1. Open `esp-cam4.ino` in Arduino IDE
2. Select board: "AI Thinker ESP32-CAM"
3. Upload the sketch
4. Open Serial Monitor (115200 baud) to see the camera's IP address

### 4. Access the Web Interface

Open in your browser:
```
http://192.168.2.38:5000
```

## Web Interface Usage

### Main Grid View
- Shows all connected cameras as live streams
- Click any stream to open fullscreen view
- Displays camera IP and image count

### Fullscreen View
- **Live Stream**: Watch the MJPEG stream in real-time
- **Captured Images**: View high-quality captured images
- **Timeline**: Scroll through all captured images at the bottom
- Click any thumbnail to display that image
- Press **ESC** or click **×** to close

## File Structure

```
ESP/
├── esp-cam4.ino           # ESP32-CAM firmware
├── image_server.py        # Python Flask server
├── requirements.txt       # Python dependencies
├── start_server.sh        # Server startup script
├── static/
│   ├── index.html        # Web interface
│   ├── style.css         # Styling
│   └── script.js         # Frontend logic
└── uploads/
    ├── 127/              # Camera at 192.168.2.127
    ├── 128/              # Camera at 192.168.2.128
    └── 129/              # Camera at 192.168.2.129
```

## API Endpoints

### Upload
- `POST /upload` - Receive images from ESP32

### Images
- `GET /latest` - Latest image from any camera
- `GET /latest/<camera_id>` - Latest from specific camera
- `GET /uploads/<camera_id>/<filename>` - Specific image file

### Stats & Lists
- `GET /stats` - Statistics per camera (JSON)
- `GET /images` - All images from all cameras (JSON)
- `GET /images/<camera_id>` - Images from specific camera (JSON)

### Frontend
- `GET /` - Multi-camera web interface
- `GET /dashboard` - Status dashboard (legacy)

## Configuration

### Python Server (`image_server.py`)
```python
UPLOAD_FOLDER = 'uploads'          # Where images are stored
KEEP_LAST_N_IMAGES = 100          # Images to keep per camera
```

### ESP32 (`esp-cam4.ino`)
```cpp
const int uploadInterval = 60000;  // Upload every 60 seconds
FRAMESIZE_QVGA                     // Stream resolution
FRAMESIZE_UXGA                     // Capture resolution
```

### Frontend (`static/script.js`)
```javascript
const REFRESH_INTERVAL = 10000;    // Refresh cameras every 10s
const NETWORK_PREFIX = '192.168.2.'; // Your network prefix
```

## Troubleshooting

### Camera Not Appearing
1. Check ESP32 Serial Monitor for IP address
2. Verify camera can reach the server (ping test)
3. Check firewall settings on server

### Stream Not Loading
1. Ensure ESP32 is on the same network
2. Try accessing stream directly: `http://192.168.2.129/stream`
3. Check browser console for CORS errors

### Upload Failures
1. Verify `serverUrl` in ESP32 code matches server IP
2. Check server logs for error messages
3. Ensure sufficient PSRAM on ESP32

### Image Quality Issues
- For better quality: Lower `jpeg_quality` value (e.g., 8)
- For faster capture: Use lower resolution (SVGA instead of UXGA)
- Adjust `xclk_freq_hz` (10MHz is stable, 20MHz is faster)

## Network Configuration

If your network uses a different subnet, update `script.js`:
```javascript
const NETWORK_PREFIX = '192.168.1.'; // Change to your subnet
```

## Performance Tips

1. **Reduce upload interval** for more frequent captures:
   ```cpp
   const int uploadInterval = 30000; // 30 seconds
   ```

2. **Increase retention** to keep more images:
   ```python
   KEEP_LAST_N_IMAGES = 500
   ```

3. **Lower capture quality** for faster uploads:
   ```cpp
   s->set_quality(s, 12); // Higher number = lower quality
   ```

## License

This project is provided as-is for educational and personal use.

## Credits

Built with:
- ESP32-CAM / Arduino
- Flask (Python)
- Vanilla JavaScript
- FreeRTOS
