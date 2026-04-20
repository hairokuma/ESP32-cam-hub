// Timeline Instance Class for fullscreen overlay
class TimelineInstance {
    constructor() {
        this.cameraId = null;
        this.images = [];
        this.batches = [];
        this.currentBatch = 0;
        this.index = 0;
        this.isDragging = false;
        this.timelineObserver = null;
        
        this.timeline = document.getElementById('timeline');
        this.scrubberTrack = document.getElementById('scrubberTrack');
        this.scrubberBar = document.getElementById('scrubberBar');
        this.scrubberTime = document.getElementById('scrubberTime');
        this.scrubberTooltip = document.getElementById('scrubberTooltip');
        this.batchContainer = document.getElementById('batchContainer');
        
        this.setupEventListeners();
    }

    async load(cameraId, batch = null) {
        this.cameraId = cameraId;
        this.currentBatch = batch;
        
        try {
            const url = batch !== null 
                ? `/api/timeline/${cameraId}/${batch}` 
                : `/api/timeline/${cameraId}`;
            const response = await fetch(url);
            const data = await response.json();
            
            this.images = data.images || [];
            this.batches = data.batches || [];
            this.currentBatch = data.current_batch || 0;
            
            this.render();
        } catch (error) {
            console.error('Failed to load timeline data:', error);
        }
    }

    render() {
        // Render batch navigation
        this.batchContainer.innerHTML = '';
        this.batches.forEach(batch => {
            const batchItem = document.createElement('a');
            batchItem.href = 'javascript:void(0);';
            batchItem.className = 'batch-item';
            batchItem.textContent = batch.name;
            batchItem.setAttribute('data-active', batch.active);
            batchItem.onclick = () => this.load(this.cameraId, batch.batch);
            this.batchContainer.appendChild(batchItem);
        });
        
        // Render timeline images
        this.timeline.innerHTML = '';
        this.images.forEach((image, i) => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.setAttribute('data-item', i);
            item.setAttribute('data-timestamp', image.timestamp);
            item.onclick = () => this.displayImage(i);
            
            const img = document.createElement('img');
            img.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect fill=%22%232a2a2a88%22 width=%22400%22 height=%22300%22/%3E%3C/svg%3E';
            img.setAttribute('data-src', image.src);
            img.alt = 'Captured Image';
            
            const timestamp = document.createElement('div');
            timestamp.className = 'timestamp';
            timestamp.textContent = image.timestamp;
            
            item.appendChild(img);
            item.appendChild(timestamp);
            this.timeline.appendChild(item);
        });
        
        // Update scrubber labels
        if (this.images.length > 0) {
            document.getElementById('scrubberStart').textContent = this.images[0].timestamp;
            document.getElementById('scrubberEnd').textContent = this.images[this.images.length - 1].timestamp;
        }
        
        // Scroll to end and display last image
        this.timeline.scrollLeft = this.timeline.scrollWidth;
        this.initializeLazyLoading();
        
        setTimeout(() => {
            this.displayImage(this.images.length - 1);
        }, 200);
    }

    initializeLazyLoading() {
        if (this.timelineObserver) this.timelineObserver.disconnect();

        const options = {
            root: this.timeline,
            rootMargin: '3300px',
            threshold: 0.01
        };

        this.timelineObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.getAttribute('data-src');
                    img.src = src;
                    this.timelineObserver.unobserve(img);
                }
            });
        }, options);

        this.timeline.querySelectorAll('img').forEach(img => this.timelineObserver.observe(img));
    }

    displayImage(i, scroll = true) {
        if (i < 0 || i >= this.images.length || i === this.index) return;
        this.index = i;
        
        document.querySelectorAll('.active').forEach(item => {
            item.classList.remove('active');
            item.classList.add('timeline-item');
        });
        document.querySelectorAll('.timeline-item.timeline-item-dummy').forEach(item => item.remove());
        
        const activeItem = this.timeline.querySelector(`.timeline-item[data-item="${this.index}"]`);
        if (!activeItem) return;
        
        const timestamp = activeItem.getAttribute('data-timestamp');
        
        // Create dummy placeholder
        const dummy = document.createElement('div');
        dummy.classList.add('timeline-item', 'timeline-item-dummy');
        dummy.innerHTML = `<img
              src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect fill=%22%232a2a2a88%22 width=%22400%22 height=%22300%22/%3E%3C/svg%3E"
              data-src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect fill=%22%232a2a2a88%22 width=%22400%22 height=%22300%22/%3E%3C/svg%3E" 
              alt="Captured Image">
            <div class="timestamp">${timestamp}</div>`;
        
        this.timeline.insertBefore(dummy, activeItem);
        activeItem.classList.add('active');
        activeItem.classList.remove('timeline-item');
        this.scrubberTime.textContent = timestamp;

        if (scroll) {
            dummy.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
        
        const maxScroll = this.timeline.scrollWidth - this.timeline.clientWidth;
        const scrollPercentage = maxScroll > 0 ? this.timeline.scrollLeft / maxScroll : 0;
        this.scrubberBar.style.left = `calc(${scrollPercentage * 100}% - 8px)`;
    }

    handleTimelineScroll() {
        if (this.images.length === 0) return;
        const centerPosition = this.timeline.scrollLeft + (this.timeline.clientWidth / 2);
        const scrollPercentage = this.timeline.scrollWidth > 0 ? centerPosition / this.timeline.scrollWidth : 0;
        const visibleIndex = Math.round(scrollPercentage * (this.images.length - 1));
        this.displayImage(visibleIndex, false);
    }

    handleScrubberDrag(e) {
        const rect = this.scrubberTrack.getBoundingClientRect();
        const x = (e.type.includes('touch') ? e.touches[0].clientX : e.clientX) - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));
        this.timeline.scrollLeft = percentage * (this.timeline.scrollWidth - this.timeline.clientWidth);
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
            if (this.isDragging) {
                this.isDragging = false;
                this.scrubberTrack.classList.remove('dragging');
            }
        };

        // Keyboard navigation
        const handleKeyboard = (e) => {
            if (document.getElementById('timelineOverlay').style.display !== 'flex') return;
            
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.displayImage(this.index - 1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.displayImage(this.index + 1);
            } else if (e.key === 'Escape') {
                hideTimeline();
            }
        };

        document.addEventListener('keydown', handleKeyboard);
        
        // Navigation buttons
        document.getElementById('prevImage').addEventListener('click', () => this.displayImage(this.index - 1));
        document.getElementById('nextImage').addEventListener('click', () => this.displayImage(this.index + 1));
        
        // Scrubber
        this.scrubberTrack.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', onDrag, { passive: false });
        document.addEventListener('mouseup', endDrag);
        this.scrubberTrack.addEventListener('touchstart', startDrag, { passive: false });
        document.addEventListener('touchmove', onDrag, { passive: false });
        document.addEventListener('touchend', endDrag);
        
        // Timeline scroll
        this.timeline.addEventListener('scroll', () => this.handleTimelineScroll(), { passive: true });
    }

    cleanup() {
        if (this.timelineObserver) {
            this.timelineObserver.disconnect();
        }
        this.timeline.innerHTML = '';
        this.batchContainer.innerHTML = '';
        this.index = 0;
    }
}