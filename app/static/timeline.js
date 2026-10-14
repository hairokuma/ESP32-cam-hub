// Thumbnails kept loaded on each side of the visible ones; images further away are released
const KEEP_LOADED = 50;

// Filmstrip of thumbnails with a scrubber in a dialog; subclasses change what the items are and how they show.
// A day has thousands of images, so only the items near the viewport exist in the DOM.
class TimelineInstance {
  constructor(dialog) {
    this.dialog = dialog;
    this.cameraId = null;
    this.images = [];
    this.index = -1;
    this.isDragging = false;
    this.autoScrolling = false; // true while the strip is scrolled to the selection
    this.autoScrollTimer = null;
    this.fetchingNew = false;
    this.loadId = 0;            // detects loads that were superseded or closed while fetching
    this.items = new Map();     // index -> element of the items that exist
    this.loaded = new Set();    // images holding a blob URL
    this.sizer = null;          // as wide as all items, so the strip scrolls as if they all existed
    this.pitch = 0;             // distance between two items, px
    this.itemWidth = 0;
    this.windowFrame = 0;

    this.stageEl = dialog.querySelector('.stage');
    this.timeline = dialog.querySelector('.timeline');
    this.scrubberTrack = dialog.querySelector('.scrubber-track');
    this.scrubberBar = dialog.querySelector('.scrubber-bar');
    this.scrubberTooltip = dialog.querySelector('.scrubber-tooltip');
    this.scrubberMarks = dialog.querySelector('.scrubber-marks');

    this.setupEventListeners();
  }

  async load(cameraId) {
    const loadId = ++this.loadId;
    this.cameraId = cameraId;
    try {
      const data = await fetch(`/api/timeline/${cameraId}`).then(r => r.json());
      if (loadId !== this.loadId) return;
      this.images = data.images || [];
      this.render();
    } catch (e) {
      console.error('Timeline load failed:', e);
    }
  }

