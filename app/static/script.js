// Configuration
const API_BASE = window.location.origin;
const REFRESH_INTERVAL = 10000; // 10 seconds
const NETWORK_PREFIX = '192.168.2.'; // Adjust to your network

// State
let cameras = [];
let currentCamera = null;
let currentImages = [];
let isStreamMode = true;
let ledStates = {}; // Track LED states for each camera
let qualitySettings = {}; // Track quality settings for each camera
let streamStates = {}; // Track if stream is playing or stopped for each camera
let currentImageIndex = -1; // Track current image in timeline
let touchStartX = 0;
let touchEndX = 0;
let timelineObserver = null; // Intersection Observer for lazy loading
let scrubberDragHandlers = null; // Store scrubber drag handlers for cleanup

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
});

async function initializeApp() {
    await loadCameras(); // Load camera metadata
    await loadCameraQualities(); // Load quality settings BEFORE rendering streams
    updateCameraGrid(); // Now render the grid with all settings loaded
    setInterval(loadCameras, REFRESH_INTERVAL); // Only refresh stats in interval
}

function setupEventListeners() {
    // Close modal
    document.getElementById('closeModal').addEventListener('click', closeModal);
    
    // Click outside modal to close
    document.getElementById('fullscreenModal').addEventListener('click', (e) => {
        if (e.target.id === 'fullscreenModal') {
            closeModal();
        }
    });

    // View toggle buttons
    document.getElementById('viewStream').addEventListener('click', () => switchToStream());
    document.getElementById('viewImage').addEventListener('click', () => switchToImage());

    // Navigation arrows
    document.getElementById('prevImage').addEventListener('click', (e) => {
        e.stopPropagation();
        navigateImage(1);
    });
    document.getElementById('nextImage').addEventListener('click', (e) => {
        e.stopPropagation();
        navigateImage(-1);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        } else if (e.key === 'ArrowLeft') {
            navigateImage(1);
        } else if (e.key === 'ArrowRight') {
            navigateImage(-1);
        }
    });

    // Touch swipe support
    const mediaContainer = document.querySelector('.media-container');
    mediaContainer.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    mediaContainer.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });
}

function handleSwipe() {
    const swipeThreshold = 50; // minimum distance for a swipe
    const diff = touchStartX - touchEndX;

    if (Math.abs(diff) > swipeThreshold) {
        if (diff > 0) {
            // Swipe left - next image
            navigateImage(1);
        } else {
            // Swipe right - previous image
            navigateImage(-1);
        }
    }
}

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

        // Only update stats, don't re-render grid (to avoid recreating streams)
        updateStats(cameras.length, data.last_upload);
    } catch (error) {
        console.error('Failed to load cameras:', error);
    }
}

async function loadCameraQualities() {
    if (cameras.length === 0) return;

    // Load current quality settings for each camera (in parallel) using proxy
    await Promise.all(cameras.map(async camera => {
        try {
            const qualityResponse = await fetch(`${API_BASE}/camera/${camera.id}/quality`, {
                method: 'GET',
                cache: 'no-cache',
                signal: AbortSignal.timeout(3000) // 3 second timeout
            });
            if (qualityResponse.ok) {
                const qualityData = await qualityResponse.json();
                qualitySettings[camera.id] = qualityData.resolution;
                console.log(`Camera ${camera.id} quality loaded: ${qualityData.resolution}`);
            }
        } catch (error) {
            // Default to QVGA if we can't fetch
            qualitySettings[camera.id] = 'QVGA';
            console.log(`Camera ${camera.id} quality defaulted to QVGA (${error.message})`);
        }
    }));
    
    // Don't call updateCameraGrid() here - it will be called after this function completes
    console.log('Quality settings loaded for all cameras');
}

