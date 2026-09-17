import {MenuItem} from "./Menu";
import {fetchPost} from "../util/fetch";
import {confirmDialog} from "../dialog/confirmDialog";
import {escapeHtml} from "../util/escape";
import {renameTag} from "../util/noRelyPCFunction";
import {getDockByType} from "../layout/tabUtil";
import {Tag} from "../layout/dock/Tag";
import {Constants} from "../constants";

export const openTagMenu = (element: HTMLElement, event: MouseEvent, labelName: string) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    if (event.type !== "contextmenu" && !window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_TAG) {
        window.siyuan.menus.menu.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconEdit",
        label: window.siyuan.languages.rename,
        click: () => {
            renameTag(labelName);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.remove,
        click: () => {
            confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.confirmDelete} <b>${escapeHtml(labelName)}</b>?`, () => {
                fetchPost("/api/tag/removeTag", {label: labelName}, () => {
                    /// #if MOBILE
                    window.siyuan.mobile.docks.tag.update();
                    /// #else
                    const dockTag = getDockByType("tag");
                    (dockTag.data.tag as Tag).update();
                    /// #endif
                });
            }, undefined, true);
        }
    }).element);
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_TAG);
    const button = event.type === "contextmenu" ? null : (event.target as Element).closest(".b3-list-item__action");
    const rect = (button || element).getBoundingClientRect();
    window.siyuan.menus.menu.popup({x: button ? rect.left : event.clientX, y: rect.bottom, h: rect.height});
};
