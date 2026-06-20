const PREVIEW_BORDER_SIZE = 2;
const PREVIEW_MARGIN = 8;
const BASE_POPUP_DISPLAY_TIME = 5000;
const POPUP_CHECK_INTERVAL = 500;
const MAX_VISIBLE_POPUPS = 5;
let popupQueue = [];
let popupManagerStarted = false;
let lastRenderedVideoId = null;
let lastRenderedDuration = null;
let durationRecheckTimer = null;
let statusHideTimer = null;
let statusFadeTimer = null;
let statusVideoId = null;
let statusQueue = [];
let statusProcessing = false;
let statusGeneration = 0;
const STATUS_STEP_MS = 550;
const STATUS_DONE_MS = 1800;

function getStatusLabel(stage, options = {}) {
    const count = options.count;
    const countSuffix = count != null ? ` (${count})` : '';
    switch (stage) {
        case 'detected':
            return 'Wykryto film';
        case 'checking':
            return 'Sprawdzanie cache…';
        case 'cache-hit':
            return `Z cache${countSuffix}`;
        case 'fetching':
            return 'Pobieranie…';
        case 'drawing':
            return 'Rysowanie…';
        case 'done-cache':
            return `Gotowe · cache${countSuffix}`;
        case 'done-fetch':
            return `Gotowe · pobrane${countSuffix}`;
        default:
            return stage;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function setStatusIndicator(stage, videoId, options = {}) {
    if (!settings.statusIndicator) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        statusQueue.push({ stage, videoId, options, resolve });
        processStatusQueue();
    });
}

async function processStatusQueue() {
    if (statusProcessing) {
        return;
    }
    statusProcessing = true;
    const generation = statusGeneration;

    while (statusQueue.length > 0 && generation === statusGeneration) {
        const { stage, videoId, options, resolve } = statusQueue.shift();

        if (!isActiveVideo(videoId) && stage !== 'detected') {
            resolve();
            continue;
        }

        showStatusIndicatorNow(stage, videoId);
        const textEl = document.querySelector('.__youtube-timestamps__status .__youtube-timestamps__status-text');
        if (textEl) {
            textEl.textContent = getStatusLabel(stage, options);
        }

        const isDone = stage.startsWith('done-');
        await sleep(isDone ? STATUS_DONE_MS : STATUS_STEP_MS);

        if (isDone && generation === statusGeneration && statusVideoId === videoId) {
            const indicator = document.querySelector('.__youtube-timestamps__status');
            if (indicator) {
                indicator.classList.add('ytt-status-fade-out');
                await sleep(600);
                if (statusVideoId === videoId) {
                    indicator.remove();
                }
            }
        }

        resolve();
    }

    statusProcessing = false;
    if (statusQueue.length > 0 && generation === statusGeneration) {
        processStatusQueue();
    }
}

function showStatusIndicatorNow(stage, videoId) {
    const player = document.querySelector('#movie_player');
    if (!player) {
        return;
    }

    statusVideoId = videoId;
    let indicator = player.querySelector('.__youtube-timestamps__status');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.classList.add('__youtube-timestamps__status');
        indicator.innerHTML = '<span class="__youtube-timestamps__status-dot"></span><span class="__youtube-timestamps__status-text"></span>';
        player.appendChild(indicator);
    }

    clearTimeout(statusHideTimer);
    clearTimeout(statusFadeTimer);
    indicator.classList.remove('ytt-status-fade-out');
    indicator.dataset.stage = stage.startsWith('done-') ? 'done' : stage;
}

function hideStatusIndicator() {
    statusGeneration++;
    statusQueue = [];
    statusProcessing = false;
    clearTimeout(statusHideTimer);
    clearTimeout(statusFadeTimer);
    statusVideoId = null;
    document.querySelector('.__youtube-timestamps__status')?.remove();
}

let pausedForLoadVideoId = null;

