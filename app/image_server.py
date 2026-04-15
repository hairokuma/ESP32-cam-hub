#!/usr/bin/env python3
"""
ESP32-CAM Image Upload Server
Receives and saves images from ESP32 camera
"""

from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
from datetime import datetime, timedelta
import os
from pathlib import Path
import requests
from flask_cors import CORS
import subprocess
from apscheduler.schedulers.background import BackgroundScheduler
from PIL import Image, ImageDraw, ImageFont
import tempfile
import shutil

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)  # Enable CORS for all routes

# Configuration
NETWORK_PREFIX = os.getenv('NETWORK_PREFIX', '192.168.2.')  # Adjust to your network
UPLOAD_FOLDER = os.getenv('UPLOAD_FOLDER', '/data')  # Use env var, default to /data
VIDEO_FPS = 24  # Frames per second for videos
ALLOWED_EXTENSIONS = {'jpg', 'jpeg'}

# Create upload directory if it doesn't exist
Path(UPLOAD_FOLDER).mkdir(parents=True, exist_ok=True)

# Track upload statistics
upload_stats = {
    'total_uploads': 0,
    'last_upload_time': None,
    'last_image_size': 0,
    'latest_image': None
}


def get_camera_id(ip_address):
    """Extract the last octet from IP address as camera ID"""
    try:
        return ip_address.split('.')[-1]
    except Exception:
        return 'unknown'


def generate_daily_video(camera_id, date_str):
    """Generate video from all images of a specific day with timestamp overlays"""
    temp_dir = None
    try:
        images_folder = os.path.join(UPLOAD_FOLDER, camera_id, 'images', date_str)
        videos_folder = os.path.join(UPLOAD_FOLDER, camera_id, 'videos')
        
        # Debug: Print the folder path
        print(f"Looking for images in: {os.path.abspath(images_folder)}")
        
        # Check if images folder exists
        if not os.path.exists(images_folder):
            print(f"✗ Images folder does not exist: {images_folder}")
            return False
        
        # Get all image files
        image_files = sorted(Path(images_folder).glob('*.jpg'))
        print(f"Found {len(image_files)} images")
        
        if len(image_files) < 10:  # Need at least 10 images for a video
            print(f"✗ Not enough images for {camera_id}/{date_str} (only {len(image_files)}, need at least 10)")
            return False
        
        # Create videos folder if it doesn't exist
        Path(videos_folder).mkdir(parents=True, exist_ok=True)
        
        output_video = os.path.join(videos_folder, f'{date_str}.mp4')
        
        # Create temporary directory for timestamped images
        temp_dir = tempfile.mkdtemp(prefix=f'video_{camera_id}_{date_str}_')
        print(f"Creating timestamped images in {temp_dir}")
        
        # Add timestamp overlay to each image using PIL
        try:
            # Try to use a nice font, fall back to default if not available
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 32)
        except Exception:
            font = ImageFont.load_default()
        
        timestamped_files = []
        for i, img_file in enumerate(image_files):
            # Extract timestamp from filename (e.g., 13-45-45.jpg -> 13:45:45)
            timestamp = img_file.stem.replace('-', ':')
            
            # Open image and add timestamp
            img = Image.open(img_file)
            draw = ImageDraw.Draw(img)
            
            # Get text size for positioning
            bbox = draw.textbbox((0, 0), timestamp, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            
            # Position at bottom right with padding
            x = img.width - text_width - 20
            y = img.height - text_height - 20
            
            # Draw semi-transparent black background box
            padding = 8
            draw.rectangle(
                [x - padding, y - padding, x + text_width + padding, y + text_height + padding],
                fill=(0, 0, 0, 180)
            )
            
            # Draw white text
            draw.text((x, y), timestamp, font=font, fill=(255, 255, 255, 255))
            
            # Save timestamped image to temp directory
            temp_file = os.path.join(temp_dir, f"{i:06d}.jpg")
            img.save(temp_file, quality=95)
            timestamped_files.append(temp_file)
            img.close()
            
            if (i + 1) % 100 == 0:
                print(f"  Processed {i + 1}/{len(image_files)} images")
        
        print(f"✓ Created {len(timestamped_files)} timestamped images")
        
        # Create file list for ffmpeg concat demuxer
        input_list_file = os.path.join(temp_dir, 'input.txt')
        with open(input_list_file, 'w') as f:
            for temp_file in timestamped_files:
                f.write(f"file '{temp_file}'\n")
        
        # Generate video using ffmpeg with concat demuxer
        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', input_list_file,
            '-r', str(VIDEO_FPS),
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-crf', '23',
            output_video
        ]
        
        print("Running ffmpeg to create video...")
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # Clean up temporary directory
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            print(f"✓ Cleaned up temporary directory")
        
        if result.returncode == 0:
            print(f"✓ Generated video: {output_video}")
            # Delete original images after successful video creation
            for img in image_files:
                img.unlink()
            print(f"✓ Deleted {len(image_files)} original images from {date_str}")
            return True
        else:
            print(f"✗ ffmpeg failed with return code {result.returncode}")
            print(f"✗ ffmpeg stderr: {result.stderr}")
            print(f"✗ ffmpeg stdout: {result.stdout}")
            return False
            
    except Exception as e:
        print(f"✗ Video generation error: {e}")
        import traceback
        traceback.print_exc()
        # Clean up temporary directory on error
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass
        return False


