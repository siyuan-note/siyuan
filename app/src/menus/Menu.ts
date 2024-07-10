import {getEventName, updateHotkeyTip} from "../protyle/util/compatibility";
import {setPosition} from "../util/setPosition";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {isMobile} from "../util/functions";
import {Constants} from "../constants";

export class Menu {
    public element: HTMLElement;
    public data: any;   // 用于记录当前菜单的数据
    public removeCB: () => void;
    private wheelEvent: string;

    constructor() {
        this.wheelEvent = "onwheel" in document.createElement("div") ? "wheel" : "mousewheel";

        this.element = document.getElementById("commonMenu");
        this.element.querySelector(".b3-menu__title .b3-menu__label").innerHTML = window.siyuan.languages.back;
        this.element.addEventListener(isMobile() ? "click" : "mouseover", (event) => {
            const target = event.target as Element;
            if (isMobile()) {
                const titleElement = hasClosestByClassName(target, "b3-menu__title");
                if (titleElement || (typeof event.detail === "string" && event.detail === "back")) {
                    const lastShowElements = this.element.querySelectorAll(".b3-menu__item--show");
                    if (lastShowElements.length > 0) {
                        lastShowElements[lastShowElements.length - 1].classList.remove("b3-menu__item--show");
                    } else {
                        this.remove();
                    }
                    return;
                }
            }

            const itemElement = hasClosestByClassName(target, "b3-menu__item");
            if (!itemElement) {
                return;
            }
            if (itemElement.classList.contains("b3-menu__item--readonly")) {
                return;
            }
            const subMenuElement = itemElement.querySelector(".b3-menu__submenu") as HTMLElement;
            this.element.querySelectorAll(".b3-menu__item--show").forEach((item) => {
                if (!item.contains(itemElement) && !item.isSameNode(itemElement) && !itemElement.contains(item)) {
                    item.classList.remove("b3-menu__item--show");
                }
            });
            this.element.querySelectorAll(".b3-menu__item--current").forEach((item) => {
                item.classList.remove("b3-menu__item--current");
            });
            itemElement.classList.add("b3-menu__item--current");
            if (!subMenuElement) {
                return;
            }
            itemElement.classList.add("b3-menu__item--show");
            if (!this.element.classList.contains("b3-menu--fullscreen")) {
                this.showSubMenu(subMenuElement);
            }
        });
    }

    public showSubMenu(subMenuElement: HTMLElement) {
        const itemRect = subMenuElement.parentElement.getBoundingClientRect();
        subMenuElement.style.top = (itemRect.top - 8) + "px";
        subMenuElement.style.left = (itemRect.right + 8) + "px";
        subMenuElement.style.bottom = "auto";
        const rect = subMenuElement.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            if (itemRect.left - 8 > rect.width) {
                subMenuElement.style.left = (itemRect.left - 8 - rect.width) + "px";
            } else {
                subMenuElement.style.left = (window.innerWidth - rect.width) + "px";
            }
        }
        if (rect.bottom > window.innerHeight) {
            subMenuElement.style.top = "auto";
            subMenuElement.style.bottom = "8px";
        }
    }

    private preventDefault(event: KeyboardEvent) {
        if (!hasClosestByClassName(event.target as Element, "b3-menu") &&
            // 移动端底部键盘菜单
            !hasClosestByClassName(event.target as Element, "keyboard__bar")) {
            event.preventDefault();
        }
    }

    public addSeparator(index?: number) {
        return this.addItem({type: "separator", index});
    }

    public addItem(option: IMenu) {
        const menuItem = new MenuItem(option);
        this.append(menuItem.element, option.index);
        return menuItem.element;
    }

    public removeScrollEvent() {
        window.removeEventListener(isMobile() ? "touchmove" : this.wheelEvent, this.preventDefault, false);
    }

    public remove() {
        if (window.siyuan.menus.menu.removeCB) {
            window.siyuan.menus.menu.removeCB();
            window.siyuan.menus.menu.removeCB = undefined;
        }
        this.removeScrollEvent();
        this.element.firstElementChild.classList.add("fn__none");
        this.element.lastElementChild.innerHTML = "";
        this.element.lastElementChild.removeAttribute("style");  // 输入框 focus 后 boxShadow 显示不全
        this.element.classList.add("fn__none");
        this.element.classList.remove("b3-menu--list", "b3-menu--fullscreen");
        this.element.removeAttribute("style");  // zIndex
        this.element.removeAttribute("data-name");    // 标识再次点击不消失
        this.element.removeAttribute("data-from");    // 标识是否在浮窗内打开
        this.data = undefined;    // 移除数据
    }

    public append(element?: HTMLElement, index?: number) {
        if (!element) {
            return;
        }
        if (typeof index === "number") {
            const insertElement = this.element.querySelectorAll(".b3-menu__items > .b3-menu__separator")[index];
            if (insertElement) {
                insertElement.before(element);
                return;
            }
        }
        this.element.lastElementChild.append(element);
    }

    public popup(options: IPosition) {
        if (this.element.lastElementChild.innerHTML === "") {
            return;
        }
        window.addEventListener(isMobile() ? "touchmove" : this.wheelEvent, this.preventDefault, {passive: false});
        this.element.style.zIndex = (++window.siyuan.zIndex).toString();
        this.element.classList.remove("fn__none");
        setPosition(this.element, options.x - (options.isLeft ? this.element.clientWidth : 0), options.y, options.h, options.w);
    }

    public fullscreen(position: "bottom" | "all" = "all") {
        if (this.element.lastElementChild.innerHTML === "") {
            return;
        }
        this.element.classList.add("b3-menu--fullscreen");
        this.element.style.zIndex = (++window.siyuan.zIndex).toString();
        this.element.firstElementChild.classList.remove("fn__none");
        this.element.classList.remove("fn__none");
        window.addEventListener("touchmove", this.preventDefault, {passive: false});

        setTimeout(() => {
            if (position === "bottom") {
                this.element.style.transform = "translateY(-50vh)";
                this.element.style.height = "50vh";
            } else {
                this.element.style.transform = "translateY(-100vh)";
            }
        });
        this.element.lastElementChild.scrollTop = 0;
    }
}

