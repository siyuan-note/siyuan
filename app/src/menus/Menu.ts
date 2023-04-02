import {getEventName, isCtrl, updateHotkeyTip} from "../protyle/util/compatibility";
import {setPosition} from "../util/setPosition";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {isMobile} from "../util/functions";

export class Menu {
    public element: HTMLElement;
    public removeCB: () => void;
    private wheelEvent: string;

    constructor() {
        this.wheelEvent = "onwheel" in document.createElement("div") ? "wheel" : "mousewheel";

        this.element = document.getElementById("commonMenu");
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
        const parentRect = subMenuElement.parentElement.getBoundingClientRect();
        subMenuElement.style.top = (parentRect.top - 8) + "px";
        subMenuElement.style.left = (parentRect.right + 8) + "px";
        subMenuElement.style.bottom = "auto";
        const rect = subMenuElement.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            if (parentRect.left - 8 > rect.width) {
                subMenuElement.style.left = (parentRect.left - 8 - rect.width) + "px";
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

    public remove() {
        if (window.siyuan.menus.menu.removeCB) {
            window.siyuan.menus.menu.removeCB();
            window.siyuan.menus.menu.removeCB = undefined;
        }
        if (isMobile()) {
            window.removeEventListener("touchmove", this.preventDefault, false);
        } else {
            window.removeEventListener(this.wheelEvent, this.preventDefault, false);
        }

        this.element.innerHTML = "";
        this.element.classList.add("fn__none");
        this.element.classList.remove("b3-menu--list", "b3-menu--fullscreen");
        this.element.removeAttribute("style");  // zIndex
        window.siyuan.menus.menu.element.removeAttribute("data-name");    // 标识再次点击不消失
    }

    public append(element?: HTMLElement) {
        if (!element) {
            return;
        }
        this.element.append(element);
    }

    public popup(options: { x: number, y: number, h?: number, w?: number }, isLeft = false) {
        if (this.element.innerHTML === "") {
            return;
        }
        if (isMobile()) {
            window.addEventListener("touchmove", this.preventDefault, {passive: false});
        } else {
            window.addEventListener(this.wheelEvent, this.preventDefault, {passive: false});
        }

        this.element.classList.remove("fn__none");
        setPosition(this.element, options.x - (isLeft ? window.siyuan.menus.menu.element.clientWidth : 0), options.y, options.h, options.w);
    }

    public fullscreen(position: "bottom" | "all" = "all") {
        this.element.classList.add("b3-menu--fullscreen");
        this.element.insertAdjacentHTML("afterbegin", `<div class="b3-menu__title">
<svg class="b3-menu__icon"><use xlink:href="#iconLeft"></use></svg>
<span class="b3-menu__label">${window.siyuan.languages.back}</span>
</div><button class="b3-menu__separator"></button>`);
        if (position === "bottom") {
            this.element.querySelectorAll(".b3-menu__submenu").forEach((item: HTMLElement) => {
                item.style.top = "calc(50vh + 48.5px)";
            });
        }
        this.popup({x: 0, y: position === "bottom" ? window.innerHeight / 2 : 0});
        this.element.scrollTop = 0;
    }
}

export class MenuItem {
    public element: HTMLElement;

    constructor(options: IMenu) {
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
                options.click(this.element);
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                window.siyuan.menus.menu.remove();
            });
        }
        let html = `<span class="b3-menu__label">${options.label}</span>`;
        if (options.iconHTML) {
            html = options.iconHTML + html;
        } else {
            html = `<svg class="b3-menu__icon${["HTML (SiYuan)", window.siyuan.languages.template].includes(options.label) ? " ft__error" : ""}" style="${options.icon === "iconClose" ? "height:10px;" : ""}"><use xlink:href="#${options.icon || ""}"></use></svg>${html}`;
        }
        if (options.accelerator) {
            html += `<span class="b3-menu__accelerator">${updateHotkeyTip(options.accelerator)}</span>`;
        }
        if (options.action) {
            html += `<svg class="b3-menu__action"><use xlink:href="#${options.action}"></use></svg>`;
        }
        if (options.id) {
            this.element.setAttribute("data-id", options.id);
        }
        if (options.type === "readonly") {
            this.element.classList.add("b3-menu__item--readonly");
        }
        this.element.innerHTML = html;
        if (options.bind) {
            // 主题 rem craft 需要使用 b3-menu__item--custom 来区分自定义菜单 by 281261361
            this.element.classList.add("b3-menu__item--custom");
            options.bind(this.element);
        }
        if (options.submenu) {
            const submenuElement = document.createElement("div");
            submenuElement.classList.add("b3-menu__submenu");
            options.submenu.forEach((item) => {
                submenuElement.append(new MenuItem(item).element);
            });
            this.element.insertAdjacentHTML("beforeend", '<svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>');
            this.element.append(submenuElement);
        }
    }
}

const getActionMenu = (element: Element, next: boolean) => {
    let actionMenuElement = element;
    while (actionMenuElement && (actionMenuElement.classList.contains("b3-menu__separator") || actionMenuElement.classList.contains("b3-menu__item--readonly"))) {
        if (next) {
            actionMenuElement = actionMenuElement.nextElementSibling;
        } else {
            actionMenuElement = actionMenuElement.previousElementSibling;
        }
    }
    return actionMenuElement;
};

export const bindMenuKeydown = (event: KeyboardEvent) => {
    if (window.siyuan.menus.menu.element.classList.contains("fn__none") || event.altKey || event.shiftKey || isCtrl(event)) {
        return false;
    }
    if (event.code === "ArrowDown" || event.code === "ArrowUp") {
        const currentElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current");
        let actionMenuElement;
        if (!currentElement) {
            if (event.code === "ArrowUp") {
                actionMenuElement = getActionMenu(window.siyuan.menus.menu.element.lastElementChild, false);
            } else {
                actionMenuElement = getActionMenu(window.siyuan.menus.menu.element.firstElementChild, true);
            }
        } else {
            currentElement.classList.remove("b3-menu__item--current", "b3-menu__item--show");
            if (event.code === "ArrowUp") {
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
    } else if (event.code === "ArrowRight") {
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

        const actionMenuElement = getActionMenu(subMenuElement.firstElementChild, true);
        if (actionMenuElement) {
            actionMenuElement.classList.add("b3-menu__item--current");
        }
        window.siyuan.menus.menu.showSubMenu(subMenuElement);
        return true;
    } else if (event.code === "ArrowLeft") {
        const currentElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__submenu .b3-menu__item--current");
        if (!currentElement) {
            return true;
        }
        currentElement.parentElement.parentElement.classList.remove("b3-menu__item--show");
        currentElement.parentElement.parentElement.classList.add("b3-menu__item--current");
        currentElement.classList.remove("b3-menu__item--current");
        return true;
    } else if (event.code === "Enter") {
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
            window.siyuan.menus.menu.remove();
        }
        return true;
    }
};
