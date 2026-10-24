// 转义 HTML 文本和双引号属性值，保持 Lute.EscapeHTMLStr 的字符替换规则。
export const escapeHtmlTextAndAttr = (html: unknown) => {
    return String(html).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
};

// 纯文本写入 HTML 模板中的提示属性，需分别保护属性解析及提示框的 innerHTML 解析。
// 已转义的 hPath 只需 escapeHtmlTextAndAttr；setAttribute 接受的提示 HTML 不再转义属性层。
export const escapeTooltipTextAttr = (text: string) => escapeHtmlTextAndAttr(escapeHtmlTextAndAttr(text));

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
