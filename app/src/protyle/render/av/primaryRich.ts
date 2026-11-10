import {escapeHtml} from "../../../util/escape";
import {sanitizeKernelHTML} from "../../../util/hostCapabilities";
import {prepareDocumentTitleInitialDOM, prepareDocumentTitleBlockDOM} from "../../header/documentTitleDOM";

export const getAVPrimaryInitialDOM = (value: IAVCellValue) => {
    const id = Lute.NewNodeID();
    return prepareDocumentTitleInitialDOM(value.block?.richBlockDOM ? sanitizeKernelHTML(value.block.richBlockDOM) :
        `<div data-type="NodeParagraph" data-node-id="${id}"><div contenteditable="true">${escapeHtml(value.block?.content || "")}</div></div>`, id);
};

export const getAVPrimaryPreviewHTML = (value: IAVCellValue) => {
    if (!value.block?.richBlockDOM) { return escapeHtml(value.block?.content || ""); }
    const template = document.createElement("template");
    template.innerHTML = sanitizeKernelHTML(value.block.richBlockDOM);
    const content = template.content.querySelector<HTMLElement>('[data-type="NodeParagraph"] > [contenteditable]');
    if (!content) { return escapeHtml(value.block.content || ""); }
    content.querySelectorAll(".protyle-action, .protyle-icons, .img__alt, .img__name, .protyle-attr, wbr").forEach(item => item.remove());
    content.querySelectorAll("[contenteditable], [spellcheck]").forEach(item => {
        item.removeAttribute("contenteditable"); item.removeAttribute("spellcheck");
    });
    return content.innerHTML;
};

export const createAVPrimaryEditValue = (blockDOM: string, source: IAVCellValue): IAVCellValue => {
    const dom = prepareDocumentTitleBlockDOM(blockDOM);
    return {type: "block", isDetached: source.isDetached,
        block: {...source.block, content: Lute.BlockDOM2Content(dom).replace(/\u200b/g, "").replace(/[\r\n]/g, " "),
            rich: null, richBlockDOM: dom}};
};
