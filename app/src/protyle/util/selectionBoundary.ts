export const selectTextToEditorBoundary = (editorElement: HTMLElement, toStart: boolean,
                                           selection = getSelection()): Range | undefined => {
    if (!selection?.anchorNode ||
        (selection.anchorNode !== editorElement && !editorElement.contains(selection.anchorNode))) {
        return;
    }
    selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, editorElement,
        toStart ? 0 : editorElement.childNodes.length);
    if (selection.rangeCount === 0) {
        return;
    }
    return selection.getRangeAt(0);
};
