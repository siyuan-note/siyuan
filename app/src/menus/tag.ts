import {MenuItem} from "./Menu";
import {fetchPost} from "../util/fetch";
import {confirmDialog} from "../dialog/confirmDialog";
import {escapeHtml} from "../util/escape";
import {renameTag} from "../util/noRelyPCFunction";

export const openTagMenu = (element: HTMLElement, event: MouseEvent, labelName: string) => {
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === "tagMenu") {
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
                fetchPost("/api/tag/removeTag", {label: labelName});
            });
        }
    }).element);
    window.siyuan.menus.menu.element.setAttribute("data-name", "tagMenu");
    window.siyuan.menus.menu.popup({x: event.clientX - 11, y: event.clientY + 11, h: 22, w: 12});
};
