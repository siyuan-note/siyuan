import {restoreInlineElementBoundaries} from "../util/inlineElementBoundary";

const paragraphSelector = '[data-type="NodeParagraph"]';

// 标题只有一个行级载体；先检查结构，避免清洗时悄悄丢掉粘贴的块。
export const getDocumentTitleUnsupportedPasteBlocks = (blockDOM: string) => {
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    const blocks = Array.from(template.content.querySelectorAll<HTMLElement>('[data-type^="Node"]'));
    if (blocks.some(block => block.dataset.type !== "NodeParagraph") ||
        blocks.length > 1 || (blocks.length === 1 && blocks[0].parentNode !== template.content)) {
        return [window.siyuan.languages.block];
    }
    return [];
};

export const prepareDocumentTitleBlockDOM = (blockDOM: string, id?: string) => {
    if (getDocumentTitleUnsupportedPasteBlocks(blockDOM).length) {
        throw new Error(window.siyuan.languages.documentTitleInlineOnly);
    }
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    restoreInlineElementBoundaries(template.content);
    const paragraph = template.content.querySelector<HTMLElement>(paragraphSelector);
    if (!paragraph) {
        return blockDOM;
    }
    if (id) {
        paragraph.dataset.nodeId = id;
    }
    paragraph.querySelectorAll("wbr").forEach(element => element.remove());
    paragraph.querySelectorAll(".protyle-attr").forEach(element => element.remove());
    paragraph.removeAttribute("data-document-title");
    return template.innerHTML;
};

// 已有 NodeText 是文字，不是等待解释的 Markdown。使用原生转义节点保护其标点；
// 后续输入的文本仍按原生行级语法处理，保存前也不需要引入私有标记。
export const prepareDocumentTitleInitialDOM = (blockDOM: string, id: string) => {
    const template = document.createElement("template");
    template.innerHTML = prepareDocumentTitleBlockDOM(blockDOM, id);
    const editable = template.content.querySelector<HTMLElement>(`${paragraphSelector} > [contenteditable]`);
    Array.from(editable?.childNodes || []).forEach(node => {
        if (node.nodeType !== Node.TEXT_NODE) {
            return;
        }
        const fragments = node.textContent.split(/([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/);
        if (fragments.length < 2) {
            return;
        }
        const replacement = document.createDocumentFragment();
        fragments.forEach((text, index) => {
            if (index % 2) {
                const escaped = document.createElement("span");
                escaped.dataset.type = "backslash";
                escaped.textContent = text;
                replacement.append(escaped);
            } else if (text) {
                replacement.append(document.createTextNode(text));
            }
        });
        node.replaceWith(replacement);
    });
    return template.innerHTML;
};

// 渲染缓存和临时载体 ID 不属于标题源，不能使公式渲染或只读切换产生保存事务。
export const getDocumentTitleDOMFingerprint = (blockDOM: string) => {
    const template = document.createElement("template");
    template.innerHTML = prepareDocumentTitleBlockDOM(blockDOM);
    template.content.querySelectorAll(".protyle-action, .protyle-icons, .img__alt, .img__name")
        .forEach(element => element.remove());
    template.content.querySelectorAll<HTMLElement>("*").forEach(element => {
        ["contenteditable", "spellcheck", "data-render", "data-node-id", "data-node-index", "updated", "spin", "prevent-popover"]
            .forEach(name => element.removeAttribute(name));
        element.classList.remove("protyle-wysiwyg--empty", "protyle-title__input", "protyle-wysiwyg--select",
            "protyle-wysiwyg--hl", "img--select", "img--drag");
        if (!element.className) {
            element.removeAttribute("class");
        }
    });
    template.content.querySelectorAll<HTMLElement>('.render-node[data-type~="inline-math"]').forEach(element => {
        element.replaceChildren();
    });
    return template.innerHTML;
};

// 原生行级解析器固定保留唯一的段落载体，块级 Markdown 和软换行不会改变标题结构。
export const getDocumentTitleLute = (lute: Lute): Lute => new Proxy(lute, {
    get(target, property) {
        if (property !== "SpinBlockDOM") {
            return Reflect.get(target, property);
        }
        return (blockDOM: string) => target.SpinInlineBlockDOM(blockDOM);
    },
});
