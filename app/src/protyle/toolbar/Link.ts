import {getEventName} from "../util/compatibility";
import {ToolbarItem} from "./ToolbarItem";

export class Link extends ToolbarItem {
    public element: HTMLElement;

    constructor(protyle: IProtyle, menuItem: IMenuItem) {
        super(protyle, menuItem);
        this.element.addEventListener(getEventName(), (event: MouseEvent & { changedTouches: MouseEvent[] }) => {
            protyle.toolbar.setInlineMark(protyle, "link", "add");
            event.stopPropagation();
        });
    }
}
