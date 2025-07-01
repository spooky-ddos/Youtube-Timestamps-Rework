document.addEventListener('DOMContentLoaded', async () => {
    const timelineMarkersCheckbox = document.getElementById('timelineMarkers');
    const commentPopupsCheckbox = document.getElementById('commentPopups');

    // Wczytaj zapisane ustawienia
    const settings = await chrome.storage.sync.get({
        timelineMarkers: true,
        commentPopups: true
    });

    timelineMarkersCheckbox.checked = settings.timelineMarkers;
    commentPopupsCheckbox.checked = settings.commentPopups;

    // Zapisz zmiany ustawień
    timelineMarkersCheckbox.addEventListener('change', async () => {
        await chrome.storage.sync.set({
            timelineMarkers: timelineMarkersCheckbox.checked
        });
        // Powiadom content script o zmianie
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        chrome.tabs.sendMessage(tabs[0].id, {
            type: 'settingsChanged',
            settings: {
                timelineMarkers: timelineMarkersCheckbox.checked
            }
        });
    });

    commentPopupsCheckbox.addEventListener('change', async () => {
        await chrome.storage.sync.set({
            commentPopups: commentPopupsCheckbox.checked
        });
        // Powiadom content script o zmianie
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        chrome.tabs.sendMessage(tabs[0].id, {
            type: 'settingsChanged',
            settings: {
                commentPopups: commentPopupsCheckbox.checked
            }
        });
    });
}); 