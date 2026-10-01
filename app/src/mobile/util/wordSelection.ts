interface IWordTextPart {
    node: Text;
    offset: number;
    text: string;
}

const WORD_SELECTION_BOUNDARY = '[contenteditable="false"], a, img, svg, br, input, textarea, select, button, ' +
    '[data-type~="a"], [data-type~="block-ref"], [data-type~="virtual-block-ref"], [data-type~="code"], ' +
    '[data-type~="kbd"], [data-type~="tag"], [data-type~="inline-math"], [data-type~="file-annotation-ref"], ' +
    '[data-type~="inline-memo"], .protyle-action, .protyle-attr';

const getWordTextParts = (element: Element, range: Range) => {
    let parts: IWordTextPart[] = [];
    let found: IWordTextPart[];
    const flush = () => {
        if (parts.some(part => part.node === range.startContainer && range.startOffset >= part.offset &&
            range.startOffset < part.offset + part.text.length) &&
            parts.some(part => part.node === range.endContainer && range.endOffset > part.offset &&
                range.endOffset <= part.offset + part.text.length)) {
            found = parts;
        }
        parts = [];
    };
    const walk = (node: Node) => {
        if (found) {
            return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            let offset = 0;
            // 隐藏标记与特殊行内元素是选词边界，普通格式元素中的文字可连续分词。
            for (const match of text.matchAll(/[\u200b\u2060\ufeff]/g)) {
                if (match.index > offset) {
                    parts.push({node: node as Text, offset, text: text.substring(offset, match.index)});
                }
                flush();
                offset = match.index + 1;
            }
            if (offset < text.length) {
                parts.push({node: node as Text, offset, text: text.substring(offset)});
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if ((node as Element).matches(WORD_SELECTION_BOUNDARY)) {
                flush();
            } else {
                Array.from(node.childNodes).forEach(walk);
            }
        }
    };
    Array.from(element.childNodes).forEach(walk);
    flush();
    return found;
};

export const expandAndroidWordSelection = (blockElement: Element): Range | undefined => {
    const bridge = window.JSAndroid;
    const selection = blockElement.ownerDocument.getSelection();
    if (!bridge?.getWordSelection || !selection?.rangeCount || selection.isCollapsed ||
        !["NodeParagraph", "NodeHeading", "NodeTable"].includes(blockElement.getAttribute("data-type"))) {
        return;
    }
    const range = selection.getRangeAt(0);
    if (!/^\p{Script=Han}$/u.test(range.toString()) ||
        range.startContainer.nodeType !== Node.TEXT_NODE || range.endContainer.nodeType !== Node.TEXT_NODE) {
        return;
    }
    const element = range.startContainer.parentElement?.closest('[contenteditable="true"]');
    const startBoundary = range.startContainer.parentElement.closest(WORD_SELECTION_BOUNDARY);
    const endBoundary = range.endContainer.parentElement.closest(WORD_SELECTION_BOUNDARY);
    if (!element || !blockElement.contains(element) || !element.contains(range.endContainer) ||
        startBoundary && element.contains(startBoundary) || endBoundary && element.contains(endBoundary)) {
        return;
    }
    const parts = getWordTextParts(element, range);
    if (!parts) {
        return;
    }
    let start = 0;
    let end = 0;
    let offset = 0;
    parts.forEach(part => {
        if (part.node === range.startContainer && range.startOffset >= part.offset &&
            range.startOffset < part.offset + part.text.length) {
            start = offset + range.startOffset - part.offset;
        }
        if (part.node === range.endContainer && range.endOffset > part.offset &&
            range.endOffset <= part.offset + part.text.length) {
            end = offset + range.endOffset - part.offset;
        }
        offset += part.text.length;
    });
    const text = parts.map(part => part.text).join("");
    let contextStart = Math.max(0, start - 1024);
    let contextEnd = Math.min(text.length, end + 1024);
    // 截取上下文时保留完整代理对，原生接口与选区均使用 UTF-16 偏移。
    if (contextStart > 0 && /[\uDC00-\uDFFF]/.test(text[contextStart])) {
        contextStart--;
    }
    if (contextEnd < text.length && /[\uD800-\uDBFF]/.test(text[contextEnd - 1])) {
        contextEnd++;
    }
    let boundaries: unknown;
    try {
        boundaries = JSON.parse(bridge.getWordSelection(text.substring(contextStart, contextEnd),
            start - contextStart, end - contextStart));
    } catch (error) {
        return;
    }
    if (!Array.isArray(boundaries) || boundaries.length !== 2 ||
        !boundaries.every(value => Number.isInteger(value)) ||
        boundaries[0] < 0 || boundaries[0] > start - contextStart ||
        boundaries[1] < end - contextStart || boundaries[1] > contextEnd - contextStart ||
        boundaries[0] === start - contextStart && boundaries[1] === end - contextStart) {
        return;
    }
    const expanded = range.cloneRange();
    let remainingStart = boundaries[0] + contextStart;
    let remainingEnd = boundaries[1] + contextStart;
    for (const part of parts) {
        if (remainingStart >= 0 && remainingStart < part.text.length) {
            expanded.setStart(part.node, part.offset + remainingStart);
            remainingStart = -1;
        } else if (remainingStart >= 0) {
            remainingStart -= part.text.length;
        }
        if (remainingEnd > 0 && remainingEnd <= part.text.length) {
            expanded.setEnd(part.node, part.offset + remainingEnd);
            remainingEnd = -1;
        } else if (remainingEnd >= 0) {
            remainingEnd -= part.text.length;
        }
    }
    if (remainingStart !== -1 || remainingEnd !== -1) {
        return;
    }
    selection.removeAllRanges();
    selection.addRange(expanded);
    return expanded;
};