function maybePauseForLoad(videoId) {
    if (!settings.pauseWhileLoading) {
        return;
    }
    const video = getVideo();
    if (!video || video.paused) {
        pausedForLoadVideoId = null;
        return;
    }
    video.pause();
    pausedForLoadVideoId = videoId;
}

function maybeResumeAfterLoad(videoId) {
    if (pausedForLoadVideoId !== videoId || !isActiveVideo(videoId)) {
        pausedForLoadVideoId = null;
        return;
    }
    const video = getVideo();
    pausedForLoadVideoId = null;
    if (video?.paused) {
        video.play().catch(() => {});
    }
}

function cancelPauseForLoad() {
    pausedForLoadVideoId = null;
}

function addTimeComments(timeComments, videoId, attempt = 1) {
    if (!timeComments?.length || !isActiveVideo(videoId)) {
        if (timeComments?.length && !isActiveVideo(videoId)) {
            yttLog(`Pominięto rysowanie — dane nie pasują do aktywnego filmu (${videoId}).`);
        }
        return;
    }

    const video = getVideo();
    if (!video) {
        if (attempt < 10) {
            setTimeout(() => addTimeComments(timeComments, videoId, attempt + 1), 200);
        }
        return;
    }

    const videoDuration = video.duration;
    if (Number.isNaN(videoDuration) || videoDuration <= 0) {
        if (attempt < 10) {
            const delay = attempt <= 3 ? (attempt === 1 ? 500 : 1000) : 200;
            setTimeout(() => addTimeComments(timeComments, videoId, attempt + 1), delay);
        }
        return;
    }

    const durationChanged = lastRenderedVideoId === videoId
        && lastRenderedDuration !== null
        && Math.abs(videoDuration - lastRenderedDuration) > 1;

    if (lastRenderedVideoId === videoId && !durationChanged) {
        return;
    }

    if (durationChanged) {
        yttLog(`Ponowne rysowanie — duration ${lastRenderedDuration} → ${videoDuration}.`);
    } else {
        yttLog(`Rysowanie ${timeComments.length} znaczników (duration: ${videoDuration}).`);
    }

    lastRenderedVideoId = videoId;
    lastRenderedDuration = videoDuration;

    renderTimelineMarkers(timeComments, videoDuration);
    setupPopupsIfNeeded(timeComments, videoId);
    scheduleDurationRecheck(timeComments, videoId, videoDuration);
}

function scheduleDurationRecheck(timeComments, videoId, renderedDuration) {
    clearTimeout(durationRecheckTimer);
    let checks = 0;

    function check() {
        if (!isActiveVideo(videoId) || lastRenderedVideoId !== videoId) {
            return;
        }

        const video = getVideo();
        if (!video) {
            return;
        }

        const duration = video.duration;
        if (!Number.isNaN(duration) && duration > 0 && Math.abs(duration - renderedDuration) > 1) {
            addTimeComments(timeComments, videoId);
            return;
        }

        checks++;
        if (checks < 5) {
            durationRecheckTimer = setTimeout(check, checks <= 2 ? 500 : 1000);
        }
    }

    durationRecheckTimer = setTimeout(check, 500);
}

