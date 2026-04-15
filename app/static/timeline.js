// Virtual scrolling configuration
const BATCH_SIZE = 400;
const images = window.timelineImages || [];
const imagesLength = images.length;

let isDragging = false;
let index;
let timelineObserver;
let renderedStart = 0;
let renderedEnd = 0;

const timeline = document.getElementById('timeline');
const scrubberTrack = document.getElementById('scrubberTrack');
const scrubberBar = document.getElementById('scrubberBar');
const scrubberTime = document.getElementById('scrubberTime');
const scrubberTooltip = document.getElementById('scrubberTooltip');

// Create timeline items for a specific range
function createTimelineItem(imageData, itemIndex) {
    const div = document.createElement('div');
    div.className = 'timeline-item';
    div.setAttribute('data-item', itemIndex);
    div.setAttribute('data-timestamp', imageData.timestamp);
    div.onclick = () => displayImage(itemIndex);
    
    const img = document.createElement('img');
    img.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect fill=%22%232a2a2a88%22 width=%22400%22 height=%22300%22/%3E%3C/svg%3E';
    img.setAttribute('data-src', imageData.src);
    img.alt = 'Captured Image';
    
    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    timestamp.textContent = imageData.timestamp;
    
    div.appendChild(img);
    div.appendChild(timestamp);
    
    return div;
}

// Render a batch of timeline items
function renderBatch(startIdx, endIdx) {
    const fragment = document.createDocumentFragment();
    const items = [];
    
    for (let i = startIdx; i < endIdx && i < imagesLength; i++) {
        // Skip if already rendered
        if (document.querySelector(`.timeline-item[data-item="${i}"]`)) continue;
        
        const item = createTimelineItem(images[i], i);
        items.push({ element: item, index: i });
    }
    
    // Sort items by index to maintain proper order
    items.sort((a, b) => a.index - b.index);
    
    // Find the correct insertion point
    if (items.length > 0) {
        const firstNewIndex = items[0].index;
        const existingItems = Array.from(timeline.children);
        let insertBeforeElement = null;
        
        for (const existing of existingItems) {
            const existingIndex = parseInt(existing.getAttribute('data-item'));
            if (existingIndex > firstNewIndex) {
                insertBeforeElement = existing;
                break;
            }
        }
        
        items.forEach(({ element }) => fragment.appendChild(element));
        
        if (insertBeforeElement) {
            timeline.insertBefore(fragment, insertBeforeElement);
        } else {
            timeline.appendChild(fragment);
        }
    }
    
    renderedEnd = Math.max(renderedEnd, endIdx);
    if (startIdx < renderedStart) renderedStart = startIdx;
    
    // Re-initialize lazy loading for new items
    initializeLazyLoading();
    
    console.log(`Rendered items ${startIdx} to ${Math.min(endIdx, imagesLength)-1}`);
}

// Check if we need to load more items based on current index
function ensureItemsRendered(targetIndex) {
    // Calculate the range we want to have rendered (centered on target with buffer)
    const bufferSize = BATCH_SIZE / 2;
    const desiredStart = Math.max(0, targetIndex - bufferSize);
    const desiredEnd = Math.min(imagesLength, targetIndex + bufferSize);
    
    // Render forward if needed
    if (targetIndex > renderedEnd - BATCH_SIZE / 2 && renderedEnd < imagesLength) {
        const nextBatchEnd = Math.min(Math.max(renderedEnd + BATCH_SIZE, desiredEnd), imagesLength);
        renderBatch(renderedEnd, nextBatchEnd);
    }
    
    // Render backward if needed
    if (targetIndex < renderedStart + BATCH_SIZE / 2 && renderedStart > 0) {
        const prevBatchStart = Math.max(Math.min(renderedStart - BATCH_SIZE, desiredStart), 0);
        renderBatch(prevBatchStart, renderedStart);
    }
    
    // Handle jumps to unrendered areas (e.g., scrubber drag)
    if (targetIndex < renderedStart || targetIndex >= renderedEnd) {
        console.log(`Jump to unrendered area: ${targetIndex} (rendered: ${renderedStart}-${renderedEnd})`);
        const jumpStart = Math.max(0, targetIndex - BATCH_SIZE / 2);
        const jumpEnd = Math.min(imagesLength, targetIndex + BATCH_SIZE / 2);
        renderBatch(jumpStart, jumpEnd);
    }
}

// Initialize with first batch (load from end since we scroll to end by default)
const initialStart = Math.max(0, imagesLength - BATCH_SIZE);
renderBatch(initialStart, imagesLength);
renderedStart = initialStart;

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
    
    // Ensure the target item is rendered
    ensureItemsRendered(i);
    
    index = i;
    document.querySelectorAll('.active').forEach(item => {
        item.classList.remove('active')
        item.classList.add('timeline-item')
    });
    document.querySelectorAll('.timeline-item.timeline-item-dummy').forEach(item => item.remove());
    const activeItem = document.querySelector(`.timeline-item[data-item="${index}"]`);

    if (!activeItem) {
        console.warn(`Item ${index} not found in DOM`);
        return;
    }
    
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
    
    // Ensure items around the visible index are rendered
    ensureItemsRendered(visibleIndex);
    
    displayImage(visibleIndex, false);
}
function handleScrubberDrag(e) {
    const rect = scrubberTrack.getBoundingClientRect();
    const x = (e.type.includes('touch') ? e.touches[0].clientX : e.clientX) - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    
    // Calculate target index and ensure items are rendered
    const targetIndex = Math.round(percentage * (imagesLength - 1));
    ensureItemsRendered(targetIndex);
    
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