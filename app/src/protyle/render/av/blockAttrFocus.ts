const getNodeElement = (node: Node) => node.nodeType === 1 ? node as Element : node.parentElement;

const isRangeInEditor = (editorElement: HTMLElement, range?: Range) => Boolean(range?.startContainer.isConnected &&
    range.endContainer.isConnected && editorElement.contains(range.startContainer) &&
    editorElement.contains(range.endContainer));

export const getAVAttributeEditorRange = (editorElement: HTMLElement, currentRange?: Range, savedRange?: Range) => {
    const range = isRangeInEditor(editorElement, currentRange) ? currentRange : savedRange;
    return isRangeInEditor(editorElement, range) ? range.cloneRange() : undefined;
};

export const restoreAVAttributeEditorRange = (editorElement: HTMLElement, range?: Range,
                                              selection = document.getSelection()) => {
    if (!isRangeInEditor(editorElement, range) || !selection) {
        return false;
    }
    const startElement = getNodeElement(range.startContainer);
    const editableElement = startElement?.closest<HTMLElement>('[contenteditable="true"]');
    if (!editableElement || !editorElement.contains(editableElement)) {
        return false;
    }
    editableElement.focus({preventScroll: true});
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
};
