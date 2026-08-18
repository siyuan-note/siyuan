export const escapeHtml = (html: string) => {
    if (!html) {
        return html;
    }
    return html.replace(/&/g, "&amp;").replace(/</g, "&lt;");
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
