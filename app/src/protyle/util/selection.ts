import {
    getContenteditableElement,
    getNextBlock,
    getPreviousBlock,
    hasPreviousSibling,
    isNotEditBlock
} from "../wysiwyg/getBlock";
import {hasClosestByMatchTag} from "./hasClosest";
import {countBlockWord, countSelectWord} from "../../layout/status";

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

export const selectAll = (protyle: IProtyle, nodeElement: Element, range: Range) => {
    const editElement = getContenteditableElement(nodeElement);
    if (editElement) {
        let position;
        if (editElement.tagName === "TABLE") {
            const cellElement = hasClosestByMatchTag(range.startContainer, "TD") || hasClosestByMatchTag(range.startContainer, "TH");
            if (cellElement) {
                position = getSelectionOffset(cellElement, nodeElement, range);
                if (position.start !== 0 || position.end !== cellElement.textContent.length) {
                    range.setStart(cellElement.firstChild, 0);
                    range.setEndAfter(cellElement.lastChild);
                    protyle.toolbar.render(protyle, range);
                    countSelectWord(range);
                    return true;
                }
            }
        } else {
            position = getSelectionOffset(editElement, nodeElement, range);
            if (position.start !== 0 || position.end !== editElement.textContent.length) {
                // 全选后 rang 不对 https://ld246.com/article/1654848722251
                let firstChild = editElement.firstChild;
                while (firstChild) {
                    if (firstChild.nodeType === 3) {
                        if (firstChild.textContent !== "") {
                            range.setStart(firstChild, 0);
                            break;
                        }
                        firstChild = firstChild.nextSibling;
                    } else {
                        if ((firstChild as HTMLElement).classList.contains("render-node") ||
                            (firstChild as HTMLElement).classList.contains("img")) {
                            range.setStartBefore(firstChild);
                            break;
                        }
                        firstChild = firstChild.firstChild;
                    }
                }
                let lastChild = editElement.lastChild as HTMLElement;
                while (lastChild) {
                    if (lastChild.nodeType === 3) {
                        if (lastChild.textContent !== "") {
                            range.setEnd(lastChild, lastChild.textContent.length);
                            break;
                        }
                        lastChild = lastChild.previousSibling as HTMLElement;
                    } else {
                        if (lastChild.classList.contains("render-node") ||
                            lastChild.classList.contains("img") ||
                            lastChild.tagName === "BR") {
                            range.setEndAfter(lastChild);
                            break;
                        }
                        lastChild = lastChild.lastChild as HTMLElement;
                    }
                }
                protyle.toolbar.render(protyle, range);
                countSelectWord(range);
                return true;
            }
        }
    }
    range.collapse(true);
    const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
    if (protyle.wysiwyg.element.childElementCount === selectElements.length && selectElements[0].parentElement.isSameNode(protyle.wysiwyg.element)) {
        return true;
    }
    selectElements.forEach(item => {
        item.classList.remove("protyle-wysiwyg--select");
    });
    const ids: string [] = [];
    Array.from(protyle.wysiwyg.element.children).forEach(item => {
        item.classList.add("protyle-wysiwyg--select");
        ids.push(item.getAttribute("data-node-id"));
    });
    countBlockWord(ids);
};

export const getEditorRange = (element: Element) => {
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0);
        if (element.isSameNode(range.startContainer) || element.contains(range.startContainer)) {
            return range;
        }
    }
    // 代码块过长，在代码块的下一个块前删除，代码块会滚动到顶部，因粗需要 preventScroll
    (element as HTMLElement).focus({preventScroll: true});
    let targetElement;
    if (element.classList.contains("table")) {
        // 当光标不在表格区域中时表格无法被复制 https://ld246.com/article/1650510736504
        targetElement = element.querySelector("th") || element.querySelector("td");
    } else {
        targetElement = getContenteditableElement(element);
        if (!targetElement) {
            targetElement = element;
        }
    }
    range = targetElement.ownerDocument.createRange();
    range.setStart(targetElement || element, 0);
    range.collapse(true);
    return range;
};

