import {getEventName, updateHotkeyTip} from "../protyle/util/compatibility";
import {setPosition} from "../util/setPosition";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {isMobile} from "../util/functions";
import {Constants} from "../constants";
import {getTopBarHeight} from "../layout/getTopBarHeight";
import {electronUndo} from "../protyle/undo";
import {escapeAttr} from "../util/escape";
/// #if !MOBILE
import {applyMenuEntryVisibility} from "../config/entryVisibility/runtime";
/// #endif

const CUSTOM_EVENT_LOAD_SUBMENU = "load-submenu";
let fullscreenCloseTimeout: number;
let fullscreenScrimHideTimeout: number;

const updateMenuItemGroupClasses = (itemsElement: Element) => {
    const itemElements = Array.from(itemsElement.children).filter((element) =>
        element.classList.contains("b3-menu__item")) as HTMLElement[];
    itemElements.forEach((element) => {
        element.classList.remove("b3-menu__item--group-first", "b3-menu__item--group-last");
    });
    if (itemElements.length === 0) {
        itemsElement.classList.remove("b3-menu__items--menu");
        return;
    }
    itemsElement.classList.add("b3-menu__items--menu");
    let groupElements: HTMLElement[] = [];
    const updateGroup = () => {
        if (groupElements.length === 0) {
            return;
        }
        groupElements[0].classList.add("b3-menu__item--group-first");
        groupElements[groupElements.length - 1].classList.add("b3-menu__item--group-last");
        groupElements = [];
    };
    Array.from(itemsElement.children).forEach((element: HTMLElement) => {
        if (element.classList.contains("fn__none")) {
            return;
        }
        if (element.classList.contains("b3-menu__separator")) {
            updateGroup();
        } else if (element.classList.contains("b3-menu__item")) {
            groupElements.push(element);
        }
    });
    updateGroup();
};

const applyMenuConfig = (menuElement: HTMLElement) => {
    /// #if !MOBILE
    applyMenuEntryVisibility(menuElement);
    menuElement.querySelectorAll(".b3-menu__items").forEach(updateMenuItemGroupClasses);
    /// #endif
};

export class Menu {
    public element: HTMLElement;
    public data: any;   // 用于记录当前菜单的数据
    public removeCB: () => void;
    private wheelEvent: string;
    private position: IPosition;
    private sheetTouchStartX: number | undefined;
    private sheetTouchStartY: number | undefined;
    private sheetTouchStartTime: number | undefined;
    private sheetCanDrag = false;
    private sheetDragging = false;
    private suppressSheetClick = false;
    private targetPositionFrame: number | undefined;

    private updateTargetPosition = () => {
        if (typeof this.targetPositionFrame === "number") {
            cancelAnimationFrame(this.targetPositionFrame);
        }
        this.targetPositionFrame = requestAnimationFrame(() => {
            this.targetPositionFrame = undefined;
            this.resetPosition();
        });
    };

