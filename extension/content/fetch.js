const DEFAULT_INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const DEFAULT_INNERTUBE_CLIENT_VERSION = "2.20241201.00.00";
const INNERTUBE_CLIENT_NAME = "WEB";
const COMMENTS_TOKEN_WAIT_MS = 15000;
const COMMENTS_TOKEN_POLL_MS = 500;
const MAX_COMMENT_PAGES = 500;

async function fetchTimeComments(videoId) {
    const comments = await fetchRawComments(videoId);
    const timeComments = await parseTimeCommentsViaBackground(comments);
    yttLog(`Po parsowaniu: ${timeComments.length} znaczników czasu z ${comments.length} komentarzy głównych.`);
    return timeComments;
}

function parseTimeCommentsViaBackground(comments) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            type: 'parseTimeComments',
            comments
        }, (response) => {
            resolve(response || []);
        });
    });
}

async function fetchRawComments(videoId) {
    try {
        const page = await waitForCommentsPageData(videoId);
        if (!page?.data) {
            yttLog('Brak ytInitialData.');
            return [];
        }

        let token = commentsContinuationToken(page.data);
        if (!token) {
            yttLog('Brak tokenu komentarzy.');
            return [];
        }

        const comments = [];
        const seenIds = new Set();
        let prevToken;
        let pageCount = 0;

        while (prevToken !== token && token && pageCount < MAX_COMMENT_PAGES) {
            try {
                const commentsResponse = await innertubeNext({ continuation: token }, page);
                prevToken = token;
                const pageComments = extractCommentsFromResponse(commentsResponse);
                for (const comment of pageComments) {
                    if (!seenIds.has(comment.commentId)) {
                        seenIds.add(comment.commentId);
                        comments.push(comment);
                    }
                }

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
    } catch (error) {
        console.error('[YTT] Nie udało się pobrać komentarzy dla wideo:', videoId, error);
        return [];
    }
}

async function waitForCommentsPageData(videoId) {
    const deadline = Date.now() + COMMENTS_TOKEN_WAIT_MS;
    let scrolledToComments = false;

    while (Date.now() < deadline) {
        if (!scrolledToComments) {
            const commentsSection = document.querySelector('#comments, ytd-comments#comments');
            if (commentsSection) {
                commentsSection.scrollIntoView({ behavior: 'instant', block: 'start' });
                scrolledToComments = true;
            }
        }

        const page = await getYouTubePageData();
        if (page?.data && commentsContinuationToken(page.data)) {
            return page;
        }
        await new Promise(resolve => setTimeout(resolve, COMMENTS_TOKEN_POLL_MS));
        if (getVideoId() !== videoId) {
            return null;
        }
    }
    return getYouTubePageData();
}

function getYouTubePageData() {
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
        }, 3000);
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
