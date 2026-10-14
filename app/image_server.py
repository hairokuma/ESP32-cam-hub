#!/usr/bin/env python3
"""
ESP32-CAM Image Upload Server
Receives images from ESP32 cameras, serves the web UI and builds daily videos
"""

import json
import os
import subprocess
import traceback
from datetime import datetime, timedelta
from pathlib import Path

import requests
from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask, Response, jsonify, render_template, request, send_from_directory
from PIL import Image, ImageDraw, ImageFont
from waitress import serve

import notify

app = Flask(__name__, static_folder='static', static_url_path='')

# Configuration
NETWORK_PREFIX = os.getenv('NETWORK_PREFIX', '192.168.2.')  # Adjust to your network
UPLOAD_FOLDER = Path(os.getenv('UPLOAD_FOLDER', '/data'))
VIDEO_FPS = 24
MIN_VIDEO_IMAGES = 10
BATCH_SIZE = 1000  # Timeline images per batch
ONLINE_THRESHOLD = timedelta(minutes=5)
MOTION_ACTIVE_THRESHOLD = timedelta(seconds=30)  # Motion frames arrive several times a second while motion lasts
FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
DIAGNOSTIC_HEADERS = ('RSSI', 'Free-Heap', 'Min-Free-Heap', 'Uptime', 'Reset-Reason')  # Sent by the firmware

UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)


# ── Helpers ──────────────────────────────────────────────

def today():
    return datetime.now().strftime('%Y-%m-%d')


def images_dir(camera_id, date):
    return UPLOAD_FOLDER / str(camera_id) / 'images' / date


def videos_dir(camera_id):
    return UPLOAD_FOLDER / str(camera_id) / 'videos'


def camera_url(camera_id, path):
    return f'http://{NETWORK_PREFIX}{camera_id}/{path}'


def get_camera_ids():
    """Camera IDs (last IP octet) that have an upload folder, in numeric order"""
    return sorted(
        (d.name for d in UPLOAD_FOLDER.iterdir() if d.is_dir() and d.name.isdigit()),
        key=int
    )


def list_images(camera_id, date):
    """Images of one day, oldest first (filenames start with HH-MM-SS, so name order is chronological)"""
    folder = images_dir(camera_id, date)
    return sorted(folder.glob('*.jpg')) if folder.is_dir() else []


# Images are stored as HH-MM-SS-mmm.jpg, or HH-MM-SS-mmm_m.jpg when the camera's motion sensor
# triggered (milliseconds because motion frames arrive several times a second; older images are HH-MM-SS)
MOTION_SUFFIX = '_m'


def image_time(path):
    return path.stem[:8].replace('-', ':')


def is_motion(path):
    return path.stem.endswith(MOTION_SUFFIX)


def motion_event_times(images):
    """Start time of each motion event, i.e. each run of consecutive motion images"""
    return [
        image_time(path) for i, path in enumerate(images)
        if is_motion(path) and (i == 0 or not is_motion(images[i - 1]))
    ]


def motion_sensor_marker(camera_id):
    """Exists while the camera's firmware reports a motion sensor (not every camera has one)"""
    return UPLOAD_FOLDER / str(camera_id) / 'motion-sensor'


def motion_summary_file(camera_id, date):
    """Motion events of a day, kept next to its video because the images are deleted"""
    return videos_dir(camera_id) / f'{date}.json'


def image_info(camera_id, path):
    return {
        'src': f'/uploads/{camera_id}/{path.name}',
        'filename': path.name,
        'timestamp': image_time(path),
        'motion': is_motion(path)
    }


# ── Daily video ──────────────────────────────────────────

def stamp_time(img, text, font, motion=False):
    """Draw the capture time in the bottom-right corner, on a red box for motion images"""
    draw = ImageDraw.Draw(img)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    width, height = right - left, bottom - top
    x, y = img.width - width - 20, img.height - height - 20
    draw.rectangle([x - 8, y - 8, x + width + 8, y + height + 8], fill=(200, 0, 0) if motion else (0, 0, 0))
    draw.text((x, y), text, font=font, fill=(255, 255, 255))


