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

function streamLabel(img) {
  return img.closest('.stream-wrap').querySelector('.stream-label');
}

// Stop a stream: cancel its timeout, detach handlers and show a blank image
function resetStream(img) {
  clearTimeout(img._streamTimeout);
  img._streamTimeout = null;
  img.onload = null;
  img.onerror = null;
  img.src = BLANK;
}

function loadSingleStream(img, withTimeout) {
  const url = img.dataset.streamUrl;
  if (!url) return;
  const label = streamLabel(img);

  resetStream(img);
  label.textContent = 'Wird geladen…';
  img.onerror = () => {
    clearTimeout(img._streamTimeout);
    label.textContent = 'Nicht erreichbar';
  };
  img.onload = () => {
    clearTimeout(img._streamTimeout);
    label.textContent = '';
  };
  img.src = url;

  if (withTimeout) {
    img._streamTimeout = setTimeout(() => {
      resetStream(img);
      label.textContent = 'Timeout';
    }, 1000);
  }
}

function loadStream() {
  document.querySelectorAll('.camera-stream').forEach(img => loadSingleStream(img, true));
}

function unloadStream() {
  document.querySelectorAll('.camera-stream').forEach(img => {
    resetStream(img);
    streamLabel(img).textContent = 'Stream gestoppt';
  });
}

function reloadStream(cameraId, event) {
  event.stopPropagation();
  const card = document.querySelector(`.camera-card[data-camera-id="${cameraId}"]`);
  loadSingleStream(card.querySelector('.camera-stream'), false);
}

// ── Stats ────────────────────────────────────────────────

const cameraImageCounts = {};

function getCameraStats() {
  fetch('/stats').then(r => r.json()).then(data => {
    data.forEach(camera => {
      const card = document.querySelector(`.camera-card[data-camera-id="${camera.id}"]`);
      if (!card) return;
      card.querySelector('footer').textContent = `${camera.imageCount} Aufnahmen · ${camera.latestTime}`;
      card.querySelector('.status-dot').dataset.online = camera.online;
      updateMotionBadge(card.querySelector('.motion-badge'), camera);

      const prev = cameraImageCounts[camera.id];
      cameraImageCounts[camera.id] = camera.imageCount;

      if (prev !== undefined && camera.imageCount > prev) {
        const timelineDialog = document.getElementById('timelineDialog');
        if (timelineDialog.open && window.timelineInstance?.cameraId === camera.id) {
          window.timelineInstance.fetchNewImages();
        }
      }
    });
  }).catch(console.error);
}

// Only cameras with a motion sensor show the badge
function updateMotionBadge(badge, camera) {
  badge.hidden = !camera.motionSensor;
  if (!camera.motionSensor) return;
  badge.dataset.active = camera.motionActive;
  badge.textContent = camera.motionActive ? 'Bewegung' : motionCountText(camera.motionEvents);
  badge.title = camera.lastMotion ? `Bewegungen heute: ${camera.motionEvents} · zuletzt ${camera.lastMotion}` : 'Heute keine Bewegung';
}

function motionCountText(count) {
  return count === 1 ? '1 Bewegung' : `${count} Bewegungen`;
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

  getCameraStats();
  setInterval(getCameraStats, 1000);
  handleRoute();
});
