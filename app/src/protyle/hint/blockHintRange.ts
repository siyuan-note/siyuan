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
