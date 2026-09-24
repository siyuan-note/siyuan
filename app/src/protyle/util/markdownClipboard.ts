const DOLLAR_PLACEHOLDER = "\uE000";

// 比较 Markdown 的普通 HTML 渲染结果，仅忽略块间排版空白及默认列表样式。
const normalizeClipboardHTML = (root: DocumentFragment) => {
    root.querySelectorAll("ol[style]").forEach(element => {
        if (/^\s*list-style-type\s*:\s*decimal\s*;?\s*$/i.test(element.getAttribute("style"))) {
            element.removeAttribute("style");
        }
    });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
    const remove: Node[] = [];
    let node: Node;
    while ((node = walker.nextNode())) {
        if (node.nodeType === Node.COMMENT_NODE ||
            (node.nodeType === Node.TEXT_NODE && !node.textContent.trim() &&
                (node.parentNode === root ||
                    /^(DIV|UL|OL|BLOCKQUOTE|TABLE|THEAD|TBODY|TFOOT|TR)$/.test(node.parentElement?.tagName)))) {
            remove.push(node);
        }
    }
    remove.forEach(node => node.parentNode.removeChild(node));
    root.normalize();
};

export const shouldPasteMarkdownFromHTML = (html: string, text: string) => {
    if (!html || !text?.trim() || text.includes(DOLLAR_PLACEHOLDER) || html.includes(DOLLAR_PLACEHOLDER)) {
        return false;
    }
    // 使用惰性片段进行比较，避免加载剪贴板中的图片或执行元素事件。
    const sourceTemplate = document.createElement("template");
    sourceTemplate.innerHTML = html;
    const source = sourceTemplate.content;
    const markdown = text.replace(/\r\n?|\u2028|\u2029/g, "\n");
    // 普通网页划选通常提供相同的可见文本，不能仅凭美元符号或 HTML 排版换行将其解释为 Markdown。
    if (source.textContent.trim() === markdown.trim()) {
        return false;
    }
    normalizeClipboardHTML(source);
    if (source.querySelector("[style], [class], math, svg, iframe, video, audio")) {
        return false;
    }
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    let node: Node;
    let hasUnrenderedContent = false;
    while ((node = walker.nextNode())) {
        if (!node.parentElement?.closest("pre, code") &&
            (/\n/.test(node.textContent) || /\$[^$\n]+\$/.test(node.textContent))) {
            hasUnrenderedContent = true;
            break;
        }
    }
    if (!hasUnrenderedContent) {
        return false;
    }
    const lute = Lute.New();
    lute.SetHeadingID(false);
    lute.SetInlineMath(false);
    // 临时遮蔽美元符号，模拟未解析公式的 Markdown 转换；实际粘贴仍使用完整的原始文本。
    const renderedTemplate = document.createElement("template");
    renderedTemplate.innerHTML = lute.MarkdownStr("", markdown.replaceAll("$", DOLLAR_PLACEHOLDER))
        .replaceAll(DOLLAR_PLACEHOLDER, "$");
    const rendered = renderedTemplate.content;
    rendered.querySelectorAll("br").forEach(element => element.remove());
    normalizeClipboardHTML(rendered);
    if (!source.isEqualNode(rendered)) {
        return false;
    }
    // 原始 HTML 标签可能生成 HTML 块，不能因预览一致就替换富文本；代码中的标签仍按代码保留。
    return !/<[!/?a-z]/i.test(markdown) || !lute.Md2BlockDOM(markdown).includes('data-type="NodeHTMLBlock"');
};
