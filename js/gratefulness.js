// ===========================
// GRATEFULNESS PAGE - MAIN SCRIPT
// ===========================

document.addEventListener('DOMContentLoaded', () => {
    // ---- Password Gate ----
    if (!checkPassword()) return;

    // ---- Initialize Book ----
    initBook();
    initAutoHideScrollbars();
    initScrollHintsAndIsolation();
    initBookNavigation();
    initHorizontalSwipeNavigation();
});

// ===========================
// PASSWORD GATE
// ===========================
function checkPassword() {
    const password = prompt('Nhập mật khẩu để tiếp tục:');
    if (password !== 'Dancen5@') {
        window.location.replace('index.html');
        return false;
    }
    return true;
}

// ===========================
// BOOK INITIALIZATION
// ===========================
let pageFlip = null;
let TOTAL_PAGES = 0;     // stored once at init — never re-queried from live DOM
let stackedLayers = [];  // direct references to layer elements

function getResponsiveBookDimensions() {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    if (screenW <= 480) {
        // Mobile phone small
        const w = Math.min(screenW - 20, 380);
        const h = Math.min(screenH - 30, 580);
        return { width: Math.max(w, 290), height: Math.max(h, 450) };
    } else if (screenW <= 768) {
        // Mobile phone large / tablet
        const w = Math.min(screenW - 32, 450);
        const h = Math.min(screenH - 40, 650);
        return { width: w, height: h };
    } else {
        // Desktop default
        return { width: 550, height: 733 };
    }
}

function initBook() {
    const bookEl = document.getElementById('book');
    if (!bookEl) return;

    const dims = getResponsiveBookDimensions();

    pageFlip = new St.PageFlip(bookEl, {
        width: dims.width,
        height: dims.height,
        size: 'fixed',
        showCover: false,
        flippingTime: 800,
        drawShadow: true,
        mobileScrollSupport: false,
        maxShadowOpacity: 0.15,
        useMouseEvents: true,
    });

    // Load all pages from DOM
    pageFlip.loadFromHTML(document.querySelectorAll('.page'));

    // Store authoritative page count ONCE from StPageFlip (not re-queried later,
    // because StPageFlip clones .page elements during flip animation which inflates
    // querySelectorAll('.page').length and breaks the remaining-page calculation)
    TOTAL_PAGES = pageFlip.getPageCount();

    // ---- Build stacked layers dynamically based on page count ----
    initStackedPages();

    // ---- Fix page heights for scrollable content ----
    fixPageHeights();

    // ---- Update stack depth and scroll hints on every page flip ----
    pageFlip.on('flip', (e) => {
        updateStackDepth(e.data);
        setTimeout(updateAllScrollHints, 100);
    });

    // Set initial stack depth (page 0 = all layers visible)
    // Small delay to let StPageFlip finish rendering first
    setTimeout(() => {
        updateStackDepth(0);
        updateAllScrollHints();
    }, 100);

    // ---- Chapter click-to-flip ----
    const chapterItems = document.querySelectorAll('.chapter-item[data-page]');
    chapterItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetPage = parseInt(item.getAttribute('data-page'), 10);
            if (!isNaN(targetPage)) {
                pageFlip.flip(targetPage, 'bottom');
            }
        });
    });

    // ---- Window resize handler for mobile responsiveness ----
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (!pageFlip) return;
            const newDims = getResponsiveBookDimensions();
            const curSettings = pageFlip.getSettings();

            if (curSettings.width !== newDims.width || curSettings.height !== newDims.height) {
                pageFlip.update({
                    width: newDims.width,
                    height: newDims.height
                });
                updateStackedPagesDimensions(newDims.width, newDims.height);
                fixPageHeights();
                updateAllScrollHints();
            }
        }, 200);
    });
}

// ===========================
// PAGE HEIGHT FIX
// ===========================
function fixPageHeights() {
    const H = pageFlip.getSettings().height;
    document.querySelectorAll('.page').forEach(page => {
        page.style.height = H + 'px';
        page.style.boxSizing = 'border-box';
    });
}