def generate_daily_video(camera_id, date):
    """Encode all images of a day into a timestamped video, then delete the images"""
    images = list_images(camera_id, date)
    if len(images) < MIN_VIDEO_IMAGES:
        print(f"✗ {camera_id}/{date}: only {len(images)} images, need at least {MIN_VIDEO_IMAGES}")
        return False

    output = videos_dir(camera_id) / f'{date}.mp4'
    output.parent.mkdir(parents=True, exist_ok=True)

    try:
        font = ImageFont.truetype(FONT_PATH, 32)
    except OSError:
        font = ImageFont.load_default()

    # Stream the timestamped frames straight into ffmpeg instead of writing temp files
    ffmpeg = subprocess.Popen([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', str(VIDEO_FPS), '-i', '-',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23',
        str(output)
    ], stdin=subprocess.PIPE)

    print(f"Encoding {len(images)} images for {camera_id}/{date}...")
    try:
        for path in images:
            with Image.open(path) as img:
                stamp_time(img, image_time(path), font, is_motion(path))
                img.save(ffmpeg.stdin, 'JPEG', quality=95)
        ffmpeg.stdin.close()
        success = ffmpeg.wait() == 0
    except Exception:
        traceback.print_exc()
        ffmpeg.kill()
        ffmpeg.wait()
        success = False

    if not success:
        print(f"✗ Video generation failed for {camera_id}/{date}")
        output.unlink(missing_ok=True)
        return False

    motion_summary_file(camera_id, date).write_text(json.dumps({'motion_events': motion_event_times(images)}))
    for path in images:
        path.unlink()
    print(f"✓ Generated {output}, deleted {len(images)} images")
    return True


def generate_videos_for_yesterday():
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    print(f"Generating videos for {yesterday}")
    for camera_id in get_camera_ids():
        generate_daily_video(camera_id, yesterday)


# ── Routes ───────────────────────────────────────────────

# Whether each camera's previous upload was a motion image; a motion image after a normal one starts an event
last_upload_motion = {}


@app.route('/upload', methods=['POST'])
def upload_image():
    """Receive and save image from ESP32-CAM"""
    image_data = request.get_data()
    if not image_data:
        return jsonify({'error': 'No image data received'}), 400

    # Camera ID is the last IP octet (e.g. 192.168.2.129 -> 129)
    camera_id = request.remote_addr.split('.')[-1]
    now = datetime.now()
    folder = images_dir(camera_id, now.strftime('%Y-%m-%d'))
    folder.mkdir(parents=True, exist_ok=True)
    motion = request.headers.get('X-Motion') == '1'
    filename = f"{now.strftime('%H-%M-%S')}-{now.microsecond // 1000:03d}" + (MOTION_SUFFIX if motion else '') + '.jpg'
    (folder / filename).write_bytes(image_data)

    event_start = motion and not last_upload_motion.get(camera_id, False)
    last_upload_motion[camera_id] = motion
    if event_start:
        notify.notify_motion(camera_id, image_data, now.strftime('%H:%M:%S'))

    marker = motion_sensor_marker(camera_id)
    if request.headers.get('X-Motion-Sensor') == '1':
        marker.touch()
    else:
        marker.unlink(missing_ok=True)

    diagnostics = {h: request.headers[f'X-{h}'] for h in DIAGNOSTIC_HEADERS if f'X-{h}' in request.headers}
    details = ' '.join(f'{h.lower()}={v}' for h, v in diagnostics.items())
    print(f"✓ Camera {camera_id}: {folder.name}/{filename} ({len(image_data)} bytes) {details}".rstrip())
    if diagnostics.get('Uptime', '').isdigit() and int(diagnostics['Uptime']) < 60:
        print(f"⚠ Camera {camera_id} restarted, reason: {diagnostics.get('Reset-Reason', 'unknown')}")
    if event_start:
        print(f"● Camera {camera_id}: motion detected")
    return jsonify({'status': 'success', 'camera_id': camera_id, 'filename': filename, 'size': len(image_data)})


def get_camera_status(camera_id):
    images = list_images(camera_id, today())
    latest = images[-1] if images else None
    latest_time = datetime.fromtimestamp(latest.stat().st_mtime) if latest else None
    motion_images = [p for p in images if is_motion(p)]
    last_motion = datetime.fromtimestamp(motion_images[-1].stat().st_mtime) if motion_images else None
    return {
        'id': camera_id,
        'ip': f'{NETWORK_PREFIX}{camera_id}',
        'imageCount': len(images),
        'latestTime': latest_time.strftime('%d.%m.%Y %H:%M:%S') if latest else None,
        'latestImage': image_info(camera_id, latest) if latest else None,
        'streamUrl': camera_url(camera_id, 'stream'),
        'online': latest is not None and datetime.now() - latest_time < ONLINE_THRESHOLD,
        'motionSensor': motion_sensor_marker(camera_id).exists(),
        'motionEvents': len(motion_event_times(images)),
        'lastMotion': last_motion.strftime('%H:%M:%S') if last_motion else None,
        'motionActive': last_motion is not None and datetime.now() - last_motion < MOTION_ACTIVE_THRESHOLD
    }


@app.route('/')
def index():
    return render_template('index.html', cameras=[get_camera_status(c) for c in get_camera_ids()])


