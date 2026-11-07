import {isHiddenTabContent} from "../render/tabsVisibility";
import {setTabTitleNavigationEditing} from "../render/tabsRender";

const getNodeElement = (node: Node) => node.nodeType === 1 ? node as Element : node.parentElement;

const isRangeInEditor = (editorElement: HTMLElement, range?: Range) => Boolean(range?.startContainer.isConnected &&
    range.endContainer.isConnected && editorElement.contains(range.startContainer) &&
    editorElement.contains(range.endContainer));

export const getEditorFocusRange = (editorElement: HTMLElement, currentRange?: Range, savedRange?: Range) => {
    const range = isRangeInEditor(editorElement, currentRange) ? currentRange : savedRange;
    return isRangeInEditor(editorElement, range) ? range.cloneRange() : undefined;
};

export const getEditorFocusRangeOutsideElement = (editorElement: HTMLElement, excludedElement: Element,
                                                  currentRange?: Range, savedRange?: Range) => {
    const range = getEditorFocusRange(editorElement, currentRange, savedRange);
    return range && !excludedElement.contains(range.startContainer) && !excludedElement.contains(range.endContainer) ?
        range : undefined;
};

export const canRestoreEditorFocus = (editorElement: HTMLElement) => {
    const active = document.activeElement;
    return editorElement.isConnected && editorElement.getClientRects().length > 0 &&
        (!active || active === document.body || active === editorElement || editorElement.contains(active));
};

export const restoreTabTitleEditing = (item: HTMLElement) => !isHiddenTabContent(item) &&
    (!item.parentElement?.classList.contains("tabs") || setTabTitleNavigationEditing(item, true));

export const restoreEditorFocusRange = (editorElement: HTMLElement, range?: Range,
                                        selection = document.getSelection()) => {
    if (!isRangeInEditor(editorElement, range) || !selection) {
        return false;
    }
    const startElement = getNodeElement(range.startContainer);
    const editableElement = startElement?.closest<HTMLElement>('[contenteditable="true"]');
    if (!editableElement || !editorElement.contains(editableElement)) {
        return false;
    }
    if (editableElement.classList.contains("tab-item-title")) {
        // 异步确认期间选区清空会结束页签标题编辑，恢复焦点前先同步显示标题输入层。
        const item = editableElement.closest<HTMLElement>(".tab-item");
        if (item && !restoreTabTitleEditing(item)) {
            return false;
        }
    }
    editableElement.focus({preventScroll: true});
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
};
