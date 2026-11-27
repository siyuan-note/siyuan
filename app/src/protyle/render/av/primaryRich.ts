import {escapeHtml} from "../../../util/escape";
import {sanitizeKernelHTML} from "../../../util/hostCapabilities";
import {getAVRichTextBlockDOM, getAVRichTextPreviewHTML, sanitizeAVRichTextBlockDOM, serializeAVRichTextBlockDOM} from "./richText";

export const getAVPrimaryInitialDOM = (value: IAVCellValue) => {
    const id = Lute.NewNodeID();
    if (value.block?.rich?.format === "kramdown") {
        return getAVRichTextBlockDOM(value.block.rich.content, true);
    }
    return sanitizeAVRichTextBlockDOM(value.block?.richBlockDOM ? sanitizeKernelHTML(value.block.richBlockDOM) :
        `<div class="p" data-type="NodeParagraph" data-node-id="${id}"><div contenteditable="true" spellcheck="false">${escapeHtml(value.block?.content || "")}</div></div>`, true);
};

export const getAVPrimaryPreviewHTML = (value: IAVCellValue) => {
    if (value.block?.rich?.format === "kramdown") {
        return getAVRichTextPreviewHTML(value.block.rich.content, true);
    }
    if (!value.block?.richBlockDOM) { return escapeHtml(value.block?.content || ""); }
    const template = document.createElement("template");
    template.innerHTML = sanitizeAVRichTextBlockDOM(sanitizeKernelHTML(value.block.richBlockDOM), true);
    const content = template.content.querySelector<HTMLElement>('[data-type="NodeParagraph"] > [contenteditable]');
    if (!content) { return escapeHtml(value.block.content || ""); }
    content.querySelectorAll(".protyle-action, .protyle-icons, .img__alt, .img__name, .protyle-attr, wbr").forEach(item => item.remove());
    content.querySelectorAll("[contenteditable], [spellcheck]").forEach(item => {
        item.removeAttribute("contenteditable"); item.removeAttribute("spellcheck");
    });
    return content.innerHTML;
};

export const createAVPrimaryEditValue = (blockDOM: string, source: IAVCellValue): IAVCellValue => {
    const serialized = serializeAVRichTextBlockDOM(blockDOM, undefined, true);
    return {type: "block", isDetached: source.isDetached,
        block: {...source.block, content: serialized.plainText,
            rich: null, richBlockDOM: serialized.blockDOM}};
};
