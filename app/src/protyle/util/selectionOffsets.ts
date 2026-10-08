import {Constants} from "../../constants";
import {revealTabsForTarget} from "../render/tabsRender";
import {getTextWithLegacyInlineBoundary} from "./inlineElementBoundary";
import {getMarkerAwareTextLength, getSemanticMarkerPrefixLengthForNode, stripSemanticMarkersFromRangeText} from "./inlineElementMarker";

const selectIsEditor = (editor: Element, range?: Range) => {
    if (!range) {
        if (getSelection().rangeCount === 0) {
            return false;
        } else {
            range = getSelection().getRangeAt(0);
        }
    }
    const container = range.commonAncestorContainer;

    return editor.isEqualNode(container) || editor.contains(container);
};

export const getSelectionOffset = (selectElement: Node, editorElement?: Element, range?: Range, ignoreZWSP = false) => {
    const position = {
        end: 0,
        start: 0,
    };

    if (!range) {
        if (getSelection().rangeCount === 0) {
            return position;
        }
        range = window.getSelection().getRangeAt(0);
    }

    if (editorElement && !selectIsEditor(editorElement, range)) {
        return position;
    }
    const preSelectionRange = range.cloneRange();
    if (selectElement.childNodes[0] && selectElement.childNodes[0].childNodes[0]) {
        preSelectionRange.setStart(selectElement.childNodes[0].childNodes[0], 0);
    } else {
        preSelectionRange.selectNodeContents(selectElement);
    }
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const getRangeTextLength = (textRange: Range) => ignoreZWSP ?
        stripSemanticMarkersFromRangeText(textRange).split(Constants.ZWSP).join("").length :
        textRange.toString().length;
    // 需加上表格内软换行 br 的长度
    position.start = getRangeTextLength(preSelectionRange) +
        preSelectionRange.cloneContents().querySelectorAll("br, .emoji").length;
    position.end = position.start + getRangeTextLength(range) +
        range.cloneContents().querySelectorAll("br, .emoji").length;
    return position;
};

const searchNode = (
    container: Node,
    startNode: Node,
    predicate: (node: Node) => boolean,
    excludeSibling?: boolean,
) => {
    if (!startNode) {
        return false;
    }

    if (predicate(startNode as Text)) {
        return true;
    }

    for (let i = 0, len = startNode.childNodes.length; i < len; i++) {
        if (searchNode(startNode, startNode.childNodes[i], predicate, true)) {
            return true;
        }
    }

    if (!excludeSibling) {
        let parentNode = startNode;
        while (parentNode && parentNode !== container) {
            let nextSibling = parentNode.nextSibling;
            while (nextSibling) {
                if (searchNode(container, nextSibling, predicate, true)) {
                    return true;
                }
                nextSibling = nextSibling.nextSibling;
            }
            parentNode = parentNode.parentNode;
        }
    }

    return false;
};

export const setLastNodeRange = (editElement: Element, range: Range, setStart = true) => {
    if (!editElement) {
        return range;
    }
    let lastNode = editElement.lastChild as Element;
    while (lastNode && lastNode.nodeType !== 3) {
        // https://github.com/siyuan-note/siyuan/issues/12792
        if (!lastNode.lastChild) {
            break;
        }
        // 最后一个为多种行内元素嵌套
        lastNode = lastNode.lastChild as Element;
    }
    // https://github.com/siyuan-note/siyuan/issues/12753
    if (!lastNode) {
        lastNode = editElement;
    }
    if (setStart) {
        if (lastNode.nodeType !== 3 && (lastNode.classList.contains("render-node") || lastNode.tagName === "BR") && lastNode.innerHTML === "") {
            range.setStartAfter(lastNode);
        } else {
            range.setStart(lastNode, lastNode.textContent.length);
        }
    } else {
        if (lastNode.nodeType !== 3 && (lastNode.classList.contains("render-node") || lastNode.tagName === "BR") && lastNode.innerHTML === "") {
            range.setEndAfter(lastNode);
        } else {
            range.setEnd(lastNode, lastNode.textContent.length);
        }
    }
    return range;
};

