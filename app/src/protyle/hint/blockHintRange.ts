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

// 自动闭合：光标前刚输入 [[ 且光标后没有闭合符时补全 ]]
export const shouldAutoCloseRefBrackets = (textBeforeCaret: string, textAfterCaret: string) => {
    return textBeforeCaret.endsWith("[[") && !textAfterCaret.startsWith("]");
};

// 自动闭合：在空括号对之间退格时一并删除光标后的 ]
export const shouldDeleteRefBracketPair = (textBeforeCaret: string, textAfterCaret: string) => {
    return textBeforeCaret.endsWith("[") && textAfterCaret.startsWith("]");
};

// 输入 ]] 完成引用时，优先匹配标题完全一致的文档，其次忽略大小写匹配
export const findExactDocTitleIndex = (items: { type: string, titles: string[] }[], key: string) => {
    const title = key.trim();
    if (!title) {
        return -1;
    }
    const index = items.findIndex((item) => item.type === "NodeDocument" && item.titles.includes(title));
    if (index > -1) {
        return index;
    }
    const lowerTitle = title.toLowerCase();
    return items.findIndex((item) => item.type === "NodeDocument" &&
        item.titles.some((itemTitle) => itemTitle.toLowerCase() === lowerTitle));
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