def generate_videos_for_yesterday():
    """Generate videos for all cameras from yesterday's images"""
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    print(f"\n{'='*50}")
    print(f"Generating videos for {yesterday}")
    print(f"{'='*50}")
    
    camera_folders = [d for d in Path(UPLOAD_FOLDER).iterdir() if d.is_dir()]
    
    for camera_folder in camera_folders:
        camera_id = camera_folder.name
        if camera_id == 'videos':  # Skip videos folder
            continue
        generate_daily_video(camera_id, yesterday)
    
    print(f"{'='*50}\n")


@app.route('/upload', methods=['POST'])
def upload_image():
    """Receive and save image from ESP32-CAM"""
    
    try:
        # Get the raw image data
        image_data = request.get_data()
        
        if not image_data:
            return jsonify({'error': 'No image data received'}), 400
        
        # Get camera ID from IP address (e.g., 192.168.2.129 -> 129)
        camera_ip = request.remote_addr
        camera_id = get_camera_id(camera_ip)
        
        # Get current date and time
        now = datetime.now()
        date_str = now.strftime('%Y-%m-%d')
        time_str = now.strftime('%H-%M-%S')
        
        # Create camera/date-specific folder structure: uploads/129/images/2026-04-12/
        camera_images_folder = os.path.join(UPLOAD_FOLDER, camera_id, 'images', date_str)
        Path(camera_images_folder).mkdir(parents=True, exist_ok=True)
        
        # Generate filename with timestamp
        filename = f'{time_str}.jpg'
        filepath = os.path.join(camera_images_folder, filename)
        
        # Save the image
        with open(filepath, 'wb') as f:
            f.write(image_data)
        
        # Update statistics
        upload_stats['total_uploads'] += 1
        upload_stats['last_upload_time'] = now.strftime('%d.%m.%Y %H:%M:%S')
        upload_stats['last_image_size'] = len(image_data)
        upload_stats['latest_image'] = f"{camera_id}/images/{date_str}/{filename}"
        
        print(f"✓ Camera {camera_id} ({camera_ip}): {date_str}/{time_str}.jpg ({len(image_data)} bytes)")
        
        return jsonify({
            'status': 'success',
            'camera_id': camera_id,
            'filename': filename,
            'date': date_str,
            'size': len(image_data),
            'timestamp': upload_stats['last_upload_time']
        }), 200
        
    except Exception as e:
        print(f"✗ Upload error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/uploads/<camera_id>/<filename>', methods=['GET'])
def serve_upload(camera_id, filename):
    """Serve uploaded images from today's folder"""
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        today_folder = os.path.join(UPLOAD_FOLDER, camera_id, 'images', today)
        return send_from_directory(today_folder, filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/stats', methods=['GET'])
def get_stats():
    return get_cameras()

def get_cameras():
    """Get list of active cameras based on upload folders"""
    camera_folders = [d for d in Path(UPLOAD_FOLDER).iterdir() if d.is_dir()]
    
    cameras = []
    for camera_folder in camera_folders:
        camera_id = camera_folder.name
        today = datetime.now().strftime('%Y-%m-%d')
        today_folder = camera_folder / 'images' / today
        image_count = len(list(today_folder.glob('*.jpg'))) if today_folder.exists() else 0
        files = sorted(
            today_folder.glob('*.jpg'),
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        latest_time = datetime.fromtimestamp(files[0].stat().st_mtime).strftime('%d.%m.%Y %H:%M:%S') if files else None
        cameras.append(
            {
                "id": camera_id,
                "ip": f"{NETWORK_PREFIX}{camera_id}",
                "imageCount": image_count,
                "latestTime": latest_time,
                "streamUrl": f"http://{NETWORK_PREFIX}{camera_id}/stream",
                "online": latest_time is not None and (datetime.now() - datetime.strptime(latest_time, '%d.%m.%Y %H:%M:%S')).total_seconds() < 300 # Consider online if last upload was within 5 minutes
            }
        )
    cameras.sort(key=lambda x: int(x['id']))
    return cameras

@app.route('/', methods=['GET'])
def index():
    """Serve the main frontend"""
    return render_template('index.html', cameras=get_cameras())


@app.route('/timeline/<camera_id>', methods=['GET'])
@app.route('/timeline/<camera_id>/<int:batch>', methods=['GET'])
def timeline(camera_id=None, batch=None):
    """Serve the timeline frontend"""
    try:
        today = datetime.now().strftime('%Y-%m-%d')

        # List today's images for specific camera
        today_folder = os.path.join(UPLOAD_FOLDER, camera_id, 'images', today)
        
        if not os.path.exists(today_folder):
            return jsonify({'camera_id': camera_id, 'count': 0, 'images': []})
        
        files = sorted(
            Path(today_folder).glob('*.jpg'),
            key=lambda x: x.stat().st_mtime,
            reverse=False
        )
        
        # Build full image list
        all_images = []
        for f in files:
            stat = f.stat()
            all_images.append({
                'src': f'/uploads/{camera_id}/{f.name}',
                'filename': f.name,
                'size': stat.st_size,
                'timestamp': datetime.fromtimestamp(stat.st_mtime).strftime('%H:%M:%S')
            })
        
        # Calculate batches (1000 images per batch)
        BATCH_SIZE = 1000
        total_images = len(all_images)
        num_batches = max(1, (total_images + BATCH_SIZE - 1) // BATCH_SIZE)  # Ceiling division, at least 1
        
        # Determine current batch (default to last batch - most recent images)
        current_batch = batch if batch is not None else num_batches - 1
        current_batch = max(0, min(current_batch, num_batches - 1))  # Clamp to valid range
        
        # Get images for current batch
        start_idx = current_batch * BATCH_SIZE
        end_idx = min(start_idx + BATCH_SIZE, total_images)
        image_list = all_images[start_idx:end_idx]
        
        # Add live stream as the last item (only for the most recent batch)
        if current_batch == num_batches - 1:
            image_list.append({
                'src': f"http://{NETWORK_PREFIX}{camera_id}/stream",
                'filename': 'stream',
                'size': 0,
                'timestamp': 'now'
            })
        
        # Generate batch information for navigation
        batches = []
        for i in range(num_batches):
            batch_start_idx = i * BATCH_SIZE
            batch_end_idx = min(batch_start_idx + BATCH_SIZE, total_images) - 1
            
            if batch_start_idx < total_images and batch_end_idx >= 0:
                first_timestamp = all_images[batch_start_idx]['timestamp']
                last_timestamp = all_images[batch_end_idx]['timestamp']
                batch_name = f"{first_timestamp} - {last_timestamp}"
                
                batches.append({
                    'name': batch_name,
                    'url': f'/timeline/{camera_id}/{i}',
                    'active': i == current_batch
                })
        
        return render_template('timeline.html', images=image_list, camera_id=camera_id, 
                             stream_url=f"http://{NETWORK_PREFIX}{camera_id}/stream", 
                             date=today, batches=batches)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    
@app.route('/calendar/<camera_id>', methods=['GET'])
def calendar(camera_id=None):
    """Serve the calendar page"""
    return render_template('calendar.html')

@app.route('/camera/<camera_id>/led', methods=['GET'])
def control_led(camera_id):
    """Proxy endpoint to control camera LED (avoids CORS issues)"""
    
    try:
        state = request.args.get('state', 'toggle')
        camera_ip = f"{NETWORK_PREFIX}{camera_id}"
        
        # Make request to ESP camera
        response = requests.get(
            f"http://{camera_ip}/led",
            params={'state': state},
            timeout=5
        )
        
        if response.ok:
            return jsonify(response.json()), 200
        else:
            return jsonify({'error': 'Failed to control LED', 'camera_id': camera_id}), response.status_code
            
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Camera timeout', 'camera_id': camera_id}), 504
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Camera not reachable', 'camera_id': camera_id}), 503
    except Exception as e:
        return jsonify({'error': str(e), 'camera_id': camera_id}), 500


@app.route('/api/calendar/<camera_id>', methods=['GET'])
def get_calendar_data(camera_id):
    """Get calendar data showing which days have videos"""
    
    try:
        videos_folder = os.path.join(UPLOAD_FOLDER, camera_id, 'videos')
        
        if not os.path.exists(videos_folder):
            return jsonify({'camera_id': camera_id, 'videos': []})
        
        # Get all video files
        video_files = sorted(Path(videos_folder).glob('*.mp4'), reverse=True)
        
        videos = []
        for video in video_files:
            date_str = video.stem  # Filename without extension (YYYY-MM-DD)
            stat = video.stat()
            
            videos.append({
                'date': date_str,
                'filename': video.name,
                'size': stat.st_size,
                'size_mb': round(stat.st_size / (1024 * 1024), 2)
            })
        
        return jsonify({
            'camera_id': camera_id,
            'videos': videos
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/video/<camera_id>/<date>', methods=['GET'])
def serve_video(camera_id, date):
    """Serve a specific video file"""
    try:
        videos_folder = os.path.join(UPLOAD_FOLDER, camera_id, 'videos')
        video_file = f'{date}.mp4'
        return send_from_directory(videos_folder, video_file)
    except Exception as e:
        return jsonify({'error': str(e)}), 404

if __name__ == '__main__':
    print("=" * 50)
    print("ESP32-CAM Multi-Camera Upload Server")
    print("=" * 50)
    print(f"Upload folder: {os.path.abspath(UPLOAD_FOLDER)}")
    print(f"Video generation: {VIDEO_FPS} FPS")
    print("=" * 50)
    print("\nEndpoints:")
    print("  POST /upload                   - Receive images from ESP32")
    print("  GET  /                         - Multi-camera web interface")
    print("  GET  /calendar                 - Calendar view of recorded videos")
    print("  GET  /api/calendar/<cam_id>    - Get calendar data (JSON)")
    print("  GET  /video/<cam_id>/<date>    - Serve video file")
    print("  GET  /stats                    - Upload statistics per camera")
    print("=" * 50)
    print("\nDaily Video Generation:")
    print("  - Images stored by date: uploads/<cam>/images/YYYY-MM-DD/")
    print("  - Videos generated at midnight for previous day")
    print("  - Videos saved to: uploads/<cam>/videos/YYYY-MM-DD.mp4")
    print("  - Images deleted after video creation")
    print("=" * 50)
    
    # Set up scheduler for automatic video generation
    scheduler = BackgroundScheduler()
    # Run every day at 00:05 (5 minutes past midnight)
    scheduler.add_job(generate_videos_for_yesterday, 'cron', hour=0, minute=5)
    scheduler.start()
    print("\n✓ Scheduler started - Videos will be generated daily at 00:05")
    print("=" * 50)
    print("\nStarting server on 0.0.0.0:5000...")
    print("Open in browser: http://YOUR_IP:5000")
    print("ESP32 upload URL: http://YOUR_IP:5000/upload")
    print("=" * 50)
    
    # for testing generate_daily_video for today's images, uncomment the line below:
    # generate_daily_video('129', datetime.now().strftime('%Y-%m-%d'))

    try:
        app.run(host='0.0.0.0', port=5000, debug=True)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
        print("\n\nServer stopped")