const getDOMOffset = (textNode: Text, offset: number, skipZWSP: boolean) => {
    const text = getTextWithLegacyInlineBoundary(textNode);
    const semanticPrefixLength = getSemanticMarkerPrefixLengthForNode(textNode);
    let domOffset = 0;
    let textOffset = 0;
    while (domOffset < text.length && textOffset < offset) {
        if (text[domOffset] !== Constants.ZWSP && domOffset >= semanticPrefixLength) {
            textOffset++;
        }
        domOffset++;
    }
    if (skipZWSP) {
        while (text[domOffset] === Constants.ZWSP || domOffset < semanticPrefixLength) {
            domOffset++;
        }
    }
    return domOffset;
};

// 根据正文偏移构造 DOM 选区，不执行编辑器的特殊块聚焦。
export const createRangeByOffsets = (container: Element, start: number, end: number, ignoreZWSP = false,
                                     fallbackElement: Element | null = container) => {
    if (!container) {
        return false;
    }
    const isSame = start === end;
    let startNode: Node;
    searchNode(container, container.firstChild, node => {
        if (node.nodeType === Node.TEXT_NODE) {
            const textNode = node as Text;
            const dataLength = ignoreZWSP ? getMarkerAwareTextLength(textNode, true) : textNode.data.length;
            if (start <= dataLength) {
                startNode = node;
                return true;
            }
            start -= dataLength;
            end -= dataLength;
            return false;
        } else if (node.nodeType === Node.ELEMENT_NODE &&
            ((node as Element).tagName === "BR" || (node as Element).classList.contains("emoji"))) {
            if (start <= 1) {
                startNode = node;
                return true;
            }
            start -= 1;
            end -= 1;
            return false;
        }
    });

    let endNode;
    if (startNode) {
        if (isSame) {
            endNode = startNode;
        } else {
            searchNode(container, startNode, node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const textNode = node as Text;
                    const dataLength = ignoreZWSP ? getMarkerAwareTextLength(textNode, true) : textNode.data.length;
                    if (end <= dataLength) {
                        endNode = node;
                        return true;
                    }
                    end -= dataLength;
                    return false;
                } else if (node.nodeType === Node.ELEMENT_NODE &&
                    ((node as Element).tagName === "BR" || (node as Element).classList.contains("emoji"))) {
                    if (end <= 1) {
                        endNode = node;
                        return true;
                    }
                    end -= 1;
                    return false;
                }
            });
        }
    }

    const range = document.createRange();
    if (startNode) {
        if (startNode.nodeType === Node.TEXT_NODE) {
            range.setStart(startNode, ignoreZWSP ? getDOMOffset(startNode as Text, start, true) : start);
        } else {
            range.setStartAfter(startNode);
        }
    } else {
        if (start === 0) {
            range.setStart(container, 0);
        } else {
            setLastNodeRange(fallbackElement, range);
        }
    }
    if (isSame) {
        range.collapse(true);
    } else {
        if (endNode) {
            if (endNode.nodeType === Node.TEXT_NODE) {
                range.setEnd(endNode, ignoreZWSP ? getDOMOffset(endNode as Text, end, false) : end);
            } else {
                range.setEndAfter(endNode);
            }
        } else {
            if (end === 0) {
                range.setEnd(container, 0);
            } else {
                setLastNodeRange(fallbackElement, range, false);
            }
        }
    }
    return range;
};

export const focusByRange = (range: Range) => {
    if (!range) {
        return;
    }

    const startNode = range.startContainer.childNodes[range.startOffset] as HTMLElement;
    if (startNode && startNode.nodeType !== 3 && ["INPUT", "TEXTAREA"].includes(startNode.tagName)) {
        startNode.focus();
        return;
    }
    const target = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
    if (target) {
        const tabTitle = target.closest(".tab-item-title");
        if (tabTitle) {
            tabTitle.closest<HTMLElement>(".tab-item").dataset.tabsEditing = "true";
        }
        revealTabsForTarget(target);
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
};
