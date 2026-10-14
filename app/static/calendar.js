class CalendarInstance {
  constructor() {
    this.cameraId = null;
    this.currentDate = new Date();
    this.videoData = {};   // date -> video info
    this.motion = {};      // date -> number of motion events
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
      this.motion = data.motion || {};
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

      const motionEvents = this.motion[dateStr];
      if (motionEvents) {
        const badge = document.createElement('span');
        badge.className = 'motion-count';
        badge.textContent = motionEvents;
        el.appendChild(badge);
        el.title = [el.title, motionCountText(motionEvents)].filter(Boolean).join(' · ');
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

function navigateMonth(direction) {
  window.calendarInstance?.changeMonth(direction);
}

function goToToday() {
  if (window.calendarInstance) {
    window.calendarInstance.currentDate = new Date();
    window.calendarInstance.render();
  }
}