// ===========================
// STACKED-PAGE GENERATION
// ===========================
function initStackedPages() {
    const bookScene = document.querySelector('.book-scene');
    const bookEl = document.getElementById('book');
    const maxLayers = TOTAL_PAGES - 1; // 5 pages → 4 max layers

    // Read offset values from CSS variables (falls back to 20/15)
    const styles = getComputedStyle(document.documentElement);
    const offsetX = parseInt(styles.getPropertyValue('--stack-offset-x')) || 20;
    const offsetY = parseInt(styles.getPropertyValue('--stack-offset-y')) || 15;

    // Dimensions must match StPageFlip's book exactly
    const W = pageFlip.getSettings().width;
    const H = pageFlip.getSettings().height;

    stackedLayers = []; // reset

    // Gray palette: closest layer = lightest (#E0), furthest = darkest (#AB)
    for (let i = 1; i <= maxLayers; i++) {
        const t = (i - 1) / Math.max(maxLayers - 1, 1);
        const shade = Math.round(224 - t * 85);
        const hex = shade.toString(16).padStart(2, '0');

        const div = document.createElement('div');
        div.classList.add('stacked-page', `stacked-page--${i}`);
        div.style.width = `${W}px`;
        div.style.height = `${H}px`;
        div.style.transform = `translate(${offsetX * i}px, ${offsetY * i}px)`;
        div.style.backgroundColor = `#${hex}${hex}${hex}`;
        div.style.zIndex = String(-i);

        // Insert before #book so all layers sit behind it in the stacking context
        bookScene.insertBefore(div, bookEl);
        stackedLayers.push(div);
    }
}

function updateStackedPagesDimensions(W, H) {
    const styles = getComputedStyle(document.documentElement);
    const offsetX = parseInt(styles.getPropertyValue('--stack-offset-x')) || 20;
    const offsetY = parseInt(styles.getPropertyValue('--stack-offset-y')) || 15;

    stackedLayers.forEach((layer, index) => {
        const i = index + 1;
        layer.style.width = `${W}px`;
        layer.style.height = `${H}px`;
        layer.style.transform = `translate(${offsetX * i}px, ${offsetY * i}px)`;
    });
}

// ===========================
// STACKED-PAGE DEPTH SYNC
// ===========================
function updateStackDepth(currentPage) {
    // Use TOTAL_PAGES (stored at init) — never re-query the DOM here because
    // StPageFlip clones .page elements during flip animation, which inflates
    // querySelectorAll('.page').length and breaks the remaining calculation.
    const pagesRemaining = TOTAL_PAGES - 1 - currentPage;

    // Show exactly pagesRemaining layers; hide the rest immediately (no fade)
    stackedLayers.forEach((layer, index) => {
        const layerNumber = index + 1;
        layer.classList.toggle('stack-hidden', layerNumber > pagesRemaining);
    });
}

// ===========================
// AUTO-HIDE SCROLLBARS
// ===========================
function initAutoHideScrollbars() {
    // Target all scrollable containers
    const scrollables = document.querySelectorAll('.chapter-list-wrapper, .page-body');
    const HIDE_DELAY = 1500; // ms after scroll stops

    scrollables.forEach(el => {
        let scrollTimer = null;

        el.addEventListener('scroll', () => {
            // Show scrollbar
            el.classList.add('is-scrolling');

            // Reset hide timer
            if (scrollTimer) clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                el.classList.remove('is-scrolling');
            }, HIDE_DELAY);
        }, { passive: true });
    });
}

