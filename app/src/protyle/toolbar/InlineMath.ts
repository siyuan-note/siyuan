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
                mathElement = (range.startContainer as HTMLElement).querySelector('[data-type~="inline-math"]');
            }
            if (!mathElement && range.startOffset === range.startContainer.textContent.length && range.startContainer.nodeType === 3) {
                let isMath = true;
                range.cloneContents().childNodes.forEach((item: HTMLElement) => {
                    if ((item.nodeType !== 3 && item.getAttribute("data-type").indexOf("inline-math") > -1) ||
                        (item.nodeType == 3 && item.textContent === "")) {
                        // 是否仅选中数学公式
                    } else {
                        isMath = false
                    }
                })
                if (isMath) {
                    const nextSibling = hasNextSibling(range.startContainer) as HTMLElement;
                    if (nextSibling && nextSibling.nodeType !== 3 && nextSibling.getAttribute("data-type").indexOf("inline-math") > -1) {
                        mathElement = nextSibling;
                    }
                }
            }
            if (mathElement) {
                protyle.toolbar.showRender(protyle, mathElement);
                return;
            }
            protyle.toolbar.setInlineMark(protyle, "inline-math", "range", {
                type: "inline-math",
            });
        });
    }
}
