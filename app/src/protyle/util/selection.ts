import {
    getContenteditableElement,
    getNextBlock,
    getPreviousBlock,
    hasPreviousSibling,
    isContainerBlock,
    isEndOfBlock,
    isNotEditBlock
} from "../wysiwyg/getBlock";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    isInEmbedBlock
} from "./hasClosest";
import {countBlockWord, countSelectWord} from "../../layout/status";
import {hideElements} from "../ui/hideElements";
import {genRenderFrame} from "../render/util";
import {Constants} from "../../constants";

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

// table 选中处理
export const fixTableRange = (range: Range) => {
    const tableElement = hasClosestByAttribute(range.startContainer, "data-type", "NodeTable");
    if (range.toString() !== "" && tableElement && range.commonAncestorContainer.nodeType !== 3) {
        const parentTag = (range.commonAncestorContainer as Element).tagName;
        if (parentTag !== "TH" && parentTag !== "TD") {
            const startCellElement = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
            const endCellElement = hasClosestByTag(range.endContainer, "TD") || hasClosestByTag(range.endContainer, "TH");
            if (!startCellElement && !endCellElement) {
                const cellElement = tableElement.querySelector("th") || tableElement.querySelector("td");
                range.setStart(cellElement.firstChild, 0);
                range.setEnd(cellElement.lastChild, cellElement.lastChild.textContent.length);
            } else if (startCellElement &&
                // 不能包含自身元素，否则对 cell 中的部分文字两次高亮后就会选中整个 cell。 https://github.com/siyuan-note/siyuan/issues/3649 第二点
                !startCellElement.contains(range.endContainer)) {
                setLastNodeRange(startCellElement, range, false);
            }
        }
    }
};

