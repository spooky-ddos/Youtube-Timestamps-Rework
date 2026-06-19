function yttLog(...args) {
    if (typeof settings !== 'undefined' && settings.debug) {
        console.log('[YTT]', ...args);
    }
}
