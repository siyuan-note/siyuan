export interface ITextBlockContext {
    editor: HTMLElement;
    range: Range;
    disabled: boolean;
    lite: boolean;
}

export interface IBlockTypeOption {
    key: string;
    lang: string;
    icon: string;
    type: TTurnInto | TTurnIntoOne;
    level?: number;
    current: boolean;
    disabled: boolean;
}

const elementOf = (node: Node) => node?.nodeType === 1 ? node as Element : node?.parentElement;

// 仅识别实际承载文字的子块，不把容器标题或跨块选区提升为父块。
export const getTextSelectionBlock = ({editor, range, disabled, lite}: ITextBlockContext): HTMLElement | undefined => {
    if (disabled || lite || !editor?.isConnected || editor.dataset.readonly === "true" || !range || range.collapsed ||
        !range.startContainer.isConnected || !range.endContainer.isConnected ||
        !range.toString().replace(/[\u200b-\u200f\u2060-\u2064\ufeff]/g, "").trim() ||
        editor.querySelector(".protyle-wysiwyg--select")) {
        return;
    }
    const start = elementOf(range.startContainer);
    const end = elementOf(range.endContainer);
    if (start?.closest(".protyle-wysiwyg") !== editor || end?.closest(".protyle-wysiwyg") !== editor) {
        return;
    }
    const block = start.closest<HTMLElement>("[data-node-id][data-type]");
    if (!block || block !== end.closest("[data-node-id][data-type]") ||
        !["NodeParagraph", "NodeHeading"].includes(block.dataset.type) ||
        block.closest('td, th, .tab-item[data-tabs-hidden="true"]')) {
        return;
    }
    const editable = start.closest("[contenteditable]");
    if (!editable || editable !== end.closest("[contenteditable]") ||
        editable.getAttribute("contenteditable") !== "true" || editable.parentElement !== block) {
        return;
    }
    return block;
};

export const getBlockTypeKey = (block: HTMLElement) => block.dataset.type === "NodeHeading" ?
    `heading${block.dataset.subtype?.slice(1)}` : "paragraph";

export const getBlockTypeOptions = (block: HTMLElement): IBlockTypeOption[] => {
    if (!["NodeParagraph", "NodeHeading"].includes(block.dataset.type)) {
        return [];
    }
    const current = getBlockTypeKey(block);
    const parent = block.parentElement;
    // 包装唯一子块会触发既有转换器取消超级块；带列宽的子块也不能在包装时丢失外层布局。
    const changesParent = parent?.classList.contains("sb") &&
        (parent.querySelectorAll(":scope > [data-node-id]").length === 1 || !!block.style.width || !!block.style.flex);
    return [{key: "paragraph", lang: "paragraph", icon: "iconParagraph", type: "Blocks2Ps" as const},
        ...[1, 2, 3, 4, 5, 6].map(level => ({
            key: `heading${level}`, lang: `heading${level}`, icon: `iconH${level}`, type: "Blocks2Hs" as const, level,
        })),
        {key: "list", lang: "list", icon: "iconList", type: "Blocks2ULs" as const},
        {key: "orderedList", lang: "ordered-list", icon: "iconOrderedList", type: "Blocks2OLs" as const},
        {key: "check", lang: "check", icon: "iconCheck", type: "Blocks2TLs" as const},
        {key: "quote", lang: "quote", icon: "iconQuote", type: "Blocks2Blockquote" as const},
        {key: "callout", lang: "callout", icon: "iconCallout", type: "Blocks2Callout" as const},
    ].map(option => ({...option, current: option.key === current,
        disabled: Boolean(changesParent && !["Blocks2Ps", "Blocks2Hs"].includes(option.type))}));
};

export const captureTextBlockSelection = (context: ITextBlockContext, rootID: string) => {
    const block = getTextSelectionBlock(context);
    if (!block) {
        return;
    }
    const range = context.range.cloneRange();
    const ancestors: Array<{element: HTMLElement, parent: HTMLElement, attributes: Array<string | null>}> = [];
    for (let element = block.parentElement; element && element !== context.editor; element = element.parentElement) {
        ancestors.push({element, parent: element.parentElement,
            attributes: ["data-node-id", "data-type", "data-subtype", "data-sb-layout", "style"].map(name => element.getAttribute(name))});
    }
    return {
        editor: context.editor, rootID, block, parent: block.parentElement, ancestors,
        id: block.dataset.nodeId, type: block.dataset.type, subtype: block.dataset.subtype,
        text: block.textContent, range,
        start: range.startContainer, startOffset: range.startOffset,
        end: range.endContainer, endOffset: range.endOffset,
    };
};

export type TTextBlockSelection = ReturnType<typeof captureTextBlockSelection>;

export const isTextBlockSelectionValid = (snapshot: TTextBlockSelection, context: ITextBlockContext,
                                        rootID: string) => !!snapshot && snapshot.editor === context.editor &&
    snapshot.rootID === rootID && snapshot.block === getTextSelectionBlock({...context, range: snapshot.range}) &&
    snapshot.parent === snapshot.block.parentElement && snapshot.id === snapshot.block.dataset.nodeId &&
    snapshot.type === snapshot.block.dataset.type && snapshot.subtype === snapshot.block.dataset.subtype &&
    snapshot.text === snapshot.block.textContent && snapshot.start === snapshot.range.startContainer &&
    snapshot.startOffset === snapshot.range.startOffset && snapshot.end === snapshot.range.endContainer &&
    snapshot.endOffset === snapshot.range.endOffset && snapshot.ancestors.every(ancestor =>
        ancestor.element.parentElement === ancestor.parent &&
        ["data-node-id", "data-type", "data-subtype", "data-sb-layout", "style"].every((name, index) =>
            ancestor.element.getAttribute(name) === ancestor.attributes[index]));

export const isSameTextRange = (left: Range, right: Range) => !!left && !!right &&
    left.startContainer === right.startContainer && left.startOffset === right.startOffset &&
    left.endContainer === right.endContainer && left.endOffset === right.endOffset;