function renderTimelineMarkers(timeComments, videoDuration) {
    if (!settings.timelineMarkers) {
        return;
    }

    const timeCounts = {};
    timeComments.forEach(tc => {
        timeCounts[tc.time] = (timeCounts[tc.time] || 0) + 1;
    });
    const maxCount = Math.max(...Object.values(timeCounts));

    function getHeatLevel(time) {
        const count = timeCounts[time];
        if (maxCount <= 1) return 'stamp-heat-1';
        const heatRatio = count / maxCount;
        if (heatRatio > 0.75) return 'stamp-heat-4';
        if (heatRatio > 0.5) return 'stamp-heat-3';
        if (heatRatio > 0.25) return 'stamp-heat-2';
        return 'stamp-heat-1';
    }

    const bar = getOrCreateBar();
    if (!bar) {
        return;
    }
    bar.innerHTML = '';

    for (const tc of timeComments) {
        if (tc.time > videoDuration) continue;

        const stamp = document.createElement('div');
        stamp.classList.add('__youtube-timestamps__stamp', getHeatLevel(tc.time));

        const positionPercent = (tc.time / videoDuration) * 100;
        stamp.style.left = `calc(${positionPercent}% - 2px)`;

        bar.appendChild(stamp);

        stamp.addEventListener('mouseenter', () => {
            hoveredTimeComment = tc;
            showPreview(tc);
        });

        stamp.addEventListener('mouseleave', () => {
            hoveredTimeComment = null;
            hidePreview();
        });

        stamp.addEventListener('wheel', withWheelThrottle((e) => {
            const preview = getOrCreatePreview();
            if (preview) {
                preview.scrollBy(0, e.deltaY);
            }
        }));

        stamp.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            if (tc === contextMenuTimeComment && isContextMenuVisible()) {
                hideContextMenu();
            } else {
                showContextMenu(tc, e.pageX, e.pageY);
                contextMenuTimeComment = tc;
            }
        });
    }
}

function setupPopupsIfNeeded(timeComments, videoId) {
    if (settings.commentPopups && !popupManagerStarted) {
        if (typeof window.__youtube_timestamps_cleanup === 'function') {
            window.__youtube_timestamps_cleanup();
        }
        window.__youtube_timestamps_cleanup = manageTimePopups(timeComments, videoId);
        popupManagerStarted = true;
    }
}

function cleanupUi() {
    clearTimeout(durationRecheckTimer);
    lastRenderedVideoId = null;
    lastRenderedDuration = null;
    cancelPauseForLoad();
    hideStatusIndicator();
    document.querySelector('.__youtube-timestamps__bar')?.remove();
    document.querySelector('.__youtube-timestamps__popup-container')?.remove();
    popupQueue = [];
    popupManagerStarted = false;
    if (typeof window.__youtube_timestamps_cleanup === 'function') {
        window.__youtube_timestamps_cleanup();
    }
    window.__youtube_timestamps_cleanup = null;
}

function getOrCreateBar() {
    let bar = document.querySelector('.__youtube-timestamps__bar');
    if (!bar) {
        const container = document.querySelector('#movie_player .ytp-progress-bar');
        if (container) {
            bar = document.createElement('div');
            bar.classList.add('__youtube-timestamps__bar');
            container.insertBefore(bar, container.firstChild);
        }
    }
    return bar;
}

function getTooltip() {
    return document.querySelector('#movie_player .ytp-tooltip');
}

function showPreview(timeComment) {
    const tooltip = getTooltip();
    if (!tooltip) {
        return;
    }
    const preview = getOrCreatePreview();
    preview.style.display = '';
    preview.querySelector('.__youtube-timestamps__preview__avatar').src = timeComment.authorAvatar;
    preview.querySelector('.__youtube-timestamps__preview__name').textContent = timeComment.authorName;

    const textNode = preview.querySelector('.__youtube-timestamps__preview__text');
    textNode.innerHTML = '';

    const timeSpan = document.createElement('span');
    timeSpan.className = '__youtube-timestamps__highlight-time';
    timeSpan.textContent = `[${timeComment.timestamp}] `;
    textNode.appendChild(timeSpan);

    textNode.appendChild(document.createTextNode(timeComment.text));

    const tooltipBgWidth = tooltip.querySelector('.ytp-tooltip-bg').style.width;
    const previewWidth = tooltipBgWidth.endsWith('px') ? parseFloat(tooltipBgWidth) : 160;
    preview.style.width = `${previewWidth + 2 * PREVIEW_BORDER_SIZE}px`;

    const halfPreviewWidth = previewWidth / 2;
    const playerRect = document.querySelector('#movie_player .ytp-progress-bar').getBoundingClientRect();
    const pivot = preview.parentElement.getBoundingClientRect().left;
    const minPivot = playerRect.left + halfPreviewWidth;
    const maxPivot = playerRect.right - halfPreviewWidth;
    let previewLeft;

    if (pivot < minPivot) {
        previewLeft = playerRect.left - pivot;
    } else if (pivot > maxPivot) {
        previewLeft = -previewWidth + (playerRect.right - pivot);
    } else {
        previewLeft = -halfPreviewWidth;
    }
    preview.style.left = `${previewLeft - PREVIEW_BORDER_SIZE}px`;

    const textAboveVideoPreview = tooltip.querySelector('.ytp-tooltip-edu');
    if (textAboveVideoPreview) {
        preview.style.bottom = `${10 + textAboveVideoPreview.clientHeight}px`;
    }

    const tooltipTop = tooltip.style.top;
    if (tooltipTop.endsWith('px')) {
        let previewHeight = parseFloat(tooltipTop) - 2 * PREVIEW_MARGIN;
        if (textAboveVideoPreview) {
            previewHeight -= textAboveVideoPreview.clientHeight;
        }
        if (previewHeight > 0) {
            preview.style.maxHeight = `${previewHeight}px`;
        }
    }
}