  _releaseImage(image) {
    URL.revokeObjectURL(image.blobUrl);
    delete image.blobUrl;
    delete image.loadPromise;
    this.loaded.delete(image);
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
        this.loaded.add(image);
        return image.blobUrl;
      });
    return image.loadPromise;
  }

  render() {
    this.index = -1;
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
    this._clearItems();
    // Measure one item to place the others without layout
    const probe = this._createItem(this.images[0] || { timestamp: '' }, 0);
    this.timeline.replaceChildren(probe);
    this.itemWidth = probe.offsetWidth;
    this.itemHeight = probe.offsetHeight;
    this.pitch = this.itemWidth + (parseFloat(getComputedStyle(this.timeline).columnGap) || 0);

    this.sizer = document.createElement('div');
    this.sizer.className = 'timeline-sizer';
    this.sizer.style.height = `${this.itemHeight}px`;
    this._updateSizer();
    this.timeline.replaceChildren(this.sizer);
    this._renderWindow();
  }

  // Half a viewport of space at each end lets every item reach the center, so the selection is always the
  // centered item and scroll position, scrubber and selection map onto each other: scrollLeft = index * pitch
  _updateSizer() {
    this.sizer.style.setProperty('--edge', `${this._edge()}px`);
    this.sizer.style.width = `${Math.max(0, this.images.length - 1) * this.pitch + this.timeline.clientWidth}px`;
  }

  _edge() {
    return (this.timeline.clientWidth - this.itemWidth) / 2;
  }

  _placeItem(el, i) {
    el.dataset.item = i;
    el.style.left = `calc(var(--edge) + ${i * this.pitch}px)`;
  }

  // The viewport width changed: resize the end spaces and keep the selection centered
  _handleResize() {
    if (!this.sizer || !this.timeline.clientWidth) return;
    this._updateSizer();
    if (this.index >= 0) {
      this._ignoreScrollUntilIdle();
      this._scrollToItem(this.index, 'instant');
    }
    this._scheduleWindow();
  }

  _clearItems() {
    this.items.clear();
    this.sizer?.replaceChildren();
    this.selectedEl = null;
    cancelAnimationFrame(this.windowFrame);
  }

  _scheduleWindow() {
    if (!this.sizer) return;
    cancelAnimationFrame(this.windowFrame);
    this.windowFrame = requestAnimationFrame(() => this._renderWindow());
  }

  // Create the items in and next to the viewport, remove the others and release far away images
  _renderWindow() {
    if (!this.sizer) return;
    const buffer = 10;
    const start = this.timeline.scrollLeft - this._edge();
    const first = Math.max(0, Math.floor(start / this.pitch) - buffer);
    const last = Math.min(this.images.length - 1,
      Math.ceil((start + this.timeline.clientWidth) / this.pitch) + buffer);

    for (const [i, el] of this.items) {
      if (i >= first && i <= last) continue;
      el.remove();
      this.items.delete(i);
      if (el === this.selectedEl) this.selectedEl = null;
    }
    const added = [];
    for (let i = first; i <= last; i++) {
      if (this.items.has(i)) continue;
      const el = this._createItem(this.images[i], i);
      this._placeItem(el, i);
      this._loadThumb(el.querySelector('img'), i);
      if (i === this.index) {
        el.classList.add('selected');
        this.selectedEl = el;
      }
      this.items.set(i, el);
      added.push(el);
    }
    this.sizer.append(...added);

    const keep = new Set(this.images.slice(Math.max(0, first - KEEP_LOADED), last + KEEP_LOADED + 1));
    keep.add(this.images[this.index]);
    this.loaded.forEach(image => { if (!keep.has(image)) this._releaseImage(image); });
  }

  _itemEl(i) {
    return this.items.get(i) || null;
  }

  // The item may not exist yet, so scroll by position
  // Long jumps scroll at once: animating them takes long and passes thousands of items
  _scrollToItem(i, scroll) {
    const left = i * this.pitch;
    const far = Math.abs(left - this.timeline.scrollLeft) > 2 * this.timeline.clientWidth;
    this.timeline.scrollTo({ left, behavior: scroll === 'instant' || far ? 'instant' : 'smooth' });
    this._scheduleWindow();
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

  _loadThumb(img, i) {
    this._fetchImage(this.images[i]).then(blobUrl => { img.src = blobUrl; });
  }

  // Show item i on the stage
  _showItem(i) {
    const image = this.images[i];
    // Fetch once — if already fetching/fetched, reuses the same promise/blobUrl
    this._fetchImage(image).then(blobUrl => {
      if (this.index !== i) return; // user navigated away while loading
      this._setStageUrl(blobUrl, image.timestamp);
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
    // The item in the center is selected
    const i = Math.round(this.timeline.scrollLeft / this.pitch);
    this.displayImage(Math.max(0, Math.min(this.images.length - 1, i)), false);
  }

  handleScrubberDrag(e) {
    const rect = this.scrubberTrack.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const max = this.timeline.scrollWidth - this.timeline.clientWidth;
    this.timeline.scrollTo({ left: pct * max, behavior: 'instant' });
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
    this.timeline.addEventListener('scroll', () => {
      this.handleTimelineScroll();
      this._scheduleWindow();
    }, { passive: true });
    new ResizeObserver(() => this._handleResize()).observe(this.timeline);
  }

  // Fetch the images uploaded since the newest one shown (several per second during motion)
  async fetchNewImages() {
    // Only today's timeline, which ends with the stream, grows
    const streamIndex = this.images.length - 1;
    if (this.images[streamIndex]?.filename !== 'stream' || this.fetchingNew) return;

    this.fetchingNew = true;
    const cameraId = this.cameraId;
    const after = this.images[streamIndex - 1]?.filename || '';
    try {
      const images = await fetch(`/api/timeline/${cameraId}/new?after=${encodeURIComponent(after)}`).then(r => r.json());
      if (this.cameraId !== cameraId || this.images[this.images.length - 1]?.filename !== 'stream') return;
      const followStream = this.index === streamIndex;
      images.forEach(image => this._appendImage(image));
      const added = this.images.length - 1 - streamIndex;
      if (!added) return;
      this._moveStreamItem(streamIndex, added);
      this._updateSizer();
      this._renderWindow();
      this._renderMotionMarks();
      // Stay on the stream when it was selected
      if (followStream) {
        this._ignoreScrollUntilIdle();
        this._scrollToItem(this.index, 'instant');
      }
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
    // Keep this.index correct if we inserted before the selected item
    if (this.index >= streamIndex) this.index++;
  }

  // Move the stream's item behind the inserted images instead of recreating it, which would reconnect the stream
  _moveStreamItem(from, count) {
    const el = this.items.get(from);
    if (!el) return;
    this.items.delete(from);
    this.items.set(from + count, el);
    this._placeItem(el, from + count);
  }

  cleanup() {
    this.loadId++;
    this._clearItems();
    this.sizer = null;
    this.loaded.forEach(image => this._releaseImage(image));
    this.images = [];
    this.timeline.innerHTML = '';
    this.scrubberMarks.innerHTML = '';
    this.stageEl.querySelector('img')?.remove();
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