    constructor(element?: HTMLElement) {
        this.wheelEvent = "onwheel" in document.createElement("div") ? "wheel" : "mousewheel";
        this.preventDefault = this.preventDefault.bind(this);

        this.element = element || document.getElementById("commonMenu");
        this.element.querySelector(".b3-menu__title .b3-menu__label").innerHTML = window.siyuan.languages.back;
        if (isMobile()) {
            this.element.addEventListener("touchstart", this.handleSheetTouchStart, {passive: true});
            this.element.addEventListener("touchmove", this.handleSheetTouchMove, {passive: false});
            this.element.addEventListener("touchend", this.handleSheetTouchEnd);
            this.element.addEventListener("touchcancel", this.handleSheetTouchCancel);
            if (this.element.id === "commonMenu") {
                document.getElementById("commonMenuScrim")?.addEventListener("click", (event) => {
                    event.stopPropagation();
                    this.closeSheet();
                });
            }
        }
        this.element.addEventListener(isMobile() ? "click" : "mouseover", (event) => {
            if (isMobile() && this.suppressSheetClick && typeof event.detail !== "string") {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            const target = event.target as Element;
            if (isMobile()) {
                const titleElement = hasClosestByClassName(target, "b3-menu__title");
                const isSystemBack = typeof event.detail === "string" && event.detail === "back";
                if ((titleElement && !titleElement.classList.contains("b3-menu__title--root")) || isSystemBack) {
                    const lastShowElements = this.element.querySelectorAll(".b3-menu__item--show");
                    if (lastShowElements.length > 0) {
                        lastShowElements[lastShowElements.length - 1].classList.remove("b3-menu__item--show");
                        if (this.element.classList.contains("b3-menu--sheet")) {
                            this.setSheetHeight(this.element.dataset.position === "bottom" ? "bottom" : "all");
                        }
                    } else {
                        this.closeSheet();
                    }
                    return;
                }
            }

            const itemElement = hasClosestByClassName(target, "b3-menu__item");
            if (!itemElement) {
                return;
            }
            if (itemElement.classList.contains("b3-menu__item--readonly") ||
                itemElement.getAttribute("data-type") === "nobg") {
                return;
            }
            const subMenuElement = itemElement.querySelector(":scope > .b3-menu__submenu") as HTMLElement;
            // 子菜单容器的 mouseover 会向上匹配到所属菜单项，无需重新定位已打开的子菜单
            if (subMenuElement?.contains(target)) {
                return;
            }
            const isSubMenuShown = itemElement.classList.contains("b3-menu__item--show");
            this.element.querySelectorAll(".b3-menu__item--show").forEach((item) => {
                if (!item.contains(itemElement) && item !== itemElement && !itemElement.contains(item)) {
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
            if (!isSubMenuShown) {
                if (this.element.classList.contains("b3-menu--sheet")) {
                    this.setSheetHeight(this.element.dataset.position === "bottom" ? "bottom" : "all");
                } else if (!this.element.classList.contains("b3-menu--fullscreen")) {
                    this.showSubMenu(subMenuElement);
                }
            }
        });
    }

    private getFullscreenScrim() {
        if (this.element.id !== "commonMenu") {
            return;
        }
        return document.getElementById("commonMenuScrim");
    }

    private showFullscreenScrim() {
        const scrimElement = this.getFullscreenScrim();
        if (!scrimElement) {
            return;
        }
        clearTimeout(fullscreenScrimHideTimeout);
        scrimElement.style.opacity = "";
        scrimElement.style.zIndex = (++window.siyuan.zIndex).toString();
        scrimElement.classList.remove("fn__none");
        requestAnimationFrame(() => {
            if (this.element.classList.contains("b3-menu--sheet") &&
                !this.element.classList.contains("fn__none")) {
                scrimElement.classList.add("b3-menu__scrim--open");
            }
        });
    }

    private hideFullscreenScrim() {
        const scrimElement = this.getFullscreenScrim();
        if (!scrimElement) {
            return;
        }
        scrimElement.style.opacity = "";
        scrimElement.classList.remove("b3-menu__scrim--open");
        clearTimeout(fullscreenScrimHideTimeout);
        fullscreenScrimHideTimeout = window.setTimeout(() => {
            if (!scrimElement.classList.contains("b3-menu__scrim--open")) {
                scrimElement.classList.add("fn__none");
                scrimElement.style.zIndex = "";
            }
        }, Constants.TIMEOUT_DBLCLICK);
    }

    private canDragSheet(target: HTMLElement) {
        if (target.closest("input, textarea, select, [contenteditable=\"true\"]")) {
            return false;
        }
        if (target.closest(".b3-menu__title")) {
            return true;
        }
        if (!target.closest(".b3-menu__items")) {
            return false;
        }
        let element: HTMLElement = target;
        while (element && element !== this.element) {
            const style = getComputedStyle(element);
            if (element.scrollHeight > element.clientHeight + 1 &&
                ["auto", "scroll", "overlay"].includes(style.overflowY) && element.scrollTop > 0) {
                return false;
            }
            element = element.parentElement;
        }
        return true;
    }

    private handleSheetTouchStart = (event: TouchEvent) => {
        if (!this.element.classList.contains("b3-menu--sheet") || event.touches.length !== 1) {
            return;
        }
        const touch = event.touches[0];
        this.sheetTouchStartX = touch.clientX;
        this.sheetTouchStartY = touch.clientY;
        this.sheetTouchStartTime = performance.now();
        this.sheetCanDrag = this.canDragSheet(event.target as HTMLElement);
        this.sheetDragging = false;
    };

    private handleSheetTouchMove = (event: TouchEvent) => {
        if (!this.sheetCanDrag || typeof this.sheetTouchStartX !== "number" ||
            typeof this.sheetTouchStartY !== "number" || event.touches.length !== 1) {
            return;
        }
        const touch = event.touches[0];
        const xDiff = touch.clientX - this.sheetTouchStartX;
        const yDiff = touch.clientY - this.sheetTouchStartY;
        if (!this.sheetDragging && (yDiff <= 0 || Math.abs(xDiff) > Math.abs(yDiff))) {
            return;
        }
        const offset = Math.max(0, yDiff);
        this.sheetDragging = true;
        this.element.style.transition = "none";
        this.element.style.transform = `translateY(${offset}px)`;
        const scrimElement = this.getFullscreenScrim();
        if (scrimElement) {
            scrimElement.style.opacity = Math.max(0, .2 * (1 - offset / this.element.clientHeight)).toString();
        }
        if (event.cancelable) {
            event.preventDefault();
        }
    };

    private finishSheetTouch() {
        this.sheetTouchStartX = undefined;
        this.sheetTouchStartY = undefined;
        this.sheetTouchStartTime = undefined;
        this.sheetCanDrag = false;
        this.sheetDragging = false;
    }

    private handleSheetTouchEnd = (event: TouchEvent) => {
        if (!this.sheetDragging || typeof this.sheetTouchStartY !== "number" ||
            typeof this.sheetTouchStartTime !== "number") {
            this.finishSheetTouch();
            return;
        }
        const touch = event.changedTouches[0];
        const offset = Math.max(0, touch.clientY - this.sheetTouchStartY);
        const duration = Math.max(performance.now() - this.sheetTouchStartTime, 1);
        const velocity = offset / duration;
        const shouldClose = offset > Math.min(120, this.element.clientHeight * .25) ||
            (offset > 20 && velocity > .6);
        this.element.style.transition = "";
        void this.element.offsetHeight;
        if (shouldClose) {
            this.closeSheet();
        } else {
            this.element.style.transform = "translateY(0px)";
            const scrimElement = this.getFullscreenScrim();
            if (scrimElement) {
                scrimElement.style.opacity = "";
            }
        }
        this.suppressSheetClick = true;
        window.setTimeout(() => {
            this.suppressSheetClick = false;
        }, 300);
        this.finishSheetTouch();
    };

    private handleSheetTouchCancel = () => {
        if (this.sheetDragging) {
            this.element.style.transition = "";
            void this.element.offsetHeight;
            this.element.style.transform = "translateY(0px)";
            const scrimElement = this.getFullscreenScrim();
            if (scrimElement) {
                scrimElement.style.opacity = "";
            }
        }
        this.finishSheetTouch();
    };

    private closeSheet() {
        if (!this.element.classList.contains("b3-menu--sheet")) {
            this.element.style.transform = "";
            window.setTimeout(() => this.remove(), Constants.TIMEOUT_DBLCLICK);
            return;
        }
        clearTimeout(fullscreenCloseTimeout);
        this.element.style.transition = "";
        void this.element.offsetHeight;
        this.element.style.transform = "translateY(100%)";
        this.hideFullscreenScrim();
        fullscreenCloseTimeout = window.setTimeout(() => this.removeImmediately(), Constants.TIMEOUT_DBLCLICK);
    }

    private updateSheetTitle() {
        if (!this.element.classList.contains("b3-menu--sheet")) {
            return;
        }
        const titleElement = this.element.firstElementChild as HTMLElement;
        const labelElement = titleElement.querySelector(".b3-menu__label") as HTMLElement;
        const shownItems = this.element.querySelectorAll(".b3-menu__item--show");
        if (shownItems.length === 0) {
            titleElement.classList.add("b3-menu__title--root");
            labelElement.textContent = "";
            return;
        }
        titleElement.classList.remove("b3-menu__title--root");
        const parentLabelElement = shownItems[shownItems.length - 1]
            .querySelector(":scope > .b3-menu__label") as HTMLElement;
        labelElement.textContent = parentLabelElement?.textContent.trim() || window.siyuan.languages.back;
    }

    private setSheetHeight(position: "bottom" | "all") {
        this.updateSheetTitle();
        if (position === "bottom") {
            this.element.style.height = "56vh";
            return;
        }
        let itemsElement = this.element.lastElementChild;
        const shownItems = this.element.querySelectorAll(".b3-menu__item--show");
        if (shownItems.length > 0) {
            itemsElement = shownItems[shownItems.length - 1]
                .querySelector(":scope > .b3-menu__submenu > .b3-menu__items") || itemsElement;
        }
        const maxHeight = window.innerHeight * .56;
        const titleHeight = this.element.firstElementChild.getBoundingClientRect().height;
        const contentHeight = itemsElement.scrollHeight;
        this.element.style.height = Math.min(maxHeight, Math.max(160, titleHeight + contentHeight)) + "px";
    }

    public showSubMenu(subMenuElement: HTMLElement) {
        const itemsMenuElement = subMenuElement.lastElementChild as HTMLElement;
        if (itemsMenuElement) {
            itemsMenuElement.style.maxHeight = "";
        } else {
            return;
        }
        if (this.element.classList.contains("b3-menu--sheet")) {
            this.setSheetHeight(this.element.dataset.position === "bottom" ? "bottom" : "all");
            return;
        }
        const itemRect = subMenuElement.parentElement.getBoundingClientRect();
        const subMenuRect = subMenuElement.getBoundingClientRect();
        if (subMenuElement.dataset.anchor === "action" && !this.element.classList.contains("b3-menu--fullscreen")) {
            const actionElement = subMenuElement.parentElement.querySelector(":scope > .b3-menu__action") as HTMLElement;
            if (actionElement) {
                const actionRect = actionElement.getBoundingClientRect();
                if (actionRect.right + subMenuRect.width <= window.innerWidth) {
                    subMenuElement.style.left = `${actionRect.right}px`;
                    subMenuElement.style.top = `${Math.max(getTopBarHeight(), Math.min(actionRect.top - 9, window.innerHeight - subMenuRect.height - 1))}px`;
                } else {
                    subMenuElement.style.left = `${Math.max(0, Math.min(actionRect.right - subMenuRect.width, window.innerWidth - subMenuRect.width))}px`;
                    const below = actionRect.bottom;
                    subMenuElement.style.top = `${below + subMenuRect.height <= window.innerHeight ? below : Math.max(getTopBarHeight(), actionRect.top - subMenuRect.height)}px`;
                }
                return;
            }
        }

        // 垂直方向位置调整
        // 减 9px 是为了尽量对齐菜单选项（b3-menu__submenu 的默认 padding-top 加上子菜单首个 b3-menu__item 的默认 margin-top）
        // 减 1px 是为了避免在特定情况下渲染出不应存在的滚动条而做的兼容处理
        subMenuElement.style.top = Math.max(getTopBarHeight(),
            Math.min(itemRect.top - 9, window.innerHeight - subMenuRect.height - 1)) + "px";

        // 水平方向位置调整
        // 多级菜单继承上一级子菜单的方向
        let isParentDirectionLeft = false;
        const parentSubMenuElement = hasClosestByClassName(subMenuElement.parentElement.parentElement, "b3-menu__item") as HTMLElement;
        if (parentSubMenuElement && itemRect.left < parentSubMenuElement.getBoundingClientRect().left) {
            isParentDirectionLeft = true;
        }

        // 8px 是 b3-menu__items 的默认 padding-right
        const spaceRight = window.innerWidth - itemRect.right - 8;
        const spaceLeft = itemRect.left - 8;
        if (isParentDirectionLeft) {
            if (spaceLeft >= subMenuRect.width) {
                subMenuElement.style.left = (itemRect.left - 8 - subMenuRect.width) + "px";
            } else if (spaceRight >= subMenuRect.width) {
                subMenuElement.style.left = (itemRect.right + 8) + "px";
            } else {
                subMenuElement.style.left = Math.max(0, window.innerWidth - subMenuRect.width) + "px";
            }
        } else {
            if (spaceRight >= subMenuRect.width) {
                subMenuElement.style.left = (itemRect.right + 8) + "px";
            } else if (spaceLeft >= subMenuRect.width) {
                subMenuElement.style.left = (itemRect.left - 8 - subMenuRect.width) + "px";
            } else {
                subMenuElement.style.left = Math.max(0, window.innerWidth - subMenuRect.width) + "px";
            }
        }

        this.updateMaxHeight(subMenuElement, itemsMenuElement);
    }

    private updateMaxHeight(menuElement: HTMLElement, itemsMenuElement: HTMLElement) {
        // 加 1px 是为了避免在特定情况下渲染出不应存在的滚动条而做的兼容处理; 18 为父子块高差
        itemsMenuElement.style.maxHeight = Math.max(window.innerHeight - menuElement.getBoundingClientRect().top - 18 + 1, 30) + "px";
    }

    private preventDefault(event: KeyboardEvent) {
        if (!hasClosestByClassName(event.target as Element, "b3-menu") &&
            !hasClosestByClassName(event.target as Element, "tooltip") &&
            // 移动端底部键盘菜单
            !hasClosestByClassName(event.target as Element, "keyboard__bar")) {
            event.preventDefault();
        }
    }

    public addItem(option: IMenu) {
        const menuItem = new MenuItem(option, this);
        if (menuItem) {
            this.append(menuItem.element, option.index);
            return menuItem.element;
        }
    }

    public removeScrollEvent() {
        window.removeEventListener(isMobile() ? "touchmove" : this.wheelEvent, this.preventDefault, false);
    }

    public remove(isKeyEvent = false) {
        if (isKeyEvent) {
            const subElements = this.element.querySelectorAll(".b3-menu__item--show");
            if (subElements.length > 0) {
                const subElement = subElements[subElements.length - 1];
                subElement.classList.remove("b3-menu__item--show");
                subElement.classList.add("b3-menu__item--current");
                subElement.querySelector(".b3-menu__item--current")?.classList.remove("b3-menu__item--current");
                if (this.element.classList.contains("b3-menu--sheet")) {
                    this.setSheetHeight(this.element.dataset.position === "bottom" ? "bottom" : "all");
                }
                return;
            }
        }
        this.removeImmediately();
    }

    private removeImmediately() {
        clearTimeout(fullscreenCloseTimeout);
        this.hideFullscreenScrim();
        this.finishSheetTouch();
        this.stopTrackingTargetPosition();
        if (this.removeCB) {
            const removeCB = this.removeCB;
            this.removeCB = undefined;
            removeCB();
        }
        this.removeScrollEvent();
        this.element.firstElementChild.classList.add("fn__none");
        this.element.firstElementChild.classList.remove("b3-menu__title--root");
        (this.element.firstElementChild.querySelector(".b3-menu__label") as HTMLElement).innerHTML =
            window.siyuan.languages.back;
        this.element.lastElementChild.innerHTML = "";
        this.element.lastElementChild.classList.remove("b3-menu__items--menu");
        this.element.lastElementChild.removeAttribute("style");  // 输入框 focus 后 boxShadow 显示不全
        this.element.classList.add("fn__none");
        this.element.classList.remove("b3-menu--list", "b3-menu--fullscreen", "b3-menu--sheet");
        this.element.removeAttribute("style");  // zIndex
        this.element.removeAttribute("data-name");    // 标识再次点击不消失
        this.element.removeAttribute("data-from");    // 标识菜单入口
        this.element.removeAttribute("data-position");
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
                updateMenuItemGroupClasses(this.element.lastElementChild);
                return;
            }
        }
        this.element.lastElementChild.append(element);
        updateMenuItemGroupClasses(this.element.lastElementChild);
    }

    public popup(options: IPosition) {
        applyMenuConfig(this.element);
        if (this.element.lastElementChild.innerHTML === "") {
            return;
        }
        window.addEventListener(isMobile() ? "touchmove" : this.wheelEvent, this.preventDefault, {passive: false});
        this.element.style.zIndex = (++window.siyuan.zIndex).toString();
        this.element.classList.remove("fn__none");
        this.position = options;
        setPosition(this.element, options.x - (options.isLeft ? this.element.clientWidth : 0), options.y, options.h, options.w);
        this.updateMaxHeight(this.element, this.element.lastElementChild as HTMLElement);
        this.startTrackingTargetPosition();
    }

    public resetPosition() {
        if (this.element.classList.contains("fn__none") || !this.position) {
            return;
        }
        if (this.position.target?.isConnected) {
            const rect = this.position.target.getBoundingClientRect();
            this.position.x = this.position.isLeft ? rect.right : rect.left;
            this.position.y = rect.bottom;
            this.position.h = rect.height;
            this.position.w = rect.width;
        }
        setPosition(this.element, this.position.x - (this.position.isLeft ? this.element.clientWidth : 0), this.position.y, this.position.h, this.position.w);
        this.updateMaxHeight(this.element, this.element.lastElementChild as HTMLElement);
        this.element.querySelectorAll(".b3-menu__item--show .b3-menu__submenu").forEach((item: HTMLElement) => {
            // 可能有多层子菜单，都要重新定位
            this.showSubMenu(item);
        });
    }

    private startTrackingTargetPosition() {
        this.stopTrackingTargetPosition();
        if (!this.position.target) {
            return;
        }
        window.addEventListener("resize", this.updateTargetPosition);
        window.visualViewport?.addEventListener("resize", this.updateTargetPosition);
        window.visualViewport?.addEventListener("scroll", this.updateTargetPosition);
    }

    private stopTrackingTargetPosition() {
        window.removeEventListener("resize", this.updateTargetPosition);
        window.visualViewport?.removeEventListener("resize", this.updateTargetPosition);
        window.visualViewport?.removeEventListener("scroll", this.updateTargetPosition);
        if (typeof this.targetPositionFrame === "number") {
            cancelAnimationFrame(this.targetPositionFrame);
            this.targetPositionFrame = undefined;
        }
    }

    public fullscreen(position: "bottom" | "all" = "all") {
        applyMenuConfig(this.element);
        if (this.element.lastElementChild.innerHTML === "") {
            return;
        }
        if (!isMobile()) {
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
                    this.element.style.transform = "translateY(-100%)";
                }
            });
            this.element.lastElementChild.scrollTop = 0;
            return;
        }
        clearTimeout(fullscreenCloseTimeout);
        this.element.querySelectorAll(":scope > .b3-menu__items, .b3-menu__submenu > .b3-menu__items")
            .forEach(updateMenuItemGroupClasses);
        this.element.classList.add("b3-menu--fullscreen", "b3-menu--sheet");
        this.element.dataset.position = position;
        this.element.style.transform = "translateY(100%)";
        this.showFullscreenScrim();
        this.element.style.zIndex = (++window.siyuan.zIndex).toString();
        this.element.firstElementChild.classList.remove("fn__none");
        this.element.classList.remove("fn__none");
        window.addEventListener("touchmove", this.preventDefault, {passive: false});
        this.setSheetHeight(position);
        void this.element.offsetHeight;
        requestAnimationFrame(() => {
            if (this.element.classList.contains("b3-menu--sheet")) {
                this.element.style.transform = "translateY(0px)";
            }
        });
        this.element.lastElementChild.scrollTop = 0;
    }
}

