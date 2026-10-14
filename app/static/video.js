const VIDEO_FPS = 24; // must match VIDEO_FPS in image_server.py

// The frames of a day's video as a timeline: selecting a frame seeks the paused video, playing it moves the selection
class VideoTimeline extends TimelineInstance {
  constructor(dialog) {
    super(dialog);
    this.date = null;
    this.thumbs = null; // layout of the thumbnail sheets
    this.player = dialog.querySelector('video');
    this.followingPlayback = false;
    this.seekTarget = null;
    this.items = new Map(); // index -> element; only the frames around the viewport exist in the DOM
    this.pitch = 0;         // distance between two frames in the strip, px
    this.itemWidth = 0;
    this.windowFrame = 0;

    // Seek once per finished seek instead of once per scroll event
    this.player.addEventListener('seeked', () => this._applySeek());
    this.timeline.addEventListener('scroll', () => this._scheduleWindow(), { passive: true });
    new ResizeObserver(() => this._scheduleWindow()).observe(this.timeline);

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

  // Thousands of frames are too many elements, so only those near the viewport are created
  _renderItems() {
    this._clearItems();
    const probe = super._createItem(this.images[0] || { timestamp: '' }, 0);
    this.timeline.replaceChildren(probe);
    this.itemWidth = probe.offsetWidth;
    this.itemHeight = probe.offsetHeight;
    this.pitch = this.itemWidth + (parseFloat(getComputedStyle(this.timeline).columnGap) || 0);

    this.sizer = document.createElement('div');
    this.sizer.className = 'timeline-sizer';
    this.sizer.style.width = `${this.images.length * this.pitch}px`;
    this.sizer.style.height = `${this.itemHeight}px`;
    this.timeline.replaceChildren(this.sizer);
    this._renderWindow();
  }

  _clearItems() {
    this.items.clear();
    this.selectedEl = null;
    cancelAnimationFrame(this.windowFrame);
  }

  _scheduleWindow() {
    if (!this.pitch) return;
    cancelAnimationFrame(this.windowFrame);
    this.windowFrame = requestAnimationFrame(() => this._renderWindow());
  }

  _renderWindow() {
    if (!this.sizer) return;
    const buffer = 10;
    const first = Math.max(0, Math.floor(this.timeline.scrollLeft / this.pitch) - buffer);
    const last = Math.min(this.images.length - 1,
      Math.ceil((this.timeline.scrollLeft + this.timeline.clientWidth) / this.pitch) + buffer);

    for (const [i, el] of this.items) {
      if (i >= first && i <= last) continue;
      el.remove();
      this.items.delete(i);
      if (el === this.selectedEl) this.selectedEl = null;
    }
    const added = [];
    for (let i = first; i <= last; i++) {
      if (this.items.has(i)) continue;
      const el = super._createItem(this.images[i], i);
      el.style.left = `${i * this.pitch}px`;
      this._loadThumb(el.querySelector('img'), i);
      if (i === this.index) {
        el.classList.add('selected');
        this.selectedEl = el;
      }
      this.items.set(i, el);
      added.push(el);
    }
    this.sizer.append(...added);
  }

  _itemEl(i) {
    return this.items.get(i) || null;
  }

  // The frame may not exist in the DOM yet, so scroll by position
  _scrollToItem(i, scroll) {
    const max = this.timeline.scrollWidth - this.timeline.clientWidth;
    const left = Math.max(0, Math.min(max, i * this.pitch + (this.itemWidth - this.timeline.clientWidth) / 2));
    this.timeline.scrollTo({ left, behavior: scroll === 'instant' ? 'instant' : 'smooth' });
    this._scheduleWindow();
  }

  initLazyLoad() {}

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
    this.seekTarget = (i + 0.5) / VIDEO_FPS;
    if (!this.player.seeking) this._applySeek();
  }

  // While a seek runs, only the latest wanted position is kept
  _applySeek() {
    if (this.seekTarget === null) return;
    this.player.currentTime = this.seekTarget;
    this.seekTarget = null;
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
    this._clearItems();
    this.sizer = null;
    this.pitch = 0;
    this.seekTarget = null;
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
