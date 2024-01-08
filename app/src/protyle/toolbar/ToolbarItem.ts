import {getEventName} from "../util/compatibility";
import {updateHotkeyTip} from "../util/compatibility";
import {Constants} from "../../constants";

export class ToolbarItem {
    public element: HTMLElement;

    constructor(protyle: IProtyle, menuItem: IMenuItem) {
        this.element = document.createElement("button");
        const hotkey = menuItem.hotkey ? ` ${updateHotkeyTip(menuItem.hotkey)}` : "";
        const tip = menuItem.tip || window.siyuan.languages[menuItem.lang];
        this.element.classList.add("protyle-toolbar__item", "b3-tooltips", `b3-tooltips__${menuItem.tipPosition}`);
        this.element.setAttribute("data-type", menuItem.name);
        this.element.setAttribute("aria-label", tip + hotkey);
        this.element.innerHTML = `<svg><use xlink:href="#${menuItem.icon}"></use></svg>`;
        if (["text", "a", "block-ref", "inline-math", "inline-memo"].includes(menuItem.name)) {
            return;
        }
        this.element.addEventListener(getEventName(), (event) => {
            event.preventDefault();
            if (Constants.INLINE_TYPE.includes(menuItem.name)) {
                protyle.toolbar.setInlineMark(protyle, menuItem.name, "toolbar");
            } else if (menuItem.click) {
                menuItem.click(protyle.getInstance());
            }
        });
    }
}
