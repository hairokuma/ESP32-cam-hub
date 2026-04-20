// Calendar State Management
const calendarStates = {};

// Initialize calendar state for a camera
function initCalendar(cameraId) {
    if (!calendarStates[cameraId]) {
        calendarStates[cameraId] = {
            currentDate: new Date(),
            videoDates: new Set(),
            videoData: {}
        };
    }
    return calendarStates[cameraId];
}

// Toggle calendar visibility for a camera
function toggleCalendar(cameraId, event) {
    if (event) event.stopPropagation();
    
    const calendarWrapper = document.getElementById(`calendar-${cameraId}`);
    if (!calendarWrapper) return;
    
    if (calendarWrapper.style.display === 'none') {
        // Show calendar
        calendarWrapper.style.display = 'block';
        initCalendar(cameraId);
        loadVideoData(cameraId).then(() => {
            renderCalendar(cameraId);
        });
    } else {
        // Hide calendar
        calendarWrapper.style.display = 'none';
    }
}

// Navigate months
function navigateMonth(cameraId, direction) {
    const state = calendarStates[cameraId];
    if (!state) return;
    
    state.currentDate.setMonth(state.currentDate.getMonth() + direction);
    renderCalendar(cameraId);
}

// Load video data for a camera
async function loadVideoData(cameraId) {
    try {
        const response = await fetch(`/api/calendar/${cameraId}`);
        const data = await response.json();

        const state = calendarStates[cameraId];
        state.videoDates = new Set();
        state.videoData = {};

        if (data.videos) {
            data.videos.forEach(video => {
                state.videoDates.add(video.date);
                state.videoData[video.date] = video;
            });
        }

        console.log(`Loaded ${state.videoDates.size} videos for camera ${cameraId}`);
    } catch (error) {
        console.error('Failed to load video data:', error);
    }
}

// Render calendar for a camera
function renderCalendar(cameraId) {
    const state = calendarStates[cameraId];
    if (!state) return;
    
    const calendarWrapper = document.getElementById(`calendar-${cameraId}`);
    if (!calendarWrapper) return;
    
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();

    // Update header
    const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
        'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const monthTitle = calendarWrapper.querySelector('.calendar-month-title');
    if (monthTitle) {
        monthTitle.textContent = `${monthNames[month]} ${year}`;
    }

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

    // Get grid
    const grid = calendarWrapper.querySelector('.calendar-grid');
    if (!grid) return;
    
    // Clear grid (keep day names)
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
        if (state.videoDates.has(dateStr)) {
            dayDiv.classList.add('has-video');
            dayDiv.onclick = () => playVideo(cameraId, dateStr);
            dayDiv.title = `Play video - ${state.videoData[dateStr].size_mb} MB`;
        }

        grid.appendChild(dayDiv);
    }
}

// Play video
function playVideo(cameraId, dateStr) {
    const state = calendarStates[cameraId];
    if (!state) return;
    
    const video = state.videoData[dateStr];
    if (!video) return;

    const videoSource = document.getElementById('videoSource');
    const videoPlayer = document.getElementById('videoPlayer');
    const modal = document.getElementById('videoModal');

    videoSource.src = `/video/${cameraId}/${dateStr}`;
    videoPlayer.load();

    // Update modal info
    // Convert date to German format (DD.MM.YYYY)
    const [year, month, day] = dateStr.split('-');
    const germanDate = `${day}.${month}.${year}`;
    document.getElementById('videoDate').textContent = `Datum: ${germanDate}`;
    document.getElementById('videoSize').textContent = `Größe: ${video.size_mb} MB`;
    modal.classList.add('active');

    // Auto play
    videoPlayer.play();
}

// Close video modal
function closeVideoModal() {
    const modal = document.getElementById('videoModal');
    const videoPlayer = document.getElementById('videoPlayer');
    const videoSource = document.getElementById('videoSource');
    
    modal.classList.remove('active');
    videoPlayer.pause();
    videoSource.src = '';
}

// Setup video modal event listeners (call once on page load)
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('videoModal');
    
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'videoModal') {
                closeVideoModal();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeVideoModal();
        }
    });
});