function getOrCreatePreview() {
    const tooltip = getTooltip();
    let preview = tooltip?.querySelector('.__youtube-timestamps__preview');
    if (!preview && tooltip) {
        preview = document.createElement('div');
        preview.classList.add('__youtube-timestamps__preview');
        const wrapper = document.createElement('div');
        wrapper.classList.add('__youtube-timestamps__preview-wrapper');
        wrapper.appendChild(preview);
        tooltip.insertAdjacentElement('afterbegin', wrapper);

        const author = document.createElement('div');
        author.classList.add('__youtube-timestamps__preview__author');
        preview.appendChild(author);

        const avatar = document.createElement('img');
        avatar.classList.add('__youtube-timestamps__preview__avatar');
        author.appendChild(avatar);

        const name = document.createElement('span');
        name.classList.add('__youtube-timestamps__preview__name');
        author.appendChild(name);

        const text = document.createElement('div');
        text.classList.add('__youtube-timestamps__preview__text');
        preview.appendChild(text);
    }
    return preview;
}

function hidePreview() {
    const preview = document.querySelector('.__youtube-timestamps__preview');
    if (preview) {
        preview.style.display = 'none';
    }
}

function withWheelThrottle(callback) {
    let afReq = false;
    return (e) => {
        e.preventDefault();
        if (afReq) return;
        afReq = true;
        requestAnimationFrame(() => {
            callback(e);
            afReq = false;
        });
    }
}

function showContextMenu(tc, x, y) {
    const menu = getOrCreateContextMenu();
    menu.style.display = '';
    adjustContextMenu(menu, x, y);
    menu.dataset.commentId = tc.commentId;
}

function adjustContextMenu(menu, x, y) {
    const height = menu.querySelector('.ytp-panel-menu').clientHeight;
    menu.style.height = `${height}px`;
    menu.style.top = `${y - height}px`;
    menu.style.left = `${x}px`;
}

function getOrCreateContextMenu() {
    let menu = document.querySelector('#__youtube-timestamps__context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = '__youtube-timestamps__context-menu';
        menu.classList.add('ytp-popup');
        const panel = document.createElement('div');
        panel.classList.add('ytp-panel');
        menu.appendChild(panel);
        const menuContent = document.createElement('div');
        menuContent.classList.add('ytp-panel-menu');
        panel.appendChild(menuContent);
        menuContent.appendChild(menuItem("Open in New Tab", () => {
            window.open(`https://www.youtube.com/watch?v=${getVideoId()}&lc=${menu.dataset.commentId}`, '_blank');
        }));
        document.body.appendChild(menu);
    }
    return menu;
}

function menuItem(label, action) {
    const item = document.createElement('div');
    item.classList.add('ytp-menuitem');
    item.addEventListener('click', action);
    const labelEl = document.createElement('div');
    labelEl.classList.add('ytp-menuitem-label');
    labelEl.textContent = label;
    item.appendChild(labelEl);
    return item;
}