export const selectAll = (protyle: IProtyle, nodeElement: Element, range: Range): boolean => {
    const editElement = getContenteditableElement(nodeElement);
    if (editElement) {
        let position;
        if (editElement.tagName === "TABLE") {
            const cellElement = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
            if (cellElement) {
                position = getSelectionOffset(cellElement, nodeElement, range);
                if (position.start !== 0 || position.end !== cellElement.textContent.length) {
                    range.setStart(cellElement.firstChild, 0);
                    range.setEndAfter(cellElement.lastChild);
                    protyle.toolbar.render(protyle, range);
                    countSelectWord(range, protyle.block.rootID);
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
                // 列表回车后，左键全选无法选中
                focusByRange(range);
                protyle.toolbar.render(protyle, range);
                countSelectWord(range, protyle.block.rootID);
                return true;
            }
        }
    }
    range.collapse(true);
    const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
    if (selectElements.length > 0 && protyle.wysiwyg.element.childElementCount === selectElements.length &&
        selectElements[0].parentElement === protyle.wysiwyg.element) {
        return false;
    }
    hideElements(["select"], protyle);
    const ids: string[] = [];
    Array.from(protyle.wysiwyg.element.children).forEach(item => {
        const nodeId = item.getAttribute("data-node-id");
        if (nodeId) {
            item.classList.add("protyle-wysiwyg--select");
            ids.push(nodeId);
        }
    });
    countBlockWord(ids, protyle.block.rootID);
    return false;
};

export const getBlockRangeSelectElements = (rangeStartElement: HTMLElement, rangeEndElement: HTMLElement) => {
    let startElement = rangeStartElement;
    let endElement = rangeEndElement;
    let toDown = true;
    const startRect = startElement.getBoundingClientRect();
    const endRect = endElement.getBoundingClientRect();
    let startTop = startRect.top;
    let endTop = endRect.top;
    if (startTop === endTop) {
        // 横排 https://ld246.com/article/1663036247544
        startTop = startRect.left;
        endTop = endRect.left;
    }
    if (startTop > endTop) {
        const tempElement = endElement;
        endElement = startElement;
        startElement = tempElement;
        const tempTop = endTop;
        endTop = startTop;
        startTop = tempTop;
        toDown = false;
    }
    let selectElements: HTMLElement[] = [];
    let currentElement: HTMLElement = startElement;
    let hasJump = false;
    while (currentElement) {
        if (currentElement.classList.contains("protyle-breadcrumb__bar")) {
            currentElement = currentElement.nextElementSibling as HTMLElement;
        }
        if (currentElement && !currentElement.classList.contains("protyle-attr")) {
            const currentRect = currentElement.getBoundingClientRect();
            if (startRect.top === endRect.top ? currentRect.left <= endTop : currentRect.top <= endTop) {
                if (hasJump) {
                    // 父节点的下个节点在选中范围内才可使用父节点作为选中节点
                    if (currentElement.nextElementSibling &&
                        !currentElement.nextElementSibling.classList.contains("protyle-attr")) {
                        const currentNextRect = currentElement.nextElementSibling.getBoundingClientRect();
                        if (startRect.top === endRect.top ?
                            currentNextRect.left <= endTop && currentNextRect.bottom <= endRect.bottom :
                            currentNextRect.top <= endTop) {
                            selectElements = [currentElement];
                            currentElement = currentElement.nextElementSibling as HTMLElement;
                            hasJump = false;
                        } else if (currentElement.parentElement.classList.contains("sb")) {
                            currentElement = hasClosestBlock(currentElement.parentElement) as HTMLElement;
                            hasJump = true;
                        } else {
                            break;
                        }
                    } else {
                        currentElement = hasClosestBlock(currentElement.parentElement) as HTMLElement;
                        hasJump = true;
                    }
                } else {
                    if (!currentElement.classList.contains("sb__resize")) {
                        selectElements.push(currentElement);
                    }
                    currentElement = currentElement.nextElementSibling as HTMLElement;
                }
            } else if (currentElement.parentElement.classList.contains("sb")) {
                // 跳出超级块横向排版中的未选中元素
                currentElement = hasClosestBlock(currentElement.parentElement) as HTMLElement;
                hasJump = true;
            } else {
                break;
            }
        } else {
            currentElement = hasClosestBlock(currentElement.parentElement) as HTMLElement;
            hasJump = true;
        }
    }
    return {endElement, selectElements, startElement, toDown};
};

export const getBlockElementsByRange = (range: Range) => {
    const startBlockElement = hasClosestBlock(range.startContainer);
    const endBlockElement = hasClosestBlock(range.endContainer);
    if (!startBlockElement || !endBlockElement) {
        return [];
    }
    const startElement = (isInEmbedBlock(startBlockElement) || startBlockElement) as HTMLElement;
    const endElement = (isInEmbedBlock(endBlockElement) || endBlockElement) as HTMLElement;
    return startElement === endElement ? [startElement] :
        getBlockRangeSelectElements(startElement, endElement).selectElements;
};

export const selectBlocksByRange = (protyle: IProtyle, range: Range) => {
    const selectElements = getBlockElementsByRange(range);
    if (selectElements.length === 0) {
        return;
    }
    selectElements.forEach(selectElement => {
        selectElement.classList.add("protyle-wysiwyg--select");
        selectElement.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
            item.classList.remove("protyle-wysiwyg--select");
        });
    });
    range.collapse(false);
    countBlockWord(selectElements.map(item => item.getAttribute("data-node-id")), protyle.block.rootID);
};

// https://github.com/siyuan-note/siyuan/issues/8196
export const getRangeByPoint = (x: number, y: number) => {
    const range = document.caretRangeFromPoint(x, y);
    const imgElement = hasClosestByAttribute(range.startContainer, "data-type", "img");
    if (imgElement) {
        range.setStart(imgElement.nextSibling, 0);
        range.collapse();
    }
    // 列表标记不承载编辑内容，拖放命中时将插入点定位到列表项正文开头。
    const actionElement = hasClosestByClassName(range.startContainer, "protyle-action");
    const blockElement = actionElement && hasClosestBlock(actionElement);
    const editableElement = blockElement && getContenteditableElement(blockElement);
    if (editableElement) {
        range.selectNodeContents(editableElement);
        range.collapse(true);
    }
    return range;
};

