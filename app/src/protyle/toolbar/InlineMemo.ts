import {ToolbarItem} from "./ToolbarItem";
import * as dayjs from "dayjs";
import {updateTransaction} from "../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";
import {fixTableRange} from "../util/selection";
import {isArrayEqual} from "../../util/functions";

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

            fixTableRange(range);

            if (!["DIV", "TD", "TH", "TR"].includes(range.startContainer.parentElement.tagName) && range.startOffset === 0 && !hasPreviousSibling(range.startContainer)) {
                range.setStartBefore(range.startContainer.parentElement);
            }
            if (!["DIV", "TD", "TH", "TR"].includes(range.endContainer.parentElement.tagName) && range.endOffset === range.endContainer.textContent.length && !hasNextSibling(range.endContainer)) {
                range.setEndAfter(range.endContainer.parentElement);
            }
            const oldHTML = nodeElement.outerHTML;
            const newNodes: Element[] = [];
            const contents = range.extractContents();
            contents.childNodes.forEach((item: HTMLElement) => {
                if (item.nodeType === 3) {
                    if (item.textContent) {
                        const inlineElement = document.createElement("span");
                        inlineElement.setAttribute("data-type", "inline-memo");
                        inlineElement.textContent = item.textContent;
                        newNodes.push(inlineElement);
                    }
                } else {
                    let types = (item.getAttribute("data-type") || "").split(" ");
                    types.push("inline-memo");
                    types = [...new Set(types)];
                    if (item.tagName !== "BR" && item.tagName !== "WBR" && !types.includes("inline-math")) {
                        item.setAttribute("data-type", types.join(" "));
                        newNodes.push(item);
                    } else if (item.tagName !== "WBR") {
                        newNodes.push(item);
                    }
                }
            });
            for (let i = 0; i < newNodes.length; i++) {
                const currentNewNode = newNodes[i] as HTMLElement;
                const nextNewNode = newNodes[i + 1] as HTMLElement;
                if (currentNewNode.nodeType !== 3 && nextNewNode && nextNewNode.nodeType !== 3 &&
                    isArrayEqual(nextNewNode.getAttribute("data-type").split(" "), currentNewNode.getAttribute("data-type").split(" ")) &&
                    currentNewNode.style.color === nextNewNode.style.color &&
                    currentNewNode.style.webkitTextFillColor === nextNewNode.style.webkitTextFillColor &&
                    currentNewNode.style.webkitTextStroke === nextNewNode.style.webkitTextStroke &&
                    currentNewNode.style.textShadow === nextNewNode.style.textShadow &&
                    currentNewNode.style.backgroundColor === nextNewNode.style.backgroundColor) {
                    // 合并相同的 node
                    nextNewNode.innerHTML = currentNewNode.innerHTML + nextNewNode.innerHTML;
                    newNodes.splice(i, 1);
                    i--;
                } else {
                    range.insertNode(newNodes[i]);
                    range.collapse(false);
                    // 数学公式不允许备注
                    if (currentNewNode.nodeType !== 3 && (currentNewNode.getAttribute("data-type") || "").indexOf("inline-math") > -1) {
                        newNodes.splice(i, 1);
                        i--;
                    }
                }
            }
            if (newNodes[0]) {
                range.setStart(newNodes[0].firstChild, 0);
                protyle.toolbar.showRender(protyle, newNodes[0], newNodes, oldHTML);
            }
        });
    }
}
