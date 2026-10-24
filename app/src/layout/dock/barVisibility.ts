export const shouldShowDockBar = (globallyHidden: boolean, hasVisibleEntry: boolean, temporarilyShown = false) =>
    (!globallyHidden || temporarilyShown) && hasVisibleEntry;

export const shouldShowDockSplit = (hasVisibleEntryBefore: boolean, hasVisibleEntryAfter: boolean) =>
    hasVisibleEntryBefore && hasVisibleEntryAfter;

const hoveredDockBars = new WeakSet<HTMLElement>();
let floatingBarResizeObserver: ResizeObserver;

export const adjustDockPadding = () => {
    const layoutElement = window.siyuan.layout?.layout?.children[0]?.element;
    const leftDockElement = window.siyuan.layout?.leftDock?.elements[0]?.parentElement;
    const rightDockElement = window.siyuan.layout?.rightDock?.elements[0]?.parentElement;
    // 设置窗口和独立编辑窗口没有主窗口的停靠栏，布局初始化完成后才调整间距。
    if (!layoutElement || !leftDockElement || !rightDockElement) {
        return;
    }
    if (leftDockElement.classList.contains("fn__none") || leftDockElement.classList.contains("dock--float")) {
        layoutElement.style.marginLeft = "var(--b3-layout-space)";
    } else {
        layoutElement.style.marginLeft = "";
    }
    if (rightDockElement.classList.contains("fn__none") || rightDockElement.classList.contains("dock--float")) {
        layoutElement.style.marginRight = "var(--b3-layout-space)";
    } else {
        layoutElement.style.marginRight = "";
    }
    if (window.siyuan.config.appearance.hideStatusBar) {
        layoutElement.style.marginBottom = "var(--b3-layout-space)";
    } else {
        layoutElement.style.marginBottom = "";
    }
};

export const syncDockBarVisibility = () => {
    let changed = false;
    let hasFloatingBar = false;
    document.querySelectorAll<HTMLElement>(".dock").forEach((item) => {
        const sections = Array.from(item.querySelectorAll<HTMLElement>(":scope > .dock__items"));
        const sectionVisibility = sections.map((section) =>
            Boolean(section.querySelector(".dock__item[data-type]:not(.fn__none)")));
        const splitElement = item.querySelector(":scope > .dock__split");
        splitElement?.classList.toggle("fn__none", !shouldShowDockSplit(
            sectionVisibility[0],
            sectionVisibility[1],
        ));
        const dock = item.id === "dockLeft" ? window.siyuan.layout?.leftDock :
            item.id === "dockRight" ? window.siyuan.layout?.rightDock : undefined;
        const floatingPanelOpen = Boolean(dock?.isFloating() && dock.isPanelVisible() &&
            !dock.layout.element.classList.contains("fn__none") && dock.layout.element.style.opacity === "1");
        const canFloat = window.siyuan.config.uiLayout.hideDock && dock?.isFloating() && sectionVisibility.some(Boolean);
        if (!canFloat) {
            hoveredDockBars.delete(item);
        }
        const floating = Boolean(canFloat && (floatingPanelOpen || hoveredDockBars.has(item)));
        const wasFloating = item.classList.contains("dock--float");
        item.classList.toggle("dock--float", floating);
        const hidden = !shouldShowDockBar(
            window.siyuan.config.uiLayout.hideDock,
            sectionVisibility.some(Boolean),
            floating,
        );
        changed = item.classList.contains("fn__none") !== hidden || wasFloating !== floating || changed;
        item.classList.toggle("fn__none", hidden);
        if (floating) {
            hasFloatingBar = true;
            // 保留停靠栏原有的顶栏避让和高度范围，临时显示时脱离编辑区布局。
            const rowRect = item.parentElement.getBoundingClientRect();
            item.style.top = rowRect.top + "px";
            item.style.bottom = (window.innerHeight - rowRect.bottom) + "px";
            item.style.zIndex = (Math.max(10, Number(dock.layout.element.style.zIndex)) - 1).toString();
        } else if (wasFloating) {
            item.style.top = "";
            item.style.bottom = "";
            item.style.zIndex = "";
        }
    });
    adjustDockPadding();
    if (hasFloatingBar && !floatingBarResizeObserver) {
        floatingBarResizeObserver = new ResizeObserver(() => {
            syncDockBarVisibility();
            for (const dock of [window.siyuan.layout?.leftDock, window.siyuan.layout?.rightDock]) {
                if (dock?.elements[0].parentElement.classList.contains("dock--float") &&
                    dock.isPanelVisible() && dock.layout.element.style.opacity === "1") {
                    dock.showDock(true);
                }
            }
        });
        for (const element of [document.getElementById("dockLeft"), document.getElementById("dockRight")]) {
            if (element) {
                floatingBarResizeObserver.observe(element);
                floatingBarResizeObserver.observe(element.parentElement);
            }
        }
    } else if (!hasFloatingBar && floatingBarResizeObserver) {
        floatingBarResizeObserver.disconnect();
        floatingBarResizeObserver = undefined;
    }
    return changed;
};

export const setDockBarHover = (element: HTMLElement, hovered: boolean) => {
    if (hovered) {
        hoveredDockBars.add(element);
    } else {
        hoveredDockBars.delete(element);
    }
    syncDockBarVisibility();
};