@app.route('/stats')
def get_stats():
    return jsonify([get_camera_status(c) for c in get_camera_ids()])


@app.route('/uploads/<int:camera_id>/<filename>')
def serve_upload(camera_id, filename):
    """Serve an image from today's folder"""
    return send_from_directory(images_dir(camera_id, today()), filename)


@app.route('/api/timeline/<int:camera_id>')
@app.route('/api/timeline/<int:camera_id>/<int:batch>')
def get_timeline_data(camera_id, batch=None):
    """Today's images in batches of BATCH_SIZE; defaults to the latest batch"""
    images = [image_info(camera_id, p) for p in list_images(camera_id, today())]
    chunks = [images[i:i + BATCH_SIZE] for i in range(0, len(images), BATCH_SIZE)] or [[]]
    last = len(chunks) - 1
    current = last if batch is None else min(batch, last)

    page = chunks[current]
    if current == last:  # The live stream follows the most recent image
        page = page + [{'src': f'/camera/{camera_id}/stream', 'filename': 'stream', 'timestamp': 'now'}]

    return jsonify({
        'camera_id': camera_id,
        'images': page,
        'batches': [
            {'name': f"{c[0]['timestamp']} - {c[-1]['timestamp']}", 'batch': i, 'active': i == current}
            for i, c in enumerate(chunks) if c
        ],
        'current_batch': current
    })


@app.route('/api/timeline/<int:camera_id>/new')
def get_new_images(camera_id):
    """Today's images after ?after=<filename>, so the open timeline gets every frame of a motion burst"""
    after = request.args.get('after', '')
    return jsonify([image_info(camera_id, p) for p in list_images(camera_id, today()) if p.name > after])


@app.route('/camera/<int:camera_id>/stream')
def proxy_stream(camera_id):
    """Proxy the MJPEG stream from an ESP32 camera"""
    try:
        upstream = requests.get(camera_url(camera_id, 'stream'), stream=True, timeout=10)
    except requests.RequestException:
        return jsonify({'error': 'Camera not reachable', 'camera_id': camera_id}), 503
    content_type = upstream.headers.get('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
    response = Response(upstream.iter_content(chunk_size=4096), content_type=content_type)
    # Close the camera connection when the viewer leaves; the camera serves only one stream at a time
    response.call_on_close(upstream.close)
    return response


@app.route('/camera/<int:camera_id>/led')
def control_led(camera_id):
    """Proxy LED control to an ESP32 camera"""
    try:
        response = requests.get(
            camera_url(camera_id, 'led'),
            params={'state': request.args.get('state', 'toggle')},
            timeout=5
        )
    except requests.Timeout:
        return jsonify({'error': 'Camera timeout', 'camera_id': camera_id}), 504
    except requests.RequestException:
        return jsonify({'error': 'Camera not reachable', 'camera_id': camera_id}), 503
    if not response.ok:
        return jsonify({'error': 'Failed to control LED', 'camera_id': camera_id}), response.status_code
    return jsonify(response.json())


@app.route('/api/calendar/<int:camera_id>')
def get_calendar_data(camera_id):
    """Days that have a video (oldest first) and the number of motion events per day"""
    videos = [
        {'date': v.stem, 'size_mb': round(v.stat().st_size / 2**20, 2)}
        for v in sorted(videos_dir(camera_id).glob('*.mp4'))
    ]
    motion = {}
    for summary in videos_dir(camera_id).glob('*.json'):
        events = json.loads(summary.read_text()).get('motion_events', [])
        if events:
            motion[summary.stem] = len(events)
    today_events = motion_event_times(list_images(camera_id, today()))
    if today_events:
        motion[today()] = len(today_events)
    return jsonify({'camera_id': camera_id, 'videos': videos, 'motion': motion})


@app.route('/video/<int:camera_id>/<date>')
def serve_video(camera_id, date):
    return send_from_directory(videos_dir(camera_id), f'{date}.mp4')


if __name__ == '__main__':
    scheduler = BackgroundScheduler()
    scheduler.add_job(generate_videos_for_yesterday, 'cron', hour=0, minute=5)
    scheduler.start()

    print(f"Upload folder: {UPLOAD_FOLDER.resolve()}")
    print("Videos of the previous day are generated daily at 00:05")
    print(notify.status())
    print("Web UI: http://YOUR_IP:5000  ·  ESP32 upload URL: http://YOUR_IP:5000/upload")

    # Waitress instead of Flask's dev server, which closes every connection: keep-alive lets the cameras
    # reuse one connection for their uploads (faster motion bursts). Each open live stream holds a
    # thread, so there are plenty; idle connections hold none and are closed after channel_timeout.
    serve(app, host='0.0.0.0', port=5000, threads=32, channel_timeout=60)