export const getSelectionPosition = (nodeElement: Element, range?: Range) => {
    if (!range) {
        range = getEditorRange(nodeElement);
    }
    if (!nodeElement.contains(range.startContainer)) {
        return {
            left: 0,
            top: 0,
        };
    }
    let cursorRect;
    if (range.getClientRects().length === 0) {
        if (range.startContainer.nodeType === 3) {
            // 空行时，会出现没有 br 的情况，需要根据父元素 <p> 获取位置信息
            const parent = range.startContainer.parentElement;
            if (parent && parent.getClientRects().length > 0) {
                cursorRect = parent.getClientRects()[0];
            } else {
                return {
                    left: 0,
                    top: 0,
                };
            }
        } else {
            const children = (range.startContainer as Element).children;
            if (children[range.startOffset] &&
                children[range.startOffset].getClientRects().length > 0) {
                // markdown 模式回车
                cursorRect = children[range.startOffset].getClientRects()[0];
            } else if (range.startContainer.childNodes.length > 0) {
                // in table or code block
                const cloneRange = range.cloneRange();
                range.selectNode(range.startContainer.childNodes[Math.max(0, range.startOffset - 1)]);
                cursorRect = range.getClientRects()[0];
                range.setEnd(cloneRange.endContainer, cloneRange.endOffset);
                range.setStart(cloneRange.startContainer, cloneRange.startOffset);
            } else {
                cursorRect = (range.startContainer as HTMLElement).getClientRects()[0];
            }
            if (!cursorRect) {
                let parentElement = range.startContainer.childNodes[range.startOffset] as HTMLElement;
                if (!parentElement) {
                    parentElement = range.startContainer.childNodes[range.startOffset - 1] as HTMLElement;
                }
                while (!parentElement.getClientRects || (parentElement.getClientRects && parentElement.getClientRects().length === 0)) {
                    parentElement = parentElement.parentElement;
                }
                cursorRect = parentElement.getClientRects()[0];
            }
        }
    } else {
        cursorRect = range.getBoundingClientRect();
    }

    return {
        left: cursorRect.left,
        top: cursorRect.top,
    };
};

export const getSelectionOffset = (selectElement: Element, editorElement?: Element, range?: Range) => {
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
    position.start = preSelectionRange.toString().length;
    position.end = position.start + range.toString().length;
    return position;
};

function searchNode(
    container: Node,
    startNode: Node,
    predicate: (node: Node) => boolean,
    excludeSibling?: boolean,
): boolean {
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
}

export const setLastNodeRange = (editElement: Element, range: Range, setStart = true) => {
    if (!editElement) {
        return range;
    }
    let lastNode = editElement.lastChild;
    while (lastNode && lastNode.nodeType !== 3) {
        // 最后一个为多种行内元素嵌套
        lastNode = lastNode.lastChild;
    }
    if (!lastNode) {
        range.selectNodeContents(editElement);
        return range;
    }
    if (setStart) {
        range.setStart(lastNode, lastNode.textContent.length);
    } else {
        range.setEnd(lastNode, lastNode.textContent.length);
    }
    return range;
};

export const setFirstNodeRange = (editElement: Element, range: Range) => {
    if (!editElement) {
        return range;
    }
    let firstChild = editElement.firstChild;
    while (firstChild && firstChild.nodeType !== 3) {
        firstChild = firstChild.firstChild;
    }
    if (!firstChild) {
        range.selectNodeContents(editElement);
        return range;
    }
    range.setStart(firstChild, 0);
    return range;
};

