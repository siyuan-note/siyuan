const FULL_WIDTH_TILDE = "～";
const FULL_WIDTH_STRIKETHROUGH_MARKER = FULL_WIDTH_TILDE.repeat(2);

export const getFullWidthStrikethroughMarkerOffsets = (text: string) => {
    if (!text.endsWith(FULL_WIDTH_STRIKETHROUGH_MARKER) ||
        text.length <= FULL_WIDTH_STRIKETHROUGH_MARKER.length * 2) {
        return;
    }

    const closeStart = text.length - FULL_WIDTH_STRIKETHROUGH_MARKER.length;
    let openStart = text.lastIndexOf(FULL_WIDTH_STRIKETHROUGH_MARKER,
        closeStart - FULL_WIDTH_STRIKETHROUGH_MARKER.length);
    while (openStart > -1) {
        const content = text.substring(openStart + FULL_WIDTH_STRIKETHROUGH_MARKER.length, closeStart);
        const hasExactMarkerRuns = (openStart === 0 || text[openStart - 1] !== FULL_WIDTH_TILDE) &&
            content[0] !== FULL_WIDTH_TILDE && content[content.length - 1] !== FULL_WIDTH_TILDE;
        if (hasExactMarkerRuns && content.trim() === content && content.length > 0) {
            return {
                openStart,
                closeStart,
                markerLength: FULL_WIDTH_STRIKETHROUGH_MARKER.length,
            };
        }
        if (openStart === 0) {
            break;
        }
        openStart = text.lastIndexOf(FULL_WIDTH_STRIKETHROUGH_MARKER, openStart - 1);
    }
};