export const getEditorRange = (element: Element): Range => {
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0);
        if (element === range.startContainer || element.contains(range.startContainer)) {
            if (range.toString() === "" && range.startContainer.nodeType === 1) {
                // 有时候点击编辑器头部需要矫正到第一个块中
                if (range.startOffset === 0 && (range.startContainer as HTMLElement).classList.contains("protyle-wysiwyg")) {
                    const focusRange = focusBlock(range.startContainer.firstChild as Element);
                    if (focusRange) {
                        return focusRange;
                    }
                }
                // 移动端获取有偏差 https://github.com/siyuan-note/siyuan/issues/15998
                if ((range.startContainer as Element).getAttribute("contenteditable") !== "true" &&
                    getContenteditableElement(range.startContainer as Element)) {
                    const blockElement = hasClosestBlock(range.startContainer);
                    if (blockElement) {
                        const focusRange = focusBlock(blockElement);
                        if (focusRange) {
                            return focusRange;
                        }
                    }
                }
            }
            return range;
        }
    }

    if (element.classList.contains("li") || element.classList.contains("list")) {
        const childElement = element.querySelector("[data-node-id]");
        if (childElement) {
            return getEditorRange(childElement);
        }
    }

    // 代码块过长，在代码块的下一个块前删除，代码块会滚动到顶部，因粗需要 preventScroll
    (element as HTMLElement).focus({preventScroll: true});
    if (!range) {
        range = document.createRange();
    }

    let targetElement;
    if (element.classList.contains("table")) {
        // 当光标不在表格区域中时表格无法被复制 https://ld246.com/article/1650510736504
        targetElement = element.querySelector("th") || element.querySelector("td");
    } else {
        targetElement = getContenteditableElement(element);
        if (!targetElement) {
            const type = element.getAttribute("data-type");
            if (type === "NodeThematicBreak") {
                targetElement = element.firstElementChild;
            } else if (type === "NodeBlockQueryEmbed") {
                targetElement = element.querySelector(".protyle-cursor")?.firstChild;
            } else if (["NodeMathBlock", "NodeHTMLBlock"].includes(type)) {
                targetElement = element.lastElementChild.previousElementSibling?.lastElementChild?.firstChild;
            } else if (type === "NodeVideo") {
                targetElement = element.firstElementChild.firstChild;
            } else if (type === "NodeAudio") {
                targetElement = element.firstElementChild.lastChild;
            }
        } else if (targetElement.tagName === "TABLE") {
            // 文档中开头为表格，获取错误 https://ld246.com/article/1663408335459?r=88250
            targetElement = targetElement.querySelector("th") || element.querySelector("td");
        }
    }
    range.setStart(targetElement || element, 0);
    range.collapse(true);
    return range;
};

interface IClosestSelectionRect {
    rect: DOMRect;
    rectIndex: number;
    left: number;
    verticalDistance: number;
    horizontalDistance: number;
}

const getDistanceToInterval = (value: number, start: number, end: number) => {
    if (value < start) {
        return start - value;
    }
    if (value > end) {
        return value - end;
    }
    return 0;
};

const getClosestSelectionRect = (rects: DOMRectList, position: IPosition) => {
    const rectArray = Array.from(rects);
    const hasTextRect = rectArray.some(rect => rect.width > 0.5 && rect.height > 0.5);
    let closest: IClosestSelectionRect | undefined;
    rectArray.forEach((rect, rectIndex) => {
        if (hasTextRect && (rect.width <= 0.5 || rect.height <= 0.5)) {
            return;
        }
        const verticalDistance = getDistanceToInterval(position.y, rect.top, rect.bottom);
        const horizontalDistance = getDistanceToInterval(position.x, rect.left, rect.right);
        // 文本按行排列，优先比较垂直距离，避免较长的其他行因水平距离较近而被选中
        if (!closest ||
            verticalDistance < closest.verticalDistance - 0.5 ||
            (Math.abs(verticalDistance - closest.verticalDistance) <= 0.5 &&
                horizontalDistance < closest.horizontalDistance)) {
            closest = {
                rect,
                rectIndex,
                left: Math.max(rect.left, Math.min(position.x, rect.right)),
                verticalDistance,
                horizontalDistance,
            };
        }
    });
    return closest;
};

