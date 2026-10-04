export const shouldShowDockBar = (globallyHidden: boolean, hasVisibleEntry: boolean) =>
    !globallyHidden && hasVisibleEntry;

export const shouldShowDockSplit = (hasVisibleEntryBefore: boolean, hasVisibleEntryAfter: boolean) =>
    hasVisibleEntryBefore && hasVisibleEntryAfter;

export const adjustDockPadding = () => {
    const layoutElement = window.siyuan.layout?.layout?.children[0]?.element;
    const leftDockElement = window.siyuan.layout?.leftDock?.elements[0]?.parentElement;
    const rightDockElement = window.siyuan.layout?.rightDock?.elements[0]?.parentElement;
    // 设置窗口和独立编辑窗口没有主窗口的停靠栏，布局初始化完成后才调整间距。
    if (!layoutElement || !leftDockElement || !rightDockElement) {
        return;
    }
    if (leftDockElement.classList.contains("fn__none")) {
        layoutElement.style.marginLeft = "var(--b3-layout-space)";
    } else {
        layoutElement.style.marginLeft = "";
    }
    if (rightDockElement.classList.contains("fn__none")) {
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
    document.querySelectorAll<HTMLElement>(".dock").forEach((item) => {
        const sections = Array.from(item.querySelectorAll<HTMLElement>(":scope > .dock__items"));
        const sectionVisibility = sections.map((section) =>
            Boolean(section.querySelector(".dock__item[data-type]:not(.fn__none)")));
        const splitElement = item.querySelector(":scope > .dock__split");
        splitElement?.classList.toggle("fn__none", !shouldShowDockSplit(
            sectionVisibility[0],
            sectionVisibility[1],
        ));
        item.classList.toggle("fn__none", !shouldShowDockBar(
            window.siyuan.config.uiLayout.hideDock,
            sectionVisibility.some(Boolean),
        ));
    });
    adjustDockPadding();
};
