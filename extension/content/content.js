let initialized = false;
let isProcessing = false;
let currentVideoId = null;

let settings = {
    timelineMarkers: true,
    commentPopups: true
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'settingsChanged') {
        settings = { ...settings, ...message.settings };
        updateFeatures();
    }
});

function updateFeatures() {
    const bar = document.querySelector('.__youtube-timestamps__bar');
    if (bar) {
        bar.style.display = settings.timelineMarkers ? '' : 'none';
    }

    if (window.__youtube_timestamps_cleanup) {
        window.__youtube_timestamps_cleanup();
        window.__youtube_timestamps_cleanup = null;
    }

    if (settings.commentPopups) {
        const videoId = getVideoId();
        if (videoId) {
            fetchTimeComments(videoId)
                .then(timeComments => {
                    if (videoId === getVideoId()) {
                        const cleanup = manageTimePopups(timeComments);
                        window.__youtube_timestamps_cleanup = cleanup;
                    }
                });
        }
    }
}

chrome.storage.sync.get({
    timelineMarkers: true,
    commentPopups: true
}, result => {
    settings = result;
    if (!initialized) {
        initialized = true;
        main();
    }
});

const PREVIEW_BORDER_SIZE = 2
const PREVIEW_MARGIN = 8
const POPUP_DISPLAY_TIME = 5000; // czas wyświetlania popupu w ms
const POPUP_CHECK_INTERVAL = 1000; // częstotliwość sprawdzania czasu w ms
const MAX_VISIBLE_POPUPS = 5; // maksymalna liczba jednocześnie wyświetlanych popupów
let popupQueue = []; // kolejka oczekujących popupów

main()

onLocationHrefChange(() => {
    removeBar()
    removeContextMenu()
    main()
})

document.addEventListener('click', e => {
    const stamp = e.target.closest('.__youtube-timestamps__stamp')
    if (!stamp) {
        hideContextMenu()
    }
}, true)
document.addEventListener('contextmenu', e => {
    const stamp = e.target.closest('.__youtube-timestamps__stamp')
    if (!stamp) {
        hideContextMenu()
    }
}, true)

function log(message) {
    console.log(`[YTT] ${message}`);
}

function main() {
    if (isProcessing) {
        log('Already processing, skipping');
        return;
    }
    
    const videoId = getVideoId();
    if (!videoId) {
        log('No video ID found');
        return;
    }

    // Sprawdź czy to ten sam film
    if (videoId === currentVideoId) {
        log('Same video ID, skipping');
        return;
    }
    
    isProcessing = true;
    currentVideoId = videoId;
    
    log(`Processing video: ${videoId}`);
    
    // Wyczyść poprzedni stan
    removeBar();
    if (typeof window.__youtube_timestamps_cleanup === 'function') {
        window.__youtube_timestamps_cleanup();
        window.__youtube_timestamps_cleanup = null;
    }
    
    fetchTimeComments(videoId)
        .then(timeComments => {
            if (videoId !== getVideoId()) {
                log('Video ID changed, aborting');
                isProcessing = false;
                return;
            }
            addTimeComments(timeComments);
            isProcessing = false;
        })
        .catch(error => {
            log(`Error in main process: ${error}`);
            isProcessing = false;
        });
}

function getVideoId() {
    if (window.location.pathname === '/watch') {
        return parseParams(window.location.href)['v']
    } else if (window.location.pathname.startsWith('/embed/')) {
        return window.location.pathname.substring('/embed/'.length)
    } else {
        return null
    }
}

function getVideo() {
    return document.querySelector('#movie_player video')
}

function fetchTimeComments(videoId) {
    log(`Fetching comments for video: ${videoId}`);
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({type: 'fetchTimeComments', videoId}, (response) => {
            log(`Received ${response?.length || 0} time comments`);
            resolve(response);
        });
    });
}

