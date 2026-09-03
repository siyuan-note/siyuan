import {ToolbarItem} from "./ToolbarItem";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {getSemanticInlineVisibleText, stripSemanticMarkersFromRangeText} from "../util/inlineElementMarker";
import {Constants} from "../../constants";
import {getFirstSelectedInlineMemoContent} from "./inlineMemoSelection";

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
            const memoContent = getFirstSelectedInlineMemoContent(range);
            const selectedText = stripSemanticMarkersFromRangeText(range).split(Constants.ZWSP).join("");
            if (memoElement && getSemanticInlineVisibleText(memoElement) === selectedText) {
                // https://github.com/siyuan-note/siyuan/issues/6569
                protyle.toolbar.showRender(protyle, memoElement);
                return;
            }

            if (selectedText === "") {
                return;
            }

            protyle.toolbar.setInlineMark(protyle, "inline-memo", "range", {
                type: "inline-memo",
                color: memoContent,
            });
        });
    }
}
