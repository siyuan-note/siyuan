import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";

export const getPreviousHeading = (element: Element) => {
    let previous = getPreviousBlock(element);
    while (previous) {
        if (previous.getAttribute("data-type") === "NodeHeading") {
            break;
        } else {
            previous = getPreviousBlock(previous);
        }
    }
    return previous;
};

export const getPreviousBlock = (element: Element) => {
    let parentElement = element;
    while (parentElement) {
        if (parentElement.previousElementSibling && parentElement.previousElementSibling.getAttribute("data-node-id")) {
            return parentElement.previousElementSibling;
        }
        const pElement = hasClosestBlock(parentElement.parentElement);
        if (pElement) {
            parentElement = pElement;
        } else {
            return false;
        }
    }
};

export const getLastBlock = (element: Element) => {
    let lastElement;
    Array.from(element.querySelectorAll("[data-node-id]")).reverse().find(item => {
        if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
            lastElement = item;
            return true;
        }
    });
    return lastElement || element;
};

export const getFirstBlock = (element: Element) => {
    let firstElement;
    Array.from(element.querySelectorAll("[data-node-id]")).find(item => {
        if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed") && !item.classList.contains("li")) {
            firstElement = item;
            return true;
        }
    });
    return firstElement || element;
};

export const getNextBlock = (element: Element) => {
    let parentElement = element;
    while (parentElement) {
        if (parentElement.nextElementSibling && !parentElement.nextElementSibling.classList.contains("protyle-attr")) {
            return parentElement.nextElementSibling as HTMLElement;
        }
        const pElement = hasClosestBlock(parentElement.parentElement);
        if (pElement) {
            parentElement = pElement;
        } else {
            return false;
        }
    }
    return false;
};

export const getNoContainerElement = (element: Element) => {
    let childElement = element;
    while (childElement) {
        if (childElement.classList.contains("list") || childElement.classList.contains("li")|| childElement.classList.contains("bq")|| childElement.classList.contains("sb")) {
            childElement = childElement.querySelector("[data-node-id]");
        } else {
            return childElement;
        }
    }
    return false;
};

export const getContenteditableElement = (element: Element) => {
    if (!element || element.getAttribute("contenteditable") === "true") {
        return element;
    }
    return element.querySelector('[contenteditable="true"]');
};

export const isNotEditBlock = (element: Element) => {
    return ["NodeBlockQueryEmbed", "NodeThematicBreak", "NodeMathBlock", "NodeHTMLBlock", "NodeIFrame", "NodeWidget", "NodeVideo", "NodeAudio"].includes(element.getAttribute("data-type")) ||
        (element.getAttribute("data-type") === "NodeCodeBlock" && element.classList.contains("render-node"));
};

export const getTopEmptyElement = (element: Element) => {
    let topElement = element;
    while (topElement.parentElement && !topElement.parentElement.classList.contains("protyle-wysiwyg")) {
        if (!topElement.parentElement.getAttribute("data-node-id")) {
            topElement = topElement.parentElement;
        } else if (topElement.parentElement.textContent !== "" || topElement.previousElementSibling?.getAttribute("data-node-id")) {
            break;
        } else {
            topElement = topElement.parentElement;
        }
    }
    return topElement;
};

export const getTopAloneElement = (topSourceElement: Element) => {
    if ("NodeBlockquote" === topSourceElement.parentElement.getAttribute("data-type") && topSourceElement.parentElement.childElementCount === 2) {
        while (!topSourceElement.parentElement.classList.contains("protyle-wysiwyg")) {
            if (topSourceElement.parentElement.getAttribute("data-type") === "NodeBlockquote" && topSourceElement.parentElement.childElementCount === 2) {
                topSourceElement = topSourceElement.parentElement;
            } else {
                topSourceElement = getTopAloneElement(topSourceElement);
                break;
            }
        }
    } else if ("NodeSuperBlock" === topSourceElement.parentElement.getAttribute("data-type") && topSourceElement.parentElement.childElementCount === 2) {
        while (!topSourceElement.parentElement.classList.contains("protyle-wysiwyg")) {
            if (topSourceElement.parentElement.getAttribute("data-type") === "NodeSuperBlock" && topSourceElement.parentElement.childElementCount === 2) {
                topSourceElement = topSourceElement.parentElement;
            } else {
                topSourceElement = getTopAloneElement(topSourceElement);
                break;
            }
        }
    } else if ("NodeListItem" === topSourceElement.parentElement.getAttribute("data-type") && topSourceElement.parentElement.childElementCount === 3) {
        while (!topSourceElement.parentElement.classList.contains("protyle-wysiwyg")) {
            if (topSourceElement.parentElement.getAttribute("data-type") === "NodeListItem" && topSourceElement.parentElement.childElementCount === 3) {
                topSourceElement = topSourceElement.parentElement;
            } else if (topSourceElement.parentElement.getAttribute("data-type") === "NodeList" && topSourceElement.parentElement.childElementCount === 2) {
                topSourceElement = topSourceElement.parentElement;
            } else {
                topSourceElement = getTopAloneElement(topSourceElement);
                break;
            }
        }
    } else if ("NodeList" === topSourceElement.parentElement.getAttribute("data-type") && topSourceElement.parentElement.childElementCount === 2) {
        while (!topSourceElement.parentElement.classList.contains("protyle-wysiwyg")) {
            if ("NodeList" === topSourceElement.parentElement.getAttribute("data-type") && topSourceElement.parentElement.childElementCount === 2) {
                topSourceElement = topSourceElement.parentElement;
            } else if (topSourceElement.parentElement.getAttribute("data-type") === "NodeListItem" && topSourceElement.parentElement.childElementCount === 3) {
                topSourceElement = topSourceElement.parentElement;
            } else {
                topSourceElement = getTopAloneElement(topSourceElement);
                break;
            }
        }
    }
    return topSourceElement;
};

export const hasNextSibling = (element: Node) => {
    let nextSibling = element.nextSibling;
    while (nextSibling) {
        if (nextSibling.textContent === "") {
            nextSibling = nextSibling.nextSibling;
        } else {
            return nextSibling;
        }
    }
    return false;
};

export const hasPreviousSibling = (element: Node) => {
    let previousSibling = element.previousSibling;
    while (previousSibling) {
        if (previousSibling.textContent === "" && previousSibling.nodeType === 3) {
            previousSibling = previousSibling.previousSibling;
        } else {
            return previousSibling;
        }
    }
    return false;
};
