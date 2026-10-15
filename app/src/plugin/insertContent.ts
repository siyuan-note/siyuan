import type {Protyle} from "../protyle";
import {getRememberedEditorFocusRange, rememberEditorFocusRange} from "../protyle/util/editorFocusMemory";
import {getEditorFocusRange, restoreEditorFocusRange} from "../protyle/util/editorFocus";
import {hasClosestBlock, isInEmbedBlock} from "../protyle/util/hasClosest";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {insertHTML} from "../protyle/util/insertHTML";
import {getProtyleBlockDOMSanitizer, getProtyleUnsupportedPasteBlocks} from "../protyle/runtimeCapabilities";
import {blockRender} from "../protyle/render/blockRender";
import {processRender} from "../protyle/util/processCode";
import {highlightRender} from "../protyle/render/highlightRender";
import {avRender} from "../protyle/render/av/render";

export interface IInsertContentOptions {
    data: string;
    dataType?: "markdown" | "html";
    editor?: Protyle;
    range?: Range;
}

export interface IInsertContentResult {
    status: "inserted" | "no-editor" | "readonly" | "invalid-range" | "unsupported-range" |
        "unsupported-content" | "empty-content";
}

const isVisible = (editor: Protyle) => editor?.protyle.wysiwyg.element.ownerDocument === document &&
    editor.protyle.wysiwyg.element.isConnected &&
    !editor.protyle.wysiwyg.element.closest(".fn__none, [inert]") &&
    editor.protyle.wysiwyg.element.getClientRects().length > 0;

const getInsertionEditor = (editors: Protyle[], range?: Range) => {
    const visible = editors.filter(isVisible);
    const selected = range && visible.find(editor => editor.protyle.wysiwyg.element.contains(range.startContainer));
    if (selected) {
        return selected;
    }
    const active = visible.find(editor => editor.protyle.element.closest(".layout__wnd--active"));
    if (active) {
        return active;
    }
    return visible.reduce<Protyle | undefined>((latest, editor) => {
        const time = Number(editor.protyle.model?.headElement?.dataset.activetime) || 0;
        const latestTime = Number(latest?.protyle.model?.headElement?.dataset.activetime) || 0;
        return !latest || time > latestTime ? editor : latest;
    }, undefined);
};

const isEditableBoundary = (root: HTMLElement, node: Node) => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (element?.closest("[contenteditable]")?.getAttribute("contenteditable") === "false") {
        return false;
    }
    const block = hasClosestBlock(node);
    if (!block || isInEmbedBlock(block) || block.getAttribute("data-type") === "NodeAttributeView") {
        return false;
    }
    const editable = getContenteditableElement(block, node);
    return !!editable && root.contains(editable) && (editable === node || editable.contains(node));
};

export const insertEditorContent = (options: IInsertContentOptions, editors: Protyle[]): IInsertContentResult => {
    if (typeof options?.data !== "string" || options.dataType && !["markdown", "html"].includes(options.dataType)) {
        throw new TypeError("Content must be a string with markdown or html dataType");
    }
    const selection = document.getSelection();
    const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    const editor = options.editor || getInsertionEditor(editors, currentRange);
    if (!editor || !isVisible(editor)) {
        return {status: "no-editor"};
    }
    const protyle = editor.protyle;
    const root = protyle.wysiwyg.element;
    if (protyle.disabled || protyle.element.getAttribute("data-readonly") === "true" ||
        root.getAttribute("data-readonly") === "true") {
        return {status: "readonly"};
    }
    if (!options.range && currentRange &&
        root.contains(currentRange.startContainer) !== root.contains(currentRange.endContainer)) {
        return {status: "invalid-range"};
    }
    const range = options.range ? getEditorFocusRange(root, options.range) :
        getEditorFocusRange(root, currentRange, getRememberedEditorFocusRange(root));
    if (!range) {
        return {status: "invalid-range"};
    }
    if (!isEditableBoundary(root, range.startContainer) || !isEditableBoundary(root, range.endContainer) ||
        Array.from(root.querySelectorAll('[data-type="NodeBlockQueryEmbed"], [data-type="NodeAttributeView"], [data-readonly="true"]'))
            .some(element => range.intersectsNode(element))) {
        return {status: "unsupported-range"};
    }
    if (options.data === "") {
        return {status: "empty-content"};
    }
    const block = hasClosestBlock(range.startContainer);
    const inCode = block && (block.getAttribute("data-type") === "NodeCodeBlock" ||
        protyle.toolbar.getCurrentType(range).includes("code"));
    let html = inCode ? options.data : options.dataType === "html" ?
        protyle.lute.HTML2BlockDOM(options.data) : protyle.lute.Md2BlockDOM(options.data);
    if (!inCode) {
        if (getProtyleUnsupportedPasteBlocks(protyle)?.(html).length) {
            return {status: "unsupported-content"};
        }
        html = getProtyleBlockDOMSanitizer(protyle)?.(html) ?? html;
    }
    if (!html) {
        return {status: "empty-content"};
    }
    if (!restoreEditorFocusRange(root, range)) {
        return {status: "unsupported-range"};
    }
    protyle.toolbar.range = range;
    insertHTML(html, protyle, false, true, true);
    blockRender(protyle, root);
    processRender(root);
    highlightRender(root);
    avRender(root, protyle);
    const insertedRange = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    if (insertedRange) {
        rememberEditorFocusRange(root, insertedRange);
    }
    return {status: "inserted"};
};
