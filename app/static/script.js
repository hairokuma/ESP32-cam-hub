// ============= CONFIGURATION =============
const API_BASE = window.location.origin;
const REFRESH_INTERVAL = 10000;
const NETWORK_PREFIX = '192.168.2.';

// ============= STATE =============
let cameras = [];
let currentCamera = null;
let currentImages = [];
let isStreamMode = true;
let ledStates = {};
let streamStates = {};
let currentImageIndex = -1;
let touchStartX = 0;
let touchEndX = 0;
let timelineObserver = null;
let scrubberDragHandlers = null;

// ============= INITIALIZATION =============
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
});

async function initializeApp() {
    await loadCameras();
    updateCameraGrid();
    setInterval(loadCameras, REFRESH_INTERVAL);
}

function setupEventListeners() {
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('fullscreenModal').addEventListener('click', (e) => {
        if (e.target.id === 'fullscreenModal') closeModal();
    });
    document.getElementById('viewStream').addEventListener('click', () => switchToStream());
    document.getElementById('viewImage').addEventListener('click', () => switchToImage());
    document.getElementById('prevImage').addEventListener('click', (e) => {
        e.stopPropagation();
        navigateImage(-1);
    });
    document.getElementById('nextImage').addEventListener('click', (e) => {
        e.stopPropagation();
        navigateImage(1);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
        else if (e.key === 'ArrowLeft') navigateImage(-1);
        else if (e.key === 'ArrowRight') navigateImage(1);
    });
    const mediaContainer = document.querySelector('.media-container');
    mediaContainer.addEventListener('touchstart', (e) => touchStartX = e.changedTouches[0].screenX, { passive: true });
    mediaContainer.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });
}

function handleSwipe() {
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) > 50) {
        navigateImage(diff > 0 ? 1 : -1);
    }
}

// ============= DATA LOADING =============
async function loadCameras() {
    try {
        const response = await fetch(`${API_BASE}/stats`);
        const data = await response.json();
        cameras = Object.keys(data.cameras || {}).map(id => ({
            id: id,
            ip: `${NETWORK_PREFIX}${id}`,
            streamUrl: `http://${NETWORK_PREFIX}${id}/stream`,
            imageCount: data.cameras[id].image_count,
            latestTime: data.cameras[id].latest_time
        }));
        updateStats(cameras.length, data.last_upload);
    } catch (error) {
        console.error('Failed to load cameras:', error);
    }
}

function updateStats(count, lastUpdate) {
    document.getElementById('cameraCount').textContent = `${count} camera${count !== 1 ? 's' : ''}`;
    document.getElementById('lastUpdate').textContent = `Letzte Aktualisierung: ${lastUpdate || 'Nie'}`;
}

