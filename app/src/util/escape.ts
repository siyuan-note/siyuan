export const escapeHtml = (html: string) => {
    if (!html) {
        return html;
    }
    return html.replace(/&/g, "&amp;").replace(/</g, "&lt;");
};

// 将纯文本中的 Markdown 标记转义，保留编辑器重新解析时的字面内容。
export const escapeMarkdownPlainText = (text: string) => {
    return text.replace(/\\/g, "\\\\")
        .replace(/\*/g, "\\*")
        .replace(/_/g, "\\_")
        .replace(/\[/g, "\\[")
        .replace(/]/g, "\\]")
        .replace(/!/g, "\\!")
        .replace(/`/g, "\\`")
        .replace(/</g, "\\<")
        .replace(/>/g, "\\>")
        .replace(/&/g, "\\&")
        .replace(/~/g, "\\~")
        .replace(/\{/g, "\\{")
        .replace(/}/g, "\\}")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
        .replace(/=/g, "\\=")
        .replace(/#/g, "\\#")
        .replace(/\$/g, "\\$")
        .replace(/\^/g, "\\^")
        .replace(/\|/g, "\\|")
        .replace(/\./g, "\\.");
};

export const stripSearchMark = (html: string) => {
    return html.replace(/<\/?mark>/g, "");
};

// 仅转义非搜索高亮的 < 字符，保留内核插入的 <mark> 高亮标签
export const escapeSearchHighlight = (html: string) => {
    return html.replace(/<(?!\/?mark>)/g, "&lt;");
};

export const escapeLessThans = (html: string) => {
    return html.replace(/</g, "&lt;");
};

export const escapeAttr = (html: string) => {
    if (!html) {
        return html;
    }
    return html.replace(/"/g, "&quot;").replace(/'/g, "&apos;");
};

export const escapeAriaLabel = (html: string) => {
    if (!html) {
        return html;
    }
    return html.replace(/"/g, "&quot;").replace(/'/g, "&apos;")
        .replace(/</g, "&amp;lt;").replace(/&lt;/g, "&amp;lt;");
};

export const decodeHTML = (html: string) => {
    const txtElement = document.createElement("textarea");
    txtElement.innerHTML = html;
    return txtElement.value;
};
