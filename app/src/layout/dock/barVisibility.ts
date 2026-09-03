export const shouldShowDockBar = (globallyHidden: boolean, hasVisibleEntry: boolean) =>
    !globallyHidden && hasVisibleEntry;

export const adjustDockPadding = () => {
    const layoutElement = window.siyuan.layout.layout.children[0].element;
    if (window.siyuan.layout.leftDock.elements[0].parentElement.classList.contains("fn__none")) {
        layoutElement.style.marginLeft = "var(--b3-layout-space)";
    } else {
        layoutElement.style.marginLeft = "";
    }
    if (window.siyuan.layout.rightDock.elements[0].parentElement.classList.contains("fn__none")) {
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
        const hasVisibleEntry = Boolean(item.querySelector(".dock__item[data-type]:not(.fn__none)"));
        item.classList.toggle("fn__none", !shouldShowDockBar(
            window.siyuan.config.uiLayout.hideDock,
            hasVisibleEntry,
        ));
    });
    adjustDockPadding();
};