function addTimeComments(timeComments) {
    if (!timeComments || timeComments.length === 0) {
        log('No time comments to process');
        return;
    }

    log(`Processing ${timeComments.length} comments`);
    
    if (typeof window.__youtube_timestamps_cleanup === 'function') {
        window.__youtube_timestamps_cleanup();
        window.__youtube_timestamps_cleanup = null;
    }

    let markersAdded = false;
    let popupsInitialized = false;

    if (settings.timelineMarkers && !markersAdded) {
        const bar = getOrCreateBar();
        const video = getVideo();
        if (!video) {
            log('Video element not found');
            return;
        }
        const videoDuration = video.duration;
        log(`Video duration: ${videoDuration}`);
        
        let addedMarkers = 0;
        
        for (const tc of timeComments) {
            if (tc.time > videoDuration) continue;
            const stamp = document.createElement('div')
            stamp.classList.add('__youtube-timestamps__stamp')
            const offset = tc.time / videoDuration * 100
            stamp.style.left = `calc(${offset}% - 2px)`
            bar.appendChild(stamp)
            stamp.addEventListener('mouseenter', () => {
                showPreview(tc)
            })
            stamp.addEventListener('mouseleave', () => {
                hidePreview()
            })
            stamp.addEventListener('wheel', withWheelThrottle((deltaY) => {
                const preview = getOrCreatePreview()
                if (preview) {
                    preview.scrollBy(0, deltaY)
                }
            }))
            stamp.addEventListener('contextmenu', e => {
                e.preventDefault()
                e.stopPropagation()
                if (tc === contextMenuTimeComment && isContextMenuVisible()) {
                    hideContextMenu()
                } else {
                    showContextMenu(tc, e.pageX, e.pageY)
                    contextMenuTimeComment = tc
                }
            })
            addedMarkers++;
        }
        
        log(`Added ${addedMarkers} timeline markers`);
        markersAdded = true;
    }

    if (settings.commentPopups && !popupsInitialized) {
        setTimeout(() => {
            const cleanup = manageTimePopups(timeComments);
            if (cleanup) {
                window.__youtube_timestamps_cleanup = cleanup;
                log('Popup manager initialized');
                popupsInitialized = true;
            }
        }, 1000);
    }
}

function getOrCreateBar() {
    let bar = document.querySelector('.__youtube-timestamps__bar')
    if (!bar) {
        let container = document.querySelector('#movie_player .ytp-timed-markers-container')
        if (!container) {
            container = document.querySelector('#movie_player .ytp-progress-list')
        }
        bar = document.createElement('div')
        bar.classList.add('__youtube-timestamps__bar')
        container.appendChild(bar)
    }
    return bar
}

function removeBar() {
    const bar = document.querySelector('.__youtube-timestamps__bar')
    if (bar) {
        bar.remove()
    }
    
    // Wywołaj cleanup jeśli istnieje
    if (window.__youtube_timestamps_cleanup) {
        window.__youtube_timestamps_cleanup();
        window.__youtube_timestamps_cleanup = null;
    }
}

function getTooltip() {
    return document.querySelector('#movie_player .ytp-tooltip')
}

function showPreview(timeComment) {
    const tooltip = getTooltip()
    const preview = getOrCreatePreview()
    preview.style.display = ''
    preview.querySelector('.__youtube-timestamps__preview__avatar').src = timeComment.authorAvatar
    preview.querySelector('.__youtube-timestamps__preview__name').textContent = timeComment.authorName
    const textNode = preview.querySelector('.__youtube-timestamps__preview__text')
    textNode.innerHTML = ''
    textNode.appendChild(highlightTextFragment(timeComment.text, timeComment.timestamp))

    const tooltipBgWidth = tooltip.querySelector('.ytp-tooltip-bg').style.width
    const previewWidth = tooltipBgWidth.endsWith('px') ? parseFloat(tooltipBgWidth) : 160
    preview.style.width = (previewWidth + 2*PREVIEW_BORDER_SIZE) + 'px'

    const halfPreviewWidth = previewWidth / 2
    const playerRect = document.querySelector('#movie_player .ytp-progress-bar').getBoundingClientRect()
    const pivot = preview.parentElement.getBoundingClientRect().left
    const minPivot = playerRect.left + halfPreviewWidth
    const maxPivot = playerRect.right - halfPreviewWidth
    let previewLeft
    if (pivot < minPivot) {
        previewLeft = playerRect.left - pivot
    } else if (pivot > maxPivot) {
        previewLeft = -previewWidth + (playerRect.right - pivot)
    } else {
        previewLeft = -halfPreviewWidth
    }
    preview.style.left = (previewLeft - PREVIEW_BORDER_SIZE) + 'px'

    const textAboveVideoPreview = tooltip.querySelector('.ytp-tooltip-edu')
    if (textAboveVideoPreview) {
        preview.style.bottom = (10 + textAboveVideoPreview.clientHeight) + 'px'
    }

    const tooltipTop = tooltip.style.top
    if (tooltipTop.endsWith('px')) {
        let previewHeight = parseFloat(tooltipTop) - 2*PREVIEW_MARGIN
        if (textAboveVideoPreview) {
            previewHeight -= textAboveVideoPreview.clientHeight
        }
        if (previewHeight > 0) {
            preview.style.maxHeight = previewHeight + 'px'
        }
    }

    const highlightedTextFragment = preview.querySelector('.__youtube-timestamps__preview__text-stamp')
    highlightedTextFragment.scrollIntoView({block: 'nearest'})
}

