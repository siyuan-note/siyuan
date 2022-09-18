import {ToolbarItem} from "./ToolbarItem";
import {linkMenu} from "../../menus/protyle";
import {Constants} from "../../constants";
import * as dayjs from "dayjs";
import {updateTransaction} from "../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";
import {focusByRange, focusByWbr} from "../util/selection";

export class Link extends ToolbarItem {
    public element: HTMLElement;

    constructor(protyle: IProtyle, menuItem: IMenuItem) {
        super(protyle, menuItem);
        // 不能用 getEventName，否则会导致光标位置变动到点击的文档中
        this.element.addEventListener("click", async (event: MouseEvent & { changedTouches: MouseEvent[] }) => {
            protyle.toolbar.element.classList.add("fn__none");
            event.stopPropagation();

            const range = protyle.toolbar.range;
            const nodeElement = hasClosestBlock(range.startContainer);
            if (!nodeElement) {
                return;
            }
            const aElement = hasClosestByAttribute(range.startContainer, "data-type", "a");
            if (aElement) {
                linkMenu(protyle, aElement);
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
            newElement.setAttribute("data-type", "a");
            const rangeString = range.toString();
            newElement.textContent = rangeString;
            range.extractContents();
            range.insertNode(newElement);
            let needShowLink = true;
            let focusText = false;
            try {
                const clipText = await navigator.clipboard.readText();
                // 选中链接时需忽略剪切板内容 https://ld246.com/article/1643035329737
                if (protyle.lute.IsValidLinkDest(rangeString.trim())) {
                    (newElement as HTMLElement).setAttribute("data-href", rangeString.trim());
                    needShowLink = false;
                } else if (protyle.lute.IsValidLinkDest(clipText)) {
                    (newElement as HTMLElement).setAttribute("data-href", clipText);
                    if (newElement.textContent.replace(Constants.ZWSP, "") !== "") {
                        needShowLink = false;
                    }
                    focusText = true;
                }
            } catch (e) {
                console.log(e);
            }
            if (needShowLink) {
                linkMenu(protyle, newElement as HTMLElement, focusText);
            }
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
            range.setStartAfter(newElement);
            range.collapse(true);
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
