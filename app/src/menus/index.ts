/// #if !MOBILE
import {getInstanceById} from "../layout/util";
import {Tab} from "../layout/Tab";
import {initSearchMenu} from "./search";
import {initDockMenu} from "./dock";
import {initNavigationMenu, initFileMenu} from "./navigation";
import {initTabMenu} from "./tab";
/// #endif
import {Menu} from "./Menu";
import {hasTopClosestByTag} from "../protyle/util/hasClosest";


export class Menus {
    public menu: Menu;

    constructor() {
        this.menu = new Menu();
        /// #if !MOBILE
        window.addEventListener("contextmenu", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.parentElement.isEqualNode(document.querySelector("body"))) {
                event.preventDefault();
                const dataType = target.getAttribute("data-type");
                if (dataType === "tab-header") {
                    this.unselect();
                    initTabMenu((getInstanceById(target.getAttribute("data-id")) as Tab)).popup({
                        x: event.clientX,
                        y: event.clientY
                    });
                    event.stopPropagation();
                    break;
                }

                if (dataType === "navigation-root" && !window.siyuan.config.readonly) {
                    if (target.querySelector(".b3-list-item__text").classList.contains("ft__on-surface")) {
                        return;
                    }
                    this.unselect();
                    // navigation 根上：新建文档/文件夹/取消挂在/打开文件位置
                    initNavigationMenu(target).popup({x: event.clientX, y: event.clientY});
                    event.stopPropagation();
                    break;
                }

                if (dataType === "navigation-file") {
                    this.unselect();
                    // navigation 文件上：删除/重命名/打开文件位置/导出
                    initFileMenu(this.getDir(target), target.getAttribute("data-path"), target).popup({
                        x: event.clientX,
                        y: event.clientY
                    });
                    event.stopPropagation();
                    break;
                }

                if (dataType === "search-item") {
                    initSearchMenu(target.getAttribute("data-node-id")).popup({x: event.clientX, y: event.clientY});
                    event.stopPropagation();
                    break;
                }

                if (target.classList.contains("dock__item")) {
                    initDockMenu(target).popup({x: event.clientX, y: event.clientY});
                    event.stopPropagation();
                    break;
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
