const CACHE_DURATION = 1000 * 60 * 60;
const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
const CLEANUP_INTERVAL = 1000 * 60 * 60 * 24;
const CLEANUP_KEY = '__ytt_last_cleanup__';

function maybeCleanupCache() {
    chrome.storage.local.get([CLEANUP_KEY], (meta) => {
        const lastCleanup = meta[CLEANUP_KEY] || 0;
        if (Date.now() - lastCleanup < CLEANUP_INTERVAL) {
            return;
        }
        chrome.storage.local.get(null, (all) => {
            const now = Date.now();
            const keysToRemove = [];
            for (const key in all) {
                if (key === CLEANUP_KEY) continue;
                const entry = all[key];
                if (entry && entry.timestamp && (now - entry.timestamp > CACHE_MAX_AGE)) {
                    keysToRemove.push(key);
                }
            }
            const finalize = () => chrome.storage.local.set({ [CLEANUP_KEY]: now });
            if (keysToRemove.length > 0) {
                chrome.storage.local.remove(keysToRemove, () => {
                    yttLog(`Sprzątanie cache: usunięto ${keysToRemove.length} starych wpisów.`);
                    finalize();
                });
            } else {
                finalize();
            }
        });
    });
}

function saveVideoCache(videoId, timeComments) {
    chrome.storage.local.set({
        [videoId]: {
            data: timeComments,
            timestamp: Date.now()
        }
    });
}

function loadVideoCache(videoId, callback) {
    chrome.storage.local.get([videoId], (result) => callback(result[videoId]));
}
