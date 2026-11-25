// 展开选区副本中的查询结果，供外部剪贴板使用。
export const expandQueryEmbedsForClipboard = (blockDOM: string): string => {
    if (!blockDOM.includes("NodeBlockQueryEmbed") && !blockDOM.includes("protyle-wysiwyg__embed")) {
        return blockDOM;
    }
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    const elements = template.content.querySelectorAll('[data-type="NodeBlockQueryEmbed"], .protyle-wysiwyg__embed');
    if (elements.length === 0) {
        return blockDOM;
    }
    // 从内向外展开，避免嵌套结果重复输出，并排除面包屑、操作按钮和错误提示。
    Array.from(elements).reverse().forEach(element => {
        const isResult = element.classList.contains("protyle-wysiwyg__embed");
        const blocks = isResult && !element.hasAttribute("data-id") ? [] :
            Array.from(element.children).filter(child => child.hasAttribute("data-node-id"));
        element.replaceWith(...blocks);
    });
    return template.innerHTML;
};

// 将剪贴板中的 JavaScript 查询保存为代码块，避免在插入后直接执行。
export const neutralizePastedJSEmbeds = (root: ParentNode, lute: Lute): boolean => {
    let changed = false;
    root.querySelectorAll('[data-type="NodeBlockQueryEmbed"][data-content]').forEach(element => {
        const content = Lute.UnEscapeHTMLStr(element.getAttribute("data-content"));
        if (!content.startsWith("//!js")) {
            return;
        }
        const template = document.createElement("template");
        template.innerHTML = lute.Md2BlockDOM("```js\n```");
        const code = template.content.firstElementChild;
        code.querySelector('[contenteditable="true"]').textContent = content;
        const id = element.getAttribute("data-node-id");
        if (id) {
            code.setAttribute("data-node-id", id);
        }
        element.replaceWith(code);
        changed = true;
    });
    return changed;
};

export const neutralizePastedJSEmbedHTML = (html: string, lute: Lute): string => {
    if (!html.includes("<")) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    return neutralizePastedJSEmbeds(template.content, lute) ? template.innerHTML : html;
};
