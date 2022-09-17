import {ToolbarItem} from "./ToolbarItem";
import * as dayjs from "dayjs";
import {updateTransaction} from "../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";

export class InlineMemo extends ToolbarItem {
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
            const memoElement = hasClosestByAttribute(range.startContainer, "data-type", "inline-memo");
            if (memoElement) {
                protyle.toolbar.showRender(protyle, memoElement);
                return;
            }

            if (range.toString() === "") {
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
            newElement.innerHTML = range.toString();
            newElement.setAttribute("data-type", "inline-memo");
            range.extractContents();
            range.insertNode(newElement);
            protyle.toolbar.showRender(protyle, newElement);
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
            wbrElement.remove();
        });
    }
}
