/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractSpoilerInfo };
}

/**
 * Extracts spoiler text and their positions from a string with **spoiler** markers
 * @param {string} text - Input text with **spoiler** markers
 * @returns {Object} - Object containing spoiler info and cleaned text
 */
function extractSpoilerInfo(text) {
    const spoilerMarker = '**spoiler**';
    const textEntities = [];
    let cleanedText = '';
    let currentPosition = 0;
    let searchPosition = 0;

    while (currentPosition < text.length && searchPosition < text.length) {
        // Find the next spoiler start marker
        const startMarkerIndex = text.indexOf(spoilerMarker, searchPosition);

        if (startMarkerIndex === -1) {
            // No more spoiler markers, add remaining text
            cleanedText += text.substring(searchPosition);
            break;
        }

        // Add text before the spoiler marker to cleaned text
        const textBeforeMarker = text.substring(searchPosition, startMarkerIndex);
        cleanedText += textBeforeMarker;
        currentPosition += textBeforeMarker.length;

        // Find the closing spoiler marker
        const contentStartIndex = startMarkerIndex + spoilerMarker.length;
        const endMarkerIndex = text.indexOf(spoilerMarker, contentStartIndex);

        if (endMarkerIndex === -1) {
            // No closing marker found, treat remaining text as normal
            cleanedText += text.substring(startMarkerIndex);
            break;
        }

        // Extract spoiler content
        const spoilerContent = text.substring(contentStartIndex, endMarkerIndex);

        // Record spoiler info
        textEntities.push({
            entity_type: "SPOILER",
            offset: currentPosition.toString(),
            length: spoilerContent.length.toString(),
        });

        // Add spoiler content to cleaned text
        cleanedText += spoilerContent;
        currentPosition += spoilerContent.length;

        // Move search position past the end marker
        searchPosition = endMarkerIndex + spoilerMarker.length;
    }

    return {
        textEntities: textEntities,
        text: cleanedText
    };
}