export class MenuItem {
    public element: HTMLElement;

    constructor(options: IMenu) {
        if (options.ignore) {
            return;
        }
        if (options.type === "empty") {
            this.element = document.createElement("div");
            this.element.innerHTML = options.label;
            if (options.bind) {
                options.bind(this.element);
            }
            return;
        }

        this.element = document.createElement("button");
        if (options.disabled) {
            this.element.setAttribute("disabled", "disabled");
        }
        if (options.type === "separator") {
            this.element.classList.add("b3-menu__separator");
            return;
        }
        this.element.classList.add("b3-menu__item");
        if (options.current) {
            this.element.classList.add("b3-menu__item--selected");
        }
        if (options.click) {
            // 需使用 click，否则移动端无法滚动
            this.element.addEventListener("click", (event) => {
                if (this.element.getAttribute("disabled")) {
                    return;
                }
                let keepOpen = options.click(this.element, event);
                if (keepOpen instanceof Promise) {
                    keepOpen = false;
                }
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                if (this.element.parentElement && !keepOpen) {
                    window.siyuan.menus.menu.remove();
                }
            });
        }
        if (options.id) {
            this.element.setAttribute("data-id", options.id);
        }
        if (options.type === "readonly") {
            this.element.classList.add("b3-menu__item--readonly");
        }

        if (options.element) {
            this.element.append(options.element);
        } else {
            let html = `<span class="b3-menu__label">${options.label || "&nbsp;"}</span>`;
            if (typeof options.iconHTML === "string") {
                html = options.iconHTML + html;
            } else {
                html = `<svg class="b3-menu__icon ${options.iconClass || ""}" style="${options.icon === "iconClose" ? "height:10px;" : ""}"><use xlink:href="#${options.icon || ""}"></use></svg>${html}`;
            }
            if (options.accelerator) {
                html += `<span class="b3-menu__accelerator">${updateHotkeyTip(options.accelerator)}</span>`;
            }
            if (options.action) {
                html += `<svg class="b3-menu__action${options.action === "iconCloseRound" ? " b3-menu__action--close" : ""}"><use xlink:href="#${options.action}"></use></svg>`;
            }
            if (options.checked) {
                html += '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg></span>';
            }
            this.element.innerHTML = html;
        }

        if (options.bind) {
            // 主题 rem craft 需要使用 b3-menu__item--custom 来区分自定义菜单 by 281261361
            this.element.classList.add("b3-menu__item--custom");
            options.bind(this.element);
        }

        if (options.submenu) {
            const submenuElement = document.createElement("div");
            submenuElement.classList.add("b3-menu__submenu");
            submenuElement.innerHTML = '<div class="b3-menu__items"></div>';
            options.submenu.forEach((item) => {
                submenuElement.firstElementChild.append(new MenuItem(item).element);
            });
            this.element.insertAdjacentHTML("beforeend", '<svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>');
            this.element.append(submenuElement);
        }
    }
}

