import {MenuItem} from "./Menu";
import {openInputDialog} from "../dialog/inputDialog";
import {fetchPost} from "../util/fetch";
import {confirmDialog} from "../dialog/confirmDialog";
import {escapeHtml} from "../util/escape";
import {copySubMenu} from "./commonMenuItem";
import {Bookmark} from "../layout/dock/Bookmark";
import {MobileBookmarks} from "../mobile/dock/MobileBookmarks";
import {Constants} from "../constants";

export const openBookmarkMenu = (element: HTMLElement, event: MouseEvent, bookmarkObj: Bookmark | MobileBookmarks) => {
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_BOOKMARK) {
        window.siyuan.menus.menu.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    const id = element.getAttribute("data-node-id");
    if (!id && !window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "rename",
            icon: "iconEdit",
            label: window.siyuan.languages.rename,
            click: () => {
                const oldBookmark = element.querySelector(".b3-list-item__text").textContent;
                const dialog = openInputDialog({
                    title: window.siyuan.languages.rename,
                    value: oldBookmark,
                    onConfirm: (value, dialog) => {
                        fetchPost("/api/bookmark/renameBookmark", {
                            oldBookmark,
                            newBookmark: value
                        }, () => {
                            dialog.destroy();
                        });
                    },
                });
                dialog.element.setAttribute("data-key", Constants.DIALOG_RENAMEBOOKMARK);
            }
        }).element);
    }
    if (id) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copy",
            label: window.siyuan.languages.copy,
            type: "submenu",
            icon: "iconCopy",
            submenu: copySubMenu([element.getAttribute("data-node-id")], false)
        }).element);
    }

    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({
            id: "remove",
            icon: "iconTrashcan",
            label: window.siyuan.languages.remove,
            click: () => {
                const bookmarkText = element.querySelector(".b3-list-item__text").textContent;
                confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.removeBookmark.replace("${x}", `<b>${escapeHtml(bookmarkText)}</b>`), () => {
                    if (id) {
                        fetchPost("/api/attr/setBlockAttrs", {id, attrs: {bookmark: ""}}, () => {
                            bookmarkObj.update();
                        });
                        document.querySelectorAll(`.protyle-wysiwyg [data-node-id="${id}"]`).forEach((item) => {
                            item.setAttribute("bookmark", "");
                            const bookmarkElement = item.querySelector(".protyle-attr--bookmark");
                            if (bookmarkElement) {
                                bookmarkElement.remove();
                            }
                        });
                    } else {
                        fetchPost("/api/bookmark/removeBookmark", {bookmark: bookmarkText});
                    }
                }, undefined, true);
            }
        }).element);
    }
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_BOOKMARK);
    window.siyuan.menus.menu.popup({x: event.clientX - 11, y: event.clientY + 11, h: 22, w: 12});
};
