import {getTopAloneElement} from "./getBlock";
import {hasClosestByAttribute} from "../util/hasClosest";
import {updateListOrder} from "./list";
import {transaction, updateTransaction} from "./transaction";
import {preventScroll} from "../scroll/preventScroll";
import {scrollCenter} from "../../util/highlightById";
import {focusByWbr} from "../util/selection";

export const moveToUp  = (protyle:IProtyle, nodeElement:HTMLElement, range:Range) => {
    let previousElement: Element;
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
        }
        if (!previousElement) {
            return;
        }
    }
    if (type === "NodeList" &&
        sourceElements[0].previousElementSibling?.previousElementSibling?.classList.contains("protyle-action")) {
        if (sourceElements[0].parentElement.previousElementSibling?.classList.contains("li")) {
            previousElement = sourceElements[0].parentElement.previousElementSibling.querySelector(".list");
        }
        if (!previousElement) {
            return;
        }
    }
    if (previousElement) {
        previousElement = previousElement.lastElementChild.previousElementSibling;
        const sourceParentElement = sourceElements[0].classList.contains("list") ? sourceElements[0] : sourceElements[0].parentElement;
        range.insertNode(document.createElement("wbr"));
        const html = previousElement.parentElement.parentElement.parentElement.outerHTML;
        sourceElements.reverse().forEach(item => {
            if (item.classList.contains("list")) {
                previousElement.after(item.firstElementChild);
            } else {
                previousElement.after(item);
            }
        });
        if (sourceParentElement.childElementCount === 1) {
            sourceParentElement.remove();
        } else if (sourceParentElement.getAttribute("data-subtype") === "o" && sourceParentElement.classList.contains("list")) {
            updateListOrder(sourceParentElement, 1);
        }
        if (previousElement.getAttribute("data-subtype") === "o") {
            updateListOrder(previousElement.parentElement);
        }

        updateTransaction(protyle, previousElement.parentElement.parentElement.parentElement.getAttribute("data-node-id"), previousElement.parentElement.parentElement.parentElement.outerHTML, html);
        preventScroll(protyle);
        scrollCenter(protyle);
        focusByWbr(previousElement.parentElement, range);
        return;
    }
    if (!sourceElements[0].previousElementSibling || sourceElements[0].previousElementSibling?.classList.contains("protyle-action")) {
        return;
    }
    previousElement = sourceElements[0].previousElementSibling;
    if (sourceElements[0].getAttribute("data-subtype") === "o" && type === "NodeListItem") {
        const html = sourceElements[0].parentElement.outerHTML;
        sourceElements[sourceElements.length - 1].after(previousElement);
        updateListOrder(sourceElements[0].parentElement, 1);
        updateTransaction(protyle, sourceElements[0].parentElement.getAttribute("data-node-id"), sourceElements[0].parentElement.outerHTML, html);
    } else {
        const id = previousElement.getAttribute("data-node-id");
        transaction(protyle, [{
            action: "move",
            id,
            previousID: sourceElements[sourceElements.length - 1].getAttribute("data-node-id"),
        }], [{
            action: "move",
            id,
            previousID: previousElement.previousElementSibling?.getAttribute("data-node-id"),
            parentID: previousElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
        }]);
        sourceElements[sourceElements.length - 1].after(previousElement);
    }
    preventScroll(protyle);
    scrollCenter(protyle);
};

export const moveToDown  = (protyle:IProtyle, nodeElement:HTMLElement, range:Range) => {
    let nextElement: Element;
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
        }
        if (!nextElement) {
            return;
        }
    }
    if (type === "NodeList" && sourceElements[sourceElements.length - 1].nextElementSibling.classList.contains("protyle-attr") &&
        sourceElements[0].parentElement?.classList.contains("li")) {
        if (sourceElements[0].parentElement.nextElementSibling?.classList.contains("li")) {
            nextElement = sourceElements[0].parentElement.nextElementSibling.querySelector(".list > .li");
        }
        if (!nextElement) {
            return;
        }
    }
    if (nextElement) {
        const sourceParentElement = sourceElements[0].classList.contains("list") ? sourceElements[0] : sourceElements[0].parentElement;
        range.insertNode(document.createElement("wbr"));
        const html = nextElement.parentElement.parentElement.parentElement.outerHTML;
        sourceElements.forEach(item => {
            if (item.classList.contains("list")) {
                nextElement.before(item.firstElementChild);
            } else {
                nextElement.before(item);
            }
        });
        if (sourceParentElement.childElementCount === 1) {
            sourceParentElement.remove();
        } else if (sourceParentElement.getAttribute("data-subtype") === "o" && sourceParentElement.classList.contains("list")) {
            updateListOrder(sourceParentElement, 1);
        }
        if (nextElement.getAttribute("data-subtype") === "o") {
            updateListOrder(nextElement.parentElement, 1);
        }
        updateTransaction(protyle, nextElement.parentElement.parentElement.parentElement.getAttribute("data-node-id"), nextElement.parentElement.parentElement.parentElement.outerHTML, html);
        preventScroll(protyle);
        scrollCenter(protyle);
        focusByWbr(nextElement.parentElement, range);
        return;
    }
    if (!sourceElements[sourceElements.length - 1].nextElementSibling || sourceElements[sourceElements.length - 1].nextElementSibling?.classList.contains("protyle-attr")) {
        return;
    }
    nextElement = sourceElements[sourceElements.length - 1].nextElementSibling;
    if (nextElement.getAttribute("data-subtype") === "o" && nextElement.getAttribute("data-type") === "NodeListItem") {
        const html = nextElement.parentElement.outerHTML;
        sourceElements[0].before(nextElement);
        updateListOrder(nextElement.parentElement, 1);
        updateTransaction(protyle, nextElement.parentElement.getAttribute("data-node-id"), nextElement.parentElement.outerHTML, html);
    } else {
        const id = nextElement.getAttribute("data-node-id");
        transaction(protyle, [{
            action: "move",
            id,
            previousID: sourceElements[0].previousElementSibling?.getAttribute("data-node-id"),
            parentID: nextElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
        }], [{
            action: "move",
            id,
            previousID: sourceElements[sourceElements.length - 1].getAttribute("data-node-id"),
        }]);
        sourceElements[0].before(nextElement);
    }
    preventScroll(protyle);
    scrollCenter(protyle);
};
