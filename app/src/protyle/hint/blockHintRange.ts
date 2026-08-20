export const getBlockHintTriggerOffset = (textBeforeCaret: string, textAfterCaret: string,
                                          splitChar: string, endSplit: string) => {
    const latestOffset = textBeforeCaret.lastIndexOf(splitChar);
    if (latestOffset < 0 || textAfterCaret.startsWith(endSplit)) {
        return latestOffset;
    }
    const tripleOffset = textBeforeCaret.lastIndexOf(splitChar + splitChar.substring(0, 1));
    return tripleOffset > -1 ? Math.min(latestOffset, tripleOffset) : latestOffset;
};

export const getBlockRefStaticText = (selectedText: string, splitChar: string, includesTrigger: boolean) => {
    return includesTrigger ? selectedText.substring(splitChar.length) : selectedText;
};

export const shouldIgnoreHintTrigger = (activeHint: string, candidateHint: string, blockHintKeys: string[]) => {
    if (blockHintKeys.includes(activeHint) && [":", "#", "/", "、"].includes(candidateHint)) {
        return true;
    }
    return activeHint === "#" && ["/", "、"].includes(candidateHint);
};

export const shouldCaptureHintUndoFocus = (splitChar: string, blockHintKeys: string[], lite: boolean) => {
    return blockHintKeys.includes(splitChar) || (lite && ["/", "、"].includes(splitChar));
};

export const endsWithMultiCharHintPrefix = (key: string, hintKeys: string[]) => {
    return hintKeys.some((hintKey) => hintKey.length > 1 && key.endsWith(hintKey.substring(0, 1)));
};
