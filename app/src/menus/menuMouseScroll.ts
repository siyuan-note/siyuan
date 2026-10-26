interface IMouseScrollAnchor {
    items: HTMLElement;
    y: number;
    lastY: number;
    scrollTop: number;
    currentScrollTop: number;
    top: number;
    height: number;
    scrollHeight: number;
}

export const bindMenuMouseScroll = (menu: HTMLElement, enabled: () => boolean, rootItems?: HTMLElement) => {
    let anchor: IMouseScrollAnchor;
    const reset = () => { anchor = undefined; };
    const interactive = "input, textarea, select, [contenteditable=\"true\"], [draggable=\"true\"]";
    menu.addEventListener("pointermove", (event: PointerEvent) => {
        if (!enabled() || event.pointerType !== "mouse" || event.buttons !== 0 || !menu.isConnected ||
            menu.classList.contains("fn__none") || menu.classList.contains("b3-menu--fullscreen")) {
            reset();
            return;
        }
        const target = event.target as Element;
        const panel = target.closest(".b3-menu__submenu, .b3-menu");
        // 根据命中位置选择当前列表，避免切换列表时选到隐藏的同级容器。
        const items = panel === menu && rootItems ? rootItems : target.closest<HTMLElement>(".b3-menu__items");
        if (!items || items.parentElement !== panel || !menu.contains(items) || !items.contains(target) ||
            panel?.contains(target.closest(interactive)) ||
            (items.contains(document.activeElement) && document.activeElement.matches(interactive))) {
            reset();
            return;
        }
        // 自定义表单和嵌套滚动列表保留各自的鼠标操作。
        for (let element = target; element && element !== panel; element = element.parentElement) {
            if (element !== items && element.scrollHeight > element.clientHeight + 1 &&
                ["auto", "scroll", "overlay"].includes(getComputedStyle(element).overflowY)) {
                reset();
                return;
            }
        }
        const rect = items.getBoundingClientRect();
        const maxScroll = items.scrollHeight - items.clientHeight;
        if (maxScroll <= 1 || rect.height <= 1 || event.clientX < rect.left || event.clientX > rect.right ||
            !["auto", "scroll", "overlay"].includes(getComputedStyle(items).overflowY)) {
            reset();
            return;
        }
        if (!anchor || anchor.items !== items || anchor.top !== rect.top || anchor.height !== rect.height ||
            anchor.scrollHeight !== items.scrollHeight || Math.abs(anchor.currentScrollTop - items.scrollTop) > 1) {
            // 进入菜单或其他操作改变滚动位置后建立基准，首次移动不跳转。
            // 位于首尾时将基准放在对应边缘，避免从另一端进入后朝菜单内部移动没有可滚动内容。
            const inset = Math.min(24, rect.height / 4);
            const y = items.scrollTop <= 1 ? rect.top + inset :
                maxScroll - items.scrollTop <= 1 ? rect.bottom - inset : event.clientY;
            anchor = {items, y, lastY: event.clientY, scrollTop: items.scrollTop,
                currentScrollTop: items.scrollTop, top: rect.top, height: rect.height, scrollHeight: items.scrollHeight};
            return;
        }
        if (event.clientY === anchor.lastY) return;
        anchor.lastY = event.clientY;
        // 两端留出菜单项的点击空间；整个可见区域按移动距离映射到剩余内容。
        const inset = Math.min(24, rect.height / 4);
        const distance = event.clientY - anchor.y;
        const progress = Math.min(1, Math.abs(distance) / Math.max(1,
            distance > 0 ? rect.bottom - inset - anchor.y : anchor.y - rect.top - inset));
        const previousScrollTop = items.scrollTop;
        items.scrollTop = anchor.scrollTop + (distance > 0 ? maxScroll - anchor.scrollTop : -anchor.scrollTop) * progress;
        anchor.currentScrollTop = items.scrollTop;
        if (items.scrollTop === previousScrollTop) return;
        items.querySelectorAll(".b3-menu__item--show").forEach(item => item.classList.remove("b3-menu__item--show"));
        // 滚动后按实际命中项更新高亮和子菜单，保持点击目标与视觉反馈一致。
        const hovered = document.elementFromPoint(event.clientX, event.clientY);
        if (hovered && items.contains(hovered)) {
            hovered.dispatchEvent(new MouseEvent("mouseover", {bubbles: true, clientX: event.clientX, clientY: event.clientY}));
        }
    });
    menu.addEventListener("pointerleave", reset);
    menu.addEventListener("pointerdown", reset, true);
    menu.addEventListener("wheel", reset, {passive: true, capture: true});
    menu.addEventListener("keydown", reset, true);
    return reset;
};
