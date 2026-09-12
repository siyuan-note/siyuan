import {MenuItem} from "./Menu";
import {Constants} from "../constants";
import {buildDockEntryVisibilityMenuItems, buildEntryVisibilityToggleItem} from "../config/entryVisibility/menu";
import {getDockEntryKey, refreshDockCatalog} from "../config/entryVisibility/catalog";

const moveMenuItem = (label: string, target: Element) => {
    return new MenuItem({
        id: label,
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
        }
    });
};

export const initDockMenu = (target?: Element, container?: Element) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_DOCK);
    refreshDockCatalog(window.siyuan.ws?.app?.plugins || []);
    if (target) {
        window.siyuan.menus.menu.append(moveMenuItem("moveToLeftTop", target).element);
        window.siyuan.menus.menu.append(moveMenuItem("moveToLeftBottom", target).element);
        window.siyuan.menus.menu.append(moveMenuItem("moveToRightTop", target).element);
        window.siyuan.menus.menu.append(moveMenuItem("moveToRightBottom", target).element);
        window.siyuan.menus.menu.append(moveMenuItem("moveToBottomLeft", target).element);
        window.siyuan.menus.menu.append(moveMenuItem("moveToBottomRight", target).element);
        const key = getDockEntryKey(target);
        const item = key ? buildEntryVisibilityToggleItem(`dock.${key}`) : undefined;
        if (item) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem(item).element);
        }
    }
    const items = buildDockEntryVisibilityMenuItems(container || target?.closest(".dock") || undefined);
    if (target && items.length > 0) {
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    }
    items.forEach((item) => {
        window.siyuan.menus.menu.append(new MenuItem(item).element);
    });
    return window.siyuan.menus.menu;
};
