const getEditableText = (element: Element, range?: Range) => {
    // 跳过公式、图片等不可编辑内容，避免异步渲染改变组合输入的文本判断。
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                return (node as Element).getAttribute("contenteditable") === "false" ?
                    NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    let text = "";
    let node: Node;
    while ((node = walker.nextNode())) {
        if (!range || range.intersectsNode(node)) {
            const start = range?.startContainer === node ? range.startOffset : 0;
            const end = range?.endContainer === node ? range.endOffset : node.textContent.length;
            text += node.textContent.slice(start, end);
        }
    }
    return text.replace(/[\u200B\uFEFF]/g, "");
};

export const captureCompositionText = (element: Element, range: Range) => {
    if (!element || !element.contains(range.startContainer) || !element.contains(range.endContainer)) {
        return undefined;
    }
    const before = range.cloneRange();
    before.selectNodeContents(element);
    before.setEnd(range.startContainer, range.startOffset);
    const after = range.cloneRange();
    after.selectNodeContents(element);
    after.setStart(range.endContainer, range.endOffset);
    const prefix = getEditableText(element, before);
    const suffix = getEditableText(element, after);

    return (currentRange: Range) => {
        if (!element.isConnected || !currentRange.collapsed || !element.contains(currentRange.startContainer)) {
            return false;
        }
        const text = getEditableText(element);
        // 仅在原选区位置保留了文字、前后文未变且光标位于文字末尾时，保留浏览器的光标。
        if (text.length <= prefix.length + suffix.length || !text.startsWith(prefix) || !text.endsWith(suffix)) {
            return false;
        }
        const caretPrefix = currentRange.cloneRange();
        caretPrefix.selectNodeContents(element);
        caretPrefix.setEnd(currentRange.startContainer, currentRange.startOffset);
        return getEditableText(element, caretPrefix).length === text.length - suffix.length;
    };
};
