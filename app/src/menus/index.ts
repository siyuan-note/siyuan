/// #if !MOBILE
import {getInstanceById} from "../layout/util";
import {Tab} from "../layout/Tab";
import {initSearchMenu} from "./search";
import {initDockMenu} from "./dock";
import {initFileMenu, initNavigationMenu} from "./navigation";
import {initTabMenu} from "./tab";
/// #endif
import {Menu, MenuItem} from "./Menu";
import {hasClosestByClassName, hasTopClosestByTag} from "../protyle/util/hasClosest";
import {App} from "../index";


export class Menus {
    public menu: Menu;

    constructor(app: App) {
        this.menu = new Menu();
        /// #if !MOBILE
        window.addEventListener("contextmenu", (event) => {
            if (event.shiftKey) {
                return;
            }
            let target = event.target as HTMLElement;
            if (hasClosestByClassName(target, "av__panel") && !hasClosestByClassName(target, "b3-menu")) {
                document.querySelector(".av__panel").dispatchEvent(new CustomEvent("click", {detail: "close"}));
                event.stopPropagation();
                return;
            }
            while (target && target.parentElement   // ⌃⇥ 后点击会为空
            && !target.parentElement.isEqualNode(document.querySelector("body"))) {
                event.preventDefault();
                const dataType = target.getAttribute("data-type");
                if (dataType === "tab-header") {
                    this.unselect();
                    initTabMenu(app, (getInstanceById(target.getAttribute("data-id")) as Tab)).popup({
                        x: event.clientX,
                        y: event.clientY
                    });
                    event.stopPropagation();
                    break;
                } else if (dataType === "navigation-root" && !window.siyuan.config.readonly) {
                    if (target.querySelector(".b3-list-item__text").classList.contains("ft__on-surface")) {
                        return;
                    }
                    this.unselect();
                    // navigation 根上：新建文档/文件夹/取消挂在/打开文件位置
                    initNavigationMenu(app, target).popup({x: event.clientX, y: event.clientY});
                    event.stopPropagation();
                    break;
                } else if (dataType === "navigation-file") {
                    this.unselect();
                    // navigation 文件上：删除/重命名/打开文件位置/导出
                    initFileMenu(app, this.getDir(target), target.getAttribute("data-path"), target).popup({
                        x: event.clientX,
                        y: event.clientY
                    });
                    event.stopPropagation();
                    break;
                } else if (dataType === "search-item") {
                    const nodeId = target.getAttribute("data-node-id");
                    if (nodeId) {
                        initSearchMenu(nodeId).popup({x: event.clientX, y: event.clientY});
                    }
                    event.stopPropagation();
                    break;
                } else if (dataType && target.classList.contains("dock__item")) {
                    initDockMenu(target).popup({x: event.clientX, y: event.clientY});
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("b3-text-field")) {
                    window.siyuan.menus.menu.remove();
                    if ((target as HTMLInputElement).selectionStart !== (target as HTMLInputElement).selectionEnd) {
                        window.siyuan.menus.menu.append(new MenuItem({
                            icon: "iconCopy",
                            accelerator: "⌘C",
                            label: window.siyuan.languages.copy,
                            click: () => {
                                document.execCommand("copy");
                            }
                        }).element);
                        window.siyuan.menus.menu.append(new MenuItem({
                            icon: "iconCut",
                            accelerator: "⌘X",
                            label: window.siyuan.languages.cut,
                            click: () => {
                                document.execCommand("cut");
                            }
                        }).element);
                        window.siyuan.menus.menu.append(new MenuItem({
                            icon: "iconTrashcan",
                            accelerator: "⌫",
                            label: window.siyuan.languages.delete,
                            click: () => {
                                document.execCommand("delete");
                            }
                        }).element);
                    }
                    window.siyuan.menus.menu.append(new MenuItem({
                        label: window.siyuan.languages.paste,
                        icon: "iconPaste",
                        accelerator: "⌘V",
                        click: async () => {
                            document.execCommand("paste");
                        }
                    }).element);
                    window.siyuan.menus.menu.append(new MenuItem({
                        label: window.siyuan.languages.selectAll,
                        icon: "iconSelect",
                        accelerator: "⌘A",
                        click: () => {
                            document.execCommand("selectAll");
                        }
                    }).element);
                    window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
                    target.focus()
                }
                target = target.parentElement;
            }
        }, false);
        /// #endif
    }

    private getDir(target: HTMLElement) {
        const rootElement = hasTopClosestByTag(target, "UL");
        if (rootElement) {
            return rootElement.getAttribute("data-url");
        }
    }

    private unselect() {
        if (getSelection().rangeCount > 0) {
            getSelection().getRangeAt(0).collapse(true);
        }
    }
}