export const getSelectionPosition = (nodeElement: Element, range?: Range, useDirect = false,
                                     position?: IPosition) => {
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
            const parentRects = range.startContainer.parentElement?.getClientRects();
            // 连续粘贴图片时
            const previousRects = (range.startContainer as Element).previousElementSibling?.getClientRects();
            if (parentRects.length > 0 || previousRects.length > 0) {
                if (parentRects.length === 0 || (previousRects &&
                    previousRects.length > 0 && parentRects[0].top < previousRects[previousRects.length - 1].bottom)) {
                    cursorRect = {
                        left: previousRects[previousRects.length - 1].left,
                        top: previousRects[previousRects.length - 1].bottom,
                    };
                } else {
                    cursorRect = parentRects[0];
                }
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
                if (range.startOffset === 0) {
                    let firstNode = range.startContainer.childNodes[range.startOffset] || range.startContainer.firstChild;
                    while (firstNode) {
                        if (firstNode.textContent === "" && firstNode.nodeType === 3) {
                            if (!firstNode.previousSibling) {
                                break;
                            }
                            firstNode = firstNode.previousSibling;
                        } else {
                            break;
                        }
                    }
                    range.selectNodeContents(firstNode);
                    range.collapse(true);
                } else {
                    let lastNode = range.startContainer.childNodes[range.startOffset] || range.startContainer.lastChild;
                    while (lastNode) {
                        if (lastNode.textContent === "" && lastNode.nodeType === 3) {
                            if (!lastNode.previousSibling) {
                                break;
                            }
                            lastNode = lastNode.previousSibling;
                        } else {
                            break;
                        }
                    }
                    range.selectNodeContents(lastNode);
                    range.collapse(false);
                }
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
                if (!parentElement) {
                    cursorRect = range.getBoundingClientRect();
                } else {
                    while (!parentElement.getClientRects || (parentElement.getClientRects && parentElement.getClientRects().length === 0)) {
                        parentElement = parentElement.parentElement;
                    }
                    cursorRect = parentElement.getClientRects()[0];
                }
            }
        }
    } else {
        const rects = range.getClientRects(); // 由于长度过长折行，光标在行首时有多个 rects https://github.com/siyuan-note/siyuan/issues/6156
        if (range.toString()) {
            if (useDirect) {
                if (position) {
                    const closest = getClosestSelectionRect(rects, position);
                    if (closest) {
                        const textRects = Array.from(rects).filter(rect => rect.width > 0.5 && rect.height > 0.5);
                        const compareRects = textRects.length > 0 ? textRects : Array.from(rects);
                        const maxTop = Math.max(...compareRects.map(rect => rect.top));
                        const minBottom = Math.min(...compareRects.map(rect => rect.bottom));
                        const isSingleLine = maxTop <= minBottom + 0.5;
                        let isBottom = false;
                        if (!isSingleLine) {
                            const centers = compareRects.map(rect => (rect.top + rect.bottom) / 2);
                            const closestCenter = (closest.rect.top + closest.rect.bottom) / 2;
                            isBottom = Math.abs(Math.max(...centers) - closestCenter) <
                                Math.abs(closestCenter - Math.min(...centers));
                        }
                        return {
                            left: closest.left,
                            top: isBottom ? closest.rect.bottom : closest.rect.top,
                            isBottom,
                            rectIndex: closest.rectIndex,
                        };
                    }
                }
                const selection = window.getSelection() as Selection & {
                    direction: "forward" | "backward" | "none"
                };
                // 判断选择方向
                const isBackward = (selection && "direction" in selection && selection.direction !== "none") ?
                    selection.direction === "backward"
                    : range.startContainer === selection?.focusNode && range.startOffset === selection?.focusOffset;
                const isBottom = !isBackward && rects[0].top !== rects[rects.length - 1].top;
                return {
                    // 向左选择：使用第一个矩形的左边界；向右选择：使用最后一个矩形的右边界
                    left: isBackward ? rects[0].left : rects[rects.length - 1].right,
                    // 如果向右选择时有多个垂直位置不同的矩形：使用最后一个矩形的下边界；否则使用第一个矩形的上边界
                    top: isBottom ? rects[rects.length - 1].bottom : rects[0].top,
                    isBottom,
                    rectIndex: isBottom ? rects.length - 1 : 0,
                };
            } else {
                return {    // 选中多行不应遮挡第一行 https://github.com/siyuan-note/siyuan/issues/7541
                    left: rects[rects.length - 1].left,
                    top: rects[0].top
                };
            }
        } else {
            return {    // 代码块首 https://github.com/siyuan-note/siyuan/issues/13113
                left: rects[rects.length - 1].left,
                top: rects[rects.length - 1].top
            };
        }
    }

    return {
        left: cursorRect.left,
        top: cursorRect.top,
    };
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
    const getTextLength = (text: string) => (ignoreZWSP ? text.split(Constants.ZWSP).join("") : text).length;
    // 需加上表格内软换行 br 的长度
    position.start = getTextLength(preSelectionRange.toString()) +
        preSelectionRange.cloneContents().querySelectorAll("br, .emoji").length;
    position.end = position.start + getTextLength(range.toString()) +
        range.cloneContents().querySelectorAll("br, .emoji").length;
    return position;
};

export interface IBlockRange {
    blockElement: HTMLElement;
    editableElement: Element;
    range: Range;
    start: number;
    end: number;
}

