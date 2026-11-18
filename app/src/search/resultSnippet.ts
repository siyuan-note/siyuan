interface SearchResultSnippet {
    mark: Element;
    prefix: Text;
    original: string;
}

const snippets = new WeakMap<Element, SearchResultSnippet>();
let observer: ResizeObserver;

const isMatchClipped = ({mark}: SearchResultSnippet) => {
    const content = mark.parentElement;
    const bounds = content.getBoundingClientRect();
    const match = mark.getBoundingClientRect();
    return match.bottom > bounds.bottom || match.left < bounds.left || match.right > bounds.right;
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

    // 批量读取布局，再更新前文，避免在结果行之间反复触发布局。
    const clipped = visible.filter(snippet => {
        return getComputedStyle(snippet.mark.parentElement).webkitLineClamp === "1" && isMatchClipped(snippet);
    });
    for (const snippet of clipped) {
        const context = Array.from(snippet.original).slice(-12).join("");
        snippet.prefix.data = context !== snippet.original ? "..." + context : "...";
    }
    for (const {prefix} of clipped.filter(isMatchClipped)) {
        prefix.data = "";
    }
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
