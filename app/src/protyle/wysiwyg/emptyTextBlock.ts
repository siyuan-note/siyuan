import {Constants} from "../../constants";
import {getContenteditableElement} from "./getBlock";

const isEmptyEditableBlock = (element: Element) => {
    const editableElement = getContenteditableElement(element);
    if (!editableElement) {
        return false;
    }
    const contentElement = editableElement.cloneNode(true) as Element;
    contentElement.querySelectorAll("br, wbr").forEach(item => item.remove());
    const text = contentElement.textContent.replace(new RegExp(Constants.ZWSP, "g"), "").trim();
    return text === "" && contentElement.childElementCount === 0;
};

export const isEmptyParagraph = (element: Element) =>
    element.getAttribute("data-type") === "NodeParagraph" && isEmptyEditableBlock(element);

export const isEmptyTextBlock = (element: Element) =>
    ["NodeParagraph", "NodeHeading"].includes(element.getAttribute("data-type")) && isEmptyEditableBlock(element);
