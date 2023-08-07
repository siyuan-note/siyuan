import {MenuItem} from "./Menu";
import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {confirmDialog} from "../dialog/confirmDialog";
import {escapeHtml} from "../util/escape";
import {copySubMenu} from "./commonMenuItem";
import {Bookmark} from "../layout/dock/Bookmark";
import {isMobile} from "../util/functions";
import {MobileBookmarks} from "../mobile/dock/MobileBookmarks";

export const openBookmarkMenu = (element: HTMLElement, event: MouseEvent, bookmarkObj: Bookmark | MobileBookmarks) => {
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === "bookmarkMenu") {
        window.siyuan.menus.menu.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    const id = element.getAttribute("data-node-id");
    if (!id && !window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconEdit",
            label: window.siyuan.languages.rename,
            click: () => {
                const oldBookmark = element.querySelector(".b3-list-item__text").textContent;
                const dialog = new Dialog({
                    title: window.siyuan.languages.rename,
                    content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                    width: isMobile() ? "92vw" : "520px",
                });
                const btnsElement = dialog.element.querySelectorAll(".b3-button");
                btnsElement[0].addEventListener("click", () => {
                    dialog.destroy();
                });
                const inputElement = dialog.element.querySelector("input");
                dialog.bindInput(inputElement, () => {
                    (btnsElement[1] as HTMLButtonElement).click();
                });
                inputElement.value = oldBookmark;
                inputElement.focus();
                inputElement.select();
                btnsElement[1].addEventListener("click", () => {
                    fetchPost("/api/bookmark/renameBookmark", {
                        oldBookmark,
                        newBookmark: inputElement.value
                    }, () => {
                        dialog.destroy();
                    });
                });
            }
        }).element);
    }
    if (id) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            type: "submenu",
            icon: "iconCopy",
            submenu: copySubMenu(element.getAttribute("data-node-id"), false)
        }).element);
    }

    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconTrashcan",
            label: window.siyuan.languages.remove,
            click: () => {
                const bookmarkText = element.querySelector(".b3-list-item__text").textContent;
                confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.confirmDelete} <b>${escapeHtml(bookmarkText)}</b>?`, () => {
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
                });
            }
        }).element);
    }
    window.siyuan.menus.menu.element.setAttribute("data-name", "bookmarkMenu");
    window.siyuan.menus.menu.element.style.zIndex = "221";  // 移动端被右侧栏遮挡
    window.siyuan.menus.menu.popup({x: event.clientX - 11, y: event.clientY + 11, h: 22, w: 12});
};
