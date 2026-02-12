import * as youtubei from './youtubei.js'

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'fetchTimeComments') {
        fetchTimeComments(request.videoId)
            .then(sendResponse)
            .catch(e => {
                console.error(e)
                // W razie błędu zwracamy pustą tablicę, żeby nie zawiesić content scriptu
                sendResponse([]) 
            })
        return true
    }
})

async function fetchTimeComments(videoId) {
    const comments = await fetchComments(videoId)
    // Używamy nowej logiki V6 do parsowania
    return getTimestampContextsFromComments(comments);
}

async function fetchComments(videoId) {
    return await youtubei.fetchComments(videoId)
}

// Główna funkcja przetwarzająca tablicę komentarzy na tablicę znaczników
function getTimestampContextsFromComments(comments) {
    const allTimeComments = [];
    
    for (const comment of comments) {
        // Parsujemy tekst komentarza logiką V6
        const contexts = parseCommentTextV6(comment.text);
        
        // Filtrowanie "spisów treści" (jeśli komentarz to same czasy, np. > 3 znaczniki zaczynające się od 0:00)
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
    // Prosta heurystyka: jeśli komentarz ma dużo znaczników i zaczyna się od początku, to pewnie tracklista
    return contexts.length >= 10 && contexts[0].time === 0;
}

// --- LOGIKA PARSERA V6 (Przeniesiona z tester.html) ---

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

        // --- Analiza separatorów ---
        
        // Koniec zdania (. ! ?)
        const endsWithSentenceTerminator = /[\.\!\?]\s+$/.test(precedingText);
        // Duża dziura (3 spacje)
        const endsWithBigGap = /\s{3,}$/.test(precedingText);
        
        // Logika Wiszącego Prefiksu (Nowa linia + tekst)
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

        // --- DRZEWO DECYZYJNE ---

        // 1. START
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
        // 2. NOWA LINIA
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
        // 3. SILNE SEPARATORY
        else if (endsWithSentenceTerminator || endsWithBigGap) {
            segments.push(finalizeSegment(currentSegment, text, start));
            currentSegment = {
                timestamps: [{ str: match[0], val: parseTimestamp(match[0]), end: end }],
                textStart: end
            };
        }
        // 4. GRUPOWANIE
        else if (/^[\s,\-]+$/.test(precedingText)) {
            currentSegment.timestamps.push({ str: match[0], val: parseTimestamp(match[0]), end: end });
            if (currentSegment.textStart >= textStartIndex) {
                 currentSegment.textStart = end;
            }
        }
        // 5. CYTAT (Ignoruj)
        else {
            // pass
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