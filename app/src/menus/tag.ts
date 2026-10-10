import {toggleMenu} from "./menuToggle";
import {MenuItem} from "./Menu";
import {fetchPost} from "../util/fetch";
import {confirmDialog} from "../dialog/confirmDialog";
import {escapeHtml} from "../util/escape";
import {renameTag} from "../util/noRelyPCFunction";
import {getDockByType} from "../layout/tabUtil";
import {Tag} from "../layout/dock/Tag";
import {Constants} from "../constants";

export const openTagMenu = (element: HTMLElement, event: MouseEvent, labelName: string) => {
    toggleMenu({
        target: event.type === "contextmenu" ? element : (event.target as Element).closest(".b3-list-item__action") || element,
        toggle: event.type !== "contextmenu",
        build: (_menu, session) => {
            if (window.siyuan.config.readonly) {
                return;
            }


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
            session.show(() => window.siyuan.menus.menu.popup({x: button ? rect.left : event.clientX, y: rect.bottom, h: rect.height}));

        },
    });
};
