chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'parseTimeComments') {
        try {
            sendResponse(getTimestampContextsFromComments(request.comments || []))
        } catch (e) {
            console.error(e)
            sendResponse([])
        }
        return true
    }
})

function getTimestampContextsFromComments(comments) {
    const allTimeComments = [];

    for (const comment of comments) {
        const contexts = parseCommentTextV6(comment.text);

        if (isChaptersComment(contexts)) {
            continue;
        }

        for (const ctx of contexts) {
            allTimeComments.push({
                commentId: comment.commentId,
                authorAvatar: comment.authorAvatar,
                authorName: comment.authorName,
                timestamp: ctx.timestamp,
                time: ctx.time,
                text: ctx.text
            });
        }
    }
    return allTimeComments;
}

function isChaptersComment(contexts) {
    return contexts.length >= 10 && contexts[0].time === 0;
}

function parseCommentTextV6(text) {
    const regex = /(\d?\d:)?\d?\d:\d\d/g;
    const matches = [...text.matchAll(regex)];

    if (matches.length === 0) return [];

    const segments = [];
    let currentSegment = null;

    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const start = match.index;
        const end = start + match[0].length;

        let precedingText = "";
        let textStartIndex = 0;

        if (currentSegment) {
            const lastStampInSeg = currentSegment.timestamps[currentSegment.timestamps.length - 1];
            textStartIndex = lastStampInSeg.end;
            precedingText = text.substring(textStartIndex, start);
        } else {
            precedingText = text.substring(0, start);
        }

        const endsWithSentenceTerminator = /[\.\!\?]\s+$/.test(precedingText);
        const endsWithBigGap = /\s{3,}$/.test(precedingText);

        let hasNewline = false;
        let splitAtNewline = false;
        let newlineIndexRelative = -1;

        if (precedingText.includes('\n')) {
            hasNewline = true;
            newlineIndexRelative = precedingText.lastIndexOf('\n');
            const textAfterLastNewline = precedingText.substring(newlineIndexRelative + 1);
            if (textAfterLastNewline.trim().length > 0) {
                splitAtNewline = true;
            }
        }

        if (!currentSegment) {
            let segmentStart = end;
            if (precedingText.trim().length > 0) {
                segmentStart = 0;
            }
            currentSegment = {
                timestamps: [{ str: match[0], val: parseTimestamp(match[0]), end: end }],
                textStart: segmentStart
            };
        }
        else if (hasNewline) {
            if (splitAtNewline) {
                const absoluteNewlineIndex = textStartIndex + newlineIndexRelative;
                segments.push(finalizeSegment(currentSegment, text, absoluteNewlineIndex));
                currentSegment = {
                    timestamps: [{ str: match[0], val: parseTimestamp(match[0]), end: end }],
                    textStart: absoluteNewlineIndex + 1
                };
            } else {
                segments.push(finalizeSegment(currentSegment, text, start));
                currentSegment = {
                    timestamps: [{ str: match[0], val: parseTimestamp(match[0]), end: end }],
                    textStart: end
                };
            }
        }
        else if (endsWithSentenceTerminator || endsWithBigGap) {
            segments.push(finalizeSegment(currentSegment, text, start));
            currentSegment = {
                timestamps: [{ str: match[0], val: parseTimestamp(match[0]), end: end }],
                textStart: end
            };
        }
        else if (/^[\s,\-]+$/.test(precedingText)) {
            currentSegment.timestamps.push({ str: match[0], val: parseTimestamp(match[0]), end: end });
            if (currentSegment.textStart >= textStartIndex) {
                 currentSegment.textStart = end;
            }
        }
    }

    if (currentSegment) {
        segments.push(finalizeSegment(currentSegment, text, text.length));
    }

    const flatResults = [];
    for (const seg of segments) {
        for (const ts of seg.timestamps) {
            if (ts.val !== null) {
                flatResults.push({
                    timestamp: ts.str,
                    time: ts.val,
                    text: seg.cleanText
                });
            }
        }
    }
    return flatResults;
}

function finalizeSegment(segment, fullText, cutOffIndex) {
    let rawText = fullText.substring(segment.textStart, cutOffIndex);
    let cleanText = rawText.replace(/^[\s,\-]+/, '').trim();
    segment.cleanText = cleanText;
    return segment;
}

function parseTimestamp(ts) {
    const parts = ts.split(':').reverse()
    const secs = parseInt(parts[0])
    if (secs > 59) return null
    const mins = parseInt(parts[1])
    if (mins > 59) return null
    const hours = parseInt(parts[2]) || 0
    return secs + (60 * mins) + (60 * 60 * hours)
}
