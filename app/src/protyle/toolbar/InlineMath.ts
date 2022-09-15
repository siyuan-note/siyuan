import {ToolbarItem} from "./ToolbarItem";
import * as dayjs from "dayjs";
import {updateTransaction} from "../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";
import {focusByRange, focusByWbr} from "../util/selection";
import {mathRender} from "../markdown/mathRender";

export class InlineMath extends ToolbarItem {
    public element: HTMLElement;

    constructor(protyle: IProtyle, menuItem: IMenuItem) {
        super(protyle, menuItem);
        this.element.addEventListener("click", async (event: MouseEvent & { changedTouches: MouseEvent[] }) => {
            protyle.toolbar.element.classList.add("fn__none");
            event.stopPropagation();

            const range = protyle.toolbar.range;
            const nodeElement = hasClosestBlock(range.startContainer);
            if (!nodeElement) {
                return;
            }
            if (!["DIV", "TD", "TH"].includes(range.startContainer.parentElement.tagName) && range.startOffset === 0 && !hasPreviousSibling(range.startContainer)) {
                range.setStartBefore(range.startContainer.parentElement);
            }
            if (!["DIV", "TD", "TH"].includes(range.endContainer.parentElement.tagName) && range.endOffset === range.endContainer.textContent.length && !hasNextSibling(range.endContainer)) {
                range.setEndAfter(range.endContainer.parentElement);
            }
            const wbrElement = document.createElement("wbr");
            range.insertNode(wbrElement);
            const html = nodeElement.outerHTML;

            const newElement = document.createElement("span");
            const rangeString = range.toString();
            newElement.className = "render-node";
            newElement.setAttribute("contenteditable", "false");
            newElement.setAttribute("data-type", "inline-math");
            newElement.setAttribute("data-subtype", "math");
            newElement.setAttribute("data-content", rangeString.trim());
            range.extractContents();
            range.insertNode(newElement);
            mathRender(newElement);
            if (rangeString.trim() === "") {
                protyle.toolbar.showRender(protyle, newElement);
            }
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
            wbrElement.remove();
        });
    }
}

export const removeLink = (linkElement: HTMLElement, range: Range) => {
    const types = linkElement.getAttribute("data-type").split(" ");
    if (types.length === 1) {
        const linkParentElement = linkElement.parentElement;
        linkElement.outerHTML = linkElement.innerHTML + "<wbr>";
        focusByWbr(linkParentElement, range);
    } else {
        types.find((itemType, index) => {
            if ("a" === itemType) {
                types.splice(index, 1);
                return true;
            }
        });
        linkElement.setAttribute("data-type", types.join(" "));
        linkElement.removeAttribute("data-href");
        range.selectNodeContents(linkElement);
        range.collapse(false);
        focusByRange(range);
    }
};
