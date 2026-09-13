import {getEditorFocusRange} from "../../protyle/util/editorFocus";

export const captureMenuKeyboard = (options: {
    protyle: IProtyle,
    keyboardOpen: boolean,
    isCurrent: () => boolean,
    restore: (range: Range) => void,
}) => {
    const {protyle} = options;
    const editorElement = protyle?.wysiwyg.element;
    if (!options.keyboardOpen || !editorElement?.contains(document.activeElement) || protyle.disabled) {
        return;
    }
    const selection = document.getSelection();
    const range = getEditorFocusRange(editorElement, selection?.rangeCount ? selection.getRangeAt(0) : undefined);
    if (!range) {
        return;
    }
    const rootID = protyle.block.rootID;
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    const dialogs = new Set(document.querySelectorAll(".b3-dialog--open"));
    let restored = false;
    return () => {
        if (restored) {
            return;
        }
        restored = true;
        // 选区节点删除后，浏览器会把 Range 移到父节点，不能据此恢复到其他位置。
        if (!options.isCurrent() || protyle.disabled || protyle.block.rootID !== rootID ||
            !editorElement.isConnected || editorElement.getClientRects().length === 0 ||
            !startContainer.isConnected || !endContainer.isConnected ||
            range.startContainer !== startContainer || range.endContainer !== endContainer ||
            !getEditorFocusRange(editorElement, range)) {
            return;
        }
        const activeElement = document.activeElement;
        if (activeElement && activeElement !== document.body && !editorElement.contains(activeElement) &&
            !document.getElementById("commonMenu")?.contains(activeElement)) {
            return;
        }
        if (Array.from(document.querySelectorAll(".b3-dialog--open")).some(dialog => !dialogs.has(dialog))) {
            return;
        }
        protyle.toolbar.range = range;
        options.restore(range);
    };
};
