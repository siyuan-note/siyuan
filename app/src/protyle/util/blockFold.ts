import {lineNumberRender} from "../render/highlightRender";
import {transaction} from "../wysiwyg/transaction";
import {preventScroll} from "../scroll/preventScroll";
import {hasClosestBlock} from "./hasClosest";
import {focusBlock} from "./selection";
import {scrollCenter} from "../../util/highlightById";
import {clearSelect} from "./clear";
import {removeFoldHeading} from "./heading";
import {getSbChildBlockCount, getTopAloneElement} from "../wysiwyg/getBlock";

export const setFold = (protyle: IProtyle, nodeElement: Element, isOpen?: boolean,
                        isRemove?: boolean, addLoading = true, getOperations = false) => {
    if (nodeElement.getAttribute("data-type") === "NodeListItem" && nodeElement.childElementCount < 4 &&
        // 该情况需要强制展开 https://github.com/siyuan-note/siyuan/issues/12327
        !isOpen) {
        // 没有子列表或多个块的列表项不进行折叠
        return {fold: -1};
    }
    if (nodeElement.getAttribute("data-type") === "NodeThematicBreak") {
        return {fold: -1};
    }
    const hasFold = nodeElement.getAttribute("fold") === "1";
    if (hasFold) {
        if (typeof isOpen === "boolean" && !isOpen) {
            return {fold: -1};
        }
        nodeElement.removeAttribute("fold");
        // https://github.com/siyuan-note/siyuan/issues/4411
        nodeElement.querySelectorAll(".protyle-linenumber__rows").forEach((item: HTMLElement) => {
            lineNumberRender(item.parentElement);
        });
    } else {
        if (typeof isOpen === "boolean" && isOpen) {
            return {fold: -1};
        }
        nodeElement.setAttribute("fold", "1");
        // 光标在子列表中，再次 focus 段尾的时候不会变 https://ld246.com/article/1647099132461
        if (getSelection().rangeCount > 0) {
            const range = getSelection().getRangeAt(0);
            const blockElement = hasClosestBlock(range.startContainer);
            if (blockElement && blockElement.getBoundingClientRect().width === 0) {
                // https://github.com/siyuan-note/siyuan/issues/5833
                focusBlock(nodeElement, undefined, false);
            }
        }
        clearSelect(["img", "av"], nodeElement);
        scrollCenter(protyle, nodeElement);
    }
    const id = nodeElement.getAttribute("data-node-id");
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    if (nodeElement.getAttribute("data-type") === "NodeHeading") {
        if (hasFold) {
            if (addLoading) {
                nodeElement.insertAdjacentHTML("beforeend", '<div spin="1" style="text-align: center"><img width="24px" height="24px" src="/stage/loading-pure.svg"></div>');
            }
            doOperations.push({
                action: "unfoldHeading",
                id,
                data: isRemove ? "remove" : undefined,
            });
            undoOperations.push({
                action: "foldHeading",
                id
            });
        } else {
            doOperations.push({
                action: "foldHeading",
                id
            });
            undoOperations.push({
                action: "unfoldHeading",
                id
            });
            removeFoldHeading(nodeElement);
        }
    } else {
        doOperations.push({
            action: "setAttrs",
            id,
            data: JSON.stringify({fold: hasFold ? "" : "1"})
        });
        undoOperations.push({
            action: "setAttrs",
            id,
            data: JSON.stringify({fold: hasFold ? "1" : ""})
        });
    }
    if (!getOperations) {
        transaction(protyle, doOperations, undoOperations);
    }
    // 折叠后，防止滚动条滚动后调用 get 请求 https://github.com/siyuan-note/siyuan/issues/2248
    preventScroll(protyle);
    return {fold: !hasFold ? 1 : 0, undoOperations, doOperations};
};

