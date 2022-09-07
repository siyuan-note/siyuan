import {getEventName, isCtrl, updateHotkeyTip} from "../protyle/util/compatibility";
import {setPosition} from "../util/setPosition";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {isMobile} from "../util/functions";

export class Menu {
    public element: HTMLElement;
    private wheelEvent: string;

    constructor() {
        this.wheelEvent = "onwheel" in document.createElement("div") ? "wheel" : "mousewheel";

        this.element = document.getElementById("commonMenu");
        this.element.addEventListener(isMobile() ? getEventName() : "mouseover", (event) => {
            const target = event.target as Element;
            const itemElement = hasClosestByClassName(target, "b3-menu__item");
            if (!itemElement) {
                return;
            }
            if (itemElement.classList.contains("b3-menu__item--readonly")) {
                return;
            }
            const subMenuElement = itemElement.querySelector(".b3-menu__submenu");
            this.element.querySelectorAll(".b3-menu__item--show").forEach((item) => {
                if (!item.contains(itemElement)) {
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
            this.showSubMenu(subMenuElement);
        });
    }

    public showSubMenu(subMenuElement: Element) {
        const rect = subMenuElement.getBoundingClientRect();
        let style = "";
        const leftPosition = rect.left - this.element.clientWidth - rect.width;
        if (rect.right > window.innerWidth && (
            leftPosition > 0 || Math.abs(leftPosition) < (rect.right - window.innerWidth))) {
            if (leftPosition >= 0) {
                style = "left:auto;right:100%;";
            } else {
                style = `z-index:1;mix-blend-mode: normal;left:-${this.element.style.left};`;
            }
        } else if (rect.right > window.innerWidth) {
            style = `z-index:1;mix-blend-mode: normal;left:${window.innerWidth - rect.width - this.element.offsetLeft}px;`;
        }
        if (rect.bottom > window.innerHeight) {
            style += `top: auto;bottom:-5px;max-height:${Math.min(rect.top, window.innerHeight * 0.4)}px`;
        }
        if (style) {
            subMenuElement.setAttribute("style", style);
        }
    }

    private preventDefault(event: KeyboardEvent) {
        if (!hasClosestByClassName(event.target as Element, "b3-menu")) {
            event.preventDefault();
        }
    }

    public remove() {
        if (isMobile()) {
            window.removeEventListener("touchmove", this.preventDefault, false);
        } else {
            window.removeEventListener(this.wheelEvent, this.preventDefault, false);
        }

        this.element.innerHTML = "";
        this.element.classList.add("fn__none");
        this.element.style.zIndex = "";
    }

    public append(element?: HTMLElement) {
        if (!element) {
            return;
        }
        this.element.append(element);
    }

    public popup(options: { x: number, y: number, h?: number }, isLeft = false) {
        if (isMobile()) {
            window.addEventListener("touchmove", this.preventDefault, {passive: false});
        } else {
            window.addEventListener(this.wheelEvent, this.preventDefault, {passive: false});
        }

        this.element.classList.remove("fn__none");
        setPosition(this.element, options.x - (isLeft ? window.siyuan.menus.menu.element.clientWidth : 0), options.y, options.h);
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
            this.element.addEventListener(getEventName(), (event) => {
                if (this.element.getAttribute("disabled")) {
                    return;
                }
                options.click(this.element);
                this.element.parentElement.classList.add("fn__none");
                this.element.parentElement.innerHTML = "";
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
        if (options.id) {
            this.element.setAttribute("data-id", options.id);
        }
        if (options.type === "readonly") {
            this.element.classList.add("b3-menu__item--readonly");
        }
        this.element.innerHTML = html;
        if (options.bind) {
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
    if (event.code === "ArrowDown") {
        const currentElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current");
        let actionMenuElement;
        if (!currentElement) {
            actionMenuElement = getActionMenu(window.siyuan.menus.menu.element.firstElementChild, true);
        } else {
            currentElement.classList.remove("b3-menu__item--current", "b3-menu__item--show");
            actionMenuElement = getActionMenu(currentElement.nextElementSibling, true);
            if (!actionMenuElement) {
                actionMenuElement = getActionMenu(currentElement.parentElement.firstElementChild, true);
            }
        }
        if (actionMenuElement) {
            actionMenuElement.classList.add("b3-menu__item--current");
            actionMenuElement.classList.remove("b3-menu__item--show");
        }
    } else if (event.code === "ArrowUp") {
        const currentElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current");
        let actionMenuElement;
        if (!currentElement) {
            actionMenuElement = getActionMenu(window.siyuan.menus.menu.element.lastElementChild, false);
        } else {
            currentElement.classList.remove("b3-menu__item--current", "b3-menu__item--show");
            actionMenuElement = getActionMenu(currentElement.previousElementSibling, false);
            if (!actionMenuElement) {
                actionMenuElement = getActionMenu(currentElement.parentElement.lastElementChild, false);
            }
        }
        if (actionMenuElement) {
            actionMenuElement.classList.add("b3-menu__item--current");
            actionMenuElement.classList.remove("b3-menu__item--show");
        }
    } else if (event.code === "ArrowRight") {
        const currentElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current");
        if (!currentElement) {
            return true;
        }
        const subMenuElement = currentElement.querySelector(".b3-menu__submenu");
        if (!subMenuElement) {
            return true;
        }
        currentElement.classList.remove("b3-menu__item--current");
        currentElement.classList.add("b3-menu__item--show");

        const actionMenuElement = getActionMenu(subMenuElement.firstElementChild, true);
        if (actionMenuElement) {
            actionMenuElement.classList.add("b3-menu__item--current");
        }

        const rect = subMenuElement.getBoundingClientRect();
        let style = "";
        if (rect.right > window.innerWidth && (rect.left - subMenuElement.clientWidth - rect.width > 0 ||
            Math.abs(rect.left - subMenuElement.clientWidth - rect.width) < (rect.right - window.innerWidth))) {
            style = "left:auto;right:100%;";
        }
        if (rect.bottom > window.innerHeight) {
            style += `top: auto;bottom:-5px;max-height:${Math.min(rect.top, window.innerHeight * 0.4)}px`;
        }
        if (style) {
            subMenuElement.setAttribute("style", style);
        }
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

    // submenu scroll
    if (event.code === "ArrowUp" || event.code === "ArrowDown") {
        const currentMenuElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current") as HTMLElement;
        const currentParentElement = currentMenuElement.parentElement;
        if (currentParentElement.classList.contains("b3-menu__submenu")) {
            if (currentMenuElement.offsetTop + currentMenuElement.clientHeight > currentParentElement.scrollTop + currentParentElement.clientHeight) {
                currentParentElement.scrollTop = currentMenuElement.offsetTop + currentMenuElement.clientHeight - currentParentElement.clientHeight;
            } else if (currentMenuElement.offsetTop < currentParentElement.scrollTop) {
                currentParentElement.scrollTop = currentMenuElement.offsetTop;
            }
        }
        return true;
    }
};
