// --- ZMIENNE GLOBALNE I USTAWIENIA ---
let initialized = false;
let isProcessing = false;
let currentRunId = 0;
let currentVideoId = null;
let contextMenuTimeComment = null;
let hoveredTimeComment = null;
let settings = {
    timelineMarkers: true,
    commentPopups: true
};

// --- GŁÓWNA LOGIKA INICJALIZACJI ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'settingsChanged') {
        settings = { ...settings, ...message.settings };
        cleanupAndReset(false);
        main();
    }
});

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

onLocationHrefChange(() => {
    log('Wykryto zmianę URL, resetowanie rozszerzenia...');
    cleanupAndReset(true);
    main();
});

// --- GŁÓWNE FUNKCJE STERUJĄCE ---

const CACHE_DURATION = 1000 * 60 * 60; // 1 godzina w milisekundach

function main() {
    const videoId = getVideoId();
    if (!videoId) return;

    const myRunId = ++currentRunId;
    
    if (videoId === currentVideoId && isProcessing) {
        return;
    }
    
    isProcessing = true;
    currentVideoId = videoId;
    log(`[RunID: ${myRunId}] Przetwarzanie wideo: ${videoId}`);

    // 1. Sprawdź chrome.storage.local
    chrome.storage.local.get([videoId], (result) => {
        // Ponowne sprawdzenie RunID (bo .get jest asynchroniczne)
        if (myRunId !== currentRunId) return;

        const cachedData = result[videoId];
        const isFresh = cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION);

        if (isFresh) {
            log("Znaleziono świeże dane w pamięci trwałej (storage).");
            addTimeComments(cachedData.data);
            isProcessing = false;
        } else {
            log("Brak danych w storage lub są przestarzałe. Pobieranie z sieci...");
            
            fetchTimeComments(videoId)
                .then(timeComments => {
                    if (myRunId !== currentRunId) return;
                    if (videoId !== getVideoId()) {
                        isProcessing = false;
                        return;
                    }

                    // 2. Zapisz do chrome.storage.local
                    // Zapisujemy: dane + aktualny czas (żeby wiedzieć kiedy wygasnąć)
                    chrome.storage.local.set({
                        [videoId]: {
                            data: timeComments,
                            timestamp: Date.now()
                        }
                    });

                    log("Komentarze pobrane i zapisane w storage.");
                    addTimeComments(timeComments);
                    isProcessing = false;
                })
                .catch(error => {
                    if (myRunId === currentRunId) {
                        log(`Błąd w głównym procesie: ${error}`);
                        isProcessing = false;
                    }
                });
        }
    });
}

function cleanupAndReset(fullReset = false) {
    log(`Czyszczenie stanu... (Pełny reset: ${fullReset})`);
    document.querySelector('.__youtube-timestamps__bar')?.remove();
    document.querySelector('.__youtube-timestamps__popup-container')?.remove();
    popupQueue = [];
    if (typeof window.__youtube_timestamps_cleanup === 'function') {
        window.__youtube_timestamps_cleanup();
    }
    window.__youtube_timestamps_cleanup = null;
    currentVideoId = null;
    isProcessing = false;
}

// --- FUNKCJE DODAJĄCE ELEMENTY NA STRONIE ---