export const getBlockRanges = (editorElement: Element, selectedRange: Range, excludeTypes: string[] = []) => {
    const ranges: IBlockRange[] = [];
    if (!editorElement.contains(selectedRange.startContainer) || !editorElement.contains(selectedRange.endContainer)) {
        return ranges;
    }
    const startElement = hasClosestBlock(selectedRange.startContainer);
    const endElement = hasClosestBlock(selectedRange.endContainer);
    const blockWalker = document.createTreeWalker(editorElement, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
            const element = node as HTMLElement;
            if (element.getAttribute("data-type") === "NodeBlockQueryEmbed") {
                return NodeFilter.FILTER_REJECT;
            }
            return element.hasAttribute("data-node-id") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
    });
    let item = startElement as HTMLElement;
    if (item) {
        blockWalker.currentNode = item;
    } else {
        item = blockWalker.nextNode() as HTMLElement;
    }
    let rangeStarted = false;
    while (item) {
        const editableElement = getContenteditableElement(item);
        const isEditableBlock = editableElement && hasClosestBlock(editableElement) === item;
        const intersects = isEditableBlock && selectedRange.intersectsNode(editableElement);
        if (intersects) {
            rangeStarted = true;
        } else if (rangeStarted && isEditableBlock) {
            break;
        }
        if (!intersects || excludeTypes.includes(item.getAttribute("data-type")) || isInEmbedBlock(item)) {
            item = blockWalker.nextNode() as HTMLElement;
            continue;
        }
        if (item.getAttribute("data-type") === "NodeTable") {
            editableElement.querySelectorAll("th, td").forEach(cellElement => {
                if (!selectedRange.intersectsNode(cellElement)) {
                    return;
                }
                const cellRange = document.createRange();
                cellRange.selectNodeContents(cellElement);
                if (cellElement.contains(selectedRange.startContainer)) {
                    cellRange.setStart(selectedRange.startContainer, selectedRange.startOffset);
                }
                if (cellElement.contains(selectedRange.endContainer)) {
                    cellRange.setEnd(selectedRange.endContainer, selectedRange.endOffset);
                }
                if (!cellRange.collapsed) {
                    const position = getSelectionOffset(cellElement, undefined, cellRange);
                    ranges.push({
                        blockElement: item,
                        editableElement: cellElement,
                        range: cellRange,
                        start: position.start,
                        end: position.end,
                    });
                }
            });
        } else {
            const blockRange = document.createRange();
            blockRange.selectNodeContents(editableElement);
            if (item === startElement) {
                blockRange.setStart(selectedRange.startContainer, selectedRange.startOffset);
            }
            if (item === endElement) {
                blockRange.setEnd(selectedRange.endContainer, selectedRange.endOffset);
            }
            if (!blockRange.collapsed) {
                const position = getSelectionOffset(editableElement, undefined, blockRange);
                ranges.push({
                    blockElement: item,
                    editableElement,
                    range: blockRange,
                    start: position.start,
                    end: position.end,
                });
            }
        }
        item = blockWalker.nextNode() as HTMLElement;
    }
    return ranges;
};

// 记录选区位置，供撤销或重做回放完成后恢复。
export const getUndoFocusContext = (editorElement: Element, range?: Range, ignoreZWSP = false):
Record<string, string> | undefined => {
    if (!range || !editorElement.contains(range.startContainer) || !editorElement.contains(range.endContainer)) {
        return undefined;
    }
    const startBlockElement = hasClosestBlock(range.startContainer);
    const endBlockElement = hasClosestBlock(range.endContainer);
    if (!startBlockElement || !endBlockElement || (!ignoreZWSP && startBlockElement !== endBlockElement)) {
        return undefined;
    }
    const startEditableElement = getContenteditableElement(startBlockElement) || startBlockElement;
    const endEditableElement = getContenteditableElement(endBlockElement) || endBlockElement;
    if (!startEditableElement.contains(range.startContainer) || !endEditableElement.contains(range.endContainer)) {
        return undefined;
    }
    const startBlockElements = Array.from(editorElement.querySelectorAll(
        `[data-node-id="${startBlockElement.getAttribute("data-node-id")}"]`
    ));
    const endBlockElements = startBlockElement === endBlockElement ? startBlockElements : Array.from(
        editorElement.querySelectorAll(`[data-node-id="${endBlockElement.getAttribute("data-node-id")}"]`)
    );
    const startRange = range.cloneRange();
    startRange.collapse(true);
    const endRange = range.cloneRange();
    endRange.collapse(false);
    const start = getSelectionOffset(startEditableElement, undefined, startRange, ignoreZWSP).start;
    const end = getSelectionOffset(endEditableElement, undefined, endRange, ignoreZWSP).end;
    return {
        undoFocusId: startBlockElement.getAttribute("data-node-id"),
        undoFocusIndex: startBlockElements.indexOf(startBlockElement).toString(),
        undoFocusStart: start.toString(),
        undoFocusStartAtEnd: isEndOfBlock(startRange).toString(),
        undoFocusEndId: endBlockElement.getAttribute("data-node-id"),
        undoFocusEndIndex: endBlockElements.indexOf(endBlockElement).toString(),
        undoFocusEnd: end.toString(),
        undoFocusIgnoreZWSP: ignoreZWSP.toString(),
    };
};

