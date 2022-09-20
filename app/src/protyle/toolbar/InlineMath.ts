import {ToolbarItem} from "./ToolbarItem";
import * as dayjs from "dayjs";
import {updateTransaction} from "../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";
import {mathRender} from "../markdown/mathRender";
import {fixTableRange, focusByRange} from "../util/selection";

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
            let mathElement = hasClosestByAttribute(range.startContainer, "data-type", "inline-math") as Element;
            if (!mathElement && range.startContainer.nodeType !== 3) {
                mathElement = (range.startContainer as HTMLElement).querySelector('[data-type="inline-math"]');
            }
            if (mathElement) {
                protyle.toolbar.showRender(protyle, mathElement);
                return;
            }
            fixTableRange(range);
            if (!["DIV", "TD", "TH", "TR"].includes(range.startContainer.parentElement.tagName) && range.startOffset === 0 && !hasPreviousSibling(range.startContainer)) {
                range.setStartBefore(range.startContainer.parentElement);
            }
            if (!["DIV", "TD", "TH", "TR"].includes(range.endContainer.parentElement.tagName) && range.endOffset === range.endContainer.textContent.length && !hasNextSibling(range.endContainer)) {
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
                protyle.toolbar.showRender(protyle, newElement, undefined, html);
            } else {
                range.setStartAfter(newElement);
                range.collapse(true);
                focusByRange(range)
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
                wbrElement.remove();
            }
        });
    }
}
