import {hasClosestBlock} from "../../../protyle/util/hasClosest";
import {AGENT_QUOTE_SELECTOR} from "./agentQuote";
import {getUndoFocusContext} from "../../../protyle/util/selection";
import {focusByRange} from "../../../protyle/util/selectionOffsets";
import {updateTransaction} from "../../../protyle/wysiwyg/transaction";

export const AGENT_SKILL_SELECTOR = '[data-type~="text"][custom-agent-skill="true"]';
const atomicSelector = AGENT_SKILL_SELECTOR + ", " + AGENT_QUOTE_SELECTOR;

const getAgentToken = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)
    ?.closest(atomicSelector);

export const normalizeAgentTokens = (element: ParentNode) => {
    // 渲染、撤销和草稿恢复后继续将技能和引用标记视为整体。
    element.querySelectorAll<HTMLElement>(atomicSelector).forEach(token => {
        token.contentEditable = "false";
    });
};

export const expandAgentTokenSelection = (range: Range) => {
    const start = getAgentToken(range.startContainer);
    const end = getAgentToken(range.endContainer);
    if (range.collapsed) {
        if (start) {
            range.setStartAfter(start);
            range.collapse(true);
        }
        return;
    }
    // 触摸选区或全选可能落在不可编辑元素内部，替换、剪切时将边界扩展至整个标记。
    if (start) {
        range.setStartBefore(start);
    }
    if (end) {
        range.setEndAfter(end);
    }
};

export const deleteAgentToken = (protyle: IProtyle, event: InputEvent) => {
    if (protyle.disabled || !event.cancelable || event.isComposing ||
        !["deleteContentBackward", "deleteContentForward"].includes(event.inputType)) {
        return false;
    }
    const selection = getSelection();
    const root = protyle.wysiwyg.element;
    if (!selection?.rangeCount || !root.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        return false;
    }
    const range = selection.getRangeAt(0).cloneRange();
    const block = hasClosestBlock(range.startContainer);
    if (!block || block !== hasClosestBlock(range.endContainer)) {
        return false;
    }
    if (range.collapsed) {
        const backward = event.inputType === "deleteContentBackward";
        let token = getAgentToken(range.startContainer);
        if (!token) {
            let node = range.startContainer;
            const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
            const editable = element.closest('[contenteditable="true"]');
            if (!editable || !root.contains(editable)) {
                return false;
            }
            let offset = range.startOffset;
            // 只跨过光标占位符，普通空格和文字仍交给原生删除。
            while (node) {
                if (node.nodeType === Node.TEXT_NODE) {
                    const remaining = backward ? node.textContent.slice(0, offset) : node.textContent.slice(offset);
                    if (!/^[\u200b\ufeff]*$/.test(remaining)) {
                        return false;
                    }
                } else {
                    const child = node.childNodes[backward ? offset - 1 : offset];
                    if (child) {
                        if (child instanceof Element && child.matches(atomicSelector)) {
                            token = child;
                            break;
                        }
                        if (child instanceof Element && (child.tagName === "BR" || child.getAttribute("contenteditable") === "false")) {
                            return false;
                        }
                        node = child;
                        offset = backward ? (node.nodeType === Node.TEXT_NODE ? node.textContent.length : node.childNodes.length) : 0;
                        continue;
                    }
                }
                if (node === editable) {
                    return false;
                }
                offset = Array.from(node.parentNode.childNodes).indexOf(node as ChildNode) + (backward ? 0 : 1);
                node = node.parentNode;
            }
        }
        if (!token) {
            return false;
        }
        if (getAgentToken(range.startContainer)) {
            range.selectNode(token);
        } else if (backward) {
            range.setStartBefore(token);
        } else {
            range.setEndAfter(token);
        }
    } else {
        if (!Array.from(block.querySelectorAll(atomicSelector)).some(token => range.intersectsNode(token))) {
            return false;
        }
        expandAgentTokenSelection(range);
    }
    const oldHTML = block.outerHTML;
    const undoContext = getUndoFocusContext(root, selection.getRangeAt(0));
    event.preventDefault();
    event.stopImmediatePropagation();
    range.deleteContents();
    range.collapse(true);
    focusByRange(range);
    updateTransaction(protyle, block, oldHTML, undoContext, {
        doOperations: [], undoOperations: [], context: getUndoFocusContext(root, range),
    });
    return true;
};
