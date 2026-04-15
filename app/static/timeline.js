// const imagesString = `{{ images | tojson }}`;
// const images = JSON.parse(imagesString);

// const imagesLength = images.length
let isDragging = false;
let index;
let timelineObserver;

const timeline = document.getElementById('timeline');
const imagesLength = timeline.getAttribute('data-images')

const scrubberTrack = document.getElementById('scrubberTrack')
const scrubberBar = document.getElementById('scrubberBar')
const scrubberTime = document.getElementById('scrubberTime');
const scrubberTooltip = document.getElementById('scrubberTooltip');

timeline.scrollLeft = timeline.scrollWidth;

function initializeLazyLoading() {
    if (timelineObserver) timelineObserver.disconnect();

    const options = {
        root: document.querySelector('.timeline'),
        rootMargin: '3300px',
        threshold: 0.01
    };

    timelineObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.getAttribute('data-src');
                img.src = src;
                timelineObserver.unobserve(img);
            }
        });
    }, options);

    document.querySelectorAll('.timeline img').forEach(img => timelineObserver.observe(img));
}
initializeLazyLoading();

function displayImage(i, scroll = true) {
    if (i < 0 || i >= imagesLength || i === index) return;
    index = i;
    document.querySelectorAll('.active').forEach(item => {
        item.classList.remove('active')
        item.classList.add('timeline-item')
    });
    document.querySelectorAll('.timeline-item.timeline-item-dummy').forEach(item => item.remove());
    const activeItem = document.querySelector(`.timeline-item[data-item="${index}"]`);

    if (!activeItem) return
    const dummy = activeItem.cloneNode(true)
    dummy.classList.add('timeline-item-dummy')
    timeline.insertBefore(dummy, activeItem)
    activeItem.classList.add('active');
    activeItem.classList.remove('timeline-item');
    scrubberTime.textContent = activeItem.getAttribute('data-timestamp');

    if (scroll) dummy.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    const maxScroll = timeline.scrollWidth - timeline.clientWidth;
    const scrollPercentage = maxScroll > 0 ? timeline.scrollLeft / maxScroll : 0;
    scrubberBar.style.left = `calc(${scrollPercentage * 100}% - 8px)`;
}



function handleTimelineScroll() {
    if (imagesLength === 0) return;
    const centerPosition = timeline.scrollLeft + (timeline.clientWidth / 2);
    const scrollPercentage = timeline.scrollWidth > 0 ? centerPosition / timeline.scrollWidth : 0;
    const visibleIndex = Math.round(scrollPercentage * (imagesLength - 1));
    displayImage(visibleIndex, false);
}
function handleScrubberDrag(e) {
    const rect = scrubberTrack.getBoundingClientRect();
    const x = (e.type.includes('touch') ? e.touches[0].clientX : e.clientX) - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    timeline.scrollLeft = percentage * (timeline.scrollWidth - timeline.clientWidth);
}

const startDrag = (e) => {
    isDragging = true;
    scrubberTrack.classList.add('dragging');
    handleScrubberDrag(e);
};

const onDrag = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    handleScrubberDrag(e);
};

const endDrag = () => {
    if (isDragging) {
        isDragging = false;
        scrubberTrack.classList.remove('dragging');
    }
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        displayImage(index - 1)
    }
    else if (e.key === 'ArrowRight') {
        e.preventDefault();
        displayImage(index + 1);
    }
});
document.getElementById('prevImage').addEventListener('click', () => displayImage(index - 1));
document.getElementById('nextImage').addEventListener('click', () => displayImage(index + 1));
scrubberTrack.addEventListener('mousedown', startDrag);
document.addEventListener('mousemove', onDrag, { passive: false });
document.addEventListener('mouseup', endDrag);
scrubberTrack.addEventListener('touchstart', startDrag, { passive: false });
document.addEventListener('touchmove', onDrag, { passive: false });
document.addEventListener('touchend', endDrag);
document.getElementById('timeline').addEventListener('scroll', handleTimelineScroll, { passive: true });
setTimeout(() => {
    displayImage(imagesLength - 1)
}, 200);