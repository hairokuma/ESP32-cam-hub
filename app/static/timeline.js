// Timeline State
let timelineState = {
    cameraId: null,
    date: null,
    images: [],
    isDragging: false,
    currentIndex: 0,
    observer: null
};

// Open timeline for a camera
async function openTimeline(cameraId, date = null) {
    timelineState.cameraId = cameraId;
    timelineState.date = date || new Date().toISOString().split('T')[0];
    
    const overlay = document.getElementById('timelineOverlay');
    overlay.classList.add('active');
    overlay.style.display = 'flex';
    
    // Load timeline data
    await loadTimelineData();
    
    // Initialize timeline
    renderTimeline();
    initializeLazyLoading();
    
    // Scroll to last image
    setTimeout(() => {
        displayImage(timelineState.images.length - 1);
    }, 200);
}

// Close timeline
function closeTimeline() {
    const overlay = document.getElementById('timelineOverlay');
    overlay.classList.remove('active');
    overlay.style.display = 'none';
    
    // Clean up
    if (timelineState.observer) {
        timelineState.observer.disconnect();
    }
    
    timelineState = {
        cameraId: null,
        date: null,
        images: [],
        isDragging: false,
        currentIndex: 0,
        observer: null
    };
}

// Load timeline data from API
async function loadTimelineData() {
    try {
        const url = `/api/timeline/${timelineState.cameraId}?date=${timelineState.date}`;
        const response = await fetch(url);
        const data = await response.json();
        
        timelineState.images = data.images || [];
        console.log(`Loaded ${timelineState.images.length} images for timeline`);
    } catch (error) {
        console.error('Failed to load timeline data:', error);
        timelineState.images = [];
    }
}

// Render timeline images
function renderTimeline() {
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';
    
    timelineState.images.forEach((image, index) => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.onclick = () => displayImage(index);
        item.dataset.item = index;
        item.dataset.timestamp = image.timestamp;
        
        const img = document.createElement('img');
        img.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect fill=%22%232a2a2a88%22 width=%22400%22 height=%22300%22/%3E%3C/svg%3E';
        img.dataset.src = image.src;
        img.alt = 'Captured Image';
        
        const timestamp = document.createElement('div');
        timestamp.className = 'timestamp';
        timestamp.textContent = image.timestamp;
        
        item.appendChild(img);
        item.appendChild(timestamp);
        timeline.appendChild(item);
    });
    
    // Update scrubber labels
    if (timelineState.images.length > 0) {
        const firstImage = timelineState.images[0];
        const lastImage = timelineState.images[timelineState.images.length - 1];
        
        document.getElementById('scrubberStart').textContent = firstImage.timestamp;
        document.getElementById('scrubberEnd').textContent = lastImage.timestamp;
        document.getElementById('scrubberTime').textContent = lastImage.timestamp;
    }
}

// Initialize lazy loading
function initializeLazyLoading() {
    if (timelineState.observer) {
        timelineState.observer.disconnect();
    }

    const options = {
        root: document.querySelector('.timeline'),
        rootMargin: '3300px',
        threshold: 0.01
    };

    timelineState.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.getAttribute('data-src');
                img.src = src;
                timelineState.observer.unobserve(img);
            }
        });
    }, options);

    document.querySelectorAll('.timeline img').forEach(img => {
        timelineState.observer.observe(img);
    });
}

// Display specific image
function displayImage(i, scroll = true) {
    const imagesLength = timelineState.images.length;
    if (i < 0 || i >= imagesLength || i === timelineState.currentIndex) return;
    
    timelineState.currentIndex = i;
    const timeline = document.getElementById('timeline');
    
    // Remove all active and dummy items
    document.querySelectorAll('.active').forEach(item => {
        item.classList.remove('active');
        item.classList.add('timeline-item');
    });
    document.querySelectorAll('.timeline-item.timeline-item-dummy').forEach(item => item.remove());
    
    const activeItem = document.querySelector(`.timeline-item[data-item="${i}"]`);
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
    
    timeline.insertBefore(dummy, activeItem);
    activeItem.classList.add('active');
    activeItem.classList.remove('timeline-item');
    
    document.getElementById('scrubberTime').textContent = timestamp;

    if (scroll) {
        dummy.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    
    // Update scrubber bar position
    const maxScroll = timeline.scrollWidth - timeline.clientWidth;
    const scrollPercentage = maxScroll > 0 ? timeline.scrollLeft / maxScroll : 0;
    document.getElementById('scrubberBar').style.left = `calc(${scrollPercentage * 100}% - 8px)`;
}

// Handle timeline scroll
function handleTimelineScroll() {
    const timeline = document.getElementById('timeline');
    const imagesLength = timelineState.images.length;
    
    if (imagesLength === 0) return;
    
    const centerPosition = timeline.scrollLeft + (timeline.clientWidth / 2);
    const scrollPercentage = timeline.scrollWidth > 0 ? centerPosition / timeline.scrollWidth : 0;
    const visibleIndex = Math.round(scrollPercentage * (imagesLength - 1));
    displayImage(visibleIndex, false);
}

// Handle scrubber drag
function handleScrubberDrag(e) {
    const scrubberTrack = document.getElementById('scrubberTrack');
    const timeline = document.getElementById('timeline');
    
    const rect = scrubberTrack.getBoundingClientRect();
    const x = (e.type.includes('touch') ? e.touches[0].clientX : e.clientX) - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    timeline.scrollLeft = percentage * (timeline.scrollWidth - timeline.clientWidth);
}

// Scrubber event handlers
const startDrag = (e) => {
    timelineState.isDragging = true;
    const scrubberTrack = document.getElementById('scrubberTrack');
    scrubberTrack.classList.add('dragging');
    handleScrubberDrag(e);
};

const onDrag = (e) => {
    if (!timelineState.isDragging) return;
    e.preventDefault();
    handleScrubberDrag(e);
};

const endDrag = () => {
    if (timelineState.isDragging) {
        timelineState.isDragging = false;
        const scrubberTrack = document.getElementById('scrubberTrack');
        scrubberTrack.classList.remove('dragging');
    }
};

// Setup timeline event listeners (call once on page load)
document.addEventListener('DOMContentLoaded', () => {
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        const overlay = document.getElementById('timelineOverlay');
        if (!overlay || !overlay.classList.contains('active')) return;
        
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            displayImage(timelineState.currentIndex - 1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            displayImage(timelineState.currentIndex + 1);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeTimeline();
        }
    });
    
    // Navigation buttons
    const prevBtn = document.getElementById('prevImage');
    const nextBtn = document.getElementById('nextImage');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => displayImage(timelineState.currentIndex - 1));
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => displayImage(timelineState.currentIndex + 1));
    }
    
    // Scrubber events
    const scrubberTrack = document.getElementById('scrubberTrack');
    if (scrubberTrack) {
        scrubberTrack.addEventListener('mousedown', startDrag);
        scrubberTrack.addEventListener('touchstart', startDrag, { passive: false });
    }
    
    document.addEventListener('mousemove', onDrag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
    
    // Timeline scroll
    const timeline = document.getElementById('timeline');
    if (timeline) {
        timeline.addEventListener('scroll', handleTimelineScroll, { passive: true });
    }
});