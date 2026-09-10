import {updateMenuItemGroupClasses} from "../../../menus/menuGroup";

export const bindMobileAVPanel = (panelElement: HTMLElement, menuElement: HTMLElement) => {
    menuElement.classList.add("b3-menu--fullscreen", "b3-menu--sheet");
    const scrimElement = panelElement.querySelector<HTMLElement>(".b3-dialog__scrim");
    const updateHeight = () => {
        const size = window.siyuan.mobile.size;
        const orientation = size.isLandscape ? size.landscape : size.portrait;
        menuElement.style.height = Math.max(window.innerHeight, orientation?.height1 || 0) * .56 + "px";
    };
    const updateContent = () => {
        // 保留原有节点和事件绑定，标题的返回操作仍由数据库面板处理
        menuElement.querySelectorAll(".b3-menu__items, .av__select-list").forEach((itemsElement) => {
            const titleElement = itemsElement.firstElementChild;
            if (titleElement?.matches('[data-type="nobg"]') &&
                titleElement.querySelector(":scope > .b3-menu__label.ft__center")) {
                titleElement.classList.add("b3-menu__title");
            }
            updateMenuItemGroupClasses(itemsElement);
        });
    };
    const contentObserver = new MutationObserver(() => {
        // 分组类更新不再次触发自身，页面替换和显隐切换都需要重新分组
        contentObserver.disconnect();
        updateContent();
        observeContent();
    });
    const observeContent = () => contentObserver.observe(menuElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
    });
    updateHeight();
    updateContent();
    observeContent();
    window.addEventListener("resize", updateHeight);

    let start: {x: number, y: number, time: number};
    let dragging = false;
    let suppressClickUntil = 0;
    const reset = () => {
        start = undefined;
        dragging = false;
        menuElement.style.transform = "";
        menuElement.style.transition = "";
        scrimElement.style.opacity = "";
    };
    menuElement.addEventListener("touchstart", (event) => {
        reset();
        const target = event.target as HTMLElement;
        if (event.touches.length !== 1 ||
            target.closest('input, textarea, select, [contenteditable="true"], .av__select-dropdown') ||
            menuElement.querySelector(".av__select-dropdown")) {
            return;
        }
        let element = target;
        while (element && element !== menuElement) {
            if (element.scrollHeight > element.clientHeight + 1 && element.scrollTop > 0 &&
                ["auto", "scroll", "overlay"].includes(getComputedStyle(element).overflowY)) {
                return;
            }
            element = element.parentElement;
        }
        const touch = event.touches[0];
        start = {x: touch.clientX, y: touch.clientY, time: performance.now()};
    }, {passive: true});
    menuElement.addEventListener("touchmove", (event) => {
        if (!start || event.touches.length !== 1) {
            return;
        }
        const touch = event.touches[0];
        const offset = touch.clientY - start.y;
        if (!dragging && (offset <= 0 || Math.abs(touch.clientX - start.x) > offset)) {
            start = undefined;
            return;
        }
        dragging = true;
        menuElement.style.transition = "none";
        menuElement.style.transform = `translateY(${Math.max(0, offset)}px)`;
        scrimElement.style.opacity = Math.max(0, 1 - offset / menuElement.clientHeight).toString();
        if (event.cancelable) {
            event.preventDefault();
        }
    }, {passive: false});
    menuElement.addEventListener("touchend", (event) => {
        if (!start || !dragging) {
            reset();
            return;
        }
        const offset = Math.max(0, event.changedTouches[0].clientY - start.y);
        const velocity = offset / Math.max(1, performance.now() - start.time);
        const shouldClose = offset > Math.min(120, menuElement.clientHeight * .25) ||
            (offset > 20 && velocity > .6);
        suppressClickUntil = performance.now() + 300;
        reset();
        if (shouldClose) {
            // 复用关闭入口，确保日期、关联等编辑值提交及嵌套菜单关闭顺序一致
            panelElement.dispatchEvent(new CustomEvent("click", {detail: "close"}));
        }
    });
    menuElement.addEventListener("touchcancel", reset);
    menuElement.addEventListener("click", (event) => {
        if (performance.now() < suppressClickUntil && typeof event.detail === "number") {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);

    const removalObserver = new MutationObserver(() => {
        if (!panelElement.isConnected) {
            contentObserver.disconnect();
            removalObserver.disconnect();
            window.removeEventListener("resize", updateHeight);
        }
    });
    removalObserver.observe(panelElement.parentElement, {childList: true});
};