export const restoreFocusContext = (protyle: IProtyle, context: Record<string, string>) => {
    const start = Number(context.undoFocusStart);
    const end = Number(context.undoFocusEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0) {
        return false;
    }
    const startBlockElements = Array.from(protyle.wysiwyg.element.querySelectorAll(
        `[data-node-id="${context.undoFocusId}"]`
    ));
    const startIndex = Number(context.undoFocusIndex);
    const indexedStartElement = Number.isInteger(startIndex) && startIndex >= 0 ?
        startBlockElements[startIndex] : undefined;
    const startBlockElement = indexedStartElement ||
        startBlockElements.find(item => !isInEmbedBlock(item, false)) || startBlockElements[0];
    const endBlockElements = context.undoFocusEndId === context.undoFocusId ?
        startBlockElements : Array.from(protyle.wysiwyg.element.querySelectorAll(
            `[data-node-id="${context.undoFocusEndId || context.undoFocusId}"]`
        ));
    const endIndex = Number(context.undoFocusEndIndex);
    const indexedEndElement = Number.isInteger(endIndex) && endIndex >= 0 ? endBlockElements[endIndex] : undefined;
    const endBlockElement = indexedEndElement ||
        endBlockElements.find(item => !isInEmbedBlock(item, false)) || endBlockElements[0];
    if (!startBlockElement || !endBlockElement) {
        return false;
    }
    const ignoreZWSP = context.undoFocusIgnoreZWSP === "true";
    if (context.undoFocusCollapseToEnd === "true") {
        return !!focusByOffset(endBlockElement, end, end, true, ignoreZWSP);
    }
    if (startBlockElement === endBlockElement) {
        return !!focusByOffset(startBlockElement, start, end, true, ignoreZWSP);
    }
    let startRange: Range;
    if (context.undoFocusStartAtEnd === "true") {
        startRange = document.createRange();
        setLastNodeRange(getContenteditableElement(startBlockElement) || startBlockElement, startRange);
        startRange.collapse(true);
    } else {
        startRange = focusByOffset(startBlockElement, start, start, false, ignoreZWSP) as Range;
    }
    let endRange: Range;
    if (ignoreZWSP && end === 0) {
        endRange = document.createRange();
        endRange.setStart(getContenteditableElement(endBlockElement) || endBlockElement, 0);
        endRange.collapse(true);
    } else {
        endRange = focusByOffset(endBlockElement, 0, end, false, ignoreZWSP) as Range;
    }
    if (!startRange || !endRange) {
        return false;
    }
    const range = document.createRange();
    range.setStart(startRange.startContainer, startRange.startOffset);
    range.setEnd(endRange.endContainer, endRange.endOffset);
    if (range.endContainer.nodeType === Node.TEXT_NODE) {
        let endOffset = range.endOffset;
        while (endOffset > 0 && range.endContainer.textContent[endOffset - 1] === Constants.ZWSP) {
            endOffset--;
        }
        range.setEnd(range.endContainer, endOffset);
    }
    focusByRange(range);
    return true;
};

