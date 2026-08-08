export const getBlockHintCloseLength = (textBeforeTrigger: string, textAfterCaret: string,
                                        splitChar: string, endSplit: string) => {
    const openChar = splitChar.substring(0, 1);
    const closeChar = endSplit.substring(0, 1);
    if (!openChar || !closeChar || splitChar !== openChar.repeat(splitChar.length) ||
        endSplit !== closeChar.repeat(endSplit.length) || !textAfterCaret.startsWith(endSplit)) {
        return 0;
    }

    let unmatchedOpenCount = 0;
    for (const char of textBeforeTrigger) {
        if (char === openChar) {
            unmatchedOpenCount++;
        } else if (char === closeChar && unmatchedOpenCount > 0) {
            unmatchedOpenCount--;
        }
    }

    return unmatchedOpenCount === 0 ? endSplit.length : 0;
};