function updateStats(count, lastUpdate) {
    document.getElementById('cameraCount').textContent = 
        `${count} camera${count !== 1 ? 's' : ''}`;
    document.getElementById('lastUpdate').textContent = 
        `Letzte Aktualisierung: ${lastUpdate || 'Nie'}`;
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
                    <select class="quality-select" onchange="changeQuality('${camera.id}', this.value, event)" onclick="event.stopPropagation()">
                        <option value="QVGA" ${(qualitySettings[camera.id] || 'QVGA') === 'QVGA' ? 'selected' : ''}>QVGA (320x240)</option>
                        <option value="VGA" ${(qualitySettings[camera.id] || 'QVGA') === 'VGA' ? 'selected' : ''}>VGA (640x480)</option>
                        <option value="SVGA" ${(qualitySettings[camera.id] || 'QVGA') === 'SVGA' ? 'selected' : ''}>SVGA (800x600)</option>
                        <option value="HD" ${(qualitySettings[camera.id] || 'QVGA') === 'HD' ? 'selected' : ''}>HD (1280x720)</option>
                        <option value="XGA" ${(qualitySettings[camera.id] || 'QVGA') === 'XGA' ? 'selected' : ''}>XGA (1024x768)</option>
                        <option value="SXGA" ${(qualitySettings[camera.id] || 'QVGA') === 'SXGA' ? 'selected' : ''}>SXGA (1280x1024)</option>
                    </select>
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

async function openCamera(cameraId) {
    currentCamera = cameras.find(c => c.id === cameraId);
    if (!currentCamera) return;

    // Pause all grid streams to save bandwidth
    const gridStreams = document.querySelectorAll('.camera-stream');
    gridStreams.forEach(img => {
        img.dataset.savedSrc = img.src; // Save the original src
        img.src = ''; // Stop the stream
    });

    // Load images for timeline
    await loadCameraImages(cameraId);

    // Set initial view to stream
    isStreamMode = true;
    document.getElementById('viewStream').classList.add('active');
    document.getElementById('viewImage').classList.remove('active');

    // Update modal
    document.getElementById('modalCameraTitle').textContent = 
        `Camera ${cameraId} (${currentCamera.ip})`;
    
    // Set quality dropdown to current setting
    const qualitySelect = document.getElementById('modalQualitySelect');
    qualitySelect.value = qualitySettings[cameraId] || 'QVGA';
    
    document.getElementById('fullscreenStream').src = currentCamera.streamUrl;

    // Show modal
    document.getElementById('fullscreenModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

async function loadCameraImages(cameraId) {
    try {
        const response = await fetch(`${API_BASE}/images/${cameraId}`);
        const data = await response.json();
        
        currentImages = data.images || [];
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
        timeline.innerHTML = '<p style="color: #888;">No captured images available</p>';
        updateNavigationArrows();
        return;
    }

    // Clean up existing observer
    if (timelineObserver) {
        timelineObserver.disconnect();
    }

    // Render images oldest to newest (left to right) - don't reverse
    timeline.innerHTML = currentImages.map((img, index) => `
        <div class="timeline-item" onclick="selectImage('${img.filename}', ${index})" data-index="${index}">
            <img data-src="${API_BASE}/uploads/${currentCamera.id}/${img.filename}" 
                 alt="${img.filename}"
                 class="lazy-timeline-img">
            <div class="timestamp">${formatImageTime(img.modified)}</div>
        </div>
    `).join('');

    // Initialize lazy loading
    initializeLazyLoading();
    
    // Initialize time scrubber
    initializeTimeScrubber();

    // Auto-scroll to the far right (latest image)
    setTimeout(() => {
        timeline.scrollLeft = timeline.scrollWidth;
        updateTimeScrubber(); // Update scrubber after scroll
    }, 100);
}

function formatImageTime(timestamp) {
    try {
        const date = new Date(timestamp);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
    } catch {
        return timestamp;
    }
}

function selectImage(filename, index) {
    // Switch to image view
    isStreamMode = false;
    currentImageIndex = index;
    document.getElementById('viewStream').classList.remove('active');
    document.getElementById('viewImage').classList.add('active');

    // Update main display
    const imageUrl = `${API_BASE}/uploads/${currentCamera.id}/${filename}`;
    document.getElementById('fullscreenStream').src = imageUrl;

    // Highlight selected thumbnail
    document.querySelectorAll('.timeline-item').forEach((item) => {
        if (parseInt(item.dataset.index) === index) {
            item.classList.add('active');
            // Scroll to make the active item visible
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
            item.classList.remove('active');
        }
    });

    // Update navigation arrows
    updateNavigationArrows();
}

function navigateImage(direction) {
    if (!currentCamera || currentImages.length === 0 || isStreamMode) return;

    const newIndex = currentImageIndex + direction;

    // Check bounds
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
    
    // Remove timeline selection
    document.querySelectorAll('.timeline-item').forEach(item => {
        item.classList.remove('active');
    });

    // Update navigation arrows
    updateNavigationArrows();
}

function switchToImage() {
    if (!isStreamMode || currentImages.length === 0) return;
    
    // Switch to most recent image (last index, now on the right)
    selectImage(currentImages[currentImages.length - 1].filename, currentImages.length - 1);
}

function closeModal() {
    document.getElementById('fullscreenModal').classList.remove('active');
    document.body.style.overflow = 'auto';
    
    // Clean up observer
    if (timelineObserver) {
        timelineObserver.disconnect();
        timelineObserver = null;
    }
    
    // Clean up scrubber event listeners
    const timeline = document.getElementById('timeline');
    if (timeline) {
        timeline.removeEventListener('scroll', updateTimeScrubber);
    }
    
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
    
    // Restart all grid streams
    const gridStreams = document.querySelectorAll('.camera-stream');
    gridStreams.forEach(img => {
        if (img.dataset.savedSrc) {
            img.src = img.dataset.savedSrc; // Restore the original src
            delete img.dataset.savedSrc;
        }
    });
    
    currentCamera = null;
    currentImages = [];
    isStreamMode = true;
    
    // Clear timeline
    document.getElementById('timeline').innerHTML = '';
}

// LED Control
async function toggleLED(cameraId, event) {
    // Prevent triggering camera card click
    if (event) {
        event.stopPropagation();
    }

    const camera = cameras.find(c => c.id === cameraId);
    if (!camera) return;

    const button = event.target.closest('.led-toggle');
    if (!button) return;

    try {
        // Add loading state
        button.classList.add('loading');
        button.disabled = true;
        
        // Find the stream image element for this camera
        const streamImg = event.target.closest('.camera-card').querySelector('.camera-stream');
        
        // Stop the stream before making the request
        await stopStream(streamImg);
        
        // Toggle the state
        const newState = ledStates[cameraId] ? 'off' : 'on';
        
        // Use proxy endpoint to avoid CORS issues
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
        
        // Wait a moment before restarting the stream
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Restart the stream (only if it wasn't manually stopped)
        if (streamStates[cameraId] !== false) {
            await restartStream(streamImg, camera.streamUrl);
        }
        
        // Update the button UI directly
        button.classList.remove('loading');
        button.disabled = false;
        
        // Update button state directly without recreating grid
        if (ledStates[cameraId]) {
            button.classList.add('on');
        } else {
            button.classList.remove('on');
        }
        button.querySelector('span:last-child').textContent = ledStates[cameraId] ? 'ON' : 'OFF';
        
    } catch (error) {
        console.error(`Error controlling LED for camera ${cameraId}:`, error);
        
        // Try to restart the stream even if there was an error (only if not manually stopped)
        const streamImg = event.target.closest('.camera-card').querySelector('.camera-stream');
        if (streamImg && camera && streamStates[cameraId] !== false) {
            await restartStream(streamImg, camera.streamUrl);
        }
        
        // Remove loading state
        button.classList.remove('loading');
        button.disabled = false;
    }
}

// Quality Control
async function changeQuality(cameraId, resolution, event) {
    // Prevent triggering camera card click
    if (event) {
        event.stopPropagation();
    }

    const camera = cameras.find(c => c.id === cameraId);
    if (!camera) return;

    const select = event.target;
    const originalValue = qualitySettings[cameraId] || 'QVGA';

    try {
        // Disable the select during change
        select.disabled = true;
        select.style.opacity = '0.6';
        
        // Find the stream image element for this camera
        const streamImg = event.target.closest('.camera-card').querySelector('.camera-stream');
        
        // Stop the stream before changing quality
        await stopStream(streamImg);
        
        // Change the quality using proxy endpoint
        const response = await fetch(`${API_BASE}/camera/${cameraId}/quality?resolution=${resolution}`, {
            method: 'GET',
            cache: 'no-cache',
            signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (response.ok) {
            const data = await response.json();
            qualitySettings[cameraId] = data.resolution;
            
            console.log(`Camera ${cameraId} quality: ${data.resolution}`);
        } else {
            console.error(`Failed to change quality for camera ${cameraId}`);
            // Revert selection
            select.value = originalValue;
        }
        
        // Wait for sensor to adjust
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Restart the stream with new quality (only if not manually stopped)
        if (streamStates[cameraId] !== false) {
            await restartStream(streamImg, camera.streamUrl);
        }
        
        // Re-enable select
        select.disabled = false;
        select.style.opacity = '1';
        
    } catch (error) {
        console.error(`Error changing quality for camera ${cameraId}:`, error);
        
        // Revert selection
        select.value = originalValue;
        
        // Try to restart the stream even if there was an error (only if not manually stopped)
        const streamImg = event.target.closest('.camera-card').querySelector('.camera-stream');
        if (streamImg && camera && streamStates[cameraId] !== false) {
            await restartStream(streamImg, camera.streamUrl);
        }
        
        // Re-enable select
        select.disabled = false;
        select.style.opacity = '1';
    }
}

// Quality Control (Modal)
async function changeQualityModal(resolution) {
    if (!currentCamera) return;

    const select = document.getElementById('modalQualitySelect');
    const originalValue = qualitySettings[currentCamera.id] || 'QVGA';

    try {
        // Disable the select during change
        select.disabled = true;
        select.style.opacity = '0.6';
        
        // Find the fullscreen stream element
        const streamImg = document.getElementById('fullscreenStream');
        
        // Only change quality if viewing stream (not a captured image)
        if (!isStreamMode) {
            select.disabled = false;
            select.style.opacity = '1';
            return;
        }
        
        // Stop the stream before changing quality
        await stopStream(streamImg);
        
        // Change the quality using proxy endpoint
        const response = await fetch(`${API_BASE}/camera/${currentCamera.id}/quality?resolution=${resolution}`, {
            method: 'GET',
            cache: 'no-cache',
            signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (response.ok) {
            const data = await response.json();
            qualitySettings[currentCamera.id] = data.resolution;
            
            console.log(`Camera ${currentCamera.id} quality: ${data.resolution}`);
            
            // Update quality in the grid's select dropdown without recreating DOM
            const gridCards = document.querySelectorAll('.camera-card');
            gridCards.forEach(card => {
                const title = card.querySelector('.camera-title');
                if (title && title.textContent.includes(currentCamera.id)) {
                    const gridSelect = card.querySelector('.quality-select');
                    if (gridSelect) {
                        gridSelect.value = data.resolution;
                    }
                }
            });
        } else {
            console.error(`Failed to change quality for camera ${currentCamera.id}`);
            // Revert selection
            select.value = originalValue;
        }
        
        // Wait for sensor to adjust
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Restart the stream with new quality
        await restartStream(streamImg, currentCamera.streamUrl);
        
        // Re-enable select
        select.disabled = false;
        select.style.opacity = '1';
        
    } catch (error) {
        console.error(`Error changing quality for camera ${currentCamera.id}:`, error);
        
        // Revert selection
        select.value = originalValue;
        
        // Try to restart the stream
        if (currentCamera && isStreamMode) {
            await restartStream(document.getElementById('fullscreenStream'), currentCamera.streamUrl);
        }
        
        // Re-enable select
        select.disabled = false;
        select.style.opacity = '1';
    }
}

// Helper function to properly stop a stream
async function stopStream(imgElement) {
    if (!imgElement || !imgElement.src) return;
    
    // Stop the stream
    imgElement.src = '';
    
    // Wait for the connection to close (ESP32 needs time to release the stream)
    await new Promise(resolve => setTimeout(resolve, 300));
}

// Helper function to properly restart a stream
async function restartStream(imgElement, streamUrl) {
    if (!imgElement) return;
    
    // Use provided URL or restore from saved original
    const urlToUse = streamUrl || imgElement.dataset.originalSrc;
    
    if (!urlToUse) {
        console.warn('No stream URL available to restart');
        return;
    }
    
    imgElement.src = urlToUse;
    
    // Clean up saved original if we used it
    if (imgElement.dataset.originalSrc && streamUrl) {
        delete imgElement.dataset.originalSrc;
    }
}

// Stream Control
async function toggleStream(cameraId, event) {
    // Prevent triggering camera card click
    if (event) {
        event.stopPropagation();
    }

    const camera = cameras.find(c => c.id === cameraId);
    if (!camera) return;

    const button = event.target.closest('.stream-toggle');
    if (!button) return;

    try {
        // Find the stream image element for this camera
        const streamImg = event.target.closest('.camera-card').querySelector('.camera-stream');
        
        // Toggle the stream state
        const isCurrentlyStopped = streamStates[cameraId] === false;
        
        if (isCurrentlyStopped) {
            // Start the stream
            streamStates[cameraId] = true;
            await restartStream(streamImg, camera.streamUrl);
            console.log(`Camera ${cameraId} stream started`);
            
            // Update button UI directly (don't recreate grid)
            button.classList.remove('stopped');
            button.classList.add('playing');
            button.title = 'Stop Stream';
            button.querySelector('.stream-icon').textContent = '⏸';
        } else {
            // Stop the stream
            streamStates[cameraId] = false;
            await stopStream(streamImg);
            console.log(`Camera ${cameraId} stream stopped`);
            
            // Update button UI directly (don't recreate grid)
            button.classList.remove('playing');
            button.classList.add('stopped');
            button.title = 'Start Stream';
            button.querySelector('.stream-icon').textContent = '▶';
        }
        
        // Don't call updateCameraGrid() - it recreates DOM and can cause duplicate streams
        
    } catch (error) {
        console.error(`Error toggling stream for camera ${cameraId}:`, error);
    }
}

// Lazy Loading Implementation
function initializeLazyLoading() {
    const options = {
        root: document.querySelector('.timeline'),
        rootMargin: '200px', // Start loading 200px before entering viewport
        threshold: 0.01
    };

    timelineObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.getAttribute('data-src');
                
                if (src && !img.getAttribute('src')) {
                    img.src = src;
                    img.classList.add('loaded');
                    // Continue observing in case image needs to reload
                }
            }
        });
    }, options);

    // Observe all lazy images
    document.querySelectorAll('.lazy-timeline-img').forEach(img => {
        timelineObserver.observe(img);
    });
}

// Time Scrubber Implementation
function initializeTimeScrubber() {
    const timeline = document.getElementById('timeline');
    const scrubber = document.getElementById('timeScrubber');
    const scrubberTime = document.getElementById('scrubberTime');
    const scrubberTrack = document.getElementById('scrubberTrack');
    
    if (!scrubber || !scrubberTime || !scrubberTrack || currentImages.length === 0) return;

    // Clean up old handlers if they exist
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
    }

    // Update scrubber on scroll
    timeline.removeEventListener('scroll', updateTimeScrubber); // Remove old listener
    timeline.addEventListener('scroll', updateTimeScrubber);
    
    // Make scrubber draggable
    let isDragging = false;
    
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
        }
    };
    
    const updateTimelinePosition = (e) => {
        const rect = scrubberTrack.getBoundingClientRect();
        const x = (e.type.includes('touch') ? e.touches[0].clientX : e.clientX) - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));
        
        // Update timeline scroll
        timeline.scrollLeft = percentage * (timeline.scrollWidth - timeline.clientWidth);
        
        // Update scrubber immediately
        updateTimeScrubber();
    };
    
    // Store handlers for cleanup
    scrubberDragHandlers = { startDrag, onDrag, endDrag };
    
    // Mouse events
    scrubberTrack.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
    
    // Touch events
    scrubberTrack.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
    
    // Initial update
    updateTimeScrubber();
}