function addTimeComments(timeComments, attempt = 1) {
    if (!timeComments || timeComments.length === 0) {
        log('Brak komentarzy z czasem do przetworzenia.');
        return;
    }
    
    const video = getVideo();
    // Jeśli nie ma video, próbujemy częściej, ale krótko
    if (!video) {
        if (attempt < 10) {
            setTimeout(() => addTimeComments(timeComments, attempt + 1), 200);
        }
        return;
    }

    // --- LOGIKA KOREKCYJNA (SMART RETRY) ---
    // Nawet jeśli mamy video, YouTube może podawać starą długość przez chwilę.
    // Planujemy poprawki, żeby upewnić się, że znaczniki są na dobrym miejscu.
    if (attempt <= 3) {
        const delay = attempt === 1 ? 500 : 1000; // 500ms za pierwszym razem, potem 1000ms
        log(`[Attempt ${attempt}] Planuję korektę za ${delay}ms...`);
        setTimeout(() => {
            // Sprawdzamy, czy nadal jesteśmy na tym samym filmie przed przerysowaniem
            if (currentVideoId === getVideoId()) {
                addTimeComments(timeComments, attempt + 1);
            }
        }, delay);
    }
    // ---------------------------------------

    const videoDuration = video.duration;
    // Zabezpieczenie: jeśli duration jest zepsute (NaN lub 0), nie rysujemy teraz, 
    // ale mechanizm 'attempt' i tak spróbuje ponownie za chwilę.
    if (Number.isNaN(videoDuration) || videoDuration <= 0) {
        log('Duration nieznane, czekam na kolejną próbę...');
        return;
    }

    // --- RYSOWANIE (Bez zmian logicznych, tylko czyszczenie) ---

    log(`[Attempt ${attempt}] Rysowanie znaczników dla duration: ${videoDuration}`);
    
    // Obliczanie heatmapy (bez zmian)
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

    if (settings.timelineMarkers) {
        const bar = getOrCreateBar();
        // Czyścimy pasek, żeby przy "korekcie" nie dublować znaczników
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
            
            // Wheel event
            stamp.addEventListener('wheel', withWheelThrottle((e) => {
                const preview = getOrCreatePreview();
                if (preview) {
                    preview.scrollBy(0, e.deltaY);
                }
            }));
            
            // Context menu
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

    // Popup manager restartujemy tylko przy pierwszej próbie, 
    // żeby nie tworzyć wielu interwałów sprawdzających czas.
    if (attempt === 1 && settings.commentPopups) {
        // Jeśli istniał stary cleanup, wywołaj go (bezpiecznik)
        if (typeof window.__youtube_timestamps_cleanup === 'function') {
            window.__youtube_timestamps_cleanup();
        }
        const cleanupFunc = manageTimePopups(timeComments);
        window.__youtube_timestamps_cleanup = cleanupFunc;
    }
}

function getOrCreateBar() {
    let bar = document.querySelector('.__youtube-timestamps__bar');
    if (!bar) {
        // ZMIANA: Szukamy głównego paska postępu, a nie kontenera rozdziałów.
        // Dzięki temu pasek zawsze ma 100% szerokości filmu.
        const container = document.querySelector('#movie_player .ytp-progress-bar');
        
        if (container) {
            bar = document.createElement('div');
            bar.classList.add('__youtube-timestamps__bar');
            
            // Wstawiamy jako pierwsze dziecko, żeby było "pod" suwakiem (scrubberem)
            // ale nad tłem paska.
            container.insertBefore(bar, container.firstChild);
        }
    }
    return bar;
}

// --- POZOSTAŁE FUNKCJE POMOCNICZE ---

document.addEventListener('click', e => {
    const stamp = e.target.closest('.__youtube-timestamps__stamp');
    if (!stamp) {
        hideContextMenu();
    }
}, true);

// --- OBSŁUGA KLAWISZA ALT (NOWA FUNKCJA) ---
document.addEventListener('keydown', (e) => {
    // Sprawdzamy czy wciśnięto lewy lub prawy ALT (key: "Alt")
    // I czy myszka znajduje się nad jakimś znacznikiem
    if (e.key === 'Alt' && hoveredTimeComment) {
        e.preventDefault(); // Zapobiega otwarciu menu przeglądarki
        
        // 1. Pauza filmu
        const video = getVideo();
        if (video) video.pause();

        // 2. Otwarcie w nowej karcie
        const link = `https://www.youtube.com/watch?v=${currentVideoId}&lc=${hoveredTimeComment.commentId}`;
        window.open(link, '_blank');
    }
});

document.addEventListener('contextmenu', e => {
    const stamp = e.target.closest('.__youtube-timestamps__stamp');
    if (!stamp) {
        hideContextMenu();
    }
}, true);

function fetchTimeComments(videoId) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            type: 'fetchTimeComments',
            videoId
        }, (response) => {
            resolve(response || []);
        });
    });
}

function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v');
}

function getVideo() {
    return document.querySelector('#movie_player video');
}

function log(message) {
    console.log(`[YTT] ${message}`);
}

function onLocationHrefChange(callback) {
    let currentHref = location.href;
    const observer = new MutationObserver(() => {
        if (currentHref !== location.href) {
            currentHref = location.href;
            callback();
        }
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

const PREVIEW_BORDER_SIZE = 2;
const PREVIEW_MARGIN = 8;
const BASE_POPUP_DISPLAY_TIME = 5000;
const POPUP_CHECK_INTERVAL = 500;
const MAX_VISIBLE_POPUPS = 5;
let popupQueue = [];

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

    const highlightedTextFragment = preview.querySelector('.__youtube-timestamps__preview__text-stamp');
    if (highlightedTextFragment) {
        highlightedTextFragment.scrollIntoView({
            block: 'nearest'
        });
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

function highlightTextFragment(text, fragment) {
    const result = document.createDocumentFragment();
    text.split(fragment).forEach((part, i, arr) => {
        if (part) {
            result.appendChild(document.createTextNode(part));
        }
        if (i < arr.length - 1) {
            const span = document.createElement('span');
            span.classList.add('__youtube-timestamps__preview__text-stamp');
            span.textContent = fragment;
            result.appendChild(span);
        }
    });
    return result;
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

function removeContextMenu() {
    getContextMenu()?.remove();
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
    
    // Przycinanie tekstu jeśli za długi
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
    
    // NOWE: Dodajemy timestamp na początku
    // Tworzymy span dla czasu
    const timeSpan = document.createElement('span');
    timeSpan.className = '__youtube-timestamps__highlight-time';
    timeSpan.textContent = `[${tc.timestamp}] `; // Dodaj spację po
    
    // Tworzymy węzeł tekstu dla reszty
    const textNode = document.createTextNode(displayText);
    
    textEl.appendChild(timeSpan);
    textEl.appendChild(textNode);

    author.append(avatar, name);
    popup.append(author, textEl);
    return popup;
}

function manageTimePopups(timeComments) {
    const popupCont = getOrCreatePopupContainer();
    if (!popupCont) {
        return null;
    }
    const displayed = new Set();

    const check = () => {
        const video = getVideo();
        if (!video) {
            return;
        }
        const currentTime = Math.floor(video.currentTime);
        timeComments.forEach(tc => {
            if (tc.time === currentTime && !displayed.has(tc.commentId)) {
                const popup = createTimePopup(tc);
                if (popup) {
                    displayed.add(tc.commentId);
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