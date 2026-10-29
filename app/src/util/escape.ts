// 字符类扫描适合短文本，长文本使用 V8 更高效的字面量扫描路径。
const SINGLE_PASS_ESCAPE_MAX_LENGTH = 512;

// 转义 HTML 文本和双引号属性值，保持 Lute.EscapeHTMLStr 的字符替换规则。
export const escapeHtmlTextAndAttr = (html: unknown) => {
    const text = String(html);
    if (text.length > SINGLE_PASS_ESCAPE_MAX_LENGTH) {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    return text.replace(/[&<>"]/g, (char) => {
        switch (char) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            default:
                return "&quot;";
        }
    });
};

// 纯文本写入 HTML 模板中的提示属性，需分别保护属性解析及提示框的 innerHTML 解析。
// 已渲染为 HTML 的路径只需 escapeHtmlTextAndAttr；纯文本搜索范围仍需两层。
// setAttribute 接受的提示 HTML 不再转义属性层。
export const escapeTooltipTextAttr = (text: string) => escapeHtmlTextAndAttr(escapeHtmlTextAndAttr(text));

// V8 的字面量正则扫描更适合长正文，两个字符的转义分别处理。
export const escapeHtml = (html: string) => {
    if (!html) {
        return html;
    }
    return html.replace(/&/g, "&amp;").replace(/</g, "&lt;");
};

// 将纯文本中的 Markdown 标记转义，保留编辑器重新解析时的字面内容。
export const escapeMarkdownPlainText = (text: string) => {
    if (text.length > SINGLE_PASS_ESCAPE_MAX_LENGTH) {
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
    }
    return text.replace(/[\\*_[\]!`<>&~{}()=#$^|.]/g, "\\$&");
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

// 理由同 escapeHtml：两个字符的转义保持逐字面量替换。
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
    if (html.length > SINGLE_PASS_ESCAPE_MAX_LENGTH) {
        return html.replace(/"/g, "&quot;").replace(/'/g, "&apos;")
            .replace(/</g, "&amp;lt;").replace(/&lt;/g, "&amp;lt;");
    }
    return html.replace(/&lt;|["'<]/g, (match) => {
        switch (match) {
            case '"':
                return "&quot;";
            case "'":
                return "&apos;";
            default:
                return "&amp;lt;";
        }
    });
};

export const decodeHTML = (html: string) => {
    const txtElement = document.createElement("textarea");
    txtElement.innerHTML = html;
    return txtElement.value;
};
