export const shouldShowDockBar = (globallyHidden: boolean, hasVisibleEntry: boolean, floatingPanelOpen = false) =>
    (!globallyHidden || floatingPanelOpen) && hasVisibleEntry;

export const shouldShowDockSplit = (hasVisibleEntryBefore: boolean, hasVisibleEntryAfter: boolean) =>
    hasVisibleEntryBefore && hasVisibleEntryAfter;

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
    const floatingBars: HTMLElement[] = [];
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
        const floating = window.siyuan.config.uiLayout.hideDock && floatingPanelOpen && sectionVisibility.some(Boolean);
        const wasFloating = item.classList.contains("dock--float");
        item.classList.toggle("dock--float", floating);
        item.classList.toggle("fn__none", !shouldShowDockBar(
            window.siyuan.config.uiLayout.hideDock,
            sectionVisibility.some(Boolean),
            floatingPanelOpen,
        ));
        if (floating) {
            floatingBars.push(item);
            // 临时停靠栏脱离主布局，层级低于面板，避免遮挡面板内的全屏内容。
            const panelRect = dock.layout.element.getBoundingClientRect();
            item.style.top = panelRect.top + "px";
            item.style.bottom = (window.innerHeight - panelRect.bottom) + "px";
            item.style.zIndex = (Number(dock.layout.element.style.zIndex) - 1).toString();
        } else if (wasFloating) {
            item.style.top = "";
            item.style.bottom = "";
            item.style.zIndex = "";
        }
    });
    adjustDockPadding();
    // 面板范围和界面密度变化后，同步临时停靠栏的范围及面板偏移。
    if (floatingBars.length > 0 && !floatingBarResizeObserver) {
        floatingBarResizeObserver = new ResizeObserver(() => {
            for (const dock of [window.siyuan.layout?.leftDock, window.siyuan.layout?.rightDock]) {
                if (dock?.elements[0].parentElement.classList.contains("dock--float")) {
                    dock.showDock(true);
                }
            }
        });
        for (const element of [window.siyuan.layout?.leftDock?.layout.element, window.siyuan.layout?.rightDock?.layout.element,
            document.getElementById("dockLeft"), document.getElementById("dockRight")]) {
            if (element) {
                floatingBarResizeObserver.observe(element);
            }
        }
    } else if (floatingBars.length === 0 && floatingBarResizeObserver) {
        floatingBarResizeObserver.disconnect();
        floatingBarResizeObserver = undefined;
    }
};
