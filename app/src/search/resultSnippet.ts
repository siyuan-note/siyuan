interface SearchResultSnippet {
    mark: Element;
    prefix: Text;
    original: string;
    graphemes?: string[];
}

interface SearchResultSnippetLayout {
    snippet: SearchResultSnippet;
    style: CSSStyleDeclaration;
    ellipsisWidth?: number;
}

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : undefined;
const snippets = new WeakMap<Element, SearchResultSnippet>();
let observer: ResizeObserver;
let measureContext: CanvasRenderingContext2D;

const measureEllipsis = (style: CSSStyleDeclaration) => {
    measureContext ||= document.createElement("canvas").getContext("2d");
    if (!measureContext) {
        return Number.parseFloat(style.fontSize);
    }
    measureContext.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return measureContext.measureText("\u2026").width + (Number.parseFloat(style.letterSpacing) || 0);
};

const isMatchClipped = (layout: SearchResultSnippetLayout) => {
    const {snippet: {mark}, style} = layout;
    const content = mark.parentElement;
    const bounds = content.getBoundingClientRect();
    const match = mark.getBoundingClientRect();
    if (match.bottom > bounds.bottom || match.left < bounds.left || match.right > bounds.right) {
        return true;
    }
    if (!mark.nextSibling || (content.scrollHeight <= content.clientHeight && content.scrollWidth <= content.clientWidth)) {
        return false;
    }
    // 行尾省略号占用的空间不体现在高亮元素的矩形中。
    layout.ellipsisWidth ??= measureEllipsis(style);
    const spaceAfter = style.direction === "rtl" ? match.left - bounds.left : bounds.right - match.right;
    return spaceAfter < layout.ellipsisWidth;
};

const fitClippedSnippets = (layouts: SearchResultSnippetLayout[]) => {
    const candidates = layouts.map(layout => {
        const {snippet} = layout;
        snippet.graphemes ??= segmenter ? Array.from(segmenter.segment(snippet.original), item => item.segment) : Array.from(snippet.original);
        // 如果仅有省略号仍放不下命中，就从命中开始显示。
        return {layout, graphemes: snippet.graphemes, first: 1, last: snippet.graphemes.length + 1, trial: 0};
    });
    let pending = candidates;
    // 同一轮先写入每行的候选前文，再统一读取排版。
    while (pending.length > 0) {
        for (const candidate of pending) {
            const {layout, graphemes, first, last} = candidate;
            candidate.trial = Math.floor((first + last) / 2);
            layout.snippet.prefix.data = "..." + graphemes.slice(candidate.trial).join("");
        }
        for (const candidate of pending) {
            if (isMatchClipped(candidate.layout)) {
                candidate.first = candidate.trial + 1;
            } else {
                candidate.last = candidate.trial;
            }
        }
        pending = pending.filter(candidate => candidate.first < candidate.last);
    }
    for (const {layout, graphemes, first} of candidates) {
        layout.snippet.prefix.data = first <= graphemes.length ? "..." + graphemes.slice(first).join("") : "";
    }
};

const updateSnippets = (entries: ResizeObserverEntry[]) => {
    const visible: SearchResultSnippet[] = [];
    for (const {target, contentRect} of entries) {
        if (!target.isConnected) {
            observer.unobserve(target);
            snippets.delete(target);
            continue;
        }
        if (!contentRect.width) {
            continue;
        }
        const snippet = snippets.get(target);
        if (snippet.prefix.data !== snippet.original) {
            snippet.prefix.data = snippet.original;
        }
        visible.push(snippet);
    }

    const clipped: SearchResultSnippetLayout[] = [];
    for (const snippet of visible) {
        const style = getComputedStyle(snippet.mark.parentElement);
        const layout = {snippet, style};
        if (style.webkitLineClamp === "1" && isMatchClipped(layout)) {
            clipped.push(layout);
        }
    }
    fitClippedSnippets(clipped);
};

export const observeSearchResultSnippets = (list: Element) => {
    if (typeof ResizeObserver === "undefined") {
        return;
    }
    const contentSelector = '[data-type="search-item"] .b3-list-item__text:not(.b3-list-item__meta):not(.search__av-content)';
    list.querySelectorAll(contentSelector).forEach(content => {
        const prefix = content.firstChild;
        const mark = content.firstElementChild;
        if (prefix?.nodeType !== Node.TEXT_NODE || prefix.nextSibling !== mark || mark?.tagName !== "MARK") {
            return;
        }
        observer ||= new ResizeObserver(updateSnippets);
        snippets.set(content, {mark, prefix: prefix as Text, original: prefix.textContent});
        observer.observe(content);
    });
};
