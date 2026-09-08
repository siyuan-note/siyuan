import {getSemanticMarkerPrefixLengthForNode} from "../util/inlineElementMarker";

export const INLINE_FORMAT_TYPES = ["strong", "em", "u", "s", "mark", "sup", "sub", "code", "kbd"];

export const getRangeInlineFormats = (editableElement: Element, range: Range): string[] | undefined => {
    const walker = editableElement.ownerDocument.createTreeWalker(editableElement, NodeFilter.SHOW_TEXT);
    let formats: string[] | undefined;
    let textNode = walker.nextNode() as Text;
    while (textNode) {
        if (range.intersectsNode(textNode)) {
            const start = range.startContainer === textNode ? range.startOffset : 0;
            const end = range.endContainer === textNode ? range.endOffset : textNode.data.length;
            const visibleStart = Math.max(start, getSemanticMarkerPrefixLengthForNode(textNode));
            if (visibleStart < end && textNode.data.substring(visibleStart, end).split("\u200b").join("")) {
                const types: string[] = [];
                let element = textNode.parentElement;
                let image = false;
                while (element && element !== editableElement) {
                    const elementTypes = (element.getAttribute("data-type") || "").split(" ");
                    image = image || elementTypes.includes("img");
                    types.push(...elementTypes);
                    element = element.parentElement;
                }
                // 图片内部的辅助文本不参与行级格式判断。
                if (!image) {
                    formats = (formats || INLINE_FORMAT_TYPES).filter(type => types.includes(type));
                    if (formats.length === 0) {
                        return formats;
                    }
                }
            }
        }
        textNode = walker.nextNode() as Text;
    }
    return formats;
};

export const getRangesInlineFormats = (ranges: {editableElement: Element, range: Range}[]) => {
    let formats: string[] | undefined;
    ranges.forEach(item => {
        const current = getRangeInlineFormats(item.editableElement, item.range);
        if (current) {
            formats = (formats || INLINE_FORMAT_TYPES).filter(type => current.includes(type));
        }
    });
    return formats || [];
};
