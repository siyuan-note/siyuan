import {unwrapLongTextRuns} from "./longTextWrap";

const INLINE_BOUNDARY_ATTRIBUTE = "data-inline-boundary";
const INLINE_WRAP_ATTRIBUTE = "data-inline-wrap";
const SEMANTIC_INLINE_SELECTOR = 'span[data-type~="code"],span[data-type~="tag"],span[data-type~="kbd"]';
export const SEMANTIC_INLINE_HTML_REGEXP = /<span\b[^>]*\bdata-type=(?:"(?:[^"]* )?(?:code|kbd|tag)(?: [^"]*)?"|'(?:[^']* )?(?:code|kbd|tag)(?: [^']*)?')/iu;
const WORD_JOINER = "\u2060";
const ZERO_WIDTH_SPACE = "\u200b";

// 至少 32 个连续字符按字符折行，短词、空白和用户显式设置的断行边界保持原有语义。
export const isLongUnbrokenInlineText = (text: string) =>
    /^[^\s\u200b\u2060\ufeff]{32,}$/u.test(text.replace(/^[\u200b\u2060\ufeff]+/u, ""));

export const hasInlineElementBoundary = (element: Element | null | undefined) =>
    element?.hasAttribute(INLINE_BOUNDARY_ATTRIBUTE) ?? false;

export const getInlineElementBoundaryOffset = (node: Node) => {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.endsWith(WORD_JOINER)) {
        return -1;
    }
    let next = node.nextSibling;
    while (next?.nodeName === "WBR") {
        next = next.nextSibling;
    }
    return next?.nodeType === Node.ELEMENT_NODE && hasInlineElementBoundary(next as Element) ?
        node.textContent.length - 1 : -1;
};

export const getTextWithLegacyInlineBoundary = (node: Node) => {
    const text = node.textContent || "";
    const offset = getInlineElementBoundaryOffset(node);
    return offset < 0 ? text : text.substring(0, offset) + ZERO_WIDTH_SPACE + text.substring(offset + 1);
};

export const normalizeInlineElementBoundary = (element: HTMLElement) => {
    if (!element.matches(SEMANTIC_INLINE_SELECTOR)) {
        return;
    }
    element.toggleAttribute(INLINE_WRAP_ATTRIBUTE, isLongUnbrokenInlineText(element.textContent || ""));
    let previous = element.previousSibling;
    while (previous?.nodeName === "WBR") {
        previous = previous.previousSibling;
    }
    if (previous?.nodeType !== Node.TEXT_NODE) {
        return;
    }
    const text = getTextWithLegacyInlineBoundary(previous);
    let sibling = previous.previousSibling;
    while (sibling?.nodeName === "WBR" ||
        (sibling?.nodeType === Node.TEXT_NODE && /^[\s\u200b]*$/u.test(sibling.textContent || ""))) {
        sibling = sibling.previousSibling;
    }
    if (/[^\s\u200b]/u.test(text.substring(0, text.length - 1)) ||
        (sibling && sibling.nodeName !== "BR")) {
        // 正文后的元素保留断行机会，避免前面的单词与元素内的首个单词连成整体。
        restoreInlineElementBoundary(element);
        return;
    }
    if (previous.textContent?.endsWith(ZERO_WIDTH_SPACE)) {
        // 行首光标占位符不提供断行机会，避免连续文本整体移到空白首行之后。
        (previous as Text).replaceData(text.length - 1, 1, WORD_JOINER);
        element.toggleAttribute(INLINE_BOUNDARY_ATTRIBUTE, true);
    }
};

export const normalizeInlineElementBoundaries = (root: ParentNode) => {
    root.querySelectorAll<HTMLElement>(SEMANTIC_INLINE_SELECTOR).forEach(normalizeInlineElementBoundary);
    if (root instanceof HTMLElement) {
        normalizeInlineElementBoundary(root);
    }
};

export const restoreInlineElementBoundary = (element: HTMLElement) => {
    if (!hasInlineElementBoundary(element)) {
        return;
    }
    let previous = element.previousSibling;
    while (previous?.nodeName === "WBR") {
        previous = previous.previousSibling;
    }
    if (previous && getInlineElementBoundaryOffset(previous) >= 0) {
        (previous as Text).replaceData(getInlineElementBoundaryOffset(previous), 1, ZERO_WIDTH_SPACE);
    }
    element.removeAttribute(INLINE_BOUNDARY_ATTRIBUTE);
};

export const restoreInlineElementBoundaries = (root: ParentNode) => {
    unwrapLongTextRuns(root);
    root.querySelectorAll(`[${INLINE_WRAP_ATTRIBUTE}]`).forEach(element =>
        element.removeAttribute(INLINE_WRAP_ATTRIBUTE));
    if (root instanceof HTMLElement) {
        root.removeAttribute(INLINE_WRAP_ATTRIBUTE);
    }
    const elements = Array.from(root.querySelectorAll<HTMLElement>(`[${INLINE_BOUNDARY_ATTRIBUTE}]`));
    if (root instanceof HTMLElement && hasInlineElementBoundary(root)) {
        elements.unshift(root);
    }
    elements.forEach(restoreInlineElementBoundary);
};

export const prepareInlineElementBoundaryMutation = (range: Range) => {
    const ancestor = range.commonAncestorContainer;
    const root = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor as HTMLElement : ancestor.parentElement;
    if (!root) {
        return;
    }
    const elements = Array.from(root.querySelectorAll<HTMLElement>(`[${INLINE_BOUNDARY_ATTRIBUTE}]`));
    const inline = root.closest<HTMLElement>(`[${INLINE_BOUNDARY_ATTRIBUTE}]`);
    if (inline) {
        elements.unshift(inline);
    }
    const selected = elements.filter(element => range.intersectsNode(element));
    if (selected.length === 0) {
        return;
    }
    // 删除或替换元素前恢复其外部边界，避免元素消失后占位符失去归属。
    selected.forEach(restoreInlineElementBoundary);
    requestAnimationFrame(() => {
        if (root.isConnected) {
            normalizeInlineElementBoundaries(root);
        }
    });
};

export const restoreInlineElementBoundaryHTML = (html: string) => {
    if (!html.includes(INLINE_BOUNDARY_ATTRIBUTE) && !html.includes(INLINE_WRAP_ATTRIBUTE)) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    restoreInlineElementBoundaries(template.content);
    return template.innerHTML;
};

export const protectLuteInlineElementBoundaries = (lute: Lute): Lute => new Proxy(lute, {
    get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof property !== "string" || typeof value !== "function") {
            return value;
        }
        const consumesHTML = property.startsWith("BlockDOM2") || property === "SpinBlockDOM" ||
            property === "HTML2BlockDOM";
        const producesBlockDOM = property.endsWith("BlockDOM") || property === "Md2BlockDOMWithAutoLink";
        if (!consumesHTML && !producesBlockDOM) {
            return value;
        }
        // Lute 与内核继续接收兼容的零宽空格边界，显示占位符不进入文档内容。
        return (html: string, ...args: unknown[]) => {
            const input = consumesHTML ? restoreInlineElementBoundaryHTML(html) : html;
            const result = value.call(target, input, ...args);
            if (producesBlockDOM && typeof result === "string" && SEMANTIC_INLINE_HTML_REGEXP.test(result)) {
                const template = document.createElement("template");
                template.innerHTML = result;
                normalizeInlineElementBoundaries(template.content);
                return template.innerHTML;
            }
            return result;
        };
    },
});
