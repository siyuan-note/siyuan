import {MenuItem} from "./Menu";
import {saveLayout} from "../layout/util";

const moveMenuItem = (label: string, target: Element) => {
    return new MenuItem({
        label: window.siyuan.languages[label],
        icon: label.replace("moveTo", "icon"),
        click: () => {
            if (label.indexOf("moveToLeft") > -1) {
                window.siyuan.layout.leftDock.add(label.endsWith("Top") ? 0 : 1, target);
            } else if (label.indexOf("moveToRight") > -1) {
                window.siyuan.layout.rightDock.add(label.endsWith("Top") ? 0 : 1, target);
            } else if (label.indexOf("moveToBottom") > -1) {
                window.siyuan.layout.bottomDock.add(label.endsWith("Left") ? 0 : 1, target);
            }
            saveLayout();
        }
    });
};

export const initDockMenu = (target: Element) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.append(moveMenuItem("moveToLeftTop", target).element);
    window.siyuan.menus.menu.append(moveMenuItem("moveToLeftBottom", target).element);
    window.siyuan.menus.menu.append(moveMenuItem("moveToRightTop", target).element);
    window.siyuan.menus.menu.append(moveMenuItem("moveToRightBottom", target).element);
    window.siyuan.menus.menu.append(moveMenuItem("moveToBottomLeft", target).element);
    window.siyuan.menus.menu.append(moveMenuItem("moveToBottomRight", target).element);
    return window.siyuan.menus.menu;
};
