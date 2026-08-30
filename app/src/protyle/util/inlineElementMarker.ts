export type TSemanticInlineMarkerMode = "canonical" | "legacy" | "remove";

const ZERO_WIDTH_SPACE = "\u200b";
const WORD_JOINER = "\u2060";
const SEMANTIC_INLINE_TYPES = new Set(["code", "kbd", "tag"]);
const INTERNAL_MARKERS = new Set([ZERO_WIDTH_SPACE, WORD_JOINER, "\ufeff"]);
const SEMANTIC_INLINE_HTML_REGEXP = /<span\b[^>]*\bdata-type=(?:"(?:[^"]* )?(?:code|kbd|tag)(?: [^"]*)?"|'(?:[^']* )?(?:code|kbd|tag)(?: [^']*)?')/iu;

export const hasSemanticInlineType = (type: string | null | undefined) =>
    (type || "").split(" ").some(item => SEMANTIC_INLINE_TYPES.has(item));

export const getSemanticInternalMarkerPrefixLength = (text: string) => {
    let length = 0;
    while (length < text.length && INTERNAL_MARKERS.has(text[length])) {
        length++;
    }
    return length;
};

export const stripSemanticInternalMarkerPrefix = (text: string) =>
    text.substring(getSemanticInternalMarkerPrefixLength(text));

export const normalizeSemanticInternalMarkerPrefix = (text: string, mode: TSemanticInlineMarkerMode = "canonical") => {
    const visibleText = stripSemanticInternalMarkerPrefix(text);
    if (mode === "remove") {
        return visibleText;
    }
    return (mode === "legacy" ? ZERO_WIDTH_SPACE : WORD_JOINER) + visibleText;
};

export const getInlinePlaceholder = (type: string | null | undefined) =>
    hasSemanticInlineType(type) ? WORD_JOINER : ZERO_WIDTH_SPACE;

export const buildSemanticInlineHTML = (type: "code" | "kbd" | "tag", html: string, attributes = "") =>
    `${ZERO_WIDTH_SPACE}<span data-type="${type}"${attributes}>${WORD_JOINER}${html}</span>${ZERO_WIDTH_SPACE}`;

export const isSemanticInlineElement = (element: Element | null | undefined): element is HTMLElement =>
    !!element && element.tagName === "SPAN" && hasSemanticInlineType(element.getAttribute("data-type"));

const getFirstTextNode = (root: Node): Text | undefined => {
    for (const child of Array.from(root.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            return child as Text;
        }
        const textNode = getFirstTextNode(child);
        if (textNode) {
            return textNode;
        }
    }
};

const getLastTextNode = (root: Node): Text | undefined => {
    const children = Array.from(root.childNodes);
    for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index];
        if (child.nodeType === Node.TEXT_NODE) {
            return child as Text;
        }
        const textNode = getLastTextNode(child);
        if (textNode) {
            return textNode;
        }
    }
};

export const getSemanticInlineFirstTextNode = (element: Element) => getFirstTextNode(element);

export const isSemanticInlineMarkerTextNode = (node: Node | null | undefined): node is Text => {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
        return false;
    }
    const parentElement = node.parentElement?.closest("span[data-type]");
    return isSemanticInlineElement(parentElement) && getFirstTextNode(parentElement) === node;
};

export const getSemanticMarkerPrefixLengthForNode = (node: Node | null | undefined) =>
    isSemanticInlineMarkerTextNode(node) ? getSemanticInternalMarkerPrefixLength(node.textContent || "") : 0;

export const getSemanticForwardDeleteOffset = (text: string, offset: number) =>
    Math.max(offset, getSemanticInternalMarkerPrefixLength(text));

export const isSemanticBackwardDeleteBoundary = (text: string, offset: number) =>
    getSemanticInternalMarkerPrefixLength(text) > 0 && offset <= getSemanticInternalMarkerPrefixLength(text);

export const setSemanticInlineElementMarker = (element: HTMLElement, mode: TSemanticInlineMarkerMode) => {
    let textNode = getFirstTextNode(element);
    if (!textNode) {
        textNode = element.ownerDocument.createTextNode("");
        element.prepend(textNode);
    }
    textNode.data = normalizeSemanticInternalMarkerPrefix(textNode.data, mode);
};

