// ============= CONFIGURATION =============
const API_BASE = window.location.origin;

// ============= STATE =============
let images = [];
let currentIndex = 0;
let cameraId = null;
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

// ============= INITIALIZATION =============
document.addEventListener('DOMContentLoaded', () => {
    initializeSlideshow();
    setupEventListeners();
});

async function initializeSlideshow() {
    // Get camera ID from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    cameraId = urlParams.get('camera');

    if (!cameraId) {
        showError('No camera specified');
        return;
    }

    // Update camera label
    document.getElementById('cameraTitle').textContent = `Camera ${cameraId} - Slideshow`;

    // Load images
    await loadImages();
}

function setupEventListeners() {
    // Navigation buttons
    document.getElementById('btnPrev').addEventListener('click', () => navigate(-1));
    document.getElementById('btnNext').addEventListener('click', () => navigate(1));

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') navigate(-1);
        else if (e.key === 'ArrowRight') navigate(1);
        else if (e.key === 'Escape') window.location.href = '/';
    });

    // Touch/swipe support
    const carousel = document.getElementById('carousel');
    carousel.addEventListener('touchstart', handleTouchStart, { passive: true });
    carousel.addEventListener('touchend', handleTouchEnd, { passive: true });

    // Mouse wheel navigation 
    carousel.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY > 0) navigate(1);
        else if (e.deltaY < 0) navigate(-1);
    }, { passive: false });
}

// ============= IMAGE LOADING =============
async function loadImages() {
    try {
        showLoading(true);

        const response = await fetch(`${API_BASE}/api/images?camera_id=${cameraId}`);
        if (!response.ok) throw new Error('Failed to fetch images');

        const data = await response.json();
        images = data.images || [];

        if (images.length === 0) {
            showNoImages();
            return;
        }

        // Sort images by timestamp (newest first)
        images.sort((a, b) => {
            const dateA = parseBackendDate(a.timestamp);
            const dateB = parseBackendDate(b.timestamp);
            return dateB - dateA;
        });

        currentIndex = 0;
        updateCarousel();
        showLoading(false);

    } catch (error) {
        console.error('Error loading images:', error);
        showError('Failed to load images');
    }
}

// ============= CAROUSEL MANAGEMENT =============
function updateCarousel() {
    if (images.length === 0) return;

    // Calculate indices
    const prevIndex = (currentIndex - 1 + images.length) % images.length;
    const nextIndex = (currentIndex + 1) % images.length;

    // Get carousel items
    const prevSlide = document.getElementById('prevSlide');
    const currentSlide = document.getElementById('currentSlide');
    const nextSlide = document.getElementById('nextSlide');

    // Update images
    const prevImg = prevSlide.querySelector('img');
    const currentImg = currentSlide.querySelector('img');
    const nextImg = nextSlide.querySelector('img');

    prevImg.src = images[prevIndex].url;
    prevImg.alt = `Image ${prevIndex + 1}`;
    
    currentImg.src = images[currentIndex].url;
    currentImg.alt = `Image ${currentIndex + 1}`;
    
    nextImg.src = images[nextIndex].url;
    nextImg.alt = `Image ${nextIndex + 1}`;

    // Update counter and timestamp
    updateInfo();
}

function updateInfo() {
    const counter = document.getElementById('imageCounter');
    const dateDisplay = document.getElementById('imageDate');

    counter.textContent = `${currentIndex + 1} / ${images.length}`;
    
    if (images[currentIndex]) {
        const timestamp = images[currentIndex].timestamp;
        dateDisplay.textContent = formatTimestamp(timestamp);
    }
}

// ============= NAVIGATION =============
function navigate(direction) {
    if (images.length === 0) return;

    // Update index
    currentIndex = (currentIndex + direction + images.length) % images.length;
    
    // Update carousel
    updateCarousel();
}

// ============= TOUCH HANDLERS =============
function handleTouchStart(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
}

function handleTouchEnd(e) {
    touchEndX = e.changedTouches[0].clientX;
    touchEndY = e.changedTouches[0].clientY;
    handleSwipe();
}

function handleSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const minSwipeDistance = 50;

    // Horizontal swipe (desktop-like behavior)
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (Math.abs(deltaX) > minSwipeDistance) {
            if (deltaX > 0) navigate(-1); // Swipe right = previous
            else navigate(1); // Swipe left = next
        }
    } 
    // Vertical swipe (mobile)
    else {
        if (Math.abs(deltaY) > minSwipeDistance) {
            if (deltaY > 0) navigate(-1); // Swipe down = previous
            else navigate(1); // Swipe up = next
        }
    }
}

// ============= UI HELPERS =============
function showLoading(show) {
    const loading = document.getElementById('loading');
    loading.style.display = show ? 'block' : 'none';
}

function showNoImages() {
    showLoading(false);
    const noImages = document.getElementById('noImages');
    noImages.style.display = 'block';
}

function showError(message) {
    showLoading(false);
    const noImages = document.getElementById('noImages');
    noImages.style.display = 'block';
    noImages.querySelector('p').textContent = message;
}

// ============= DATE FORMATTING =============
function parseBackendDate(timestamp) {
    if (typeof timestamp === 'string' && timestamp.includes('.')) {
        // Parse DD.MM.YYYY HH:MM:SS format
        const [datePart, timePart] = timestamp.split(' ');
        const [day, month, year] = datePart.split('.');
        const [hours, minutes, seconds] = (timePart || '00:00:00').split(':');
        return new Date(year, month - 1, day, hours, minutes, seconds || 0);
    }
    return new Date(timestamp);
}

function formatTimestamp(timestamp) {
    try {
        const date = parseBackendDate(timestamp);
        
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
