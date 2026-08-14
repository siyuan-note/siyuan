import {getContenteditableElement} from "./getBlock";
import {focusByOffset, getSelectionOffset, getUndoFocusContext, setLastNodeRange} from "../util/selection";
import {updateTransaction} from "./transaction";
import {Constants} from "../../constants";
import {
    getCodeBlockDeleteStart,
    getCodeBlockLineRange,
    getCodeTabSpace,
    resolveCodeTabSpaces,
    updateCodeBlockLines,
} from "./codeBlockUtil";

export const getCodeBlockTabSpace = (nodeElement: HTMLElement) => getCodeTabSpace(resolveCodeTabSpaces(
    nodeElement.getAttribute(Constants.CUSTOM_SY_CODE_TAB_SPACES),
    window.siyuan.config.editor.codeTabSpaces,
));

export const tabCodeBlock = (protyle: IProtyle, nodeElement: HTMLElement,
                             range: Range, outdent = false) => {
    const editableElement = getContenteditableElement(nodeElement) as HTMLElement;
    if (!editableElement) {
        return;
    }
    const undoFocusContext = getUndoFocusContext(protyle.wysiwyg.element, range, true);
    const tabSpace = getCodeBlockTabSpace(nodeElement);
    const oldHTML = nodeElement.outerHTML;
    if (range.collapsed) {
        if (outdent) {
            const caret = getSelectionOffset(editableElement, undefined, range).start;
            const deleteStart = getCodeBlockDeleteStart(editableElement.textContent, caret, tabSpace);
            if (deleteStart === caret) {
                return;
            }
            const deleteRange = focusByOffset(editableElement, deleteStart, caret, false) as Range;
            if (!deleteRange) {
                return;
            }
            deleteRange.deleteContents();
            const caretRange = focusByOffset(editableElement, deleteStart, deleteStart, false) as Range;
            if (!caretRange) {
                return;
            }
            range.setStart(caretRange.startContainer, caretRange.startOffset);
            range.collapse(true);
        } else {
            const textNode = document.createTextNode(tabSpace);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.collapse(true);
        }
        updateTransaction(protyle, nodeElement, oldHTML, undoFocusContext);
        return;
    }

    const position = getSelectionOffset(editableElement, undefined, range);
    const lineRange = getCodeBlockLineRange(editableElement.textContent, position.start, position.end);
    const normalizedRange = focusByOffset(editableElement, lineRange.start, lineRange.end, false) as Range;
    if (!normalizedRange) {
        return;
    }
    range.setStart(normalizedRange.startContainer, normalizedRange.startOffset);
    range.setEnd(normalizedRange.endContainer, normalizedRange.endOffset);
    const selectedText = range.toString();
    const text = updateCodeBlockLines(selectedText, tabSpace, outdent);
    if (text === selectedText) {
        return;
    }

    const wbrElement = document.createElement("wbr");
    range.insertNode(wbrElement);
    range.setStartAfter(wbrElement);
    range.extractContents();
    let language = nodeElement.querySelector(".protyle-action__language").textContent;
    // 语言优先级处理 https://github.com/siyuan-note/siyuan/issues/14767
    if (range.commonAncestorContainer.nodeType === 1) {
        const snippetClassName = (range.commonAncestorContainer as HTMLElement).className;
        if (snippetClassName.startsWith("language-")) {
            language = snippetClassName.replace("language-", "");
            // https://github.com/siyuan-note/siyuan/issues/14767
            if (wbrElement.parentElement !== range.commonAncestorContainer) {
                wbrElement.parentElement.after(wbrElement);
                wbrElement.previousElementSibling.remove();
            }
        }
    }
    if (!window.hljs.getLanguage(language)) {
        language = "plaintext";
    }
    wbrElement.insertAdjacentHTML("afterend", window.hljs.highlight(text, {
        language,
        ignoreIllegals: true
    }).value + "<br>");
    range.setStart(wbrElement.nextSibling, 0);
    const brElement = wbrElement.parentElement.querySelector("br");
    setLastNodeRange(brElement.previousSibling as Element, range, false);
    brElement.remove();
    updateTransaction(protyle, nodeElement, oldHTML, undoFocusContext);
    wbrElement.remove();
};
