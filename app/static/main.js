async function toggleLED(cameraId, event) {
    if (event) event.stopPropagation();
    const streamImg = event.target.closest('.camera-card').querySelector('.camera-stream');
    streamImg.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect fill=%22%232a2a2a%22 width=%22400%22 height=%22300%22/%3E%3C/svg%3E'; // Show blank image while toggling
    await fetch(`/camera/${cameraId}/led`, { method: 'GET' })
        .then(response => response.json())
        .then(data => {
            event.target.textContent = data.led == 'on' ? '⚫' : '🟡';
        })
        .catch(error => {
            console.error('Error toggling LED:', error);
        });
    loadStream(streamImg);
}

// Calendar functions
function showCalendar(cameraId, event) {
    if (event) event.stopPropagation();
    
    const modal = document.getElementById('calendarModal');
    modal.style.display = 'flex';
    
    // Initialize calendar if not already done
    if (!window.calendarInstance) {
        window.calendarInstance = new CalendarInstance();
    }
    
    // Reset to current date and load data for selected camera
    window.calendarInstance.currentDate = new Date();
    window.calendarInstance.loadVideoData(cameraId);
}

function hideCalendar() {
    const modal = document.getElementById('calendarModal');
    modal.style.display = 'none';
}

function navigateMonth(direction) {
    if (window.calendarInstance) {
        window.calendarInstance.changeMonth(direction);
    }
}

// Timeline functions
function showTimeline(cameraId) {
    const overlay = document.getElementById('timelineModal');
    overlay.style.display = 'flex';
    
    // Initialize timeline
    if (!window.timelineInstance) {
        window.timelineInstance = new TimelineInstance();
    }
    window.timelineInstance.load(cameraId);
}

function hideTimeline() {
    const overlay = document.getElementById('timelineModal');
    overlay.style.display = 'none';
    
    // Clean up timeline
    if (window.timelineInstance) {
        window.timelineInstance.cleanup();
    }
}

function init() {
    const streamImages = document.querySelectorAll('.camera-stream');
    streamImages.forEach(img => {
        loadStream(img);
    });
}

function loadStream(img) {
    const streamUrl = img.dataset.streamUrl;
    const overlay = img.parentElement.querySelector('.stream-overlay');
    overlay.textContent = 'Loading stream…';
    if (!streamUrl) return;
    img.onerror = () => {
        overlay.textContent = 'Failed to load stream';
    };
    img.src = streamUrl;
}

function getCameraStats() {
    fetch('/stats').then(response => response.json())
        .then(data => {
            console.log(data);
            data.forEach(camera => {
                const card = document.querySelector(`.camera-card[data-camera-id="${camera.id}"]`);
                if (card) {
                    card.querySelector('.stats').textContent = `${camera.imageCount} images captured - Latest:${camera.latestTime}`;
                    card.querySelector('#status-indicator').textContent = camera.online ? '🟢' : '🔴';
                }
            })
        })
        .catch(error => {
            console.error('Error fetching camera stats:', error);
        });
}

setTimeout(() => {
    init();
    setInterval(getCameraStats, 10000);
    
    // Setup modal event listeners
    setupModalHandlers();
}, 100);

// Setup modal close handlers
function setupModalHandlers() {
    const calendarModal = document.getElementById('calendarModal');
    const timelineModal = document.getElementById('timelineModal');
    
    // Close calendar on outside click
    calendarModal.addEventListener('click', (e) => {
        if (e.target.id === 'calendarModal') {
            hideCalendar();
        }
    });
    
    // Close timeline on outside click
    timelineModal.addEventListener('click', (e) => {
        if (e.target.id === 'timelineModal') {
            hideTimeline();
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (calendarModal.style.display === 'flex') {
                hideCalendar();
            } else if (timelineModal.style.display === 'flex') {
                hideTimeline();
            }
        }
    });
}
