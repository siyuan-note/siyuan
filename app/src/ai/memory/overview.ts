// 概览中的记录引用仅在展示层隐藏，原始投影仍保留溯源信息。
export const memoryOverviewMarkdown = (markdown: string) => {
    let fence = "";
    const id = "\\d{14}-[a-z0-9]{7}";
    const reference = `(?:\x60${id}\x60|\\[${id}\\](?:\\(siyuan:\\/\\/blocks\\/${id}\\))?|${id})`;
    const recordNote = new RegExp(`(?:^|[ \\t]+)\\((?:records?|记录|記錄|レコード):[ \\t]*${reference}(?:[ \\t]*[,;、][ \\t]*${reference})*[ \\t]*\\)[ \\t]*$`, "i");
    const referenceLine = new RegExp(`^[ \\t]*(?:[-*+] |\\d+\\. )?(?:(?:records?|记录|記錄|レコード):[ \\t]*)?${reference}(?:[ \\t]*[,;、][ \\t]*${reference})*[ \\t]*$`, "i");
    const lines = markdown.split("\n");
    const protectedLines = new Set<number>();
    lines.forEach((line, index) => {
        const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (marker) {
            if (!fence) { fence = marker[1]; }
            else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) { fence = ""; }
            protectedLines.add(index);
            return;
        }
        if (fence || /^(?: {4}|\t)/.test(line)) { protectedLines.add(index); }
    });
    let inlineStart = -1;
    let inlineMarker = "";
    lines.forEach((line, index) => {
        if (protectedLines.has(index)) { inlineMarker = ""; return; }
        for (const match of line.matchAll(/`+/g)) {
            const escapes = line.slice(0, match.index).match(/\\+$/)?.[0].length || 0;
            if (!inlineMarker && escapes % 2) { continue; }
            if (!inlineMarker) { inlineMarker = match[0]; inlineStart = index; }
            else if (inlineMarker === match[0]) {
                if (inlineStart !== index) {
                    for (let protectedIndex = inlineStart; protectedIndex <= index; protectedIndex++) { protectedLines.add(protectedIndex); }
                }
                inlineMarker = "";
            }
        }
    });
    const cleaned = lines.map((line, index) => {
        if (protectedLines.has(index)) { return line; }
        // 只隐藏纯文件名标题，不删除正文中提到文件名的句子或代码。
        if (/^ {0,3}#{1,6}[ \t]+`?(?:MEMORY|USER)\.md`?[ \t]*(?:#+[ \t]*)?$/i.test(line)) { return ""; }
        if (/^ {0,3}`?(?:MEMORY|USER)\.md`?[ \t]*$/i.test(line) && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index + 1] || "")) {
            lines[index + 1] = "";
            return "";
        }
        return line.replace(recordNote, "")
            .replace(/(?:^|[ \t]+)(?:\[\d{14}-[a-z0-9]{7}\](?:\(siyuan:\/\/blocks\/\d{14}-[a-z0-9]{7}\))?[ \t]*)+$/, "");
    });
    cleaned.forEach((line, index) => {
        if (protectedLines.has(index)) { return; }
        const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(?:Related records|Record references|关联记录|關聯記錄|関連レコード)[ \t]*#*[ \t]*$/i);
        if (!heading) { return; }
        let end = index + 1;
        while (end < lines.length && !(!protectedLines.has(end) && /^ {0,3}#{1,6}[ \t]+/.test(lines[end]))) { end++; }
        // 仅移除纯技术引用小节，含正文解释或代码的小节原样保留。
        if (lines.slice(index + 1, end).every((body, offset) => !body.trim() ||
            (!protectedLines.has(index + 1 + offset) && (referenceLine.test(body) || !body.replace(recordNote, "").trim())))) {
            cleaned.fill("", index, end);
        }
    });
    return cleaned.join("\n");
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
