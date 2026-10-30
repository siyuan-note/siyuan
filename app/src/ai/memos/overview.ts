// 概览中的记录引用仅在展示层隐藏，原始投影仍保留溯源信息。
export const memoryOverviewMarkdown = (markdown: string) => {
    let fence = "";
    return markdown.split("\n").map(line => {
        const marker = line.match(/^\s*(`{3,}|~{3,})/);
        if (marker) {
            if (!fence) { fence = marker[1]; }
            else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) { fence = ""; }
            return line;
        }
        if (fence || /^(?: {4}|\t)/.test(line)) { return line; }
        return line.replace(/(?:^|[ \t]+)(?:\[\d{14}-[a-z0-9]{7}\](?:\(siyuan:\/\/blocks\/\d{14}-[a-z0-9]{7}\))?[ \t]*)+$/, "");
    }).join("\n");
};

export const renderMemoryOverview = (element: HTMLElement, markdown: string) => {
    // 与资源预览相同，使用 Lute 和 DOMPurify，只允许静态排版。
    const html = Lute.New().MarkdownStr("", memoryOverviewMarkdown(markdown));
    element.innerHTML = window.DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "a", "strong", "b", "em", "i",
            "s", "del", "u", "sub", "sup", "mark", "kbd", "pre", "code", "blockquote", "ul", "ol", "li",
            "table", "thead", "tbody", "tr", "th", "td"],
        ALLOWED_ATTR: ["href", "title", "colspan", "rowspan", "start"],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    });
    element.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(link => {
        if (link.getAttribute("href").startsWith("#")) {
            // 展示不保留模型生成的 HTML ID，锚点不能改变应用路由。
            link.removeAttribute("href");
        } else {
            link.setAttribute("target", "_blank");
            link.setAttribute("rel", "noopener noreferrer");
        }
    });
};
