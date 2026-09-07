import {Constants} from "../../constants";
import {highlightRender} from "../render/highlightRender";
import {isEmptyParagraph} from "./emptyTextBlock";
import {getContenteditableElement} from "./getBlock";
import {turnEmptyParagraphsIntoTransaction, updateTransaction} from "./transaction";

export const turnParagraphIntoCode = (protyle: IProtyle, nodeElement: HTMLElement) => {
    if (isEmptyParagraph(nodeElement)) {
        turnEmptyParagraphsIntoTransaction({protyle, nodeElements: [nodeElement], type: "code"});
        return true;
    }
    const editElement = getContenteditableElement(nodeElement);
    if (!editElement) {
        return false;
    }
    const html = nodeElement.outerHTML;
    editElement.innerHTML = "```" + window.siyuan.storage[Constants.LOCAL_CODELANG] + "\n" +
        Lute.EscapeHTMLStr(editElement.textContent) + "<wbr>\n```";
    nodeElement.insertAdjacentHTML("afterend", protyle.lute.SpinBlockDOM(nodeElement.outerHTML));
    const newNodeElement = nodeElement.nextElementSibling;
    nodeElement.remove();
    updateTransaction(protyle, newNodeElement, html);
    highlightRender(newNodeElement);
    return true;
};
