let initialized = false;
let isProcessing = false;
let currentRunId = 0;
let currentVideoId = null;
let lastObservedVideoId = null;
let lastCompletedVideoId = null;
let mainScheduleTimer = null;
let navFallbackTimer = null;
const MAIN_DEBOUNCE_MS = 350;
const NAV_FALLBACK_MS = 3000;
let contextMenuTimeComment = null;
let hoveredTimeComment = null;
let settings = {
    timelineMarkers: true,
    commentPopups: true,
    statusIndicator: true,
    pauseWhileLoading: false,
    debug: false
};

const DEFAULT_SETTINGS = {
    timelineMarkers: true,
    commentPopups: true,
    statusIndicator: true,
    pauseWhileLoading: false,
    debug: false
};

function isActiveVideo(videoId) {
    return Boolean(videoId && videoId === getVideoId() && videoId === currentVideoId);
}

function isActiveRun(runId) {
    return runId === currentRunId;
}

chrome.runtime.onMessage.addListener((message) => {
    if (!isExtensionContextValid()) {
        return;
    }
    if (message.type === 'settingsChanged') {
        settings = { ...settings, ...message.settings };
        if (message.settings.statusIndicator === false) {
            hideStatusIndicator();
        }
        lastCompletedVideoId = null;
        cleanupAndReset();
        main(true);
    } else if (message.type === 'cacheCleared' && message.videoId === getVideoId()) {
        yttLog('Cache wyczyszczony z popupu, ponowne pobieranie.');
        lastCompletedVideoId = null;
        cleanupAndReset();
        main(true);
    }
});

storageSyncGet(DEFAULT_SETTINGS, result => {
    settings = result;
    if (!initialized) {
        initialized = true;
        initUiEventListeners();
        initNavigationListeners();
        lastObservedVideoId = getVideoId();
        maybeCleanupCache();
        scheduleMain();
    }
});

function scheduleMain() {
    clearTimeout(mainScheduleTimer);
    mainScheduleTimer = setTimeout(() => {
        mainScheduleTimer = null;
        main();
    }, MAIN_DEBOUNCE_MS);
}

function initNavigationListeners() {
    document.addEventListener('ytt-navigate-finish', () => {
        if (!getVideoId()) {
            return;
        }
        clearTimeout(navFallbackTimer);
        navFallbackTimer = null;
        yttLog('Nawigacja zakończona (yt-navigate-finish).');
        scheduleMain();
    });
}

onLocationHrefChange(() => {
    const videoId = getVideoId();
    if (videoId === lastObservedVideoId) {
        return;
    }
    lastObservedVideoId = videoId;

    if (!videoId) {
        cleanupAndReset();
        return;
    }

    lastCompletedVideoId = null;
    cleanupAndReset();

    clearTimeout(navFallbackTimer);
    navFallbackTimer = setTimeout(() => {
        navFallbackTimer = null;
        if (getVideoId() === videoId) {
            yttLog('Fallback nawigacji — uruchamianie main().');
            scheduleMain();
        }
    }, NAV_FALLBACK_MS);
});

function main(force = false) {
    const videoId = getVideoId();
    if (!videoId) return;

    if (!isExtensionContextValid()) {
        return;
    }

    if (!force && videoId === lastCompletedVideoId && !isProcessing) {
        return;
    }

    if (videoId === currentVideoId && isProcessing) {
        return;
    }

    const myRunId = ++currentRunId;

    isProcessing = true;
    currentVideoId = videoId;
    yttLog(`Przetwarzanie wideo: ${videoId}`);
    setStatusIndicator('detected', videoId);
    maybePauseForLoad(videoId);

    loadVideoCache(videoId, (cachedData) => {
        if (myRunId !== currentRunId) return;

        (async () => {
            try {
                await setStatusIndicator('checking', videoId);
                const isFresh = cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION);

                if (isFresh) {
                    if (!isActiveRun(myRunId) || !isActiveVideo(videoId)) {
                        abortLoad(videoId);
                        return;
                    }
                    yttLog('Wczytano dane z cache.');
                    await finishVideoProcessing(videoId, cachedData.data, 'cache', myRunId);
                } else {
                    yttLog('Pobieranie z sieci...');
                    await setStatusIndicator('fetching', videoId);
                    const timeComments = await fetchTimeComments(videoId);

                    if (!isActiveRun(myRunId) || !isActiveVideo(videoId)) {
                        abortLoad(videoId);
                        return;
                    }

                    if (timeComments?.length > 0) {
                        saveVideoCache(videoId, timeComments);
                    }
                    await finishVideoProcessing(videoId, timeComments || [], 'fetch', myRunId);
                }
            } catch {
                abortLoad(videoId);
            }
        })();
    });
}

async function finishVideoProcessing(videoId, timeComments, source, myRunId) {
    if (!isActiveRun(myRunId) || !isActiveVideo(videoId)) {
        abortLoad(videoId);
        return;
    }

    const count = timeComments.length;
    if (source === 'cache') {
        await setStatusIndicator('cache-hit', videoId, { count });
    }

    await setStatusIndicator('drawing', videoId);
    addTimeComments(timeComments, videoId);

    const doneStage = source === 'cache' ? 'done-cache' : 'done-fetch';
    await setStatusIndicator(doneStage, videoId, { count });

    maybeResumeAfterLoad(videoId);
    lastCompletedVideoId = videoId;
    isProcessing = false;
}

function abortLoad(videoId) {
    hideStatusIndicator();
    cancelPauseForLoad();
    isProcessing = false;
}

function cleanupAndReset() {
    cleanupUi();
    currentVideoId = null;
    isProcessing = false;
    currentRunId++;
}

function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v');
}

function getVideo() {
    return document.querySelector('#movie_player video');
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