// ===========================
// SCROLL EVENT ISOLATION & HINTS
// ===========================
function initScrollHintsAndIsolation() {
    const scrollables = document.querySelectorAll('.chapter-list-wrapper, .page-body');

    scrollables.forEach(el => {
        let wrapper = el.closest('.scroll-wrapper');
        if (!wrapper) {
            wrapper = el.parentElement;
        }
        if (!wrapper) return;

        // Ensure top and bottom hints exist in scroll-wrapper container
        if (!wrapper.querySelector('.scroll-hint-bottom')) {
            const hintBottom = document.createElement('div');
            hintBottom.className = 'scroll-hint-bottom';
            wrapper.appendChild(hintBottom);
        }
        if (!wrapper.querySelector('.scroll-hint-top')) {
            const hintTop = document.createElement('div');
            hintTop.className = 'scroll-hint-top';
            wrapper.appendChild(hintTop);
        }

        const updateHints = () => {
            const hasOverflow = el.scrollHeight > el.clientHeight + 4;
            const isTop = el.scrollTop <= 4;

            // Bottom gradient fade is ALWAYS active whenever content overflows,
            // ensuring any text at the bottom edge always dissolves gracefully into white.
            wrapper.classList.toggle('has-more-bottom', hasOverflow);
            wrapper.classList.toggle('has-more-top', hasOverflow && !isTop);
        };

        // Update hints on scroll
        el.addEventListener('scroll', updateHints, { passive: true });

        // Update hints on multiple timers to handle rendering/StPageFlip layout delays
        [50, 150, 400, 1000].forEach(delay => setTimeout(updateHints, delay));

        // ---- ISOLATE SCROLL EVENTS FROM BOOK FLIPPING (CAPTURE & BUBBLE PHASES) ----
        ['wheel', 'mousedown', 'mousemove', 'pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend'].forEach(evtType => {
            // Capture phase (intercepts before StPageFlip capture listeners)
            el.addEventListener(evtType, (e) => {
                e.stopPropagation();
            }, { passive: true, capture: true });

            // Bubble phase
            el.addEventListener(evtType, (e) => {
                e.stopPropagation();
            }, { passive: true, capture: false });
        });
    });
}

function updateAllScrollHints() {
    const scrollables = document.querySelectorAll('.chapter-list-wrapper, .page-body');
    scrollables.forEach(el => {
        const wrapper = el.closest('.scroll-wrapper') || el.parentElement;
        if (!wrapper) return;

        const hasOverflow = el.scrollHeight > el.clientHeight + 4;
        const isTop = el.scrollTop <= 4;

        wrapper.classList.toggle('has-more-bottom', hasOverflow);
        wrapper.classList.toggle('has-more-top', hasOverflow && !isTop);
    });
}

// ===========================
// FLOATING NAV & SWIPE CONTROLS
// ===========================
function initBookNavigation() {
    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');
    const indicator = document.getElementById('pageIndicator');

    if (!btnPrev || !btnNext || !indicator) return;

    btnPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pageFlip) pageFlip.flipPrev('bottom');
    });

    btnNext.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pageFlip) pageFlip.flipNext('bottom');
    });

    const updateNavState = (pageIndex) => {
        const current = (pageIndex !== undefined ? pageIndex : (pageFlip ? pageFlip.getCurrentPageIndex() : 0)) + 1;
        const total = TOTAL_PAGES || 1;

        indicator.textContent = `${current} / ${total}`;
        btnPrev.disabled = (current <= 1);
        btnNext.disabled = (current >= total);
    };

    if (pageFlip) {
        pageFlip.on('flip', (e) => {
            updateNavState(e.data);
        });
    }

    updateNavState(0);
}

function initHorizontalSwipeNavigation() {
    let startX = 0;
    let startY = 0;
    const MIN_SWIPE_PX = 50;

    document.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length === 0) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;

        const diffX = endX - startX;
        const diffY = endY - startY;

        // Trigger horizontal page flip when horizontal swipe is 1.5x more dominant than vertical
        if (Math.abs(diffX) > Math.abs(diffY) * 1.5 && Math.abs(diffX) >= MIN_SWIPE_PX) {
            if (diffX < 0) {
                // Swipe Left -> Next Page
                if (pageFlip && pageFlip.getCurrentPageIndex() < TOTAL_PAGES - 1) {
                    pageFlip.flipNext('bottom');
                }
            } else {
                // Swipe Right -> Prev Page
                if (pageFlip && pageFlip.getCurrentPageIndex() > 0) {
                    pageFlip.flipPrev('bottom');
                }
            }
        }
    }, { passive: true });
}

