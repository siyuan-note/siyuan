import {ToolbarItem} from "./ToolbarItem";

export class BlockRef extends ToolbarItem {
    public element: HTMLElement;

    constructor(protyle: IProtyle, menuItem: IMenuItem) {
        super(protyle, menuItem);
        // 不能用 getEventName，否则会导致光标位置变动到点击的文档中
        this.element.addEventListener("click", (event: MouseEvent & { changedTouches: MouseEvent[] }) => {
            protyle.toolbar.setInlineMark(protyle, "blockRef", "add");
            protyle.toolbar.element.classList.add("fn__none");
            event.stopPropagation();
        });
    }
}