export class MenuItem {
    public element: HTMLElement;

    constructor(options: IMenu, menu = window.siyuan.menus.menu) {
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
        if (options.id) {
            this.element.setAttribute("data-id", options.id);
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
                    menu.remove();
                }
            });
        }
        if (options.type === "readonly") {
            this.element.classList.add("b3-menu__item--readonly");
        }
        if (options.icon === "iconTrashcan" || options.warning) {
            this.element.classList.add("b3-menu__item--warning");
        }

        if (options.element) {
            this.element.append(options.element);
        } else {
            let html = `<span class="b3-menu__label">${options.label || "&nbsp;"}</span>`;
            if (typeof options.iconHTML === "string") {
                html = options.iconHTML + html;
            } else {
                html = `<svg class="b3-menu__icon ${options.iconClass || ""}"><use xlink:href="#${options.icon || ""}"></use></svg>${html}`;
            }
            if (options.accelerator) {
                html += `<span class="b3-menu__accelerator b3-menu__accelerator--hotkey">${updateHotkeyTip(options.accelerator)}</span>`;
            }
            if (options.action) {
                const actionLabel = options.actionLabel ?
                    ` aria-label="${escapeAttr(options.actionLabel)}"` : "";
                const actionClass = options.action === "iconCloseRound" ? " b3-menu__action--close" :
                    options.action === "iconInfo" ? " b3-menu__action--hint" : "";
                html += `<svg class="b3-menu__action${actionClass}${options.actionLabel ? " b3-menu__action--show ariaLabel" : ""}"${actionLabel}><use xlink:href="#${options.action}"></use></svg>`;
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

        if (options.submenu || options.loadSubmenu) {
            const submenuElement = document.createElement("div");
            submenuElement.classList.add("b3-menu__submenu");
            submenuElement.innerHTML = '<div class="b3-menu__items"></div>';
            (options.submenu || [{
                type: "readonly",
                label: window.siyuan.languages.loading,
            }]).forEach((item: IMenu) => {
                submenuElement.firstElementChild.append(new MenuItem(item, menu)?.element || "");
            });
            updateMenuItemGroupClasses(submenuElement.firstElementChild);
            this.element.insertAdjacentHTML("beforeend", '<svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>');
            this.element.append(submenuElement);
            if (options.loadSubmenu) {
                let loading = false;
                let loaded = false;
                let focusAfterLoad = false;
                const loadSubmenu = (event: Event) => {
                    if ((event as CustomEvent).detail?.focus) {
                        focusAfterLoad = true;
                    }
                    if (loading || loaded) {
                        return;
                    }
                    loading = true;
                    options.loadSubmenu().then((items) => {
                        if (!this.element.isConnected) {
                            return;
                        }
                        const itemsElement = submenuElement.firstElementChild;
                        itemsElement.innerHTML = "";
                        if (items.length === 0) {
                            itemsElement.append(new MenuItem({
                                type: "readonly",
                                label: window.siyuan.languages.emptyContent,
                            }, menu).element);
                        } else {
                            items.forEach((item) => {
                                itemsElement.append(new MenuItem(item, menu)?.element || "");
                            });
                        }
                        updateMenuItemGroupClasses(itemsElement);
                        applyMenuConfig(menu.element);
                        loaded = true;
                        menu.showSubMenu(submenuElement);
                        if (focusAfterLoad && this.element.classList.contains("b3-menu__item--show")) {
                            const actionMenuElement = getActionMenu(itemsElement.firstElementChild, true);
                            if (actionMenuElement) {
                                menu.element.querySelectorAll(".b3-menu__item--current").forEach((item) => {
                                    item.classList.remove("b3-menu__item--current");
                                });
                                actionMenuElement.classList.add("b3-menu__item--current");
                            }
                        }
                        focusAfterLoad = false;
                    }).catch(() => {
                        if (!this.element.isConnected) {
                            return;
                        }
                        submenuElement.firstElementChild.innerHTML = "";
                        submenuElement.firstElementChild.append(new MenuItem({
                            type: "readonly",
                            label: window.siyuan.languages.emptyContent,
                        }, menu).element);
                        updateMenuItemGroupClasses(submenuElement.firstElementChild);
                        focusAfterLoad = false;
                    }).finally(() => {
                        loading = false;
                    });
                };
                this.element.addEventListener(isMobile() ? "click" : "mouseenter", loadSubmenu);
                this.element.addEventListener(CUSTOM_EVENT_LOAD_SUBMENU, loadSubmenu);
            }
        }
    }
}

