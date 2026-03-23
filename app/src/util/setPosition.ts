import {Constants} from "../constants";

export const setPosition = (element: HTMLElement, left: number, top: number, targetHeight = 0, targetLeft = 0) => {
    element.style.top = top + "px";
    if (element.style.right === "") {
        // 兼容使用 right 定位的菜单（来自插件或 JS 片段）
        element.style.left = left + "px";
    }

    const rect = element.getBoundingClientRect();
    if (rect.top < Constants.SIZE_TOOLBAR_HEIGHT) {
        // 如果元素接触顶栏，向下移
        element.style.top = Constants.SIZE_TOOLBAR_HEIGHT + "px";
    } else if (rect.bottom > window.innerHeight) {
        const y = top - rect.height - targetHeight;
        if (y > Constants.SIZE_TOOLBAR_HEIGHT && y + rect.height < window.innerHeight) {
            // 如果元素底部超出窗口（下方空间不够），向上移
            element.style.top = y + "px";
        } else {
            // 如果上下空间都不够，向上移，但尽量靠底部
            element.style.top = Math.max(Constants.SIZE_TOOLBAR_HEIGHT, window.innerHeight - rect.height) + "px";
        }
    }

    if (element.style.left === "" && element.style.right !== "") {
        if (rect.right > window.innerWidth) {
            element.style.right = "0";
        } else if (rect.left < 0) {
            element.style.right = window.innerWidth - rect.width + "px";
        }
    } else {
        if (rect.right > window.innerWidth) {
            // 展现在左侧
            element.style.left = window.innerWidth - rect.width - targetLeft + "px";
        } else if (rect.left < 0) {
            // 依旧展现在左侧，只是位置右移
            element.style.left = "0";
        }
    }

    if (element.classList.contains("b3-menu")) {
        setVisibleMenusItemsMaxHeight(element);
    }
};

export const setMenuItemsMaxHeight = (menuElement: HTMLElement, itemsMenuElement: HTMLElement) => {
    const menuRect = menuElement.getBoundingClientRect();
    const itemsRect = itemsMenuElement.getBoundingClientRect();
    const style = getComputedStyle(itemsMenuElement);
    const cap = Math.max(30, window.innerHeight - itemsRect.top - Math.max(0, menuRect.bottom - itemsRect.bottom) - parseFloat(style.marginBottom) || 0);
    // content-box 下 max-height 只限制 content，不包括 padding/border
    let contentBoxExtra = 0;
    if (style.boxSizing === "content-box") {
        contentBoxExtra = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
            + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    }
    itemsMenuElement.style.maxHeight = Math.max(0, cap - contentBoxExtra) + "px";
};

export const setVisibleMenusItemsMaxHeight = (menuRoot?: HTMLElement) => {
    if (menuRoot) {
        menuRoot.querySelectorAll(":scope > .b3-menu__items:not(.fn__none)").forEach((el) => {
            setMenuItemsMaxHeight(menuRoot, el as HTMLElement);
        });
        return;
    }
    document.querySelectorAll<HTMLElement>(".b3-menu:not(.b3-menu--fullscreen):not(.fn__none)").forEach((menuElement) => {
        // 优先移动菜单位置
        const style = getComputedStyle(menuElement);
        const rect = menuElement.getBoundingClientRect();
        let left = parseFloat(style.left);
        let top = parseFloat(style.top);
        if (Number.isNaN(left)) {
            left = rect.left;
        }
        if (Number.isNaN(top)) {
            top = rect.top;
        }
        setPosition(menuElement, left, top, 0, 0);
    });
};