export const focusByOffset = (container: Element, start: number, end: number) => {
    if (!container) {
        return false;
    }
    // 空块无法 focus
    const editElement = getContenteditableElement(container);
    if (editElement) {
        container = editElement;
    } else if (isNotEditBlock(container)) {
        return focusBlock(container);
    }
    let startNode;
    searchNode(container, container.firstChild, node => {
        if (node.nodeType === Node.TEXT_NODE) {
            const dataLength = (node as Text).data.length;
            if (start <= dataLength) {
                startNode = node;
                return true;
            }
            start -= dataLength;
            end -= dataLength;
            return false;
        }
    });

    let endNode;
    if (startNode) {
        searchNode(container, startNode, node => {
            if (node.nodeType === Node.TEXT_NODE) {
                const dataLength = (node as Text).data.length;
                if (end <= dataLength) {
                    endNode = node;
                    return true;
                }
                end -= dataLength;
                return false;
            }
        });
    }

    const range = document.createRange();
    if (startNode) {
        if (start < (startNode as Text).data.length) {
            range.setStart(startNode, start);
        } else {
            range.setStartAfter(startNode);
        }
    } else {
        if (start === 0) {
            range.setStart(container, 0);
        } else {
            setLastNodeRange(getContenteditableElement(container as Element), range);
        }
    }

    if (endNode) {
        if (end < (endNode as Text).data.length) {
            range.setEnd(endNode, end);
        } else {
            range.setEndAfter(endNode);
        }
    } else {
        if (end === 0) {
            range.setEnd(container, 0);
        } else {
            setLastNodeRange(getContenteditableElement(container as Element), range, false);
        }
    }
    focusByRange(range);
    return range;
};

export const focusByWbr = (element: Element, range: Range) => {
    const wbrElements = element.querySelectorAll("wbr");
    if (wbrElements.length === 0) {
        return;
    }
    // 没找到 wbr 产生多个的地方，先顶顶
    wbrElements.forEach((item, index) => {
        if (index !== 0) {
            item.remove();
        }
    });
    const wbrElement = wbrElements[0];
    if (!wbrElement.previousElementSibling) {
        if (wbrElement.previousSibling) {
            // text<wbr>
            range.setStart(wbrElement.previousSibling, wbrElement.previousSibling.textContent.length);
        } else if (wbrElement.nextSibling) {
            if (wbrElement.nextSibling.nodeType === 3) {
                // <wbr>text
                range.setStart(wbrElement.nextSibling, 0);
            } else {
                // <wbr><span>a</span>
                range.setStartAfter(wbrElement);
            }
        } else {
            // 内容为空
            range.setStart(wbrElement.parentElement, 0);
        }
    } else {
        const wbrPreviousSibling = hasPreviousSibling(wbrElement);
        if (wbrPreviousSibling && wbrElement.previousElementSibling.isSameNode(wbrPreviousSibling)) {
            if (wbrElement.previousElementSibling.lastChild?.nodeType === 3) {
                // <em>text</em><wbr> 需把光标放在里面，因为 chrome 点击后也是默认在里面
                range.setStart(wbrElement.previousElementSibling.lastChild, wbrElement.previousElementSibling.lastChild.textContent.length);
            } else if (wbrPreviousSibling.nodeType !== 3 && (wbrPreviousSibling as HTMLElement).classList.contains("img")) {
                // <img><wbr>, 删除图片后的唯一的一个字符
                range.setStartAfter(wbrPreviousSibling);
            } else {
                // <span class="hljs-function"><span class="hljs-keyword">fun</span></span>
                range.setStartBefore(wbrElement);
            }
        } else {
            // <em>text</em>text<wbr>
            range.setStart(wbrElement.previousSibling, wbrElement.previousSibling.textContent.length);
        }
    }
    range.collapse(true);
    wbrElement.remove();
    focusByRange(range);
};

