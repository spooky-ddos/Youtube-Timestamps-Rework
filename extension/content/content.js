let initialized = false;
let isProcessing = false;
let currentRunId = 0;
let currentVideoId = null;
let contextMenuTimeComment = null;
let hoveredTimeComment = null;
let settings = {
    timelineMarkers: true,
    commentPopups: true,
    debug: false
};

const DEFAULT_SETTINGS = {
    timelineMarkers: true,
    commentPopups: true,
    debug: false
};

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'settingsChanged') {
        settings = { ...settings, ...message.settings };
        cleanupAndReset();
        main();
    } else if (message.type === 'cacheCleared' && message.videoId === getVideoId()) {
        yttLog('Cache wyczyszczony z popupu, ponowne pobieranie.');
        cleanupAndReset();
        main();
    }
});

chrome.storage.sync.get(DEFAULT_SETTINGS, result => {
    settings = result;
    if (!initialized) {
        initialized = true;
        initUiEventListeners();
        maybeCleanupCache();
        main();
    }
});

onLocationHrefChange(() => {
    cleanupAndReset();
    main();
});

function main() {
    const videoId = getVideoId();
    if (!videoId) return;

    const myRunId = ++currentRunId;

    if (videoId === currentVideoId && isProcessing) {
        return;
    }

    isProcessing = true;
    currentVideoId = videoId;
    yttLog(`Przetwarzanie wideo: ${videoId}`);

    loadVideoCache(videoId, (cachedData) => {
        if (myRunId !== currentRunId) return;

        const isFresh = cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION);

        if (isFresh) {
            yttLog('Wczytano dane z cache.');
            addTimeComments(cachedData.data);
            isProcessing = false;
        } else {
            yttLog('Pobieranie z sieci...');
            fetchTimeComments(videoId)
                .then(timeComments => {
                    if (myRunId !== currentRunId) return;
                    if (videoId !== getVideoId()) {
                        isProcessing = false;
                        return;
                    }

                    if (timeComments?.length > 0) {
                        saveVideoCache(videoId, timeComments);
                    }
                    addTimeComments(timeComments);
                    isProcessing = false;
                })
                .catch(() => {
                    if (myRunId === currentRunId) {
                        isProcessing = false;
                    }
                });
        }
    });
}

function cleanupAndReset() {
    cleanupUi();
    currentVideoId = null;
    isProcessing = false;
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