function updateCameraGrid() {
    const grid = document.getElementById('cameraGrid');
    
    if (cameras.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #888;">
                <h2>No cameras detected</h2>
                <p>Waiting for cameras to connect...</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = cameras.map(camera => `
        <div class="camera-card">
            <div class="camera-header">
                <div class="camera-title-row">
                    <span class="camera-title">Camera ${camera.id}</span>
                    <a href="/calendar?camera=${camera.id}" class="calendar-link" title="View Calendar/Videos">
                        📅
                    </a>
                </div>
                <div class="camera-info">
                    <span class="camera-ip">${camera.ip}</span>
                    <button class="stream-toggle ${streamStates[camera.id] === false ? 'stopped' : 'playing'}" 
                            onclick="toggleStream('${camera.id}', event)"
                            title="${streamStates[camera.id] === false ? 'Start Stream' : 'Stop Stream'}">
                        <span class="stream-icon">${streamStates[camera.id] === false ? '▶' : '⏸'}</span>
                    </button>
                    <button class="led-toggle ${ledStates[camera.id] ? 'on' : ''}" 
                            onclick="toggleLED('${camera.id}', event)">
                        <span class="led-icon"></span>
                        <span>${ledStates[camera.id] ? 'ON' : 'OFF'}</span>
                    </button>
                </div>
            </div>
            <img class="camera-stream" 
                 src="${streamStates[camera.id] === false ? '' : camera.streamUrl}" 
                 data-stream-url="${camera.streamUrl}"
                 alt="Camera ${camera.id} Stream"
                 onclick="openCamera('${camera.id}')"
                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect fill=%22%23333%22 width=%22400%22 height=%22300%22/%3E%3Ctext fill=%22%23888%22 font-family=%22Arial%22 font-size=%2220%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22%3EStream Unavailable%3C/text%3E%3C/svg%3E'">
            <div class="camera-status">
                <span class="status-indicator online"></span>
                ${camera.imageCount} images captured
                ${camera.latestTime ? '• Last: ' + formatTime(camera.latestTime) : ''}
            </div>
        </div>
    `).join('');
}

function formatTime(timestamp) {
    try {
        const date = new Date(timestamp);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}.${month}.${year} ${hours}:${minutes}`;
    } catch {
        return timestamp;
    }
}

// ============= MODAL CONTROL =============
async function openCamera(cameraId) {
    currentCamera = cameras.find(c => c.id === cameraId);
    if (!currentCamera) return;

    document.querySelectorAll('.camera-stream').forEach(img => {
        img.dataset.savedSrc = img.src;
        img.src = '';
    });

    await loadCameraImages(cameraId);
    isStreamMode = true;
    document.getElementById('viewStream').classList.add('active');
    document.getElementById('viewImage').classList.remove('active');
    document.getElementById('modalCameraTitle').textContent = `Camera ${cameraId} (${currentCamera.ip})`;
    document.getElementById('fullscreenStream').src = currentCamera.streamUrl;
    document.getElementById('fullscreenModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

async function loadCameraImages(cameraId) {
    try {
        const response = await fetch(`${API_BASE}/images/${cameraId}`);
        const data = await response.json();
        currentImages = (data.images || []).sort((a, b) => new Date(a.modified) - new Date(b.modified));
        updateTimeline();
    } catch (error) {
        console.error('Failed to load images:', error);
        currentImages = [];
        updateTimeline();
    }
}

function updateTimeline() {
    const timeline = document.getElementById('timeline');
    const imageCount = document.getElementById('imageCount');
    imageCount.textContent = `${currentImages.length} image${currentImages.length !== 1 ? 's' : ''}`;

    if (currentImages.length === 0) {
        timeline.innerHTML = '<p style="color: #888; padding: 20px; text-align: center;">No captured images available</p>';
        updateNavigationArrows();
        document.getElementById('timeScrubber').classList.remove('visible');
        return;
    }

    if (timelineObserver) timelineObserver.disconnect();

    const fragment = document.createDocumentFragment();
    currentImages.forEach((img, index) => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.dataset.index = index;
        item.innerHTML = `
            <img data-src="${API_BASE}/uploads/${currentCamera.id}/${img.filename}" 
                 alt="${img.filename}" class="lazy-timeline-img">
            <div class="timestamp">${formatImageTime(img.modified)}</div>
        `;
        item.addEventListener('click', () => selectImage(img.filename, index));
        fragment.appendChild(item);
    });
    
    timeline.innerHTML = '';
    timeline.appendChild(fragment);

    initializeLazyLoading();
    initializeTimeScrubber();
    
    requestAnimationFrame(() => {
        timeline.scrollLeft = timeline.scrollWidth;
        updateTimeScrubber();
    });
}

function formatImageTime(timestamp) {
    try {
        const date = new Date(timestamp);
        const now = new Date();
        
        // Check if the date is today
        const isToday = date.getDate() === now.getDate() &&
                        date.getMonth() === now.getMonth() &&
                        date.getFullYear() === now.getFullYear();
        
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        
        // If today, show only time; otherwise show full date and time
        if (isToday) {
            return `${h}:${min}:${s}`;
        } else {
            const d = String(date.getDate()).padStart(2, '0');
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const y = date.getFullYear();
            return `${d}.${m}.${y} ${h}:${min}:${s}`;
        }
    } catch { return timestamp; }
}

// ============= IMAGE NAVIGATION =============
function selectImage(filename, index) {
    isStreamMode = false;
    currentImageIndex = index;
    document.getElementById('viewStream').classList.remove('active');
    document.getElementById('viewImage').classList.add('active');
    document.getElementById('fullscreenStream').src = `${API_BASE}/uploads/${currentCamera.id}/${filename}`;
    
    // Update timeline items efficiently
    const items = document.querySelectorAll('.timeline-item');
    items.forEach((item, idx) => {
        if (idx === index) {
            item.classList.add('active');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
            item.classList.remove('active');
        }
    });
    
    updateNavigationArrows();
}

function navigateImage(direction) {
    if (!currentCamera || currentImages.length === 0 || isStreamMode) return;
    const newIndex = currentImageIndex + direction;
    if (newIndex < 0 || newIndex >= currentImages.length) return;
    selectImage(currentImages[newIndex].filename, newIndex);
}

function updateNavigationArrows() {
    const prevBtn = document.getElementById('prevImage');
    const nextBtn = document.getElementById('nextImage');
    if (isStreamMode || currentImages.length === 0) {
        prevBtn.classList.add('hidden');
        nextBtn.classList.add('hidden');
    } else {
        prevBtn.classList.toggle('hidden', currentImageIndex <= 0);
        nextBtn.classList.toggle('hidden', currentImageIndex >= currentImages.length - 1);
    }
}

function switchToStream() {
    if (isStreamMode || !currentCamera) return;
    isStreamMode = true;
    currentImageIndex = -1;
    document.getElementById('viewStream').classList.add('active');
    document.getElementById('viewImage').classList.remove('active');
    document.getElementById('fullscreenStream').src = currentCamera.streamUrl;
    document.querySelectorAll('.timeline-item').forEach(item => item.classList.remove('active'));
    updateNavigationArrows();
}

function switchToImage() {
    if (!isStreamMode || currentImages.length === 0) return;
    selectImage(currentImages[currentImages.length - 1].filename, currentImages.length - 1);
}

function closeModal() {
    document.getElementById('fullscreenModal').classList.remove('active');
    document.body.style.overflow = 'auto';
    
    // Cleanup observers
    if (timelineObserver) {
        timelineObserver.disconnect();
        timelineObserver = null;
    }
    
    // Cleanup scrubber
    const timeline = document.getElementById('timeline');
    if (timeline) timeline.removeEventListener('scroll', updateTimeScrubber);
    
    if (scrubberDragHandlers) {
        const track = document.getElementById('scrubberTrack');
        if (track) {
            track.removeEventListener('mousedown', scrubberDragHandlers.startDrag);
            track.removeEventListener('touchstart', scrubberDragHandlers.startDrag);
        }
        document.removeEventListener('mousemove', scrubberDragHandlers.onDrag);
        document.removeEventListener('mouseup', scrubberDragHandlers.endDrag);
        document.removeEventListener('touchmove', scrubberDragHandlers.onDrag);
        document.removeEventListener('touchend', scrubberDragHandlers.endDrag);
        scrubberDragHandlers = null;
    }
    
    // Restore grid streams
    document.querySelectorAll('.camera-stream').forEach(img => {
        if (img.dataset.savedSrc) {
            img.src = img.dataset.savedSrc;
            delete img.dataset.savedSrc;
        }
    });
    
    // Reset state
    currentCamera = null;
    currentImages = [];
    isStreamMode = true;
    currentImageIndex = -1;
    document.getElementById('timeline').innerHTML = '';
    document.getElementById('timeScrubber').classList.remove('visible');
}

// ============= CAMERA CONTROLS =============
async function toggleLED(cameraId, event) {
    if (event) event.stopPropagation();
    const camera = cameras.find(c => c.id === cameraId);
    if (!camera) return;
    const button = event.target.closest('.led-toggle');
    if (!button) return;

    try {
        button.classList.add('loading');
        button.disabled = true;
        const streamImg = event.target.closest('.camera-card').querySelector('.camera-stream');
        await stopStream(streamImg);
        const newState = ledStates[cameraId] ? 'off' : 'on';
        const response = await fetch(`${API_BASE}/camera/${cameraId}/led?state=${newState}`, {
            method: 'GET',
            cache: 'no-cache',
            signal: AbortSignal.timeout(5000)
        });
        if (response.ok) {
            const data = await response.json();
            ledStates[cameraId] = data.led === 'on';
            console.log(`Camera ${cameraId} LED: ${data.led}`);
        } else {
            console.error(`Failed to toggle LED for camera ${cameraId}`);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
        if (streamStates[cameraId] !== false) {
            await restartStream(streamImg, camera.streamUrl);
        }
        button.classList.remove('loading');
        button.disabled = false;
        if (ledStates[cameraId]) button.classList.add('on'); else button.classList.remove('on');
        button.querySelector('span:last-child').textContent = ledStates[cameraId] ? 'ON' : 'OFF';
    } catch (error) {
        console.error(`Error controlling LED for camera ${cameraId}:`, error);
        const streamImg = event.target.closest('.camera-card').querySelector('.camera-stream');
        if (streamImg && camera && streamStates[cameraId] !== false) {
            await restartStream(streamImg, camera.streamUrl);
        }
        button.classList.remove('loading');
        button.disabled = false;
    }
}

// ============= STREAM HELPERS =============
async function stopStream(imgElement) {
    if (!imgElement || !imgElement.src) return;
    imgElement.src = '';
    await new Promise(resolve => setTimeout(resolve, 300));
}

async function restartStream(imgElement, streamUrl) {
    if (!imgElement) return;
    const urlToUse = streamUrl || imgElement.dataset.originalSrc;
    if (!urlToUse) {
        console.warn('No stream URL available to restart');
        return;
    }
    imgElement.src = urlToUse;
    if (imgElement.dataset.originalSrc && streamUrl) {
        delete imgElement.dataset.originalSrc;
    }
}

async function toggleStream(cameraId, event) {
    if (event) event.stopPropagation();
    const camera = cameras.find(c => c.id === cameraId);
    if (!camera) return;
    const button = event.target.closest('.stream-toggle');
    if (!button) return;

    try {
        const streamImg = event.target.closest('.camera-card').querySelector('.camera-stream');
        const isCurrentlyStopped = streamStates[cameraId] === false;
        if (isCurrentlyStopped) {
            streamStates[cameraId] = true;
            await restartStream(streamImg, camera.streamUrl);
            console.log(`Camera ${cameraId} stream started`);
            button.classList.remove('stopped');
            button.classList.add('playing');
            button.title = 'Stop Stream';
            button.querySelector('.stream-icon').textContent = '⏸';
        } else {
            streamStates[cameraId] = false;
            await stopStream(streamImg);
            console.log(`Camera ${cameraId} stream stopped`);
            button.classList.remove('playing');
            button.classList.add('stopped');
            button.title = 'Start Stream';
            button.querySelector('.stream-icon').textContent = '▶';
        }
    } catch (error) {
        console.error(`Error toggling stream for camera ${cameraId}:`, error);
    }
}

// ============= LAZY LOADING & SCRUBBER =============
function initializeLazyLoading() {
    if (timelineObserver) timelineObserver.disconnect();
    
    const options = {
        root: document.querySelector('.timeline'),
        rootMargin: '300px',
        threshold: 0.01
    };
    
    timelineObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.getAttribute('data-src');
                if (src && !img.src) {
                    img.src = src;
                    img.onload = () => img.classList.add('loaded');
                }
            }
        });
    }, options);
    
    document.querySelectorAll('.lazy-timeline-img').forEach(img => timelineObserver.observe(img));
}

// Time Scrubber Implementation
function initializeTimeScrubber() {
    const timeline = document.getElementById('timeline');
    const scrubber = document.getElementById('timeScrubber');
    const scrubberTrack = document.getElementById('scrubberTrack');
    
    if (!scrubber || !scrubberTrack || currentImages.length === 0) return;

    // Cleanup old handlers
    if (scrubberDragHandlers) {
        scrubberTrack.removeEventListener('mousedown', scrubberDragHandlers.startDrag);
        scrubberTrack.removeEventListener('touchstart', scrubberDragHandlers.startDrag);
        document.removeEventListener('mousemove', scrubberDragHandlers.onDrag);
        document.removeEventListener('mouseup', scrubberDragHandlers.endDrag);
        document.removeEventListener('touchmove', scrubberDragHandlers.onDrag);
        document.removeEventListener('touchend', scrubberDragHandlers.endDrag);
    }

    timeline.removeEventListener('scroll', updateTimeScrubber);
    timeline.addEventListener('scroll', updateTimeScrubber, { passive: true });
    
    let isDragging = false;
    let animationFrame = null;
    
    const updateTimelinePosition = (e) => {
        if (animationFrame) cancelAnimationFrame(animationFrame);
        
        animationFrame = requestAnimationFrame(() => {
            const rect = scrubberTrack.getBoundingClientRect();
            const x = (e.type.includes('touch') ? e.touches[0].clientX : e.clientX) - rect.left;
            const percentage = Math.max(0, Math.min(1, x / rect.width));
            timeline.scrollLeft = percentage * (timeline.scrollWidth - timeline.clientWidth);
            updateTimeScrubber();
        });
    };
    
    const startDrag = (e) => {
        isDragging = true;
        scrubber.classList.add('dragging');
        updateTimelinePosition(e);
    };
    
    const onDrag = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        updateTimelinePosition(e);
    };
    
    const endDrag = () => {
        if (isDragging) {
            isDragging = false;
            scrubber.classList.remove('dragging');
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
        }
    };
    
    scrubberDragHandlers = { startDrag, onDrag, endDrag };
    
    scrubberTrack.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    scrubberTrack.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
    
    updateTimeScrubber();
}

function updateTimeScrubber() {
    const timeline = document.getElementById('timeline');
    const scrubber = document.getElementById('timeScrubber');
    const scrubberTime = document.getElementById('scrubberTime');
    const scrubberBar = document.getElementById('scrubberBar');
    const scrubberTooltip = document.getElementById('scrubberTooltip');
    
    if (!timeline || !scrubber || !scrubberTime || !scrubberBar || currentImages.length === 0) return;

    const maxScroll = timeline.scrollWidth - timeline.clientWidth;
    const scrollPercentage = maxScroll > 0 ? timeline.scrollLeft / maxScroll : 0;
    
    // Update bar position
    scrubberBar.style.left = `calc(${scrollPercentage * 100}% - 8px)`;
    
    // Calculate visible image
    const visibleIndex = Math.round(scrollPercentage * (currentImages.length - 1));
    const visibleImage = currentImages[visibleIndex];
    
    if (visibleImage && visibleImage.modified) {
        const date = new Date(visibleImage.modified);
        const formattedTime = formatTimeScrubber(date);
        scrubberTime.textContent = formattedTime;
        if (scrubberTooltip) scrubberTooltip.textContent = formattedTime;
        
        // Update start/end labels
        const oldestTime = formatTimeScrubber(new Date(currentImages[0].modified));
        const newestTime = formatTimeScrubber(new Date(currentImages[currentImages.length - 1].modified));
        document.getElementById('scrubberStart').textContent = oldestTime;
        document.getElementById('scrubberEnd').textContent = newestTime;
        
        scrubber.classList.add('visible');
    }
}

function formatTimeScrubber(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${d}.${m}.${y} ${h}:${min}`;
}

document.addEventListener('dragstart', (e) => {
    if (e.target.tagName === 'IMG') e.preventDefault();
});
