export const getBlockHintTriggerOffset = (textBeforeCaret: string, textAfterCaret: string,
                                          splitChar: string, endSplit: string) => {
    const latestOffset = textBeforeCaret.lastIndexOf(splitChar);
    if (latestOffset < 0 || textAfterCaret.startsWith(endSplit)) {
        return latestOffset;
    }
    const tripleOffset = textBeforeCaret.lastIndexOf(splitChar + splitChar.substring(0, 1));
    return tripleOffset > -1 ? Math.min(latestOffset, tripleOffset) : latestOffset;
};

export const isBlockHintQueryAtCaret = (textBeforeCaret: string, textAfterCaret: string,
                                        splitChar: string, endSplit: string, maxLength: number) => {
    const triggerOffset = getBlockHintTriggerOffset(textBeforeCaret, textAfterCaret, splitChar, endSplit);
    if (triggerOffset < 0) {
        return false;
    }
    const query = textBeforeCaret.substring(triggerOffset + splitChar.length);
    return query.trimStart() === query && query.length < maxLength;
};

// 自动闭合：光标前刚输入引用触发符且光标后没有对应闭合符时补全
export const shouldAutoCloseRefBrackets = (textBeforeCaret: string, textAfterCaret: string, splitChar = "[[") => {
    const closeChar = splitChar === "【【" ? "】" : "]";
    return textBeforeCaret.endsWith(splitChar) && !textAfterCaret.startsWith(closeChar);
};

// 手动输入的闭合标记（如 [[标题]] 中的 ]]）不属于查询内容，选中候选项时随触发符一起被替换
export const stripBlockHintCloseKey = (query: string, endSplit: string) => {
    return endSplit && query.endsWith(endSplit) ? query.substring(0, query.length - endSplit.length) : query;
};

export const getBlockRefStaticText = (selectedText: string, splitChar: string, includesTrigger: boolean,
                                      endSplit = "") => {
    return includesTrigger ? stripBlockHintCloseKey(selectedText.substring(splitChar.length), endSplit) : selectedText;
};

export const shouldIgnoreHintTrigger = (activeHint: string, candidateHint: string, blockHintKeys: string[]) => {
    if (blockHintKeys.includes(activeHint) && [":", "#", "/", "、"].includes(candidateHint)) {
        return true;
    }
    return activeHint === "#" && ["/", "、"].includes(candidateHint);
};

export const shouldCaptureHintUndoFocus = (splitChar: string, blockHintKeys: string[], value = "") => {
    return value === "emoji" || blockHintKeys.includes(splitChar) || ["/", "、"].includes(splitChar);
};

export const endsWithMultiCharHintPrefix = (key: string, hintKeys: string[]) => {
    return hintKeys.some((hintKey) => hintKey.length > 1 && key.endsWith(hintKey.substring(0, 1)));
};