const getActionMenu = (element: Element, next: boolean) => {
    let actionMenuElement = element;
    while (actionMenuElement && (actionMenuElement.classList.contains("b3-menu__separator") || actionMenuElement.classList.contains("b3-menu__item--readonly"))) {
        if (actionMenuElement.querySelector(".b3-text-field")) {
            break;
        }
        if (next) {
            actionMenuElement = actionMenuElement.nextElementSibling;
        } else {
            actionMenuElement = actionMenuElement.previousElementSibling;
        }
    }
    return actionMenuElement;
};

export const bindMenuKeydown = (event: KeyboardEvent) => {
    if (window.siyuan.menus.menu.element.classList.contains("fn__none")
        || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) {
        return false;
    }
    const target = event.target as HTMLElement;
    if (window.siyuan.menus.menu.element.contains(target) && ["INPUT", "TEXTAREA"].includes(target.tagName)) {
        return false;
    }
    const eventCode = Constants.KEYCODELIST[event.keyCode];
    if (eventCode === "↓" || eventCode === "↑") {
        const currentElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current");
        let actionMenuElement;
        if (!currentElement) {
            if (eventCode === "↑") {
                actionMenuElement = getActionMenu(window.siyuan.menus.menu.element.lastElementChild.lastElementChild, false);
            } else {
                actionMenuElement = getActionMenu(window.siyuan.menus.menu.element.lastElementChild.firstElementChild, true);
            }
        } else {
            currentElement.classList.remove("b3-menu__item--current", "b3-menu__item--show");
            if (eventCode === "↑") {
                actionMenuElement = getActionMenu(currentElement.previousElementSibling, false);
                if (!actionMenuElement) {
                    actionMenuElement = getActionMenu(currentElement.parentElement.lastElementChild, false);
                }
            } else {
                actionMenuElement = getActionMenu(currentElement.nextElementSibling, true);
                if (!actionMenuElement) {
                    actionMenuElement = getActionMenu(currentElement.parentElement.firstElementChild, true);
                }
            }
        }
        if (actionMenuElement) {
            actionMenuElement.classList.add("b3-menu__item--current");
            actionMenuElement.classList.remove("b3-menu__item--show");
            const parentRect = actionMenuElement.parentElement.getBoundingClientRect();
            const actionMenuRect = actionMenuElement.getBoundingClientRect();
            if (parentRect.top > actionMenuRect.top || parentRect.bottom < actionMenuRect.bottom) {
                actionMenuElement.scrollIntoView(parentRect.top > actionMenuRect.top);
            }
        }
        return true;
    } else if (eventCode === "→") {
        const currentElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current");
        if (!currentElement) {
            return true;
        }
        const subMenuElement = currentElement.querySelector(".b3-menu__submenu") as HTMLElement;
        if (!subMenuElement) {
            return true;
        }
        currentElement.classList.remove("b3-menu__item--current");
        currentElement.classList.add("b3-menu__item--show");

        const actionMenuElement = getActionMenu(subMenuElement.firstElementChild.firstElementChild, true);
        if (actionMenuElement) {
            actionMenuElement.classList.add("b3-menu__item--current");
        }
        window.siyuan.menus.menu.showSubMenu(subMenuElement);
        return true;
    } else if (eventCode === "←") {
        const currentElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__submenu .b3-menu__item--current");
        if (!currentElement) {
            return true;
        }
        const parentItemElement = hasClosestByClassName(currentElement, "b3-menu__item--show");
        if (parentItemElement) {
            parentItemElement.classList.remove("b3-menu__item--show");
            parentItemElement.classList.add("b3-menu__item--current");
            currentElement.classList.remove("b3-menu__item--current");
        }
        return true;
    } else if (eventCode === "↩") {
        const currentElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current");
        if (!currentElement) {
            return false;
        } else {
            const textElement = currentElement.querySelector(".b3-text-field") as HTMLInputElement;
            const checkElement = currentElement.querySelector(".b3-switch") as HTMLInputElement;
            if (textElement) {
                textElement.focus();
                return true;
            } else if (checkElement) {
                checkElement.click();
            } else {
                currentElement.dispatchEvent(new CustomEvent(getEventName()));
            }
            if (window.siyuan.menus.menu.element.contains(currentElement)) {
                // 块标上 AI 会使用新的 menu，不能移除
                window.siyuan.menus.menu.remove();
            }
        }
        return true;
    }
};

export class subMenu {
    public menus: IMenu[];

    constructor() {
        this.menus = [];
    }

    addSeparator(index?: number) {
        if (typeof index === "number") {
            this.menus.splice(index, 0, {type: "separator"});
        } else {
            this.menus.push({type: "separator"});
        }
    }

    addItem(menu: IMenu) {
        if (typeof menu.index === "number") {
            this.menus.splice(menu.index, 0, menu);
        } else {
            this.menus.push(menu);
        }
    }
}
