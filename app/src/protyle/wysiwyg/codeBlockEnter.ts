const findCodeBlockFenceStart = (text: string, enableMiddleDot: boolean) => {
    const markers = enableMiddleDot ? ["```", "~~~", "···"] : ["```", "~~~"];
    const trimStartText = text.trimStart();
    const trimStartOffset = text.length - trimStartText.length;
    if (markers.some(marker => trimStartText.startsWith(marker))) {
        return trimStartOffset;
    }

    let fenceStart = -1;
    markers.forEach(marker => {
        const index = text.indexOf("\n" + marker);
        if (index > -1 && (fenceStart === -1 || index + 1 < fenceStart)) {
            fenceStart = index + 1;
        }
    });
    return fenceStart;
};

export const isCodeBlockFenceBeforeCaret = (text: string, caretOffset: number, enableMiddleDot: boolean) => {
    const fenceStart = findCodeBlockFenceStart(text, enableMiddleDot);
    if (fenceStart === -1) {
        return false;
    }

    const markerCharacters = enableMiddleDot ? "`~·" : "`~";
    let fenceEnd = fenceStart + 3;
    while (fenceEnd < text.length && markerCharacters.includes(text[fenceEnd])) {
        fenceEnd++;
    }
    return fenceEnd <= caretOffset;
};
