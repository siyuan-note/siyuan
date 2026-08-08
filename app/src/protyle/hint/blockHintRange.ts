export const getBlockHintRangeAdjustment = (textBeforeTrigger: string, textFromTrigger: string,
                                            textAfterCaret: string, splitChar: string, endSplit: string) => {
    const noAdjustment = {preserveOpenLength: 0, removeOpenLength: splitChar.length, closeLength: 0};
    const openChar = splitChar.substring(0, 1);
    const closeChar = endSplit.substring(0, 1);
    if (!openChar || !closeChar || splitChar !== openChar.repeat(splitChar.length) ||
        endSplit !== closeChar.repeat(endSplit.length)) {
        return noAdjustment;
    }

    let unmatchedOpenCount = 0;
    for (const char of textBeforeTrigger) {
        if (char === openChar) {
            unmatchedOpenCount++;
        } else if (char === closeChar && unmatchedOpenCount > 0) {
            unmatchedOpenCount--;
        }
    }

    let closeRunLength = 0;
    while (textAfterCaret.substring(closeRunLength, closeRunLength + 1) === closeChar) {
        closeRunLength++;
    }
    let openRunLength = 0;
    while (textFromTrigger.substring(openRunLength, openRunLength + 1) === openChar) {
        openRunLength++;
    }
    // 在原有成对括号中输入一个开括号时，只将新输入的字符作为提示触发符
    if (closeRunLength >= endSplit.length && openRunLength === closeRunLength + 1) {
        return {preserveOpenLength: closeRunLength, removeOpenLength: 1, closeLength: 0};
    }
    if (closeRunLength < endSplit.length || unmatchedOpenCount > 0) {
        return noAdjustment;
    }
    return {preserveOpenLength: 0, removeOpenLength: splitChar.length, closeLength: endSplit.length};
};