function getOrCreatePreview() {
    const tooltip = getTooltip()
    let preview = tooltip.querySelector('.__youtube-timestamps__preview')
    if (!preview) {
        preview = document.createElement('div')
        preview.classList.add('__youtube-timestamps__preview')
        const previewWrapper = document.createElement('div')
        previewWrapper.classList.add('__youtube-timestamps__preview-wrapper')
        previewWrapper.appendChild(preview)
        tooltip.insertAdjacentElement('afterbegin', previewWrapper)

        const authorElement = document.createElement('div')
        authorElement.classList.add('__youtube-timestamps__preview__author')
        preview.appendChild(authorElement)

        const avatarElement = document.createElement('img')
        avatarElement.classList.add('__youtube-timestamps__preview__avatar')
        authorElement.appendChild(avatarElement)

        const nameElement = document.createElement('span')
        nameElement.classList.add('__youtube-timestamps__preview__name')
        authorElement.appendChild(nameElement)

        const textElement = document.createElement('div')
        textElement.classList.add('__youtube-timestamps__preview__text')
        preview.appendChild(textElement)
    }
    return preview
}

function highlightTextFragment(text, fragment) {
    const result = document.createDocumentFragment()
    const parts = text.split(fragment)
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (part) {
            result.appendChild(document.createTextNode(part))
        }
        if (i < parts.length - 1) {
            const fragmentNode = document.createElement('span')
            fragmentNode.classList.add('__youtube-timestamps__preview__text-stamp')
            fragmentNode.textContent = fragment
            result.appendChild(fragmentNode)
        }
    }
    return result
}

function hidePreview() {
    const preview = document.querySelector('.__youtube-timestamps__preview')
    if (preview) {
        preview.style.display = 'none'
    }
}

function parseParams(href) {
    const noHash = href.split('#')[0]
    const paramString = noHash.split('?')[1]
    const params = {}
    if (paramString) {
        const paramsArray = paramString.split('&')
        for (const kv of paramsArray) {
            const tmparr = kv.split('=')
            params[tmparr[0]] = tmparr[1]
        }
    }
    return params
}

function withWheelThrottle(callback) {
    let deltaYAcc = 0
    let afRequested = false
    return (e) => {
        e.preventDefault()

        deltaYAcc += e.deltaY

        if (afRequested) {
            return
        }
        afRequested = true

        window.requestAnimationFrame(() => {
            callback(deltaYAcc)

            deltaYAcc = 0
            afRequested = false
        })
    }
}

function onLocationHrefChange(callback) {
    let currentHref = document.location.href;
    let isProcessing = false;
    
    const observer = new MutationObserver(() => {
        if (currentHref !== document.location.href && !isProcessing) {
            isProcessing = true;
            currentHref = document.location.href;
            callback();
            isProcessing = false;
        }
    });
    
    observer.observe(document.querySelector("body"), {childList: true, subtree: true});
}

