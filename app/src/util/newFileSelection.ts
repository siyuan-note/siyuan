import {hasClosestBlock} from "../protyle/util/hasClosest";

export type NewFileSelectionContext = {
    range: Range;
    notebookId: string;
    rootID: string;
    path: string;
    startBlockID: string;
    endBlockID: string;
    text: string;
    undoContext?: Record<string, string>;
};

export const createNewFileSelectionContext = (protyle: IProtyle, range: Range,
                                              undoContext?: Record<string, string>) => {
    // 固定触发时的文档和选区，异步创建完成后仅修改原位置 https://github.com/siyuan-note/siyuan/issues/16972
    const selectionRange = range.cloneRange();
    const startBlockElement = hasClosestBlock(selectionRange.startContainer);
    const endBlockElement = hasClosestBlock(selectionRange.endContainer);
    if (!startBlockElement || !endBlockElement) {
        return;
    }
    return {
        range: selectionRange,
        notebookId: protyle.notebookId,
        rootID: protyle.block.rootID,
        path: protyle.path,
        startBlockID: startBlockElement.getAttribute("data-node-id"),
        endBlockID: endBlockElement.getAttribute("data-node-id"),
        text: selectionRange.toString(),
        undoContext,
    } as NewFileSelectionContext;
};

export const isSameRange = (range: Range, targetRange: Range) => range.startContainer === targetRange.startContainer &&
    range.startOffset === targetRange.startOffset && range.endContainer === targetRange.endContainer &&
    range.endOffset === targetRange.endOffset;

export const isSameBlockRange = (range: Range) => {
    const startBlockElement = hasClosestBlock(range.startContainer);
    return !!startBlockElement && startBlockElement === hasClosestBlock(range.endContainer);
};

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