const ensureLeftExternalBoundary = (element: HTMLElement) => {
    const previousSibling = element.previousSibling;
    if (previousSibling?.nodeType === Node.TEXT_NODE) {
        const textNode = previousSibling as Text;
        textNode.data = textNode.data.replace(/\u200b+$/u, "") + ZERO_WIDTH_SPACE;
        if (textNode.data === ZERO_WIDTH_SPACE && textNode.previousSibling?.nodeType === Node.TEXT_NODE) {
            const previousTextNode = textNode.previousSibling as Text;
            previousTextNode.data = previousTextNode.data.replace(/\u200b+$/u, "");
        }
    } else {
        element.before(element.ownerDocument.createTextNode(ZERO_WIDTH_SPACE));
    }
};

const ensureRightExternalBoundary = (element: HTMLElement) => {
    const nextSibling = element.nextSibling;
    if (nextSibling?.nodeType === Node.TEXT_NODE) {
        const textNode = nextSibling as Text;
        textNode.data = ZERO_WIDTH_SPACE + textNode.data.replace(/^\u200b+/u, "");
        if (textNode.data === ZERO_WIDTH_SPACE && textNode.nextSibling?.nodeType === Node.TEXT_NODE) {
            const nextTextNode = textNode.nextSibling as Text;
            nextTextNode.data = nextTextNode.data.replace(/^\u200b+/u, "");
        }
    } else {
        element.after(element.ownerDocument.createTextNode(ZERO_WIDTH_SPACE));
    }
};

export const normalizeSemanticInlineElement = (element: HTMLElement, ensureExternalBoundaries = true) => {
    if (!isSemanticInlineElement(element)) {
        return;
    }
    setSemanticInlineElementMarker(element, "canonical");
    if (ensureExternalBoundaries) {
        ensureLeftExternalBoundary(element);
        ensureRightExternalBoundary(element);
    }
};

export const removeSemanticInlineExternalBoundaries = (element: HTMLElement) => {
    const previousSibling = element.previousSibling;
    if (previousSibling?.nodeType === Node.TEXT_NODE && previousSibling.textContent?.endsWith(ZERO_WIDTH_SPACE)) {
        const textNode = previousSibling as Text;
        const text = textNode.data.substring(0, textNode.data.length - 1);
        if (text !== "" || !isSemanticInlineElement(textNode.previousElementSibling)) {
            if (text === "") {
                textNode.remove();
            } else {
                textNode.data = text;
            }
        }
    }
    const nextSibling = element.nextSibling;
    if (nextSibling?.nodeType === Node.TEXT_NODE && nextSibling.textContent?.startsWith(ZERO_WIDTH_SPACE)) {
        const textNode = nextSibling as Text;
        const text = textNode.data.substring(1);
        if (text !== "" || !isSemanticInlineElement(textNode.nextElementSibling)) {
            if (text === "") {
                textNode.remove();
            } else {
                textNode.data = text;
            }
        }
    }
};

const getSemanticInlineElements = (root: ParentNode) => {
    const elements = Array.from(root.querySelectorAll<HTMLElement>(
        'span[data-type~="code"],span[data-type~="kbd"],span[data-type~="tag"]'
    ));
    if (root instanceof Element && isSemanticInlineElement(root)) {
        elements.unshift(root);
    }
    return elements;
};

export const normalizeSemanticInlineElements = (root: ParentNode) => {
    getSemanticInlineElements(root).forEach(element => normalizeSemanticInlineElement(element));
};

export const transformSemanticInlineMarkers = (root: ParentNode, mode: TSemanticInlineMarkerMode) => {
    getSemanticInlineElements(root).forEach(element => setSemanticInlineElementMarker(element, mode));
};

export const transformSemanticInlineHTML = (html: string, mode: TSemanticInlineMarkerMode) => {
    if (!SEMANTIC_INLINE_HTML_REGEXP.test(html)) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    transformSemanticInlineMarkers(template.content, mode);
    return template.innerHTML;
};

export const normalizeSemanticInlineHTML = (html: string) => {
    if (!SEMANTIC_INLINE_HTML_REGEXP.test(html)) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    normalizeSemanticInlineElements(template.content);
    return template.innerHTML;
};

export const getSemanticInlineVisibleText = (element: Element) => {
    if (!isSemanticInlineElement(element)) {
        return element.textContent || "";
    }
    return stripSemanticInternalMarkerPrefix(element.textContent || "");
};

