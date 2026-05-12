const BLANK = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22%3E%3C/svg%3E';

// ── Navigation ───────────────────────────────────────────

function navigate(hash) {
  history.pushState(null, '', hash || location.pathname);
  handleRoute();
}

function closeCurrentView() {
  history.back();
}

function handleRoute() {
  const hash = location.hash;

  // Close open dialogs and clean up
  const timelineDialog = document.getElementById('timelineDialog');
  const calendarDialog = document.getElementById('calendarDialog');
  const videoDialog = document.getElementById('videoDialog');

  if (timelineDialog.open) {
    if (window.timelineInstance) window.timelineInstance.cleanup();
    timelineDialog.close();
  }
  if (calendarDialog.open) calendarDialog.close();
  if (videoDialog.open) {
    const player = document.getElementById('videoPlayer');
    player.pause();
    player.removeAttribute('src');
    videoDialog.close();
  }

  if (!hash || hash === '#') {
    loadStream();
    return;
  }

  unloadStream();

  if (hash.startsWith('#timeline/')) {
    openTimeline(hash.slice(10));
  } else if (hash.startsWith('#calendar/')) {
    openCalendar(hash.slice(10));
  } else if (hash.startsWith('#video/')) {
    const [cameraId, date] = hash.slice(7).split('/');
    openVideoView(cameraId, date);
  }
}

window.addEventListener('popstate', handleRoute);

// ── Stream ───────────────────────────────────────────────

function loadStream() {
  document.querySelectorAll('.camera-stream').forEach(img => {
    const url = img.dataset.streamUrl;
    const label = img.closest('.stream-wrap').querySelector('.stream-label');
    if (!url) return;
    label.textContent = 'Wird geladen…';
    img.onerror = () => { label.textContent = 'Nicht erreichbar'; };
    img.onload = () => { label.textContent = ''; };
    img.src = url;
  });
}

function unloadStream() {
  document.querySelectorAll('.camera-stream').forEach(img => {
    img.src = BLANK;
    img.onload = null;
    img.onerror = null;
    img.closest('.stream-wrap').querySelector('.stream-label').textContent = 'Stream gestoppt';
  });
}

// ── Stats ────────────────────────────────────────────────

function getCameraStats() {
  fetch('/stats').then(r => r.json()).then(data => {
    data.forEach(camera => {
      const card = document.querySelector(`.camera-card[data-camera-id="${camera.id}"]`);
      if (!card) return;
      card.querySelector('footer').textContent = `${camera.imageCount} Aufnahmen · ${camera.latestTime}`;
      card.querySelector('.status-dot').dataset.online = camera.online;
    });
  }).catch(console.error);
}

// ── LED ──────────────────────────────────────────────────

async function toggleLED(cameraId, event) {
  event.stopPropagation();
  const btn = event.currentTarget;
  const img = btn.closest('.camera-card').querySelector('.camera-stream');
  img.src = BLANK;
  try {
    const data = await fetch(`/camera/${cameraId}/led`).then(r => r.json());
    btn.textContent = data.led === 'on' ? 'LED ●' : 'LED';
  } catch (e) {
    console.error('LED error:', e);
  }
  if (!location.hash) loadStream();
}

// ── Init ─────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('cancel', e => {
      e.preventDefault();
      closeCurrentView();
    });
  });

  setInterval(getCameraStats, 10000);
  handleRoute();
});
