import {updateMenuItemGroupClasses} from "../../../menus/menuGroup";
import {getVisibleSheetViewport, waitForSheetViewport} from "../../../menus/sheetOpen";
import {getSheetActionsHTML, setSheetExpanded} from "../../../menus/sheetActions";
import {escapeAttr} from "../../../util/escape";

export const getMobileAVPanelBackTarget = (menuElement: HTMLElement) =>
    Array.from(menuElement.querySelectorAll<HTMLElement>(
        ".b3-menu__items > .b3-menu__title .block__icon--menu-back, .av__select-list > .b3-menu__title .block__icon--menu-back"))
        .find(element => !element.closest(".fn__none"));

export const bindMobileAVPanel = (panelElement: HTMLElement, menuElement: HTMLElement) => {
    menuElement.classList.add("b3-menu--fullscreen", "b3-menu--sheet");
    menuElement.setAttribute("data-prevent-swipe", "true");
    menuElement.style.maxHeight = "";
    const scrimElement = panelElement.querySelector<HTMLElement>(".b3-dialog__scrim");
    const updateHeight = () => {
        const size = window.siyuan.mobile.size;
        const orientation = size.isLandscape ? size.landscape : size.portrait;
        const viewport = getVisibleSheetViewport(window.innerHeight, window.visualViewport);
        const fullHeight = Math.max(window.innerHeight, orientation?.height1 || 0);
        menuElement.style.height = (menuElement.classList.contains("b3-menu--expanded") ? viewport.height :
            Math.min(fullHeight * .56, viewport.height)) + "px";
        menuElement.style.setProperty("--b3-menu-sheet-bottom", viewport.bottomOffset + "px");
    };
    const updateContent = () => {
        // 独立标题栏保留返回、展开和关闭入口，内容重绘不改变编辑控件及其事件绑定。
        if (!menuElement.firstElementChild?.classList.contains("b3-menu__title--actions")) {
            menuElement.insertAdjacentHTML("afterbegin", `<div class="b3-menu__title b3-menu__title--root b3-menu__title--actions">
    <button type="button" class="block__icon block__icon--show block__icon--touch ariaLabel fn__none" data-type="sheet-back" aria-label="${escapeAttr(window.siyuan.languages.back)}"><svg><use xlink:href="#iconLeft"></use></svg></button>
    ${getSheetActionsHTML()}
</div>`);
        }
        // 保留原有节点和事件绑定，标题的返回操作仍由数据库面板处理
        menuElement.querySelectorAll(".b3-menu__items, .av__select-list").forEach((itemsElement) => {
            const titleElement = itemsElement.firstElementChild;
            if (titleElement?.matches('[data-type="nobg"]') &&
                titleElement.querySelector(":scope > .b3-menu__label.ft__center")) {
                titleElement.classList.add("b3-menu__title");
            }
            updateMenuItemGroupClasses(itemsElement);
        });
        // 视图分区标题与列表项分属不同层级，按可见分区补齐列表圆角
        menuElement.querySelectorAll("[data-av-view-section]").forEach((sectionElement) => {
            sectionElement.querySelector(".b3-menu__item")?.classList.add("b3-menu__title");
            const items = Array.from(menuElement.querySelectorAll<HTMLElement>(
                `[data-av-view-visibility="${sectionElement.getAttribute("data-av-view-section")}"]`));
            items.forEach((item) => item.classList.remove("b3-menu__item--group-first", "b3-menu__item--group-last"));
            const visibleItems = items.filter((item) => !item.classList.contains("fn__none"));
            visibleItems[0]?.classList.add("b3-menu__item--group-first");
            visibleItems[visibleItems.length - 1]?.classList.add("b3-menu__item--group-last");
        });
        menuElement.querySelector('[data-type="sheet-back"]')?.classList.toggle("fn__none", !getMobileAVPanelBackTarget(menuElement));
        setSheetExpanded(menuElement, menuElement.classList.contains("b3-menu--expanded"));
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
    window.visualViewport?.addEventListener("resize", updateHeight);
    window.visualViewport?.addEventListener("scroll", updateHeight);
    // 初始定位不参与过渡，确保展开动画从屏幕外开始
    menuElement.style.transition = "none";
    menuElement.style.transform = "translateY(100%)";
    void menuElement.offsetHeight;
    const size = window.siyuan.mobile.size;
    const orientation = size.isLandscape ? size.landscape : size.portrait;
    const cancelOpen = waitForSheetViewport({
        height: () => Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight),
        fullHeight: Math.max(window.innerHeight, orientation?.height1 || 0),
        now: () => performance.now(),
        requestFrame: callback => requestAnimationFrame(callback),
        cancelFrame: id => cancelAnimationFrame(id),
        open: () => {
            if (panelElement.isConnected) {
                updateHeight();
                menuElement.style.transition = "";
                void menuElement.offsetHeight;
                menuElement.style.transform = "translateY(0px)";
            }
        },
    });
    menuElement.addEventListener("transitionend", (event) => {
        // 展开后恢复视口定位参照，避免固定定位下拉列表受面板变换影响
        if (event.target === menuElement && event.propertyName === "transform" &&
            menuElement.style.transform === "translateY(0px)") {
            menuElement.style.transform = "";
        }
    });

    let start: {x: number, y: number, time: number, height: number, canExpand: boolean};
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
        // 可排序条目的触摸由拖拽桥接处理，避免向下排序时同时拖动整个面板。
        if (event.touches.length !== 1 ||
            target.closest('.b3-menu__title--actions button, input, textarea, select, [contenteditable="true"], .av__select-dropdown, [draggable="true"]') ||
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
        start = {x: touch.clientX, y: touch.clientY, time: performance.now(), height: menuElement.clientHeight,
            canExpand: !!target.closest(".b3-menu__title--actions") && !menuElement.classList.contains("b3-menu--expanded")};
    }, {passive: true});
    menuElement.addEventListener("touchmove", (event) => {
        if (!start || event.touches.length !== 1) {
            return;
        }
        const touch = event.touches[0];
        const offset = touch.clientY - start.y;
        if (!dragging && ((offset <= 0 && !start.canExpand) || Math.abs(touch.clientX - start.x) > Math.abs(offset))) {
            start = undefined;
            return;
        }
        dragging = true;
        menuElement.style.transition = "none";
        if (offset < 0) {
            menuElement.style.height = Math.min(window.innerHeight, start.height - offset) + "px";
        } else {
            menuElement.style.transform = `translateY(${offset}px)`;
        }
        scrimElement.style.opacity = Math.max(0, 1 - Math.max(0, offset) / menuElement.clientHeight).toString();
        if (event.cancelable) {
            event.preventDefault();
        }
    }, {passive: false});
    menuElement.addEventListener("touchend", (event) => {
        if (!start || !dragging) {
            reset();
            return;
        }
        const offset = event.changedTouches[0].clientY - start.y;
        const velocity = Math.abs(offset) / Math.max(1, performance.now() - start.time);
        const shouldExpand = start.canExpand && (offset < -40 || (offset < -20 && velocity > .6));
        const shouldClose = offset > Math.min(120, start.height * .25) || (offset > 20 && velocity > .6);
        suppressClickUntil = performance.now() + 300;
        reset();
        if (shouldExpand) {
            setSheetExpanded(menuElement, true);
        } else if (shouldClose && menuElement.classList.contains("b3-menu--expanded")) {
            setSheetExpanded(menuElement, false);
        } else if (shouldClose) {
            // 复用关闭入口，确保日期、关联等编辑值提交及嵌套菜单关闭顺序一致
            panelElement.dispatchEvent(new CustomEvent("click", {detail: "close"}));
        }
        updateHeight();
    });
    menuElement.addEventListener("touchcancel", () => {
        reset();
        updateHeight();
    });
    menuElement.addEventListener("click", (event) => {
        if (performance.now() < suppressClickUntil && typeof event.detail === "number") {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        const action = (event.target as HTMLElement).closest<HTMLElement>("[data-type^=\"sheet-\"]")?.dataset.type;
        if (!action) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (action === "sheet-expand") {
            setSheetExpanded(menuElement, !menuElement.classList.contains("b3-menu--expanded"));
            updateHeight();
        } else {
            panelElement.dispatchEvent(new CustomEvent("click", {detail: action === "sheet-back" ? "back" : "close"}));
        }
    }, true);

    const removalObserver = new MutationObserver(() => {
        if (!panelElement.isConnected) {
            cancelOpen();
            contentObserver.disconnect();
            removalObserver.disconnect();
            window.removeEventListener("resize", updateHeight);
            window.visualViewport?.removeEventListener("resize", updateHeight);
            window.visualViewport?.removeEventListener("scroll", updateHeight);
        }
    });
    removalObserver.observe(panelElement.parentElement, {childList: true});
};