export const removeTextOffsets = (text: string, offsets: number[]) => {
    let result = text;
    [...new Set(offsets)].sort((first, second) => second - first).forEach(offset => {
        if (offset >= 0 && offset < result.length) {
            result = result.substring(0, offset) + result.substring(offset + 1);
        }
    });
    return result;
};

export const getTextWithoutSemanticMarkers = (root: ParentNode) => {
    let text = "";
    const visit = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += isSemanticInlineMarkerTextNode(node) ?
                stripSemanticInternalMarkerPrefix(node.textContent || "") : node.textContent || "";
            return;
        }
        Array.from(node.childNodes).forEach(visit);
    };
    visit(root as Node);
    return text;
};

export const stripSemanticMarkersFromRangeText = (range: Range) => {
    const commonElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ?
        range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
    if (!commonElement) {
        return range.toString();
    }
    const elements = getSemanticInlineElements(commonElement);
    const ancestorElement = commonElement.closest("span[data-type]");
    if (isSemanticInlineElement(ancestorElement) && !elements.includes(ancestorElement)) {
        elements.unshift(ancestorElement);
    }
    const offsets: number[] = [];
    elements.forEach(element => {
        const textNode = getFirstTextNode(element);
        const prefixLength = textNode ? getSemanticInternalMarkerPrefixLength(textNode.data) : 0;
        for (let index = 0; textNode && index < prefixLength; index++) {
            const markerRange = textNode.ownerDocument.createRange();
            markerRange.setStart(textNode, index);
            markerRange.setEnd(textNode, index + 1);
            // START_TO_END 比较选区终点与标记起点，END_TO_START 比较选区起点与标记终点。
            const rangeEndsBeforeMarker = range.compareBoundaryPoints(Range.START_TO_END, markerRange) <= 0;
            const rangeStartsAfterMarker = range.compareBoundaryPoints(Range.END_TO_START, markerRange) >= 0;
            if (rangeEndsBeforeMarker || rangeStartsAfterMarker) {
                continue;
            }
            const prefixRange = range.cloneRange();
            prefixRange.setEnd(textNode, index);
            offsets.push(prefixRange.toString().length);
        }
    });
    return removeTextOffsets(range.toString(), offsets);
};

export const getMarkerAwareTextLength = (root: Node, ignoreZWSP: boolean) => {
    let length = 0;
    const visit = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            let text = node.textContent || "";
            if (isSemanticInlineMarkerTextNode(node)) {
                text = stripSemanticInternalMarkerPrefix(text);
            }
            if (ignoreZWSP) {
                text = text.split(ZERO_WIDTH_SPACE).join("");
            }
            length += text.length;
            return;
        }
        Array.from(node.childNodes).forEach(visit);
    };
    visit(root);
    return length;
};

const getAdjacentSemanticInline = (node: Node, previous: boolean) => {
    let sibling = previous ? node.previousSibling : node.nextSibling;
    while (sibling?.nodeType === Node.TEXT_NODE && (sibling.textContent || "").split(ZERO_WIDTH_SPACE).join("") === "") {
        sibling = previous ? sibling.previousSibling : sibling.nextSibling;
    }
    return sibling?.nodeType === Node.ELEMENT_NODE && isSemanticInlineElement(sibling as Element) ?
        sibling as HTMLElement : undefined;
};

const setRangeAtSemanticStart = (range: Range, element: HTMLElement) => {
    const textNode = getFirstTextNode(element);
    if (!textNode) {
        return false;
    }
    range.setStart(textNode, getSemanticInternalMarkerPrefixLength(textNode.data));
    range.collapse(true);
    return true;
};

const setRangeAtSemanticEnd = (range: Range, element: HTMLElement) => {
    const textNode = getLastTextNode(element);
    if (!textNode) {
        return false;
    }
    range.setStart(textNode, textNode.data.length);
    range.collapse(true);
    return true;
};

const setRangeBeforeLeftBoundary = (range: Range, element: HTMLElement) => {
    const previousSibling = element.previousSibling;
    if (previousSibling?.nodeType === Node.TEXT_NODE) {
        const text = previousSibling.textContent || "";
        range.setStart(previousSibling, text.length - (text.match(/\u200b+$/u)?.[0].length || 0));
    } else {
        range.setStartBefore(element);
    }
    range.collapse(true);
    return true;
};

