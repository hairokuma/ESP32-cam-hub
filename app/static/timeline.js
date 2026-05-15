class TimelineInstance {
  constructor() {
    this.cameraId = null;
    this.images = [];
    this.batches = [];
    this.currentBatch = 0;
    this.index = -1;
    this.isDragging = false;
    this.observer = null;

    this.stageEl = document.getElementById('timelineActive');
    this.timeline = document.getElementById('timeline');
    this.scrubberTrack = document.getElementById('scrubberTrack');
    this.scrubberBar = document.getElementById('scrubberBar');
    this.scrubberTooltip = document.getElementById('scrubberTooltip');
    this.batchContainer = document.getElementById('batchContainer');

    this.setupEventListeners();
  }

  async load(cameraId, batch = null) {
    this.cameraId = cameraId;
    this.index = -1;
    this._revokeBlobUrls();
    const url = batch !== null
      ? `/api/timeline/${cameraId}/${batch}`
      : `/api/timeline/${cameraId}`;
    try {
      const data = await fetch(url).then(r => r.json());
      this.images = data.images || [];
      this.batches = data.batches || [];
      this.currentBatch = data.current_batch || 0;
      this.render();
    } catch (e) {
      console.error('Timeline load failed:', e);
    }
  }

  _revokeBlobUrls() {
    this.images.forEach(img => {
      if (img.blobUrl) URL.revokeObjectURL(img.blobUrl);
    });
  }

  // Fetch an image exactly once and store the blob URL on the image object.
  // Returns a promise that resolves to the blob URL.
  _fetchImage(image) {
    if (image.blobUrl) return Promise.resolve(image.blobUrl);
    if (image.loadPromise) return image.loadPromise;
    image.loadPromise = fetch(image.src)
      .then(r => r.blob())
      .then(blob => {
        image.blobUrl = URL.createObjectURL(blob);
        return image.blobUrl;
      });
    return image.loadPromise;
  }

  render() {
    this.batchContainer.innerHTML = '';
    this.batches.forEach(batch => {
      const a = document.createElement('a');
      a.href = 'javascript:void(0)';
      a.className = 'batch-item';
      a.textContent = batch.name;
      a.dataset.active = batch.active;
      a.onclick = () => this.load(this.cameraId, batch.batch);
      this.batchContainer.appendChild(a);
    });

    this.timeline.innerHTML = '';
    this.images.forEach((image, i) => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      item.dataset.item = i;
      item.dataset.timestamp = image.timestamp;
      item.onclick = () => this.displayImage(i);

      const img = document.createElement('img');
      img.src = BLANK;
      img.dataset.src = image.src;
      img.alt = image.timestamp;

      const ts = document.createElement('div');
      ts.className = 'timestamp';
      ts.textContent = image.timestamp;

      item.append(img, ts);
      this.timeline.appendChild(item);
    });

    this.timeline.scrollLeft = this.timeline.scrollWidth;
    this.initLazyLoad();
    setTimeout(() => this.displayImage(this.images.length - 1), 200);
  }

  initLazyLoad() {
    if (this.observer) this.observer.disconnect();
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const item = img.closest('.timeline-item');
          const idx = item ? parseInt(item.dataset.item) : -1;
          const image = idx >= 0 ? this.images[idx] : null;

          if (image) {
            this._fetchImage(image).then(blobUrl => {
              img.src = blobUrl;
              // If this is the currently displayed image, push the blob URL to stageEl too
              if (idx === this.index) this._setStageUrl(blobUrl, image.timestamp);
            });
          }
          this.observer.unobserve(img);
        }
      });
    }, { root: this.timeline, rootMargin: '3300px', threshold: 0.01 });

    this.timeline.querySelectorAll('img').forEach(img => this.observer.observe(img));
  }

  _setStageUrl(blobUrl, alt) {
    let stageImg = this.stageEl.querySelector('img');
    if (!stageImg) {
      stageImg = document.createElement('img');
      this.stageEl.appendChild(stageImg);
    }
    stageImg.src = blobUrl;
    stageImg.alt = alt;
  }

  displayImage(i, scroll = true) {
    if (i < 0 || i >= this.images.length) return;
    const changed = i !== this.index;
    this.index = i;

    const image = this.images[i];

    if (changed) {
      this.scrubberTooltip.textContent = image.timestamp;

      // Fetch once — if already fetching/fetched, reuses the same promise/blobUrl
      this._fetchImage(image).then(blobUrl => {
        if (this.index !== i) return; // user navigated away while loading
        this._setStageUrl(blobUrl, image.timestamp);
        // Propagate to timeline thumbnail if lazy loader hasn't set it yet
        const timelineImg = this.timeline.querySelector(`.timeline-item[data-item="${i}"] img`);
        if (timelineImg && timelineImg.src !== blobUrl) timelineImg.src = blobUrl;
      });

      this.timeline.querySelectorAll('.timeline-item.selected')
        .forEach(el => el.classList.remove('selected'));

      const activeItem = this.timeline.querySelector(`.timeline-item[data-item="${i}"]`);
      if (activeItem) {
        activeItem.classList.add('selected');
        if (scroll) {
          activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }
    }

    const maxScroll = this.timeline.scrollWidth - this.timeline.clientWidth;
    const pct = maxScroll > 0 ? this.timeline.scrollLeft / maxScroll : 0;
    this.scrubberBar.style.left = `calc(${pct * 100}% - 0.375rem)`;
  }

  handleTimelineScroll() {
    if (!this.images.length) return;
    const center = this.timeline.scrollLeft + this.timeline.clientWidth / 2;
    const pct = this.timeline.scrollWidth > 0 ? center / this.timeline.scrollWidth : 0;
    this.displayImage(Math.round(pct * (this.images.length - 1)), false);
  }

  handleScrubberDrag(e) {
    const rect = this.scrubberTrack.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    this.timeline.scrollLeft = pct * (this.timeline.scrollWidth - this.timeline.clientWidth);
  }

  setupEventListeners() {
    const startDrag = (e) => {
      this.isDragging = true;
      this.scrubberTrack.classList.add('dragging');
      this.handleScrubberDrag(e);
    };
    const onDrag = (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      this.handleScrubberDrag(e);
    };
    const endDrag = () => {
      this.isDragging = false;
      this.scrubberTrack.classList.remove('dragging');
    };

    const onKey = (e) => {
      if (!document.getElementById('timelineDialog').open) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.displayImage(this.index - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.displayImage(this.index + 1); }
    };

    document.addEventListener('keydown', onKey);
    document.getElementById('prevImage').addEventListener('click', () => this.displayImage(this.index - 1));
    document.getElementById('nextImage').addEventListener('click', () => this.displayImage(this.index + 1));

    this.scrubberTrack.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    this.scrubberTrack.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', endDrag);

    this.timeline.addEventListener('scroll', () => this.handleTimelineScroll(), { passive: true });
  }

  cleanup() {
    if (this.observer) this.observer.disconnect();
    this._revokeBlobUrls();
    this.timeline.innerHTML = '';
    this.batchContainer.innerHTML = '';
    this.stageEl.innerHTML = '';
    this.index = -1;
  }
}

// ── Global helper ────────────────────────────────────────

function openTimeline(cameraId) {
  if (!window.timelineInstance) {
    window.timelineInstance = new TimelineInstance();
  }
  document.getElementById('timelineDialog').showModal();
  window.timelineInstance.load(cameraId);
}
