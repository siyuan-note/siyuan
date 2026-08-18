import {getNextBlockSibling, getParentBlock, getPreviousBlockSibling, getTopAloneElement} from "./getBlock";
import {hasClosestByAttribute} from "../util/hasClosest";
import {updateListOrder} from "./list";
import {transaction, updateTransaction} from "./transaction";
import {preventScroll} from "../scroll/preventScroll";
import {scrollCenter} from "../../util/highlightById";
import {focusByWbr} from "../util/selection";
import {refreshSbResize} from "../../block/util";

export const moveToUp = (protyle: IProtyle, nodeElement: HTMLElement, range: Range) => {
    let previousElement: Element;
    let oldListHTML = "";
    let sourceElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
    if (sourceElements.length === 0) {
        let sourceElement = getTopAloneElement(nodeElement);
        const foldElement = hasClosestByAttribute(sourceElement, "fold", "1");
        if (foldElement) {
            sourceElement = foldElement;
        }
        if (sourceElement.previousElementSibling?.classList.contains("protyle-action")) {
            sourceElement = getTopAloneElement(sourceElement.parentElement);
        }
        sourceElements = [sourceElement];
    }
    const type = sourceElements[0].getAttribute("data-type");
    // 子列表
    if (type === "NodeListItem" &&
        !sourceElements[0].previousElementSibling &&
        sourceElements[0].parentElement.previousElementSibling?.previousElementSibling?.classList.contains("protyle-action")) {
        if (sourceElements[0].parentElement.parentElement.previousElementSibling?.classList.contains("li")) {
            previousElement = sourceElements[0].parentElement.parentElement.previousElementSibling.querySelector(".list");
            range.insertNode(document.createElement("wbr"));
            oldListHTML = sourceElements[0].parentElement.parentElement.parentElement.outerHTML;
            if (!previousElement) {
                const newId = Lute.NewNodeID();
                sourceElements[0].parentElement.parentElement.previousElementSibling.lastElementChild.insertAdjacentHTML("beforebegin", `<div data-subtype="${sourceElements[0].getAttribute("data-subtype")}" data-node-id="${newId}" data-type="NodeList" class="list" updated="${newId.split("-")[0]}"><div id="moveTempLi"></div><div class="protyle-attr" contenteditable="false">&ZeroWidthSpace;</div></div>`);
                previousElement = sourceElements[0].parentElement.parentElement.previousElementSibling.querySelector(".list");
            }
        } else {
            return;
        }
    }
    if (type === "NodeList" &&
        sourceElements[0].previousElementSibling?.previousElementSibling?.classList.contains("protyle-action")) {
        if (sourceElements[0].parentElement.previousElementSibling?.classList.contains("li")) {
            previousElement = sourceElements[0].parentElement.previousElementSibling.querySelector(".list");
            range.insertNode(document.createElement("wbr"));
            oldListHTML = sourceElements[0].parentElement.parentElement.outerHTML;
            if (!previousElement) {
                // 目标 li 无子列表：直接整体移动源列表，与其他块移动保持一致
                sourceElements[0].parentElement.previousElementSibling.lastElementChild.insertAdjacentElement("beforebegin", sourceElements[0]);
                updateTransaction(protyle, sourceElements[0].parentElement.parentElement, oldListHTML);
                preventScroll(protyle);
                focusByWbr(sourceElements[0], range);
                scrollCenter(protyle);
                return;
            }
        } else {
            return;
        }
    }
    if (previousElement) {
        previousElement = previousElement.lastElementChild.previousElementSibling;
        const sourceParentElement = sourceElements[0].classList.contains("list") ? sourceElements[0] : sourceElements[0].parentElement;
        const orderIndex = parseInt(sourceParentElement.firstElementChild.getAttribute("data-marker"));
        sourceElements.reverse().forEach(item => {
            if (item.classList.contains("list")) {
                // 子列表需移动其全部直接子列表项
                Array.from(item.querySelectorAll(":scope > .li")).reverse().forEach(li => previousElement.after(li));
            } else {
                previousElement.after(item);
            }
        });
        if (previousElement.id === "moveTempLi") {
            previousElement = previousElement.nextElementSibling;
            previousElement.previousElementSibling.remove();
        }
        if (sourceParentElement.childElementCount === 1) {
            sourceParentElement.remove();
        } else if (sourceParentElement.getAttribute("data-subtype") === "o" && sourceParentElement.classList.contains("list")) {
            updateListOrder(sourceParentElement, orderIndex);
        }
        if (previousElement.getAttribute("data-subtype") === "o") {
            updateListOrder(previousElement.parentElement);
        }
        updateTransaction(protyle, previousElement.parentElement.parentElement.parentElement, oldListHTML);
        preventScroll(protyle);
        focusByWbr(previousElement.parentElement, range);
        scrollCenter(protyle);
        return;
    }
    previousElement = getPreviousBlockSibling(sourceElements[0]);
    if (!previousElement) {
        return;
    }
    if (sourceElements[0].getAttribute("data-subtype") === "o" && type === "NodeListItem") {
        const html = sourceElements[0].parentElement.outerHTML;
        const orderIndex = parseInt(sourceElements[0].parentElement.firstElementChild.getAttribute("data-marker"));
        sourceElements[sourceElements.length - 1].after(previousElement);
        updateListOrder(sourceElements[0].parentElement, orderIndex);
        updateTransaction(protyle, sourceElements[0].parentElement, html);
    } else {
        const id = previousElement.getAttribute("data-node-id");
        transaction(protyle, [{
            action: "move",
            id,
            previousID: sourceElements[sourceElements.length - 1].getAttribute("data-node-id"),
        }], [{
            action: "move",
            id,
            previousID: getPreviousBlockSibling(previousElement)?.getAttribute("data-node-id"),
            parentID: getParentBlock(previousElement).getAttribute("data-node-id") || protyle.block.parentID
        }]);
        sourceElements[sourceElements.length - 1].after(previousElement);
        refreshSbResize(sourceElements[0].parentElement);
    }
    preventScroll(protyle);
    scrollCenter(protyle);
};

