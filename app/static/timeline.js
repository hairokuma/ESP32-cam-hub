// Filmstrip of thumbnails with a scrubber in a dialog; subclasses change what the items are and how they show
class TimelineInstance {
  constructor(dialog) {
    this.dialog = dialog;
    this.cameraId = null;
    this.images = [];
    this.batches = [];
    this.currentBatch = 0;
    this.index = -1;
    this.isDragging = false;
    this.autoScrolling = false; // true while scrollIntoView is moving the strip
    this.autoScrollTimer = null;
    this.observer = null;
    this.fetchingNew = false;

    this.stageEl = dialog.querySelector('.stage');
    this.timeline = dialog.querySelector('.timeline');
    this.scrubberTrack = dialog.querySelector('.scrubber-track');
    this.scrubberBar = dialog.querySelector('.scrubber-bar');
    this.scrubberTooltip = dialog.querySelector('.scrubber-tooltip');
    this.scrubberMarks = dialog.querySelector('.scrubber-marks');
    this.batchContainer = dialog.querySelector('.batch-container');

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
  // Returns a promise that resolves to the blob URL (or src directly for streams).
  _fetchImage(image) {
    if (image.filename === 'stream') return Promise.resolve(image.src);
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
    this.renderBatches();
    this.selectedEl = null;
    this._renderItems();
    this._renderMotionMarks();
    // Centering the first or last item scrolls to the strip's start or end, which the scroll position maps to as well
    this.displayImage(this._initialIndex(), 'instant');
  }

  // Start at the newest image
  _initialIndex() {
    return this.images.length - 1;
  }

  _renderItems() {
    this.timeline.replaceChildren(...this.images.map((image, i) => this._createItem(image, i)));
    this.initLazyLoad();
  }

  _itemEl(i) {
    return this.timeline.querySelector(`.timeline-item[data-item="${i}"]`);
  }

  _scrollToItem(i, scroll) {
    this.selectedEl?.scrollIntoView({ behavior: scroll === 'instant' ? 'instant' : 'smooth', block: 'nearest', inline: 'center' });
  }

  renderBatches() {
    if (!this.batchContainer) return;
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
  }

  _createItem(image, i) {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.classList.toggle('motion', !!image.motion);
    item.dataset.item = i;

    const img = document.createElement('img');
    img.src = BLANK;
    img.alt = image.timestamp;

    const ts = document.createElement('div');
    ts.className = 'timestamp';
    ts.textContent = image.timestamp;

    item.append(img, ts);
    return item;
  }

  // Motion events are runs of consecutive motion images (same definition as the server's count)
  _motionEventStarts() {
    return this.images.flatMap((image, i) => image.motion && !this.images[i - 1]?.motion ? [i] : []);
  }

  jumpToMotion(direction) {
    const starts = this._motionEventStarts();
    const target = direction > 0
      ? starts.find(i => i > this.index)
      : starts.findLast(i => i < this.index);
    if (target !== undefined) this.displayImage(target);
  }

  // One mark per motion event, spanning the scrubber positions that select its images.
  // A mark per image would be thousands of elements on a full day, which makes every repaint slow.
  _renderMotionMarks() {
    const starts = this._motionEventStarts();
    this.scrubberTrack.title = starts.length ? 'M / Shift+M: nächste / vorherige Bewegung' : '';
    const last = Math.max(1, this.images.length - 1);
    this.scrubberMarks.replaceChildren(...starts.map(start => {
      let end = start;
      while (this.images[end + 1]?.motion) end++;
      const mark = document.createElement('div');
      mark.className = 'scrubber-mark';
      mark.style.left = `${(start / last) * 100}%`;
      mark.style.width = `${((end - start) / last) * 100}%`;
      return mark;
    }));
  }

  initLazyLoad() {
    if (this.observer) this.observer.disconnect();
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const idx = Number(img.closest('.timeline-item').dataset.item);
          if (this.images[idx]) this._loadThumb(img, idx);
          this.observer.unobserve(img);
        }
      });
    }, { root: this.timeline, rootMargin: '3300px', threshold: 0.01 });

    this.timeline.querySelectorAll('img').forEach(img => this.observer.observe(img));
  }

  _loadThumb(img, i) {
    const image = this.images[i];
    this._fetchImage(image).then(blobUrl => {
      img.src = blobUrl;
      // If this is the currently displayed image, push the blob URL to stageEl too
      if (i === this.index) this._setStageUrl(blobUrl, image.timestamp);
    });
  }

  // Show item i on the stage
  _showItem(i) {
    const image = this.images[i];
    // Fetch once — if already fetching/fetched, reuses the same promise/blobUrl
    this._fetchImage(image).then(blobUrl => {
      if (this.index !== i) return; // user navigated away while loading
      this._setStageUrl(blobUrl, image.timestamp);
      // Propagate to timeline thumbnail if lazy loader hasn't set it yet
      const timelineImg = this.timeline.querySelector(`.timeline-item[data-item="${i}"] img`);
      if (timelineImg && timelineImg.src !== blobUrl) timelineImg.src = blobUrl;
    });
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

  // scroll: true scrolls the item into view smoothly, 'instant' at once, false not at all
  displayImage(i, scroll = true) {
    if (i < 0 || i >= this.images.length) return;
    const changed = i !== this.index;
    this.index = i;

    if (changed) {
      this.scrubberTooltip.textContent = this.images[i].timestamp;
      this._showItem(i);

      this.selectedEl?.classList.remove('selected');
      this.selectedEl = this._itemEl(i);
      this.selectedEl?.classList.add('selected');
      if (scroll) {
        this._ignoreScrollUntilIdle();
        this._scrollToItem(i, scroll);
      }
    }

    this._updateScrubber();
  }

  _scrollFraction() {
    const maxScroll = this.timeline.scrollWidth - this.timeline.clientWidth;
    return maxScroll > 0 ? this.timeline.scrollLeft / maxScroll : 0;
  }

  _updateScrubber() {
    this.scrubberBar.style.left = `calc(${this._scrollFraction() * 100}% - 0.375rem)`;
  }

  // Scroll events caused by scrollIntoView must not change the selection.
  // Smooth scrolling fires an event every frame, so 150ms without one means it has finished.
  _ignoreScrollUntilIdle() {
    this.autoScrolling = true;
    clearTimeout(this.autoScrollTimer);
    this.autoScrollTimer = setTimeout(() => { this.autoScrolling = false; }, 150);
  }

  handleTimelineScroll() {
    if (!this.images.length) return;
    if (this.autoScrolling) {
      this._ignoreScrollUntilIdle();
      this._updateScrubber();
      return;
    }
    // Scroll start selects the first image, scroll end the last (same mapping as the scrubber)
    this.displayImage(Math.round(this._scrollFraction() * (this.images.length - 1)), false);
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
      this.autoScrolling = false;
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
      if (!this.dialog.open) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.displayImage(this.index - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.displayImage(this.index + 1); }
      else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.jumpToMotion(e.shiftKey ? -1 : 1);
      }
    };

    document.addEventListener('keydown', onKey);
    this.dialog.querySelector('.btn-prev')?.addEventListener('click', () => this.displayImage(this.index - 1));
    this.dialog.querySelector('.btn-next')?.addEventListener('click', () => this.displayImage(this.index + 1));

    this.scrubberTrack.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    this.scrubberTrack.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', endDrag);

    this.timeline.addEventListener('click', (e) => {
      const item = e.target.closest('.timeline-item');
      if (item) this.displayImage(Number(item.dataset.item));
    });
    this.timeline.addEventListener('scroll', () => this.handleTimelineScroll(), { passive: true });
  }

  // Fetch the images uploaded since the newest one shown (several per second during motion)
  async fetchNewImages() {
    // Only the latest batch, which ends with the stream, grows
    const streamIndex = this.images.length - 1;
    if (this.images[streamIndex]?.filename !== 'stream' || this.fetchingNew) return;

    this.fetchingNew = true;
    const cameraId = this.cameraId;
    const after = this.images[streamIndex - 1]?.filename || '';
    try {
      const images = await fetch(`/api/timeline/${cameraId}/new?after=${encodeURIComponent(after)}`).then(r => r.json());
      if (this.cameraId !== cameraId || this.images[this.images.length - 1]?.filename !== 'stream') return;
      images.forEach(image => this._appendImage(image));
      this._renderMotionMarks();
    } catch (e) {
      console.error('Timeline update failed:', e);
    } finally {
      this.fetchingNew = false;
    }
  }

  _appendImage(image) {
    if (this.images.some(img => img.filename === image.filename)) return;

    const streamIndex = this.images.length - 1;
    this.images.splice(streamIndex, 0, image);

    const item = this._createItem(image, streamIndex);
    const streamItem = this.timeline.querySelector(`.timeline-item[data-item="${streamIndex}"]`);
    this.timeline.insertBefore(item, streamItem);
    streamItem.dataset.item = streamIndex + 1;

    // Keep this.index correct if we inserted before the selected item
    if (this.index >= streamIndex) this.index++;

    this.observer.observe(item.querySelector('img'));
  }

  cleanup() {
    if (this.observer) this.observer.disconnect();
    this._revokeBlobUrls();
    this.timeline.innerHTML = '';
    this.batchContainer?.replaceChildren();
    this.scrubberMarks.innerHTML = '';
    this.stageEl.querySelector('img')?.remove();
    this.selectedEl = null;
    this.index = -1;
  }
}

// ── Global helper ────────────────────────────────────────

function openTimeline(cameraId) {
  if (!window.timelineInstance) {
    window.timelineInstance = new TimelineInstance(document.getElementById('timelineDialog'));
  }
  document.getElementById('timelineDialog').showModal();
  window.timelineInstance.load(cameraId);
}
