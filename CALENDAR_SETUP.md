# ESP32-CAM Setup - Video Calendar System

## New Features

### 📅 Daily Video Generation
- All images are now organized by date: `uploads/<camera>/images/YYYY-MM-DD/HH-MM-SS.jpg`
- Every night at 00:05, videos are automatically generated from the previous day's images
- Videos are saved to: `uploads/<camera>/videos/YYYY-MM-DD.mp4`
- Original images are deleted after successful video creation to save space

### 🎥 Calendar Interface
- View all recorded videos in a calendar layout
- Days with videos are highlighted in green
- Click any day to play the video
- Access via the 📅 icon in each camera card header

## Installation

1. **Install new dependencies:**
   ```bash
   cd /home/fdoelling/Data/ESP/app
   pip install -r requirements.txt
   ```

2. **Install ffmpeg (required for video generation):**
   ```bash
   # Ubuntu/Debian
   sudo apt update
   sudo apt install ffmpeg
   
   # Check installation
   ffmpeg -version
   ```

3. **Start the server:**
   ```bash
   python image_server.py
   ```

## Storage Structure

```
uploads/
├── 129/                          # Camera 129
│   ├── images/
│   │   ├── 2026-04-11/
│   │   │   ├── 08-30-00.jpg
│   │   │   ├── 08-30-10.jpg
│   │   │   └── ...
│   │   └── 2026-04-12/          # Today's images
│   │       ├── 09-15-00.jpg
│   │       └── ...
│   └── videos/
│       ├── 2026-04-11.mp4       # Generated videos
│       └── 2026-04-10.mp4
└── 130/                          # Camera 130
    ├── images/
    └── videos/
```

## API Endpoints

### New Endpoints
- `GET /calendar` - Calendar web interface
- `GET /api/calendar/<camera_id>` - Get list of available videos (JSON)
- `GET /video/<camera_id>/<date>` - Stream/download video file
- `POST /api/generate-video/<camera_id>/<date>` - Manually trigger video generation

### Updated Endpoints
- `POST /upload` - Now saves images in date folders
- `GET /images/<camera_id>` - Returns today's images only
- `GET /stats` - Returns today's image count

## Video Generation

### Automatic (Scheduled)
Videos are automatically generated every day at **00:05** for the previous day's images.

### Manual Trigger
You can manually generate a video for a specific date:

```bash
curl -X POST http://localhost:5000/api/generate-video/129/2026-04-12
```

### Requirements
- Minimum 10 images required to generate a video
- ffmpeg must be installed and in system PATH
- Video settings: 24 FPS, H.264 codec, CRF 23

## Troubleshooting

### Video generation fails
- Check if ffmpeg is installed: `ffmpeg -version`
- Ensure at least 10 images exist for the day
- Check server logs for ffmpeg errors

### Calendar shows no videos
- Wait until after midnight for first video to generate
- Or manually trigger video generation via API
- Check `uploads/<camera>/videos/` folder exists

### Images not showing in timeline
- The timeline now only shows today's images
- Historical images are compressed into videos
- Use the calendar to view previous days

## Configuration

Edit in `image_server.py`:
- `VIDEO_FPS = 24` - Video frame rate
- `NETWORK_PREFIX = '192.168.2.'` - Your network prefix
- Scheduler time: Line with `hour=0, minute=5` - Change generation time

## Calendar Interface

Access the calendar:
1. Click the 📅 icon on any camera card
2. Or navigate to: `http://YOUR_IP:5000/calendar?camera=129`
3. Use month navigation to browse historical videos
4. Click any green-highlighted day to play the video

## Benefits

✅ **Space Efficient**: Images compressed into videos, saving ~90% storage  
✅ **Long-term Storage**: Keep months/years of footage in video format  
✅ **Easy Browsing**: Calendar interface for quick access to any day  
✅ **Automatic**: No manual intervention needed, runs every night  
✅ **Multi-camera**: Separate videos for each camera
