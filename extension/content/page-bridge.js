document.addEventListener('ytt-request-page-data', () => {
    try {
        const ytcfg = window.ytcfg?.data_ ?? {};
        document.dispatchEvent(new CustomEvent('ytt-page-data', {
            detail: {
                data: window.ytInitialData || null,
                apiKey: ytcfg.INNERTUBE_API_KEY || null,
                clientVersion: ytcfg.INNERTUBE_CLIENT_VERSION || null,
                visitorData: ytcfg.VISITOR_DATA || null,
                hl: ytcfg.HL || null,
                gl: ytcfg.GL || null
            }
        }));
    } catch (e) {
        document.dispatchEvent(new CustomEvent('ytt-page-data', { detail: null }));
    }
});