export const moveToDown = (protyle: IProtyle, nodeElement: HTMLElement, range: Range) => {
    let nextElement: Element;
    let oldListHTML = "";
    let sourceElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
    if (sourceElements.length === 0) {
        let sourceElement = getTopAloneElement(nodeElement);
        const foldElement = hasClosestByAttribute(sourceElement, "fold", "1");
        if (foldElement) {
            sourceElement = foldElement;
        }
        if (sourceElement.previousElementSibling?.classList.contains("protyle-action")) {
            sourceElement = getTopAloneElement(sourceElement.parentElement);
        }
        sourceElements = [sourceElement];
    }
    const type = sourceElements[0].getAttribute("data-type");
    // 子列表
    if (type === "NodeListItem" &&
        sourceElements[sourceElements.length - 1].nextElementSibling.classList.contains("protyle-attr") &&
        sourceElements[0].parentElement.parentElement?.classList.contains("li")) {
        if (sourceElements[0].parentElement.parentElement.nextElementSibling?.classList.contains("li")) {
            nextElement = sourceElements[0].parentElement.parentElement.nextElementSibling.querySelector(".list > .li");
            range.insertNode(document.createElement("wbr"));
            oldListHTML = sourceElements[0].parentElement.parentElement.parentElement.outerHTML;
            if (!nextElement) {
                const newId = Lute.NewNodeID();
                sourceElements[0].parentElement.parentElement.nextElementSibling.lastElementChild.insertAdjacentHTML("beforebegin", `<div data-subtype="${sourceElements[0].getAttribute("data-subtype")}" data-node-id="${newId}" data-type="NodeList" class="list" updated="${newId.split("-")[0]}"><div class="protyle-attr" contenteditable="false">&ZeroWidthSpace;</div></div>`);
                nextElement = sourceElements[0].parentElement.parentElement.nextElementSibling.querySelector(".list > div");
            }
        } else {
            return;
        }
    }
    if (type === "NodeList" && sourceElements[sourceElements.length - 1].nextElementSibling.classList.contains("protyle-attr") &&
        sourceElements[0].parentElement?.classList.contains("li")) {
        if (sourceElements[0].parentElement.nextElementSibling?.classList.contains("li")) {
            nextElement = sourceElements[0].parentElement.nextElementSibling.querySelector(".list > .li");
            range.insertNode(document.createElement("wbr"));
            oldListHTML = sourceElements[0].parentElement.parentElement.outerHTML;
            if (!nextElement) {
                // 目标 li 无子列表：直接整体移动源列表，与其他块移动保持一致
                sourceElements[0].parentElement.nextElementSibling.lastElementChild.insertAdjacentElement("beforebegin", sourceElements[0]);
                updateTransaction(protyle, sourceElements[0].parentElement.parentElement, oldListHTML);
                preventScroll(protyle);
                focusByWbr(sourceElements[0], range);
                scrollCenter(protyle);
                return;
            }
        } else {
            return;
        }
    }
    if (nextElement) {
        const orderIndex = parseInt(nextElement.getAttribute("data-marker"));
        const sourceParentElement = sourceElements[0].classList.contains("list") ? sourceElements[0] : sourceElements[0].parentElement;
        sourceElements.forEach(item => {
            if (item.classList.contains("list")) {
                // 子列表需移动其全部直接子列表项
                Array.from(item.querySelectorAll(":scope > .li")).forEach(li => nextElement.before(li));
            } else {
                nextElement.before(item);
            }
        });
        if (sourceParentElement.childElementCount === 1) {
            sourceParentElement.remove();
        }
        if (nextElement.getAttribute("data-subtype") === "o") {
            updateListOrder(nextElement.parentElement, orderIndex);
        }
        updateTransaction(protyle, nextElement.parentElement.parentElement.parentElement, oldListHTML);
        preventScroll(protyle);
        focusByWbr(nextElement.parentElement, range);
        scrollCenter(protyle);
        return;
    }
    nextElement = getNextBlockSibling(sourceElements[sourceElements.length - 1]);
    if (!nextElement) {
        return;
    }
    if (nextElement.getAttribute("data-subtype") === "o" && nextElement.getAttribute("data-type") === "NodeListItem") {
        const html = nextElement.parentElement.outerHTML;
        const orderIndex = parseInt(sourceElements[0].parentElement.firstElementChild.getAttribute("data-marker"));
        sourceElements[0].before(nextElement);
        updateListOrder(nextElement.parentElement, orderIndex);
        updateTransaction(protyle, nextElement.parentElement, html);
    } else {
        const id = nextElement.getAttribute("data-node-id");
        transaction(protyle, [{
            action: "move",
            id,
            previousID: getPreviousBlockSibling(sourceElements[0])?.getAttribute("data-node-id"),
            parentID: getParentBlock(nextElement).getAttribute("data-node-id") || protyle.block.parentID
        }], [{
            action: "move",
            id,
            previousID: sourceElements[sourceElements.length - 1].getAttribute("data-node-id"),
        }]);
        sourceElements[0].before(nextElement);
        refreshSbResize(sourceElements[0].parentElement);
    }
    preventScroll(protyle);
    scrollCenter(protyle);
};
