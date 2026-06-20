const DEFAULT_INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const DEFAULT_INNERTUBE_CLIENT_VERSION = "2.20241201.00.00";
const INNERTUBE_CLIENT_NAME = "WEB";
const BOOTSTRAP_RETRY_INTERVAL_MS = 2000;
const MAX_BOOTSTRAP_RETRIES = 3;
const MAX_COMMENT_PAGES = 500;

function getVideoIdFromInitialData(data) {
    if (!data) {
        return null;
    }
    return data.currentVideoEndpoint?.watchEndpoint?.videoId
        ?? data.microformat?.playerMicroformatRenderer?.externalVideoId
        ?? data.playerResponse?.videoDetails?.videoId
        ?? null;
}

function initialDataMatchesVideo(page, videoId) {
    if (!page || getVideoId() !== videoId) {
        return false;
    }
    if (page.playerVideoId === videoId) {
        return true;
    }
    if (page.videoId === videoId) {
        return true;
    }
    return getVideoIdFromInitialData(page.data) === videoId;
}

async function fetchTimeComments(videoId) {
    const comments = await fetchRawComments(videoId);
    const timeComments = await parseTimeCommentsViaBackground(comments);
    yttLog(`Po parsowaniu: ${timeComments.length} znaczników czasu z ${comments.length} komentarzy głównych.`);
    return timeComments;
}

function parseTimeCommentsViaBackground(comments) {
    return new Promise((resolve) => {
        sendExtensionMessage({
            type: 'parseTimeComments',
            comments
        }, (response) => {
            resolve(response || []);
        });
    });
}

async function fetchRawComments(videoId) {
    try {
        const page = await getYouTubePageData();
        if (!page?.apiKey) {
            yttLog('Brak konfiguracji InnerTube (ytcfg).');
            return [];
        }

        const resolved = await resolveCommentsToken(videoId, page);
        if (!resolved?.token) {
            yttLog('Brak tokenu komentarzy.');
            return [];
        }

        return await paginateComments(
            resolved.token,
            videoId,
            resolved.page || page,
            resolved.bootstrapResponse
        );
    } catch (error) {
        console.error('[YTT] Nie udało się pobrać komentarzy dla wideo:', videoId, error);
        return [];
    }
}

async function resolveCommentsToken(videoId, page) {
    if (initialDataMatchesVideo(page, videoId) && page.data) {
        const token = commentsContinuationToken(page.data);
        if (token) {
            yttLog('Token komentarzy z ytInitialData.');
            return { token };
        }
    }

    const bootstrapResponse = await bootstrapCommentsViaApi(videoId, page);
    let token = commentsContinuationToken(bootstrapResponse);
    if (token) {
        yttLog('Token komentarzy z InnerTube /next (bootstrap).');
        return { token, bootstrapResponse };
    }

    yttLog('Oczekiwanie na dane komentarzy (SPA)...');
    let scrolledToComments = false;

    for (let attempt = 0; attempt < MAX_BOOTSTRAP_RETRIES; attempt++) {
        if (getVideoId() !== videoId) {
            return null;
        }

        if (!scrolledToComments) {
            const commentsSection = document.querySelector('#comments, ytd-comments#comments');
            if (commentsSection) {
                commentsSection.scrollIntoView({ behavior: 'instant', block: 'start' });
                scrolledToComments = true;
            }
        }

        await new Promise(resolve => setTimeout(resolve, BOOTSTRAP_RETRY_INTERVAL_MS));

        if (getVideoId() !== videoId) {
            return null;
        }

        const freshPage = await getYouTubePageData();
        if (initialDataMatchesVideo(freshPage, videoId) && freshPage?.data) {
            token = commentsContinuationToken(freshPage.data);
            if (token) {
                yttLog('Token komentarzy z ytInitialData (po oczekiwaniu).');
                return { token, page: freshPage };
            }
        }

        const retryResponse = await bootstrapCommentsViaApi(videoId, freshPage || page);
        token = commentsContinuationToken(retryResponse);
        if (token) {
            yttLog('Token komentarzy z InnerTube /next (ponowna próba).');
            return { token, bootstrapResponse: retryResponse, page: freshPage || page };
        }
    }

    return null;
}

async function bootstrapCommentsViaApi(videoId, page) {
    return innertubeNext({
        videoId,
        racyCheckOk: true,
        contentCheckOk: true
    }, page);
}