// 在撤销或重做操作全部应用后，根据保存的位置重建选区。
export const restoreUndoFocus = (protyle: IProtyle, operations: IOperation[]) => {
    const operation = operations.find(item => item.context?.undoFocusId);
    return operation ? restoreFocusContext(protyle, operation.context) : false;
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

export const setFirstNodeRange = (editElement: Element, range: Range) => {
    if (!editElement) {
        return range;
    }
    let firstChild = editElement.firstChild as HTMLElement;
    while (firstChild && firstChild.nodeType !== 3 && !firstChild.classList.contains("render-node")) {
        if (firstChild.classList.contains("img")) { // https://ld246.com/article/1665360254842
            range.setStartBefore(firstChild);
            return range;
        }
        firstChild = firstChild.firstChild as HTMLElement;
    }
    if (!firstChild) {
        range.selectNodeContents(editElement);
        return range;
    }
    if (firstChild.nodeType !== 3 && firstChild.classList.contains("render-node")) {
        range.setStartBefore(firstChild);
    } else {
        range.setStart(firstChild, 0);
    }
    return range;
};

const getDOMOffset = (text: string, offset: number, skipZWSP: boolean) => {
    let domOffset = 0;
    let textOffset = 0;
    while (domOffset < text.length && textOffset < offset) {
        if (text[domOffset] !== Constants.ZWSP) {
            textOffset++;
        }
        domOffset++;
    }
    if (skipZWSP) {
        while (text[domOffset] === Constants.ZWSP) {
            domOffset++;
        }
    }
    return domOffset;
};

export const focusByOffset = (container: Element, start: number, end: number, isFocus = true, ignoreZWSP = false) => {
    if (!container) {
        return false;
    }
    // 空块无法 focus
    const editElement = getContenteditableElement(container);
    if (editElement) {
        container = editElement;
    } else if (isFocus && (isNotEditBlock(container) || container.classList.contains("av"))) {
        return focusBlock(container);
    }
    const isSame = start === end;
    let startNode: Node;
    searchNode(container, container.firstChild, node => {
        if (node.nodeType === Node.TEXT_NODE) {
            const dataLength = ignoreZWSP ?
                (node as Text).data.split(Constants.ZWSP).join("").length : (node as Text).data.length;
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
                    const dataLength = ignoreZWSP ?
                        (node as Text).data.split(Constants.ZWSP).join("").length : (node as Text).data.length;
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
            const data = (startNode as Text).data;
            range.setStart(startNode, ignoreZWSP ? getDOMOffset(data, start, true) : start);
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
    if (isSame) {
        range.collapse(true);
    } else {
        if (endNode) {
            if (endNode.nodeType === Node.TEXT_NODE) {
                const data = (endNode as Text).data;
                range.setEnd(endNode, ignoreZWSP ? getDOMOffset(data, end, false) : end);
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
    }
    if (isFocus) {
        focusByRange(range);
    }
    return range;
};

export const setInsertWbrHTML = (nodeElement: HTMLElement, range: Range, protyle: IProtyle) => {
    const editElement = getContenteditableElement(nodeElement);
    if (!editElement) {
        return;
    }
    if (nodeElement.classList.contains("table")) {
        const cellElement = hasClosestByTag(range.startContainer, "TH") || hasClosestByTag(range.startContainer, "TD");
        if (cellElement) {
            const offset = getSelectionOffset(cellElement, nodeElement, range);
            const cloneNode = nodeElement.cloneNode(true) as HTMLElement;
            // 通过单元格在行内的索引在克隆树中定位对应单元格，避免在原 DOM 上增删 class 残留 class="" https://github.com/siyuan-note/siyuan/issues/18084
            const cellIndex = Array.from(cellElement.parentElement.children).indexOf(cellElement);
            const rowIndex = Array.from(nodeElement.querySelector("table").rows).indexOf(cellElement.parentElement as HTMLTableRowElement);
            const cloneCellElement = cloneNode.querySelector("table").rows[rowIndex].cells[cellIndex];
            const cloneRange = focusByOffset(cloneCellElement, offset.end, offset.end, false);
            if (cloneRange) {
                cloneRange.insertNode(document.createElement("wbr"));
            }
            protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] = cloneNode.outerHTML;
        }
    } else {
        const offset = getSelectionOffset(editElement, nodeElement, range);
        const cloneNode = nodeElement.cloneNode(true) as HTMLElement;
        const cloneRange = focusByOffset(cloneNode, offset.end, offset.end, false);
        if (cloneRange) {
            cloneRange.insertNode(document.createElement("wbr"));
        }
        protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] = cloneNode.outerHTML;
    }
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
                if (wbrElement.nextSibling.textContent === Constants.ZWSP) {
                    // <wbr>零宽空格text
                    range.setStart(wbrElement.nextSibling, 1);
                } else {
                    // <wbr>text
                    range.setStart(wbrElement.nextSibling, 0);
                }
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
        if (wbrPreviousSibling && wbrElement.previousElementSibling === wbrPreviousSibling) {
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
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
};

export const focusBlock = (element: Element, parentElement?: HTMLElement, toStart = true): false | Range => {
    if (!element) {
        return false;
    }

    // hr、嵌入块、数学公式、iframe、音频、视频、图表渲染块等，删除段落块后，光标位置矫正 https://github.com/siyuan-note/siyuan/issues/4143
    if (element.classList.contains("render-node") || element.classList.contains("iframe") || element.classList.contains("hr") || element.classList.contains("av")) {
        const range = document.createRange();
        const type = element.getAttribute("data-type");
        let setRange = false;
        if (type === "NodeThematicBreak") {
            range.selectNodeContents(element.firstElementChild);
            setRange = true;
        } else if (type === "NodeBlockQueryEmbed") {
            genRenderFrame(element);
            range.setStart(element.querySelector(".protyle-cursor").firstChild, 0);
            range.collapse(true);
            setRange = true;
        } else if (type === "NodeMathBlock") {
            genRenderFrame(element);
            range.setStart(element.firstElementChild.lastElementChild.firstChild, 0);
            setRange = true;
        } else if (type === "NodeHTMLBlock") {
            range.setStart(element.lastElementChild.previousElementSibling.lastElementChild.firstChild, 0);
            range.collapse(true);
            setRange = true;
        } else if (type === "NodeIFrame" || type === "NodeWidget") {
            range.setStart(element, 0);
            setRange = true;
        } else if (type === "NodeVideo") {
            range.setStart(element.firstElementChild.firstChild, 0);
            setRange = true;
        } else if (type === "NodeAudio") {
            range.setStart(element.firstElementChild.lastChild, 0);
            setRange = true;
        } else if (type === "NodeCodeBlock") {
            range.selectNodeContents(element);
            range.collapse(true);
            setRange = true;
        } else if (type === "NodeAttributeView") {
            /// #if !MOBILE
            const cursorElement = element.querySelector(".av__cursor");
            if (cursorElement) {
                range.setStart(cursorElement.firstChild, 0);
                setRange = true;
            } else {
                element.setAttribute("data-need-focus", "true");
                return false;
            }
            /// #else
            return false;
            /// #endif
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
        if (cursorElement.getAttribute("contenteditable") === "false") {
            return false;
        }
        if (cursorElement.tagName === "TABLE") {
            if (toStart) {
                cursorElement = cursorElement.querySelector("th, td");
            } else {
                const cellElements = cursorElement.querySelectorAll("th, td");
                cursorElement = cellElements[cellElements.length - 1];
            }
        }
        let range;
        if (toStart) {
            // 需要定位到第一个 child https://github.com/siyuan-note/siyuan/issues/5930
            range = setFirstNodeRange(cursorElement, getEditorRange(cursorElement));
            range.collapse(true);
        } else {
            let focusHljs = false;
            // 定位到末尾 https://github.com/siyuan-note/siyuan/issues/5982
            if (element.getAttribute("data-type") === "NodeCodeBlock") {
                // 代码块末尾定位需在 /n 之前 https://github.com/siyuan-note/siyuan/issues/9141，https://github.com/siyuan-note/siyuan/issues/9189
                let lastNode = cursorElement.lastChild;
                if (!lastNode) {
                    // 粘贴 ``` 报错
                    cursorElement.innerHTML = "\n";
                    lastNode = cursorElement.lastChild;
                }
                if (lastNode.textContent === "" && lastNode.nodeType === 3) {
                    lastNode = hasPreviousSibling(cursorElement.lastChild) as HTMLElement;
                }
                if (lastNode && lastNode.textContent.endsWith("\n")) {
                    // https://github.com/siyuan-note/siyuan/issues/11362
                    if (lastNode.nodeType === 1) {
                        lastNode = lastNode.lastChild;
                        while (lastNode && lastNode.textContent.indexOf("\n") === -1) {
                            lastNode = lastNode.previousSibling;
                        }
                    }
                    range = getEditorRange(cursorElement);
                    range.setStart(lastNode, lastNode.textContent.length - 1);
                    focusHljs = true;
                }
            }
            if (!focusHljs) {
                range = setLastNodeRange(cursorElement, getEditorRange(cursorElement));
            }
            range.collapse(false);
        }
        focusByRange(range);
        return range;
    } else if (parentElement) {
        parentElement.focus();
    } else {
        // li 下面为 hr、嵌入块、数学公式、iframe、音频、视频、图表渲染块等时递归处理
        if (isContainerBlock(element)) {
            return focusBlock(element.querySelector("[data-node-id]"), parentElement, toStart);
        }
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