function getContextMenu() {
    return document.querySelector('#__youtube-timestamps__context-menu');
}

function isContextMenuVisible() {
    const menu = getContextMenu();
    return menu && !menu.style.display;
}

function hideContextMenu() {
    getContextMenu()?.style.setProperty('display', 'none');
}

function getOrCreatePopupContainer() {
    let cont = document.querySelector('.__youtube-timestamps__popup-container');
    if (!cont) {
        const player = document.querySelector('#movie_player');
        if (!player) return null;
        cont = document.createElement('div');
        cont.classList.add('__youtube-timestamps__popup-container');
        player.appendChild(cont);
    }
    return cont;
}

function createTimePopup(tc) {
    if (!tc.text || tc.text.length < 2) {
        return null;
    }

    const displayText = tc.text.length > 250 ? `${tc.text.substring(0, 247)}...` : tc.text;

    const popup = document.createElement('div');
    popup.className = '__youtube-timestamps__time-popup';

    const author = document.createElement('div');
    author.className = '__youtube-timestamps__popup-author';

    const avatar = document.createElement('img');
    avatar.src = tc.authorAvatar;
    avatar.className = '__youtube-timestamps__popup-avatar';

    const name = document.createElement('div');
    name.textContent = tc.authorName;
    name.className = '__youtube-timestamps__popup-name';

    const textEl = document.createElement('div');
    textEl.className = '__youtube-timestamps__popup-text';

    const timeSpan = document.createElement('span');
    timeSpan.className = '__youtube-timestamps__highlight-time';
    timeSpan.textContent = `[${tc.timestamp}] `;

    textEl.append(timeSpan, document.createTextNode(displayText));

    author.append(avatar, name);
    popup.append(author, textEl);
    return popup;
}

function manageTimePopups(timeComments, videoId) {
    const popupCont = getOrCreatePopupContainer();
    if (!popupCont) {
        return null;
    }
    const displayed = new Set();

    const check = () => {
        if (!isActiveVideo(videoId)) {
            return;
        }
        const video = getVideo();
        if (!video) {
            return;
        }
        const currentTime = Math.floor(video.currentTime);
        timeComments.forEach(tc => {
            const popupKey = `${tc.commentId}:${tc.time}`;
            if (tc.time === currentTime && !displayed.has(popupKey)) {
                const popup = createTimePopup(tc);
                if (popup) {
                    displayed.add(popupKey);
                    popupQueue.push(popup);
                    processPopupQueue(popupCont);
                }
            }
        });
    };
    const interval = setInterval(check, POPUP_CHECK_INTERVAL);
    return () => clearInterval(interval);
}

function processPopupQueue(container) {
    if (!container || popupQueue.length === 0) {
        return;
    }
    while (container.children.length >= MAX_VISIBLE_POPUPS) {
        container.firstChild?.remove();
    }
    const popup = popupQueue.shift();
    if (popup) {
        container.appendChild(popup);
        requestAnimationFrame(() => popup.classList.add('popup-visible'));
        const displayTime = Math.max(1500, BASE_POPUP_DISPLAY_TIME - Math.max(0, popupQueue.length - 2) * 500);
        setTimeout(() => {
            popup.classList.remove('popup-visible');
            popup.addEventListener('transitionend', () => popup.remove(), {
                once: true
            });
        }, displayTime);
    }
}

function initUiEventListeners() {
    document.addEventListener('click', e => {
        if (!e.target.closest('.__youtube-timestamps__stamp')) {
            hideContextMenu();
        }
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Alt' && hoveredTimeComment) {
            e.preventDefault();
            getVideo()?.pause();
            window.open(`https://www.youtube.com/watch?v=${currentVideoId}&lc=${hoveredTimeComment.commentId}`, '_blank');
        }
    });

    document.addEventListener('contextmenu', e => {
        if (!e.target.closest('.__youtube-timestamps__stamp')) {
            hideContextMenu();
        }
    }, true);
}