async function paginateComments(initialToken, videoId, page, bootstrapResponse = null) {
    const comments = [];
    const seenIds = new Set();
    let token = initialToken;
    let prevToken;
    let pageCount = 0;

    function addPageComments(commentsResponse) {
        for (const comment of extractCommentsFromResponse(commentsResponse)) {
            if (!seenIds.has(comment.commentId)) {
                seenIds.add(comment.commentId);
                comments.push(comment);
            }
        }
    }

    if (bootstrapResponse) {
        addPageComments(bootstrapResponse);
        const nextToken = findNextContinuationToken(bootstrapResponse, token);
        if (nextToken && nextToken !== token) {
            token = nextToken;
        }
    }

    while (prevToken !== token && token && pageCount < MAX_COMMENT_PAGES) {
        if (getVideoId() !== videoId) {
            yttLog('Przerwano pobieranie — użytkownik zmienił film.');
            return [];
        }

        try {
            const commentsResponse = await innertubeNext({ continuation: token }, page);
            prevToken = token;
            addPageComments(commentsResponse);

            token = findNextContinuationToken(commentsResponse, prevToken);
            pageCount++;

            if (!token) {
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.error('[YTT] Błąd podczas pobierania strony z komentarzami:', error);
            break;
        }
    }

    yttLog(`Pobrano ${comments.length} komentarzy głównych z ${pageCount} stron API.`);
    return comments;
}

function getYouTubePageData(timeoutMs = 250) {
    return new Promise((resolve) => {
        function onPageData(event) {
            document.removeEventListener('ytt-page-data', onPageData);
            resolve(event.detail || null);
        }

        document.addEventListener('ytt-page-data', onPageData);
        document.dispatchEvent(new CustomEvent('ytt-request-page-data'));

        setTimeout(() => {
            document.removeEventListener('ytt-page-data', onPageData);
            resolve(null);
        }, timeoutMs);
    });
}

function extractCommentsFromResponse(commentsResponse) {
    const comments = [];
    const seenIds = new Set();

    function addComment(comment) {
        if (!comment?.commentId || !comment.text || seenIds.has(comment.commentId)) {
            return;
        }
        seenIds.add(comment.commentId);
        comments.push(comment);
    }

    const mutations = commentsResponse?.frameworkUpdates?.entityBatchUpdate?.mutations || [];
    const mutationMap = new Map();
    for (const mutation of mutations) {
        const payload = mutation?.payload?.commentEntityPayload;
        if (payload) {
            mutationMap.set(mutation.entityKey, payload);
        }
    }

    const items = continuationItems(commentsResponse) || [];
    for (const item of items) {
        const thread = item.commentThreadRenderer;
        if (!thread) {
            continue;
        }

        if (thread.comment?.commentRenderer) {
            const cr = thread.comment.commentRenderer;
            addComment({
                commentId: cr.commentId,
                authorName: extractAuthorName(cr.authorText),
                authorAvatar: cr.authorThumbnail?.thumbnails?.[0]?.url || '',
                text: extractText(cr.contentText)
            });
        } else if (thread.commentViewModel?.commentViewModel) {
            const commentKey = thread.commentViewModel.commentViewModel.commentKey;
            const payload = mutationMap.get(commentKey);
            if (payload) {
                addComment(commentFromEntityPayload(payload));
            }
        }
    }

    for (const payload of mutationMap.values()) {
        addComment(commentFromEntityPayload(payload));
    }

    return comments;
}

function commentFromEntityPayload(payload) {
    return {
        commentId: payload.properties.commentId,
        authorName: payload.author.displayName,
        authorAvatar: payload.author.avatarThumbnailUrl,
        text: extractText(payload.properties.content)
    };
}

function extractText(content) {
    if (!content) {
        return '';
    }
    if (typeof content === 'string') {
        return content;
    }
    if (content.simpleText) {
        return content.simpleText;
    }
    if (Array.isArray(content.runs)) {
        return content.runs.map(run => run.text).join('');
    }
    if (content.content) {
        return extractText(content.content);
    }
    return '';
}

function extractAuthorName(authorText) {
    if (!authorText) {
        return '';
    }
    if (authorText.simpleText) {
        return authorText.simpleText;
    }
    if (Array.isArray(authorText.runs)) {
        return authorText.runs.map(run => run.text).join('');
    }
    return '';
}

function findNextContinuationToken(commentsResponse, previousToken) {
    const sources = getResponseContinuationSources(commentsResponse);
    let lastToken = null;

    for (const source of sources) {
        const items = getSourceContinuationItems(source);
        if (!items) {
            continue;
        }
        for (const item of items) {
            const token = getItemContinuationToken(item);
            if (token) {
                lastToken = token;
            }
        }
    }

    if (lastToken && lastToken !== previousToken) {
        return lastToken;
    }

    if (sources.length > 0) {
        const items = getSourceContinuationItems(sources[sources.length - 1]);
        if (items) {
            for (let i = items.length - 1; i >= 0; i--) {
                const token = getItemContinuationToken(items[i]);
                if (token && token !== previousToken) {
                    return token;
                }
            }
        }
    }

    return null;
}

function getResponseContinuationSources(commentsResponse) {
    return [
        ...(commentsResponse?.onResponseReceivedEndpoints || []),
        ...(commentsResponse?.onResponseReceivedActions || [])
    ];
}

function getSourceContinuationItems(source) {
    return source.reloadContinuationItemsCommand?.continuationItems
        ?? source.appendContinuationItemsAction?.continuationItems;
}

function getItemContinuationToken(item) {
    const renderer = item.continuationItemRenderer;
    if (renderer) {
        return renderer.continuationEndpoint?.continuationCommand?.token
            ?? renderer.button?.buttonRenderer?.command?.continuationCommand?.token;
    }
    return item.commentsContinuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
        ?? item.continuationEndpoint?.continuationCommand?.token;
}

function continuationItems(response) {
    const sources = getResponseContinuationSources(response);
    if (sources.length === 0) {
        return null;
    }

    const merged = [];
    for (const source of sources) {
        const items = getSourceContinuationItems(source);
        if (Array.isArray(items) && items.length > 0) {
            merged.push(...items);
        }
    }

    return merged.length > 0 ? merged : null;
}

function commentsContinuationToken(videoResponse) {
    const response = Array.isArray(videoResponse)
        ? videoResponse.find(e => e.response)?.response
        : (videoResponse.response ?? videoResponse);
    if (!response) {
        return null;
    }
    const fromPanel = tokenFromEngagementPanels(response);
    if (fromPanel) {
        return fromPanel;
    }
    return tokenFromItemSection(response);
}

function tokenFromEngagementPanels(response) {
    try {
        const panels = response.engagementPanels;
        if (!Array.isArray(panels)) {
            return null;
        }
        for (const panel of panels) {
            const eps = panel.engagementPanelSectionListRenderer;
            if (!eps) {
                continue;
            }
            const id = String(eps.panelIdentifier ?? eps.targetId ?? '');
            if (id.includes('comment')) {
                const token = findContinuationTokenInObject(eps);
                if (token) {
                    return token;
                }
            }
        }
    } catch (e) {
        // fallback do tokenFromItemSection
    }
    return null;
}

function findContinuationTokenInObject(obj, depth = 0) {
    if (!obj || depth > 25) {
        return null;
    }
    if (obj.continuationCommand?.token) {
        return obj.continuationCommand.token;
    }
    if (obj.continuationEndpoint?.continuationCommand?.token) {
        return obj.continuationEndpoint.continuationCommand.token;
    }
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value && typeof value === 'object') {
            const token = findContinuationTokenInObject(value, depth + 1);
            if (token) {
                return token;
            }
        }
    }
    return null;
}

function tokenFromItemSection(response) {
    try {
        return response
            .contents.twoColumnWatchNextResults.results.results
            .contents.find(e => e.itemSectionRenderer && e.itemSectionRenderer.sectionIdentifier === 'comment-item-section').itemSectionRenderer
            .contents[0].continuationItemRenderer
            ?.continuationEndpoint.continuationCommand.token;
    } catch (e) {
        return null;
    }
}

async function innertubeNext(payload, page) {
    const apiKey = page?.apiKey || DEFAULT_INNERTUBE_API_KEY;
    const clientVersion = page?.clientVersion || DEFAULT_INNERTUBE_CLIENT_VERSION;
    const client = {
        clientName: INNERTUBE_CLIENT_NAME,
        clientVersion
    };
    if (page?.hl) {
        client.hl = page.hl;
    }
    if (page?.gl) {
        client.gl = page.gl;
    }
    if (page?.visitorData) {
        client.visitorData = page.visitorData;
    }

    const body = {
        context: {
            client
        },
        ...payload
    };
    const response = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${apiKey}&prettyPrint=false`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-Youtube-Client-Name': '1',
            'X-Youtube-Client-Version': clientVersion
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        throw new Error(`Błąd sieci: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}
