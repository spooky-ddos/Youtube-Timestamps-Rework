const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
const INNERTUBE_CLIENT_NAME = "WEB"
const INNERTUBE_CLIENT_VERSION = "2.20211129.09.00"

export async function fetchComments(videoId) {
    try {
        const videoResponse = await fetchVideo(videoId);
        let token = commentsContinuationToken(videoResponse);
        if (!token) {
            console.log("Nie znaleziono tokenu do pobierania komentarzy. Prawdopodobnie są wyłączone.");
            return [];
        }
        
        const comments = [];
        let prevToken;
        let pageCount = 0;

        while (prevToken !== token && token) {
            try {
                const commentsResponse = await fetchNext(token);
                prevToken = token;
                const items = pageCount === 0
                    ? commentsResponse.onResponseReceivedEndpoints[1].reloadContinuationItemsCommand.continuationItems
                    : commentsResponse.onResponseReceivedEndpoints[0].appendContinuationItemsAction.continuationItems;

                if (!items) {
                    break;
                }

                token = null;

                for (const item of items) {
                    if (item.commentThreadRenderer) {
                        const commentThreadRenderer = item.commentThreadRenderer;
                        if (commentThreadRenderer.comment) {
                            const cr = commentThreadRenderer.comment.commentRenderer;
                            const commentId = cr.commentId;
                            const authorName = cr.authorText.simpleText;
                            const authorAvatar = cr.authorThumbnail.thumbnails[0].url;
                            const text = cr.contentText.runs
                                .map(run => run.text)
                                .join("");
                            comments.push({
                                commentId,
                                authorName,
                                authorAvatar,
                                text
                            });
                        } else if (commentThreadRenderer.commentViewModel) {
                            const commentViewModel = commentThreadRenderer.commentViewModel.commentViewModel;
                            const commentKey = commentViewModel.commentKey;
                            const mutation = commentsResponse.frameworkUpdates.entityBatchUpdate.mutations
                                .find(e => e.entityKey === commentKey);
                            const commentEntityPayload = mutation.payload.commentEntityPayload;
                            const commentId = commentEntityPayload.properties.commentId;
                            const authorName = commentEntityPayload.author.displayName;
                            const authorAvatar = commentEntityPayload.author.avatarThumbnailUrl;
                            const text = commentEntityPayload.properties.content.content;
                            comments.push({
                                commentId,
                                authorName,
                                authorAvatar,
                                text
                            });
                        }
                    } else if (item.continuationItemRenderer) {
                        token = item.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
                    }
                }
                pageCount++;
                
                // Opóźnienie, aby nie przeciążyć API
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error('Błąd podczas pobierania strony z komentarzami:', error);
                // Przerwij pętlę w razie błędu, ale zwróć już pobrane komentarze
                break;
            }
        }

        console.log(`Pobrano ${comments.length} komentarzy z ${pageCount} stron.`);
        return comments;

    } catch (error) {
        console.error('Nie udało się pobrać komentarzy dla wideo:', videoId, error);
        return []; // Zwróć pustą tablicę w razie błędu
    }
}


function commentsContinuationToken(videoResponse) {
    try {
        const response = Array.isArray(videoResponse)
            ? videoResponse.find(e => e.response).response
            : videoResponse.response;
        return response
            .contents.twoColumnWatchNextResults.results.results
            .contents.find(e => e.itemSectionRenderer && e.itemSectionRenderer.sectionIdentifier === 'comment-item-section').itemSectionRenderer
            .contents[0].continuationItemRenderer
            ?.continuationEndpoint.continuationCommand.token;
    } catch (e) {
        return null; // Zwróć null jeśli struktura jest nieoczekiwana
    }
}

async function fetchVideo(videoId) {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&pbj=1`, {
        credentials: "omit",
        headers: {
            "X-Youtube-Client-Name": "1",
            "X-Youtube-Client-Version": INNERTUBE_CLIENT_VERSION
        }
    });
    if (!response.ok) {
        throw new Error(`Błąd sieci: ${response.statusText}`);
    }
    return await response.json();
}

async function fetchNext(continuation) {
    const body = {
        context: {
            client: {
                clientName: INNERTUBE_CLIENT_NAME,
                clientVersion: INNERTUBE_CLIENT_VERSION
            }
        },
        continuation
    };
    const response = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${INNERTUBE_API_KEY}`, {
        method: "POST",
        credentials: "omit",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        throw new Error(`Błąd sieci: ${response.statusText}`);
    }
    return await response.json();
}