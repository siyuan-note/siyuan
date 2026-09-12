import {escapeHtml} from "./escape";

export const highlightSearchText = (text: string, keyword: string, caseSensitive: boolean) => {
    const terms = keyword.trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
    if (terms.length === 0) {
        return escapeHtml(text);
    }
    const pattern = new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), caseSensitive ? "g" : "gi");
    let html = "";
    let offset = 0;
    // 在原始文本中匹配，分别转义片段，避免高亮破坏实体或插入 HTML。
    for (const match of text.matchAll(pattern)) {
        html += escapeHtml(text.slice(offset, match.index)) + `<mark>${escapeHtml(match[0])}</mark>`;
        offset = match.index + match[0].length;
    }
    return html + escapeHtml(text.slice(offset));
};