const setRangeAfterRightBoundary = (range: Range, element: HTMLElement) => {
    const nextSibling = element.nextSibling;
    if (nextSibling?.nodeType === Node.TEXT_NODE) {
        const text = nextSibling.textContent || "";
        range.setStart(nextSibling, text.match(/^\u200b+/u)?.[0].length || 0);
    } else {
        range.setStartAfter(element);
    }
    range.collapse(true);
    return true;
};

export const moveCaretAcrossSemanticMarker = (range: Range, direction: "left" | "right") => {
    if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) {
        return false;
    }
    const textNode = range.startContainer as Text;
    const semanticElement = textNode.parentElement?.closest("span[data-type]") as HTMLElement | null;
    if (isSemanticInlineElement(semanticElement)) {
        const firstTextNode = getFirstTextNode(semanticElement);
        const lastTextNode = getLastTextNode(semanticElement);
        const prefixLength = firstTextNode ? getSemanticInternalMarkerPrefixLength(firstTextNode.data) : 0;
        if (direction === "left" && textNode === firstTextNode && range.startOffset <= prefixLength) {
            return setRangeBeforeLeftBoundary(range, semanticElement);
        }
        if (direction === "right" && textNode === firstTextNode && range.startOffset < prefixLength) {
            return setRangeAtSemanticStart(range, semanticElement);
        }
        if (direction === "right" && textNode === lastTextNode && range.startOffset === textNode.data.length) {
            return setRangeAfterRightBoundary(range, semanticElement);
        }
        return false;
    }
    if (direction === "right") {
        const trailingBoundaryLength = textNode.data.match(/\u200b+$/u)?.[0].length || 0;
        const nextSemantic = getAdjacentSemanticInline(textNode, false);
        if (nextSemantic && range.startOffset >= textNode.data.length - trailingBoundaryLength) {
            return setRangeAtSemanticStart(range, nextSemantic);
        }
    } else {
        const leadingBoundaryLength = textNode.data.match(/^\u200b+/u)?.[0].length || 0;
        const previousSemantic = getAdjacentSemanticInline(textNode, true);
        if (previousSemantic && range.startOffset <= leadingBoundaryLength) {
            return setRangeAtSemanticEnd(range, previousSemantic);
        }
    }
    return false;
};

export const moveCaretForSemanticDelete = (range: Range, forward: boolean) => {
    if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) {
        return false;
    }
    const textNode = range.startContainer as Text;
    const semanticElement = textNode.parentElement?.closest("span[data-type]") as HTMLElement | null;
    if (isSemanticInlineElement(semanticElement)) {
        const firstTextNode = getFirstTextNode(semanticElement);
        const lastTextNode = getLastTextNode(semanticElement);
        const prefixLength = firstTextNode ? getSemanticInternalMarkerPrefixLength(firstTextNode.data) : 0;
        if (forward && textNode === firstTextNode && range.startOffset < prefixLength) {
            range.setStart(textNode, getSemanticForwardDeleteOffset(textNode.data, range.startOffset));
            range.collapse(true);
            return setRangeAtSemanticStart(range, semanticElement);
        }
        if (!forward && textNode === firstTextNode &&
            isSemanticBackwardDeleteBoundary(textNode.data, range.startOffset)) {
            return setRangeBeforeLeftBoundary(range, semanticElement);
        }
        if (forward && textNode === lastTextNode && range.startOffset === textNode.data.length) {
            return setRangeAfterRightBoundary(range, semanticElement);
        }
        return false;
    }
    if (forward) {
        const nextSemantic = getAdjacentSemanticInline(textNode, false);
        const boundaryLength = textNode.data.match(/\u200b+$/u)?.[0].length || 0;
        if (nextSemantic && range.startOffset >= textNode.data.length - boundaryLength) {
            return setRangeAtSemanticStart(range, nextSemantic);
        }
    } else {
        const previousSemantic = getAdjacentSemanticInline(textNode, true);
        const boundaryLength = textNode.data.match(/^\u200b+/u)?.[0].length || 0;
        if (previousSemantic && range.startOffset <= boundaryLength) {
            return setRangeAtSemanticEnd(range, previousSemantic);
        }
    }
    return false;
};
