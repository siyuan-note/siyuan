import {ToolbarItem} from "./ToolbarItem";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";

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
            if (memoElement && memoElement.textContent === range.toString()) {
                // https://github.com/siyuan-note/siyuan/issues/6569
                protyle.toolbar.showRender(protyle, memoElement);
                return;
            }

            if (range.toString() === "") {
                return;
            }

            protyle.toolbar.setInlineMark(protyle, "inline-memo", "range", {
                type: "inline-memo",
            });
        });
    }
}
