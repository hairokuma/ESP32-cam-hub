const VIDEO_FPS = 24; // must match VIDEO_FPS in image_server.py

// The frames of a day's video as a timeline: selecting a frame seeks the paused video, playing it moves the selection
class VideoTimeline extends TimelineInstance {
  constructor(dialog) {
    super(dialog);
    this.date = null;
    this.thumbs = null; // layout of the thumbnail sheets
    this.player = dialog.querySelector('video');
    this.followingPlayback = false;

    this.player.addEventListener('play',  () => { this.player.controls = true; });
    this.player.addEventListener('pause', () => { this.player.controls = false; });
    this.player.addEventListener('click', () => { if (this.player.paused) this.player.play().catch(() => {}); });
    this._followPlayback();
  }

  async load(cameraId, date) {
    this.cameraId = cameraId;
    this.date = date;
    this.index = -1;
    this.player.src = `/video/${cameraId}/${date}`;

    const [year, month, day] = date.split('-');
    this.dialog.querySelector('.video-date').textContent = `${day}.${month}.${year}`;
    this.dialog.querySelector('.video-size').textContent = '';

    try {
      const data = await fetch(`/api/video/${cameraId}/${date}`).then(r => r.json());
      if (this.date !== date) return; // closed or switched while loading
      this.images = data.frames || [];
      this.thumbs = data.thumbs;
      this.dialog.querySelector('.video-size').textContent = [
        data.size_mb && `${data.size_mb} MB`,
        data.motion_events && motionCountText(data.motion_events)
      ].filter(Boolean).join(' · ');
      this.render();
      this.player.play().catch(() => {});
    } catch (e) {
      console.error('Video load failed:', e);
    }
  }

  // Start at the first frame
  _initialIndex() {
    return 0;
  }

  // The img stays blank; the frame shows as its background, cut out of the thumbnail sheet
  _loadThumb(img, i) {
    const { cols, rows } = this.thumbs;
    const sheet = Math.floor(i / (cols * rows));
    const tile = i % (cols * rows);
    img.style.backgroundImage = `url(/video/${this.cameraId}/${this.date}/thumbs/${sheet}.jpg)`;
    img.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
    img.style.backgroundPosition =
      `${(tile % cols) / (cols - 1) * 100}% ${Math.floor(tile / cols) / (rows - 1) * 100}%`;
  }

  // Selecting a frame pauses the video on it
  _showItem(i) {
    if (this.followingPlayback) return;
    this.player.pause();
    // Aim at the middle of the frame so rounding can't land on its neighbour
    this.player.currentTime = (i + 0.5) / VIDEO_FPS;
  }

  // Keep the selection on the frame being played
  _followPlayback() {
    const follow = (time) => {
      if (this.player.paused || !this.images.length) return;
      this.followingPlayback = true;
      this.displayImage(Math.min(this.images.length - 1, Math.floor(time * VIDEO_FPS + 1e-3)), 'instant');
      this.followingPlayback = false;
    };

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const onFrame = (now, meta) => {
        follow(meta.mediaTime);
        this.player.requestVideoFrameCallback(onFrame);
      };
      this.player.requestVideoFrameCallback(onFrame);
    } else {
      this.player.addEventListener('timeupdate', () => follow(this.player.currentTime));
    }
  }

  cleanup() {
    super.cleanup();
    this.images = [];
    this.date = null;
    this.player.pause();
    this.player.removeAttribute('src');
  }
}

// ── Global helper ────────────────────────────────────────

function openVideoView(cameraId, date) {
  if (!window.videoTimeline) {
    window.videoTimeline = new VideoTimeline(document.getElementById('videoDialog'));
  }
  document.getElementById('videoDialog').showModal();
  window.videoTimeline.load(cameraId, date);
}
