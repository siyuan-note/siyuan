import {ToolbarItem} from "./ToolbarItem";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";

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
            if (!mathElement && range.startContainer.nodeType !== 3 && range.startContainer.childNodes[range.startOffset]) {
                const previousSibling = hasPreviousSibling(range.startContainer.childNodes[range.startOffset]) as HTMLElement;
                if (previousSibling && previousSibling.nodeType !==3 && previousSibling.getAttribute("data-type").indexOf("inline-math") > -1) {
                    mathElement = previousSibling;
                }
            }
            if (!mathElement && range.startOffset === range.startContainer.textContent.length && range.startContainer.nodeType === 3) {
                let isMath = true;
                let hasMath = false;
                // https://github.com/siyuan-note/siyuan/issues/6007
                range.cloneContents().childNodes.forEach((item: HTMLElement) => {
                    if ((item.nodeType !== 3 && (item.getAttribute("data-type") || "").indexOf("inline-math") > -1) ||
                        (item.nodeType == 3 && item.textContent === "")) {
                        // 是否仅选中数学公式
                        hasMath = true;
                    } else {
                        isMath = false;
                    }
                });
                if (isMath && hasMath) {
                    const nextSibling = hasNextSibling(range.startContainer) as HTMLElement;
                    if (nextSibling && nextSibling.nodeType !== 3 && nextSibling.getAttribute("data-type").indexOf("inline-math") > -1) {
                        mathElement = nextSibling;
                    } else {
                        const previousSibling = hasPreviousSibling(range.startContainer) as HTMLElement;
                        if (range.startOffset === 0 && previousSibling && previousSibling.nodeType !== 3 && previousSibling.getAttribute("data-type").indexOf("inline-math") > -1) {
                            mathElement = previousSibling;
                        }
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