function showContextMenu(timeComment, x, y) {
    const contextMenu = getOrCreateContextMenu()
    contextMenu.style.display = ''
    adjustContextMenuSizeAndPosition(contextMenu, x, y)
    fillContextMenuData(contextMenu, timeComment)
}

function fillContextMenuData(contextMenu, timeComment) {
    contextMenu.dataset.commentId = timeComment.commentId
}

function adjustContextMenuSizeAndPosition(contextMenu, x, y) {
    const menuHeight = contextMenu.querySelector('.ytp-panel-menu').clientHeight
    contextMenu.style.height = menuHeight + 'px'
    contextMenu.style.top = (y - menuHeight) + 'px'
    contextMenu.style.left = x + 'px'
}

function getOrCreateContextMenu() {
    let contextMenu = getContextMenu()
    if (!contextMenu) {
        contextMenu = document.createElement('div')
        contextMenu.id = '__youtube-timestamps__context-menu'
        contextMenu.classList.add('ytp-popup')
        document.body.appendChild(contextMenu)

        const panelElement = document.createElement('div')
        panelElement.classList.add('ytp-panel')
        contextMenu.appendChild(panelElement)

        const menuElement = document.createElement('div')
        menuElement.classList.add('ytp-panel-menu')
        panelElement.appendChild(menuElement)

        menuElement.appendChild(menuItemElement("Open in New Tab", () => {
            const videoId = getVideoId()
            const commentId = contextMenu.dataset.commentId
            window.open(`https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`, '_blank')
        }))
    }
    return contextMenu
}

function menuItemElement(label, callback) {
    const itemElement = document.createElement('div')
    itemElement.classList.add('ytp-menuitem')
    itemElement.addEventListener('click', callback)

    const iconElement = document.createElement('div')
    iconElement.classList.add('ytp-menuitem-icon')
    itemElement.appendChild(iconElement)

    const labelElement = document.createElement('div')
    labelElement.classList.add('ytp-menuitem-label')
    labelElement.textContent = label
    itemElement.appendChild(labelElement)

    return itemElement
}

function getContextMenu() {
    return document.querySelector('#__youtube-timestamps__context-menu')
}

function isContextMenuVisible() {
    const contextMenu = getContextMenu()
    return contextMenu && !contextMenu.style.display
}

function hideContextMenu() {
    const contextMenu = getContextMenu()
    if (contextMenu) {
        contextMenu.style.display = 'none'
    }
}

function removeContextMenu() {
    const contextMenu = getContextMenu()
    if (contextMenu) {
        contextMenu.remove()
    }
}

function logError(functionName, error) {
    console.error(`[YouTube Timestamps] Error in ${functionName}:`, error);
}