const isFoldable = (el: Element) => {
    const type = el.getAttribute("data-type");
    return type === "NodeHeading" ||
        (type === "NodeCallout" && el.querySelector(".callout-content").childElementCount > 1) ||
        ((type === "NodeListItem" || type === "NodeBlockquote") && el.childElementCount > 3) ||
        (type === "NodeSuperBlock" && getSbChildBlockCount(el) > 1);
};

export const foldBlocksRecursively = (protyle: IProtyle, nodeElements: Element[]) => {
    const result: Set<Element> = new Set();
    nodeElements.forEach(element => {
        if (isFoldable(element)) {
            result.add(element);
        }
        element.querySelectorAll("[data-type='NodeHeading'], .li, .bq, .sb, .callout").forEach(child => {
            if (isFoldable(child)) {
                // Skip headings inside list items to avoid "double dot" and gutter icon conflicts
                if (child.getAttribute("data-type") === "NodeHeading" &&
                    child.parentElement?.getAttribute("data-type") === "NodeListItem") {
                    return;
                }
                result.add(child);
            }
        });
        const type = element.getAttribute("data-type");
        if (type === "NodeHeading") {
            const nodeH = parseInt(element.getAttribute("data-subtype").substr(1));
            let nextElement = element.nextElementSibling;
            while (nextElement) {
                const currentH = parseInt(nextElement.getAttribute("data-subtype")?.substr(1));
                if (!nextElement.classList.contains("protyle-attr") && (isNaN(currentH) || currentH > nodeH)) {
                    if (isFoldable(nextElement)) {
                        result.add(nextElement);
                    }
                    nextElement.querySelectorAll("[data-type='NodeHeading'], .li, .bq, .sb, .callout").forEach(child => {
                        if (isFoldable(child)) {
                            // Skip headings inside list items to avoid "double dot" and gutter icon conflicts
                            if (child.getAttribute("data-type") === "NodeHeading" &&
                                child.parentElement?.getAttribute("data-type") === "NodeListItem") {
                                return;
                            }
                            result.add(child);
                        }
                    });
                    nextElement = nextElement.nextElementSibling;
                } else {
                    break;
                }
            }
        }
    });

    const elementsToFold = Array.from(result);
    if (elementsToFold.length === 0) {
        return;
    }

    // Determine target state: if any block is unfolded, we fold all. Otherwise we expand all.
    let isFoldAll = elementsToFold.some(item => item.getAttribute("fold") !== "1");
    if (isFoldAll && nodeElements.length === 1 && nodeElements[0].getAttribute("fold") === "1") {
        isFoldAll = false;
    }
    elementsToFold.sort((a, b) => {
        const position = a.compareDocumentPosition(b);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
            return isFoldAll ? 1 : -1;
        } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
            return isFoldAll ? -1 : 1;
        }
        return 0;
    });

    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    elementsToFold.forEach(element => {
        const hasFold = element.getAttribute("fold") === "1";
        if ((isFoldAll && hasFold) || (!isFoldAll && !hasFold)) {
            return;
        }
        const ops = setFold(protyle, element, !isFoldAll, false, false, true);
        if (ops.doOperations && ops.doOperations.length > 0) {
            doOperations.push(...ops.doOperations);
            undoOperations.push(...ops.undoOperations);
        }
    });

    if (doOperations.length > 0) {
        transaction(protyle, doOperations, undoOperations);
        preventScroll(protyle);
        scrollCenter(protyle, elementsToFold[0]);
    }
};

export const getFoldBlock = (protyle: IProtyle, nodeElement: HTMLElement, cb: (elements: Element[]) => void) => {
    const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
    if (selectElements.length > 0) {
        cb(selectElements);
    } else if (nodeElement) {
        if (nodeElement.parentElement.getAttribute("data-type") === "NodeListItem") {
            if (nodeElement.parentElement.childElementCount > 3) {
                cb([nodeElement.parentElement]);
            } else {
                cb([nodeElement]);
            }
        } else if (nodeElement.getAttribute("data-type") === "NodeHeading") {
            cb([nodeElement]);
        } else {
            cb([getTopAloneElement(nodeElement)]);
        }
    }
    return true;
};
