import {hasClosestBlock} from "../protyle/util/hasClosest";

export type NewFileSelectionContext = {
    range: Range;
    notebookId: string;
    rootID: string;
    path: string;
    startBlockID: string;
    endBlockID: string;
    text: string;
};

export const isSameRange = (range: Range, targetRange: Range) => range.startContainer === targetRange.startContainer &&
    range.startOffset === targetRange.startOffset && range.endContainer === targetRange.endContainer &&
    range.endOffset === targetRange.endOffset;

export const isRangeInEditor = (editorElement: Element, range: Range) => range.startContainer.isConnected &&
    range.endContainer.isConnected && editorElement.contains(range.startContainer) && editorElement.contains(range.endContainer);

export const isNewFileSelectionValid = (protyle: IProtyle, context: NewFileSelectionContext) => {
    if (protyle.notebookId !== context.notebookId || protyle.block.rootID !== context.rootID ||
        protyle.path !== context.path || !isRangeInEditor(protyle.wysiwyg.element, context.range)) {
        return false;
    }
    const startBlockElement = hasClosestBlock(context.range.startContainer);
    const endBlockElement = hasClosestBlock(context.range.endContainer);
    return startBlockElement && endBlockElement &&
        startBlockElement.getAttribute("data-node-id") === context.startBlockID &&
        endBlockElement.getAttribute("data-node-id") === context.endBlockID && context.range.toString() === context.text;
};
