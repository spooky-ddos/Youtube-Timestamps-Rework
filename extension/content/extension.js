let extensionContextDead = false;

function isExtensionContextValid() {
    if (extensionContextDead) {
        return false;
    }
    try {
        if (!chrome.runtime?.id) {
            extensionContextDead = true;
            return false;
        }
        return true;
    } catch {
        extensionContextDead = true;
        return false;
    }
}

function markExtensionContextInvalidated() {
    if (extensionContextDead) {
        return;
    }
    extensionContextDead = true;
    yttLog('Kontekst rozszerzenia wygasł — odśwież stronę (F5).');
}

function storageLocalGet(keys, callback) {
    if (!isExtensionContextValid()) {
        markExtensionContextInvalidated();
        callback({});
        return;
    }
    try {
        chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                markExtensionContextInvalidated();
                callback({});
                return;
            }
            callback(result);
        });
    } catch {
        markExtensionContextInvalidated();
        callback({});
    }
}

function storageLocalSet(items, callback) {
    if (!isExtensionContextValid()) {
        return;
    }
    try {
        chrome.storage.local.set(items, () => {
            if (chrome.runtime.lastError) {
                markExtensionContextInvalidated();
            }
            callback?.();
        });
    } catch {
        markExtensionContextInvalidated();
    }
}

function storageLocalRemove(keys, callback) {
    if (!isExtensionContextValid()) {
        return;
    }
    try {
        chrome.storage.local.remove(keys, () => {
            if (chrome.runtime.lastError) {
                markExtensionContextInvalidated();
            }
            callback?.();
        });
    } catch {
        markExtensionContextInvalidated();
    }
}

function storageSyncGet(defaults, callback) {
    if (!isExtensionContextValid()) {
        markExtensionContextInvalidated();
        callback(defaults);
        return;
    }
    try {
        chrome.storage.sync.get(defaults, (result) => {
            if (chrome.runtime.lastError) {
                markExtensionContextInvalidated();
                callback(defaults);
                return;
            }
            callback(result);
        });
    } catch {
        markExtensionContextInvalidated();
        callback(defaults);
    }
}

function sendExtensionMessage(message, callback) {
    if (!isExtensionContextValid()) {
        markExtensionContextInvalidated();
        callback?.(null);
        return;
    }
    try {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                markExtensionContextInvalidated();
                callback?.(null);
                return;
            }
            callback?.(response);
        });
    } catch {
        markExtensionContextInvalidated();
        callback?.(null);
    }
}
