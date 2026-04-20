// Calendar Instance Class for inline display
class CalendarInstance {
    constructor(cameraId) {
        this.cameraId = cameraId;
        this.currentDate = new Date();
        this.videoDates = new Set();
        this.videoData = {};
        this.container = document.getElementById(`calendar-${cameraId}`);
        this.grid = this.container.querySelector('.calendar-grid-inline');
        
        this.loadVideoData();
    }

    async loadVideoData() {
        try {
            const response = await fetch(`/api/calendar/${this.cameraId}`);
            const data = await response.json();

            this.videoDates = new Set();
            this.videoData = {};

            if (data.videos) {
                data.videos.forEach(video => {
                    this.videoDates.add(video.date);
                    this.videoData[video.date] = video;
                });
            }

            console.log(`Loaded ${this.videoDates.size} videos for camera ${this.cameraId}`);
            this.render();
        } catch (error) {
            console.error('Failed to load video data:', error);
        }
    }

    changeMonth(direction) {
        this.currentDate.setMonth(this.currentDate.getMonth() + direction);
        this.render();
    }

    render() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();

        // Update header
        const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
            'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
        this.container.querySelector('.current-month').textContent = `${monthNames[month]} ${year}`;

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
        const dayNames = Array.from(this.grid.querySelectorAll('.day-name'));
        this.grid.innerHTML = '';
        dayNames.forEach(name => this.grid.appendChild(name));

        // Add empty cells for days before first day of month
        for (let i = 0; i < firstDayOfWeek; i++) {
            const emptyDay = document.createElement('div');
            emptyDay.className = 'calendar-day empty-day';
            this.grid.appendChild(emptyDay);
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
            if (this.videoDates.has(dateStr)) {
                dayDiv.classList.add('has-video');
                dayDiv.onclick = () => this.playVideo(dateStr);
                dayDiv.title = `Play video - ${this.videoData[dateStr].size_mb} MB`;
            }

            this.grid.appendChild(dayDiv);
        }
    }

    playVideo(dateStr) {
        const video = this.videoData[dateStr];
        if (!video) return;

        const modal = document.getElementById('videoModal');
        const videoSource = document.getElementById('videoSource');
        const videoPlayer = document.getElementById('videoPlayer');

        videoSource.src = `/video/${this.cameraId}/${dateStr}`;
        videoPlayer.load();

        // Update modal info
        const [year, month, day] = dateStr.split('-');
        const germanDate = `${day}.${month}.${year}`;
        document.getElementById('videoDate').textContent = `Datum: ${germanDate}`;
        document.getElementById('videoSize').textContent = `Größe: ${video.size_mb} MB`;
        modal.classList.add('active');

        // Auto play
        videoPlayer.play();
    }
}

// Video modal controls (shared across all calendar instances)
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('videoModal');
    const videoPlayer = document.getElementById('videoPlayer');
    const videoSource = document.getElementById('videoSource');
    const closeButton = document.getElementById('closeVideo');

    function closeVideoModal() {
        modal.classList.remove('active');
        videoPlayer.pause();
        videoSource.src = '';
    }

    closeButton.addEventListener('click', closeVideoModal);

    modal.addEventListener('click', (e) => {
        if (e.target.id === 'videoModal') {
            closeVideoModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeVideoModal();
        }
    });
});