function waitForPlayer() {
    return new Promise((resolve) => {
        const check = () => {
            const player = document.querySelector('.ytd-player') || document.querySelector('#movie_player');
            if (player) {
                resolve(player);
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });
}

function getOrCreatePopupContainer() {
    let container = document.querySelector('.__youtube-timestamps__popup-container');
    if (!container) {
        const playerContainer = document.querySelector('#movie_player');
        if (!playerContainer) {
            log('Player container not found');
            return null;
        }
        
        container = document.createElement('div');
        container.classList.add('__youtube-timestamps__popup-container');
        playerContainer.appendChild(container);
        log('Created new popup container');
    }
    return container;
}

function createTimePopup(timeComment) {
    try {
        // Funkcja do wyodrębniania fragmentów tekstu dla konkretnego czasu
        function extractRelevantTextPart(text, timestamp) {
            // Znajdź wszystkie timestampy w tekście
            const timeRegex = /(?:^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2}|\d+:\d{2}|\d+:\d{1}|\d+\s*(?::|sekund|minut|min|s))/g;
            const matches = [...text.matchAll(timeRegex)];
            
            if (matches.length <= 1) {
                // Jeśli jest tylko jeden timestamp, zastosuj limit 250 znaków
                if (text.length > 250) {
                    return text.substring(0, 247) + '...';
                }
                return text;
            }

            // Znajdź indeks bieżącego timestampa
            const currentIndex = matches.findIndex(match => match[1].includes(timestamp));
            if (currentIndex === -1) return text;

            // Określ granice fragmentu tekstu
            const start = matches[currentIndex].index;
            const end = currentIndex < matches.length - 1 
                ? matches[currentIndex + 1].index 
                : text.length;

            // Wytnij odpowiedni fragment
            let relevantText = text.substring(start, end).trim();

            // Jeśli wycięty fragment jest dłuższy niż 250 znaków, skróć go
            if (relevantText.length > 250) {
                relevantText = relevantText.substring(0, 247) + '...';
            }

            return relevantText;
        }

        const popup = document.createElement('div');
        popup.classList.add('__youtube-timestamps__time-popup');
        
        const author = document.createElement('div');
        author.classList.add('__youtube-timestamps__popup-author');
        
        const avatar = document.createElement('img');
        avatar.classList.add('__youtube-timestamps__popup-avatar');
        avatar.src = timeComment.authorAvatar;
        
        const name = document.createElement('div');
        name.classList.add('__youtube-timestamps__popup-name');
        name.textContent = timeComment.authorName;
        
        const text = document.createElement('div');
        text.classList.add('__youtube-timestamps__popup-text');

        // Wyodrębnij odpowiedni fragment tekstu
        const relevantText = extractRelevantTextPart(timeComment.text, timeComment.timestamp);
        text.appendChild(highlightTextFragment(relevantText, timeComment.timestamp));
        
        author.appendChild(avatar);
        author.appendChild(name);
        popup.appendChild(author);
        popup.appendChild(text);
        
        log(`Created popup for timestamp: ${timeComment.timestamp}`);
        return popup;
    } catch (error) {
        log(`Error creating popup: ${error}`);
        return null;
    }
}

async function manageTimePopups(timeComments) {
    if (!Array.isArray(timeComments) || timeComments.length === 0) {
        log('No time comments for popups');
        return null;
    }

    const popupContainer = getOrCreatePopupContainer();
    if (!popupContainer) {
        log('Failed to create popup container');
        return null;
    }

    const displayedComments = new Map();
    
    const checkTime = () => {
        try {
            const video = getVideo();
            if (!video) return;

            const currentTime = Math.floor(video.currentTime);
            
            timeComments.forEach(tc => {
                if (tc.time === currentTime && !displayedComments.has(tc.commentId)) {
                    const popup = createTimePopup(tc);
                    if (popup) {
                        displayedComments.set(tc.commentId, true);
                        popupQueue.push({ comment: tc, popup });
                        log(`Added popup to queue for timestamp: ${tc.timestamp}`);
                        processPopupQueue(popupContainer);
                    }
                }
            });
        } catch (error) {
            log(`Error in checkTime: ${error}`);
        }
    };

    const intervalId = setInterval(checkTime, POPUP_CHECK_INTERVAL);
    
    return function cleanup() {
        log('Cleaning up time popups');
        clearInterval(intervalId);
        displayedComments.clear();
        popupQueue = [];
        if (popupContainer && popupContainer.parentNode) {
            popupContainer.remove();
        }
    };
}

function processPopupQueue(container) {
    if (!container || !(container instanceof Element)) {
        log('Invalid container in processPopupQueue');
        return;
    }

    // Sprawdź aktualną liczbę widocznych popupów
    const visiblePopups = container.children.length;
    log(`Current visible popups: ${visiblePopups}`);
    
    // Dodaj nowe popupy z kolejki
    while (popupQueue.length > 0 && visiblePopups < MAX_VISIBLE_POPUPS) {
        const { comment, popup } = popupQueue.shift();
        if (popup) {
            container.appendChild(popup);
            log(`Displayed popup for timestamp: ${comment.timestamp}`);

            // Ustaw timeout do usunięcia popupu
            setTimeout(() => {
                popup.classList.add('__youtube-timestamps__time-popup--fade-out');
                setTimeout(() => {
                    if (popup.parentNode === container) {
                        popup.remove();
                        log(`Removed popup for timestamp: ${comment.timestamp}`);
                        processPopupQueue(container);
                    }
                }, 500);
            }, POPUP_DISPLAY_TIME);
        }
    }
}