export const focusByRange = (range: Range) => {
    if (!range) {
        return;
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
};

export const focusBlock = (element: Element, parentElement?: HTMLElement, toStart = true) => {
    if (!element) {
        return false;
    }
    // hr、嵌入块、数学公式、iframe、音频、视频、图表渲染块等，删除段落块后，光标位置矫正 https://github.com/siyuan-note/siyuan/issues/4143
    if (element.classList.contains("render-node") || element.classList.contains("iframe") || element.classList.contains("hr")) {
        const range = document.createRange();
        const type = element.getAttribute("data-type");
        let setRange = false;
        if (type === "NodeThematicBreak") {
            range.selectNodeContents(element.firstElementChild);
            setRange = true;
        } else if (type === "NodeBlockQueryEmbed") {
            if (element.lastElementChild.previousElementSibling?.firstChild) {
                range.selectNodeContents(element.lastElementChild.previousElementSibling.firstChild);
                range.collapse(true);
            } else {
                // https://github.com/siyuan-note/siyuan/issues/5267
                range.selectNodeContents(element);
                range.collapse(true);
            }
            setRange = true;
        } else if (["NodeMathBlock", "NodeHTMLBlock"].includes(type)) {
            if (element.lastElementChild.previousElementSibling?.lastElementChild?.firstChild) {
                // https://ld246.com/article/1655714737572
                range.selectNodeContents(element.lastElementChild.previousElementSibling.lastElementChild.firstChild);
                range.collapse(true);
            } else if (element.lastElementChild.previousElementSibling) {
                range.selectNodeContents(element.lastElementChild.previousElementSibling);
                range.collapse(true);
            }
            setRange = true;
        } else if (type === "NodeIFrame" || type === "NodeWidget") {
            range.setStart(element, 0);
            setRange = true;
        } else if (type === "NodeVideo") {
            range.setStart(element.firstElementChild, 0);
            setRange = true;
        } else if (type === "NodeAudio") {
            range.setStart(element.firstElementChild.lastChild, 0);
            setRange = true;
        } else if (type === "NodeCodeBlock") {
            range.selectNodeContents(element);
            range.collapse(true);
            setRange = true;
        }
        if (setRange) {
            focusByRange(range);
            return range;
        } else {
            focusSideBlock(element);
            return false;
        }
    }
    let cursorElement;
    if (toStart) {
        cursorElement = getContenteditableElement(element);
    } else {
        Array.from(element.querySelectorAll('[contenteditable="true"]')).reverse().find(item => {
            if (item.getBoundingClientRect().width > 0) {
                cursorElement = item;
                return true;
            }
        });
    }
    if (cursorElement) {
        if (cursorElement.tagName === "TABLE") {
            if (toStart) {
                cursorElement = cursorElement.querySelector("th, td");
            } else {
                const cellElements = cursorElement.querySelectorAll("th, td");
                cursorElement = cellElements[cellElements.length - 1];
            }
        }
        const range = getEditorRange(cursorElement);
        range.selectNodeContents(cursorElement);
        range.collapse(toStart);
        focusByRange(range);
        return range;
    } else if (parentElement) {
        parentElement.focus();
    }
    return false;
};

export const focusSideBlock = (updateElement: Element) => {
    if (updateElement.getAttribute("data-node-id")) {
        let sideBlockElement;
        let collapse;
        if (updateElement.nextElementSibling &&
            !updateElement.nextElementSibling.classList.contains("protyle-attr") // 用例 https://ld246.com/article/1661928364696
        ) {
            collapse = true;
            sideBlockElement = getNextBlock(updateElement) as HTMLElement;
        } else if (updateElement.previousElementSibling) {
            collapse = false;
            sideBlockElement = getPreviousBlock(updateElement) as HTMLElement;
        }
        if (!sideBlockElement) {
            sideBlockElement = updateElement;
        }
        focusBlock(sideBlockElement, undefined, collapse);
        return;
    }
    const range = getEditorRange(updateElement);
    if (updateElement.nextSibling) {
        range.selectNodeContents(updateElement.nextSibling);
        range.collapse(true);
    } else if (updateElement.previousSibling) {
        range.selectNodeContents(updateElement.previousSibling);
        range.collapse(false);
    }
    focusByRange(range);
};

