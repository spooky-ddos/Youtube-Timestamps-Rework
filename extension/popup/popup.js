document.addEventListener('DOMContentLoaded', async () => {
    const timelineMarkersCheckbox = document.getElementById('timelineMarkers');
    const commentPopupsCheckbox = document.getElementById('commentPopups');
    const statusIndicatorCheckbox = document.getElementById('statusIndicator');
    const pauseWhileLoadingCheckbox = document.getElementById('pauseWhileLoading');
    const debugCheckbox = document.getElementById('debug');
    const clearCacheButton = document.getElementById('clearCache');
    const versionEl = document.querySelector('.header-version');

    versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

    const settings = await chrome.storage.sync.get({
        timelineMarkers: true,
        commentPopups: true,
        statusIndicator: true,
        pauseWhileLoading: false,
        debug: false
    });

    timelineMarkersCheckbox.checked = settings.timelineMarkers;
    commentPopupsCheckbox.checked = settings.commentPopups;
    statusIndicatorCheckbox.checked = settings.statusIndicator;
    pauseWhileLoadingCheckbox.checked = settings.pauseWhileLoading;
    debugCheckbox.checked = settings.debug;

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    const videoId = getVideoIdFromUrl(activeTab?.url);
    clearCacheButton.disabled = !videoId;

    clearCacheButton.addEventListener('click', async () => {
        if (!videoId || clearCacheButton.disabled) {
            return;
        }
        await chrome.storage.local.remove(videoId);
        clearCacheButton.textContent = 'Wyczyszczono!';
        setTimeout(() => {
            clearCacheButton.textContent = 'Wyczyść cache tego filmu';
        }, 1500);
        if (activeTab?.id) {
            chrome.tabs.sendMessage(activeTab.id, {
                type: 'cacheCleared',
                videoId
            }).catch(() => {});
        }
    });

    timelineMarkersCheckbox.addEventListener('change', async () => {
        await saveSettingAndNotify(activeTab, {
            timelineMarkers: timelineMarkersCheckbox.checked
        });
    });

    commentPopupsCheckbox.addEventListener('change', async () => {
        await saveSettingAndNotify(activeTab, {
            commentPopups: commentPopupsCheckbox.checked
        });
    });

    statusIndicatorCheckbox.addEventListener('change', async () => {
        await saveSettingAndNotify(activeTab, {
            statusIndicator: statusIndicatorCheckbox.checked
        });
    });

    pauseWhileLoadingCheckbox.addEventListener('change', async () => {
        await saveSettingAndNotify(activeTab, {
            pauseWhileLoading: pauseWhileLoadingCheckbox.checked
        });
    });

    debugCheckbox.addEventListener('change', async () => {
        await saveSettingAndNotify(activeTab, {
            debug: debugCheckbox.checked
        });
    });
});

function getVideoIdFromUrl(url) {
    if (!url) {
        return null;
    }
    try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith('youtube.com')) {
            return null;
        }
        return parsed.searchParams.get('v');
    } catch {
        return null;
    }
}

async function saveSettingAndNotify(activeTab, settings) {
    await chrome.storage.sync.set(settings);
    if (activeTab?.id) {
        chrome.tabs.sendMessage(activeTab.id, {
            type: 'settingsChanged',
            settings
        }).catch(() => {});
    }
}
