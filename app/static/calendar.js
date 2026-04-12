// Configuration
const API_BASE = window.location.origin;

// State
let currentDate = new Date();
let currentCamera = null;
let videoDates = new Set();
let videoData = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeCalendar();
    setupEventListeners();
});

async function initializeCalendar() {
    // Get camera ID from URL parameter or load first available
    const urlParams = new URLSearchParams(window.location.search);
    const cameraParam = urlParams.get('camera');
    
    await loadCameras();
    
    if (cameraParam) {
        currentCamera = cameraParam;
        document.getElementById('cameraSelect').value = cameraParam;
    }
    
    if (currentCamera) {
        await loadVideoData();
        renderCalendar();
    }
}

function setupEventListeners() {
    document.getElementById('prevMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });
    
    document.getElementById('nextMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });
    
    document.getElementById('cameraSelect').addEventListener('change', async (e) => {
        currentCamera = e.target.value;
        await loadVideoData();
        renderCalendar();
    });
    
    document.getElementById('closeVideo').addEventListener('click', closeVideoModal);
    
    document.getElementById('videoModal').addEventListener('click', (e) => {
        if (e.target.id === 'videoModal') {
            closeVideoModal();
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeVideoModal();
        }
    });
}

async function loadCameras() {
    try {
        const response = await fetch(`${API_BASE}/stats`);
        const data = await response.json();
        
        const select = document.getElementById('cameraSelect');
        const cameras = Object.keys(data.cameras || {});
        
        if (cameras.length === 0) {
            select.innerHTML = '<option>No cameras found</option>';
            return;
        }
        
        select.innerHTML = cameras.map(id => 
            `<option value="${id}">Camera ${id}</option>`
        ).join('');
        
        // Set first camera as default
        if (!currentCamera && cameras.length > 0) {
            currentCamera = cameras[0];
            select.value = currentCamera;
        }
    } catch (error) {
        console.error('Failed to load cameras:', error);
    }
}

async function loadVideoData() {
    if (!currentCamera) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/calendar/${currentCamera}`);
        const data = await response.json();
        
        videoDates = new Set();
        videoData = {};
        
        if (data.videos) {
            data.videos.forEach(video => {
                videoDates.add(video.date);
                videoData[video.date] = video;
            });
        }
        
        console.log(`Loaded ${videoDates.size} videos for camera ${currentCamera}`);
    } catch (error) {
        console.error('Failed to load video data:', error);
    }
}

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    // Update header
    const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                       'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    document.getElementById('currentMonth').textContent = `${monthNames[month]} ${year}`;
    
    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const numDays = lastDay.getDate();
    
    // Get day of week (0 = Sunday, 1 = Monday, etc.)
    let firstDayOfWeek = firstDay.getDay();
    // Convert to Monday = 0, Sunday = 6
    firstDayOfWeek = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
    
    // Get today
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDate = today.getDate();
    
    // Clear grid (keep day names)
    const grid = document.querySelector('.calendar-grid');
    const dayNames = Array.from(grid.querySelectorAll('.day-name'));
    grid.innerHTML = '';
    dayNames.forEach(name => grid.appendChild(name));
    
    // Add empty cells for days before first day of month
    for (let i = 0; i < firstDayOfWeek; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day empty-day';
        grid.appendChild(emptyDay);
    }
    
    // Add days of month
    for (let day = 1; day <= numDays; day++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'calendar-day';
        dayDiv.textContent = day;
        
        // Check if today
        if (isCurrentMonth && day === todayDate) {
            dayDiv.classList.add('today');
        }
        
        // Check if there's a video for this date
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (videoDates.has(dateStr)) {
            dayDiv.classList.add('has-video');
            dayDiv.onclick = () => playVideo(dateStr);
            dayDiv.title = `Play video - ${videoData[dateStr].size_mb} MB`;
        }
        
        grid.appendChild(dayDiv);
    }
}

function playVideo(dateStr) {
    if (!currentCamera) return;
    
    const video = videoData[dateStr];
    if (!video) return;
    
    // Set video source
    const videoSource = document.getElementById('videoSource');
    const videoPlayer = document.getElementById('videoPlayer');
    
    videoSource.src = `${API_BASE}/video/${currentCamera}/${dateStr}`;
    videoPlayer.load();
    
    // Update modal info
    // Convert date to German format (DD.MM.YYYY)
    const [year, month, day] = dateStr.split('-');
    const germanDate = `${day}.${month}.${year}`;
    document.getElementById('videoTitle').textContent = `Camera ${currentCamera} - ${germanDate}`;
    document.getElementById('videoDate').textContent = `Datum: ${germanDate}`;
    document.getElementById('videoSize').textContent = `Größe: ${video.size_mb} MB`;
    
    // Show modal
    document.getElementById('videoModal').classList.add('active');
    
    // Auto play
    videoPlayer.play();
}

function closeVideoModal() {
    const modal = document.getElementById('videoModal');
    const videoPlayer = document.getElementById('videoPlayer');
    
    modal.classList.remove('active');
    videoPlayer.pause();
    videoPlayer.src = '';
}