const getActionMenu = (element: Element, next: boolean) => {
    let actionMenuElement = element;
    while (actionMenuElement &&
        (actionMenuElement.classList.contains("b3-menu__separator") ||
            actionMenuElement.classList.contains("b3-menu__item--readonly") ||
            // https://github.com/siyuan-note/siyuan/issues/12518
            actionMenuElement.getBoundingClientRect().height === 0)
        ) {
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
    if (window.siyuan.menus.menu.element.classList.contains("fn__none") || event.isComposing) {
        return false;
    }
    const target = event.target as HTMLElement;
    const eventCode = Constants.KEYCODELIST[event.keyCode];
    if (window.siyuan.menus.menu.element.contains(target) && ["INPUT", "TEXTAREA"].includes(target.tagName)) {
        if (target.getAttribute(Constants.ATTRIBUTE_MENU_KEYMAP)) {
            const currentElement = window.siyuan.menus.menu.element.querySelector(".b3-menu__item--current");
            const inputItemElement = Array.from(target.closest(".b3-menu__items")?.children || []).find((item) => item.contains(target));
            if (!currentElement || currentElement === inputItemElement) {
                if (eventCode === "↩") {
                    window.siyuan.menus.menu.remove();
                    return true;
                }
                if (eventCode === "→" || eventCode === "←") {
                    return false;
                }
            }
            if (!currentElement) {
                inputItemElement?.classList.add("b3-menu__item--current");
            }
            if (["INPUT", "TEXTAREA"].includes(target.tagName)) {
                electronUndo(event);
            }
        } else {
            return false;
        }
    }
    // 支持输入框中的 undo & redo
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return false;
    }
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
            const keymapInputElement = actionMenuElement.querySelector(`[${Constants.ATTRIBUTE_MENU_KEYMAP}]`) as HTMLInputElement;
            if (actionMenuElement.classList.contains("b3-menu__item") || keymapInputElement) {
                actionMenuElement.classList.add("b3-menu__item--current");
            }
            const inputElement = actionMenuElement.querySelector(":scope > .b3-text-field") as HTMLInputElement || keymapInputElement;
            if (inputElement) {
                inputElement.focus();
            }
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
        currentElement.dispatchEvent(new CustomEvent(CUSTOM_EVENT_LOAD_SUBMENU, {
            detail: {focus: true},
        }));
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
            const subMenuElement = currentElement.querySelector(".b3-menu__submenu") as HTMLElement;
            if (subMenuElement) {
                currentElement.dispatchEvent(new CustomEvent(CUSTOM_EVENT_LOAD_SUBMENU, {
                    detail: {focus: true},
                }));
                currentElement.classList.remove("b3-menu__item--current");
                currentElement.classList.add("b3-menu__item--show");
                const actionMenuElement = getActionMenu(subMenuElement.firstElementChild.firstElementChild, true);
                if (actionMenuElement) {
                    actionMenuElement.classList.add("b3-menu__item--current");
                }
                window.siyuan.menus.menu.showSubMenu(subMenuElement);
                return true;
            }
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

    addSeparator(index?: number, id?: string) {
        if (typeof index === "number") {
            this.menus.splice(index, 0, {type: "separator", id});
        } else {
            this.menus.push({type: "separator", id});
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
