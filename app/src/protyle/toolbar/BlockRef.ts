import {ToolbarItem} from "./ToolbarItem";
import {hintRef} from "../hint/extend";
import {fixTableRange} from "../util/selection";
import {isSameBlockRange} from "../../util/newFileSelection";
import {stripSemanticMarkersFromRangeText} from "../util/inlineElementMarker";
import {Constants} from "../../constants";

export class BlockRef extends ToolbarItem {
    public element: HTMLElement;

    constructor(protyle: IProtyle, menuItem: IMenuItem) {
        super(protyle, menuItem);
        // 不能用 getEventName，否则会导致光标位置变动到点击的文档中
        this.element.addEventListener("click", (event: MouseEvent & { changedTouches: MouseEvent[] }) => {
            const selectedText = stripSemanticMarkersFromRangeText(protyle.toolbar.range).split(Constants.ZWSP).join("");
            if (selectedText === "" || this.element.hasAttribute("disabled")) {
                return;
            }
            fixTableRange(protyle.toolbar.range);
            if (!isSameBlockRange(protyle.toolbar.range)) {
                return;
            }
            hintRef(selectedText, protyle, "search");
            protyle.toolbar.element.classList.add("fn__none");
            event.stopPropagation();
        });
    }
}
