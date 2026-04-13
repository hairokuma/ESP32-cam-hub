// ============= CONFIGURATION =============
const API_BASE = window.location.origin;

// ============= STATE =============
let images = [];
let currentIndex = 0;
let cameraId = null;
let touchStartX = 0;
let touchStartY = 0;
let observer = null;

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
    const container = document.getElementById('slideshowContainer');
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    // Scroll event to update active image - call directly without throttling
    container.addEventListener('scroll', updateActiveImage, { passive: true });
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

        renderCarousel();
        setupLazyLoading();
        showLoading(false);

        // Scroll to first image after render - ensure it's centered
        setTimeout(() => {
            const firstItem = document.querySelector('.carousel-item');
            if (firstItem) {
                firstItem.scrollIntoView({ 
                    behavior: 'instant',
                    block: 'center',
                    inline: 'center'
                });
                firstItem.classList.add('active');
                updateInfo();
            }
        }, 100);

    } catch (error) {
        console.error('Error loading images:', error);
        showError('Failed to load images');
    }
}

// ============= CAROUSEL RENDERING =============
function renderCarousel() {
    const track = document.getElementById('carouselTrack');
    track.innerHTML = '';

    images.forEach((image, index) => {
        const item = document.createElement('div');
        item.className = 'carousel-item';
        item.dataset.index = index;

        const img = document.createElement('img');
        
        // Preload first 40 images for smooth scrolling experience
        if (index < 40) {
            img.src = image.url;
        } else {
            img.dataset.src = image.url;
            img.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect fill=%22%232a2a2a%22 width=%22400%22 height=%22300%22/%3E%3C/svg%3E';
        }
        
        img.alt = `Image ${index + 1}`;
        img.dataset.timestamp = image.timestamp;
        
        // Click to view fullscreen or navigate
        img.addEventListener('click', () => scrollToImage(index));

        item.appendChild(img);
        
        // Add time overlay from filename (format: HH-MM-SS.jpg)
        const timeOverlay = document.createElement('div');
        timeOverlay.className = 'time-overlay';
        const timeFromFilename = extractTimeFromFilename(image.filename);
        if (timeFromFilename) {
            timeOverlay.textContent = timeFromFilename;
        }
        item.appendChild(timeOverlay);
        
        track.appendChild(item);
    });

    updateActiveImage();
    
    // Reset cached items after rendering
    cachedItems = document.querySelectorAll('.carousel-item');
}

// Extract time from filename (e.g., "22-38-45.jpg" -> "22:38:45")
function extractTimeFromFilename(filename) {
    if (!filename) return null;
    
    // Match pattern like 22-38-45 in filename
    const match = filename.match(/(\d{2})-(\d{2})-(\d{2})/);
    if (match) {
        return `${match[1]}:${match[2]}:${match[3]}`;
    }
    return null;
}

// ============= LAZY LOADING =============
function setupLazyLoading() {
    const images = document.querySelectorAll('img[data-src]');
    
    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                observer.unobserve(img);
            }
        });
    }, {
        rootMargin: '2000px' // Start loading very early for smooth scrolling
    });

    images.forEach(img => observer.observe(img));
}

// ============= ACTIVE IMAGE DETECTION =============
function updateActiveImage() {
    const items = document.querySelectorAll('.carousel-item');
    
    if (items.length === 0) return;

    // Get screen center
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;

    let closestItem = null;
    let closestDistance = Infinity;
    let closestIndex = 0;

    items.forEach((item, index) => {
        const rect = item.getBoundingClientRect();
        const itemCenterX = rect.left + rect.width / 2;
        const itemCenterY = rect.top + rect.height / 2;

        // Calculate distance from screen center
        const distance = Math.sqrt(
            Math.pow(itemCenterX - centerX, 2) + 
            Math.pow(itemCenterY - centerY, 2)
        );

        if (distance < closestDistance) {
            closestDistance = distance;
            closestItem = item;
            closestIndex = index;
        }
    });

    // Update active item
    if (closestItem) {
        items.forEach(item => item.classList.remove('active'));
        closestItem.classList.add('active');
        currentIndex = closestIndex;
        updateInfo();
        preloadNearbyImages(closestIndex);
    }
}

// Preload images around the current position
function preloadNearbyImages(centerIndex) {
    const items = document.querySelectorAll('.carousel-item');
    const preloadRange = 30; // Load 30 images ahead
    
    // Load images from current to current + 30
    for (let i = centerIndex; i < Math.min(centerIndex + preloadRange, items.length); i++) {
        const img = items[i].querySelector('img[data-src]');
        if (img && img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            if (observer) observer.unobserve(img);
        }
    }
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

    const newIndex = Math.max(0, Math.min(images.length - 1, currentIndex + direction));
    scrollToImage(newIndex);
}

function scrollToImage(index) {
    const items = document.querySelectorAll('.carousel-item');
    if (items[index]) {
        items[index].scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center',
            inline: 'center'
        });
        currentIndex = index;
        
        // Force update active state immediately
        setTimeout(() => {
            items.forEach(item => item.classList.remove('active'));
            items[index].classList.add('active');
            updateInfo();
            preloadNearbyImages(index);
        }, 50);
    }
}

// ============= TOUCH HANDLERS =============
function handleTouchStart(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
}

function handleTouchEnd(e) {
    // Touch events already handled by scroll-snap
    // This is just for future custom gestures if needed
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