function updateTimeScrubber() {
    const timeline = document.getElementById('timeline');
    const scrubber = document.getElementById('timeScrubber');
    const scrubberTime = document.getElementById('scrubberTime');
    const scrubberBar = document.getElementById('scrubberBar');
    const scrubberTooltip = document.getElementById('scrubberTooltip');
    
    if (!timeline || !scrubber || !scrubberTime || !scrubberBar || currentImages.length === 0) return;

    // Calculate scroll position (0 to 1, 0=left/oldest, 1=right/newest)
    const scrollPercentage = timeline.scrollLeft / (timeline.scrollWidth - timeline.clientWidth);
    
    // Position the scrubber bar
    scrubberBar.style.left = `${scrollPercentage * 100}%`;
    
    // Calculate which image is at the current scroll position
    const visibleIndex = Math.floor(scrollPercentage * (currentImages.length - 1));
    const visibleImage = currentImages[Math.max(0, Math.min(visibleIndex, currentImages.length - 1))];
    
    if (visibleImage && visibleImage.modified) {
        // Format the time for display
        const date = new Date(visibleImage.modified);
        const formattedTime = formatTimeScrubber(date);
        scrubberTime.textContent = formattedTime;
        
        // Update tooltip if it exists
        if (scrubberTooltip) {
            scrubberTooltip.textContent = formatTimeScrubber(date);
        }
        
        // Show oldest and newest times (oldest on left, newest on right)
        const oldestTime = formatTimeScrubber(new Date(currentImages[0].modified));
        const newestTime = formatTimeScrubber(new Date(currentImages[currentImages.length - 1].modified));
        
        document.getElementById('scrubberStart').textContent = oldestTime;
        document.getElementById('scrubberEnd').textContent = newestTime;
        
        scrubber.classList.add('visible');
    }
}

function formatTimeScrubber(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
}

// Prevent image dragging
document.addEventListener('dragstart', (e) => {
    if (e.target.tagName === 'IMG') {
        e.preventDefault();
    }
});
