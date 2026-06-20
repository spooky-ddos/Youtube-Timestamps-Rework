function readPageDataDetail() {
    const data = window.ytInitialData || null;
    const ytcfg = window.ytcfg?.data_ ?? {};
    const playerVideoId = window.ytInitialPlayerResponse?.videoDetails?.videoId ?? null;
    const urlVideoId = new URLSearchParams(window.location.search).get('v');
    const dataVideoId = data?.currentVideoEndpoint?.watchEndpoint?.videoId
        ?? data?.microformat?.playerMicroformatRenderer?.externalVideoId
        ?? data?.playerResponse?.videoDetails?.videoId
        ?? null;

    // Przy SPA ytInitialData bywa nieaktualne — playerResponse i URL są wiarygodniejsze.
    const videoId = (playerVideoId && playerVideoId === urlVideoId ? playerVideoId : null)
        ?? (dataVideoId && dataVideoId === urlVideoId ? dataVideoId : null)
        ?? playerVideoId
        ?? dataVideoId
        ?? urlVideoId
        ?? null;

    return {
        data,
        videoId,
        playerVideoId,
        urlVideoId,
        apiKey: ytcfg.INNERTUBE_API_KEY || null,
        clientVersion: ytcfg.INNERTUBE_CLIENT_VERSION || null,
        visitorData: ytcfg.VISITOR_DATA || null,
        hl: ytcfg.HL || null,
        gl: ytcfg.GL || null
    };
}

document.addEventListener('ytt-request-page-data', () => {
    try {
        document.dispatchEvent(new CustomEvent('ytt-page-data', {
            detail: readPageDataDetail()
        }));
    } catch (e) {
        document.dispatchEvent(new CustomEvent('ytt-page-data', { detail: null }));
    }
});

document.addEventListener('yt-navigate-finish', () => {
    try {
        document.dispatchEvent(new CustomEvent('ytt-navigate-finish', {
            detail: readPageDataDetail()
        }));
    } catch (e) {
        document.dispatchEvent(new CustomEvent('ytt-navigate-finish', { detail: null }));
    }
});
