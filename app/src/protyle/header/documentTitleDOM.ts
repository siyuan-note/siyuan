import {restoreInlineElementBoundaries} from "../util/inlineElementBoundary";

const paragraphSelector = '[data-type="NodeParagraph"]';

export const flattenDocumentTitlePaste = (blockDOM: string, text: string, internal: boolean) => {
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    const paragraph = document.createElement("div");
    paragraph.className = "p";
    paragraph.dataset.type = "NodeParagraph";
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    paragraph.append(editable);
    const content = Array.from(template.content.querySelectorAll(
        `${paragraphSelector} > [contenteditable], [data-type="NodeHeading"] > [contenteditable], ` +
        '[data-type="NodeTable"] th, [data-type="NodeTable"] td, [data-type="NodeCodeBlock"] .hljs > [contenteditable], ' +
        '[data-type="NodeMathBlock"][data-content]'
    ));
    if (internal && !template.content.querySelector('[data-type^="Node"]')) {
        const inline = document.createElement("div");
        inline.append(template.content);
        content.push(inline);
    }
    content.forEach(part => {
        const math = part.getAttribute("data-content");
        if (math !== null) {
            const inline = document.createElement("span");
            inline.className = "render-node";
            inline.dataset.type = "inline-math";
            inline.dataset.subtype = "math";
            inline.dataset.content = math;
            inline.contentEditable = "false";
            part.replaceChildren(inline);
        }
        if (!internal) {
            // 网页图像的替代文字属于标题文本，独立粘贴的图片文件由附件上传处理。
            part.querySelectorAll("img").forEach(image => {
                (image.closest(".img") || image).replaceWith(document.createTextNode(image.alt));
            });
        }
        part.normalize();
        if (part.firstChild?.nodeType === Node.TEXT_NODE) {
            part.firstChild.nodeValue = part.firstChild.nodeValue.replace(/^[ \t]+/, "");
        }
        if (part.lastChild?.nodeType === Node.TEXT_NODE) {
            part.lastChild.nodeValue = part.lastChild.nodeValue.replace(/[ \t]+$/, "");
        }
        if (!part.textContent.replace(/\u200b/g, "").trim() && !part.querySelector('img, [data-type~="inline-math"]')) {
            return;
        }
        if (editable.hasChildNodes()) {
            editable.append(" ");
        }
        editable.append(...Array.from(part.childNodes));
    });
    if (!editable.hasChildNodes() && text.trim()) {
        editable.textContent = text;
    }
    return editable.hasChildNodes() ? paragraph.outerHTML : "";
};

// 标题只有一个行级载体；先检查结构，避免清洗时悄悄丢掉粘贴的块。
export const getDocumentTitleUnsupportedPasteBlocks = (blockDOM: string) => {
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    const blocks = Array.from(template.content.querySelectorAll<HTMLElement>('[data-type^="Node"]'));
    if (blocks.some(block => !["NodeParagraph", "NodeHeading"].includes(block.dataset.type) ||
        block.dataset.type === "NodeHeading" && !block.querySelector(":scope > [contenteditable]")) ||
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
    const heading = template.content.querySelector<HTMLElement>('[data-type="NodeHeading"]');
    if (heading) {
        const paragraph = document.createElement("div");
        paragraph.className = "p";
        paragraph.dataset.type = "NodeParagraph";
        paragraph.dataset.nodeId = heading.dataset.nodeId || "";
        const editable = document.createElement("div");
        editable.contentEditable = "true";
        editable.innerHTML = heading.querySelector(":scope > [contenteditable]")?.innerHTML || "";
        paragraph.append(editable);
        heading.replaceWith(paragraph);
    }
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
    paragraph.querySelector(":scope > [contenteditable]")?.removeAttribute("data-tip");
    return template.innerHTML;
};

// 已有 NodeText 中可能触发行内语法的字符需要保护，单括号、连字符和数字间冒号保持普通文本。
// 后续输入仍按原生行级语法处理，保存前不需要引入私有标记。
export const prepareDocumentTitleInitialDOM = (blockDOM: string, id: string) => {
    const template = document.createElement("template");
    template.innerHTML = prepareDocumentTitleBlockDOM(blockDOM, id);
    const editable = template.content.querySelector<HTMLElement>(`${paragraphSelector} > [contenteditable]`);
    Array.from(editable?.childNodes || []).forEach(node => {
        if (node.nodeType !== Node.TEXT_NODE) {
            return;
        }
        const fragments = node.textContent.split(/([!"#$%&'*+,./;<=>?@[\\\]^_`{|}~]|\((?=\()|(?<=\()\(|:(?!\d)|(?<!\d):)/);
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
export const getDocumentTitleLute = (lute: Lute, getRenderedTitle?: () => HTMLElement): Lute => new Proxy(lute, {
    get(target, property) {
        if (property !== "SpinBlockDOM") {
            return Reflect.get(target, property);
        }
        return (blockDOM: string) => {
            const template = document.createElement("template");
            template.innerHTML = target.SpinInlineBlockDOM(blockDOM);
            template.content.querySelector(`${paragraphSelector} > [contenteditable]`)
                ?.classList.add("protyle-title__input");
            // 只复用当前编辑器中已渲染且公式源未变的缓存，不信任粘贴内容中的渲染标记。
            const rendered = new Map<string, HTMLElement>();
            getRenderedTitle?.()?.querySelectorAll<HTMLElement>(
                '[data-type="inline-math"][data-subtype="math"][data-render="true"]',
            ).forEach(element => rendered.set(element.dataset.content, element));
            template.content.querySelectorAll<HTMLElement>('[data-type="inline-math"][data-subtype="math"]')
                .forEach(element => {
                    const previous = rendered.get(element.dataset.content);
                    if (previous) {
                        element.replaceChildren(...Array.from(previous.childNodes, node => node.cloneNode(true)));
                        element.dataset.render = "true";
                        element.classList.toggle("ft__error", previous.classList.contains("ft__error"));
                    }
                });
            return template.innerHTML;
        };
    },
});
