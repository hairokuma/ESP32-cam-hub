const VIDEO_FPS = 24; // must match VIDEO_FPS in image_server.py

class CalendarInstance {
  constructor() {
    this.cameraId = null;
    this.currentDate = new Date();
    this.videoData = {};   // date -> video info
    this.sortedDates = []; // chronological, oldest first
    this.dialog = document.getElementById('calendarDialog');
    this.grid = this.dialog.querySelector('.calendar-grid');
    this.dayNames = [...this.grid.querySelectorAll('.day-name')];
  }

  async loadVideoData(cameraId) {
    this.cameraId = cameraId;
    try {
      const data = await fetch(`/api/calendar/${cameraId}`).then(r => r.json());
      const videos = data.videos || [];
      this.videoData = Object.fromEntries(videos.map(v => [v.date, v]));
      this.sortedDates = videos.map(v => v.date);
      this.render();
    } catch (e) {
      console.error('Calendar load failed:', e);
    }
  }

  changeMonth(direction) {
    this.currentDate.setMonth(this.currentDate.getMonth() + direction);
    this.render();
  }

  render() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();

    const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    this.dialog.querySelector('.current-month').textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const numDays = new Date(year, month + 1, 0).getDate();
    let firstDayOfWeek = firstDay.getDay();
    firstDayOfWeek = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    this.grid.replaceChildren(...this.dayNames);

    for (let i = 0; i < firstDayOfWeek; i++) {
      const el = document.createElement('div');
      el.className = 'calendar-day empty-day';
      this.grid.appendChild(el);
    }

    for (let day = 1; day <= numDays; day++) {
      const el = document.createElement('div');
      el.className = 'calendar-day';
      el.textContent = day;

      if (isCurrentMonth && day === today.getDate()) {
        el.classList.add('today');
      }

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (this.videoData[dateStr]) {
        el.classList.add('has-video');
        el.title = `${this.videoData[dateStr].size_mb} MB`;
        el.onclick = () => navigate(`#video/${this.cameraId}/${dateStr}`);
      }

      this.grid.appendChild(el);
    }
  }
}

// ── Global helpers ───────────────────────────────────────

function openCalendar(cameraId) {
  if (!window.calendarInstance) {
    window.calendarInstance = new CalendarInstance();
  }
  const inst = window.calendarInstance;
  document.getElementById('calendarDialog').showModal();
  if (inst.cameraId !== cameraId) {
    inst.currentDate = new Date();
    inst.loadVideoData(cameraId);
  } else {
    inst.render();
  }
}

function openVideoView(cameraId, dateStr) {
  const player = document.getElementById('videoPlayer');
  player.src = `/video/${cameraId}/${dateStr}`;
  player.load();

  const [year, month, day] = dateStr.split('-');
  document.getElementById('videoDate').textContent = `${day}.${month}.${year}`;

  const meta = window.calendarInstance?.videoData?.[dateStr];
  document.getElementById('videoSize').textContent = meta ? `${meta.size_mb} MB` : '';

  const dates = window.calendarInstance?.sortedDates || [];
  const idx = dates.indexOf(dateStr);
  document.getElementById('prevVideo').hidden = idx <= 0;
  document.getElementById('nextVideo').hidden = idx < 0 || idx >= dates.length - 1;

  document.getElementById('videoDialog').showModal();
  player.play().catch(() => {});
}

function navigateVideo(direction) {
  const hash = location.hash;
  if (!hash.startsWith('#video/')) return;
  const [cameraId, dateStr] = hash.slice(7).split('/');
  const dates = window.calendarInstance?.sortedDates || [];
  const newIdx = dates.indexOf(dateStr) + direction;
  if (newIdx < 0 || newIdx >= dates.length) return;
  navigate(`#video/${cameraId}/${dates[newIdx]}`);
}

function navigateMonth(direction) {
  window.calendarInstance?.changeMonth(direction);
}

function goToToday() {
  if (window.calendarInstance) {
    window.calendarInstance.currentDate = new Date();
    window.calendarInstance.render();
  }
}

function stepVideoFrame(direction) {
  const dialog = document.getElementById('videoDialog');
  if (!dialog.open) return;
  const player = document.getElementById('videoPlayer');
  if (!player.paused) player.pause();
  const step = direction / VIDEO_FPS;
  player.currentTime = Math.max(0, Math.min(player.duration || 0, player.currentTime + step));
}

{
  const player = document.getElementById('videoPlayer');
  player.addEventListener('play',  () => { player.controls = true; });
  player.addEventListener('pause', () => { player.controls = false; });
  player.addEventListener('click', () => { if (player.paused) player.play().catch(() => {}); });
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '.') stepVideoFrame(1);
  else if (e.key === ',') stepVideoFrame(-1);
});
