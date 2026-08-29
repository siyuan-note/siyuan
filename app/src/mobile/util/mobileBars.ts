import {
    createMobileBarsState,
    getMobileBarsVisibility,
    MOBILE_BARS_SCROLL_OPTIONS,
    reduceMobileBarsState,
} from "./mobileBarsState";

const PANEL_IDS = ["sidebar", "sidebarRight", "menu", "model"];

let barsState = createMobileBarsState();
let scrollElement: HTMLElement | undefined;
let scrollFrame = 0;
let panelObserver: MutationObserver | undefined;
let selectionObserver: MutationObserver | undefined;
let selectionFrame = 0;
let programmaticScrollTimeout = 0;
let initialized = false;

const hasTextSelection = () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !scrollElement) {
        return false;
    }
    const range = selection.getRangeAt(0);
    return scrollElement.contains(range.startContainer) && scrollElement.contains(range.endContainer);
};

export const isMobileBlockSelecting = () => {
    const multiSelectElement = scrollElement?.closest(".protyle")
        ?.querySelector(".protyle-util--mobile [data-type='exitMultiSelectMode']");
    return Boolean(multiSelectElement && !multiSelectElement.closest(".fn__none"));
};

const isPanelOpen = () => PANEL_IDS.some((id) => Boolean(document.getElementById(id)?.style.transform));

const renderMobileBars = () => {
    const visibility = getMobileBarsVisibility(barsState);
    const immersive = !visibility.topbarVisible;
    document.body.classList.toggle("mobile-chrome--hidden", immersive);
    document.body.classList.toggle("mobile-keyboard--open", visibility.editingBarVisible);
    document.body.classList.toggle("mobile-selection--active", barsState.selecting);

    const progress = MOBILE_BARS_SCROLL_OPTIONS.maxOffset === 0 ? 0 :
        barsState.readingBarsOffset / MOBILE_BARS_SCROLL_OPTIONS.maxOffset;
    const topbarElement = document.getElementById("mobileTopBar");
    if (topbarElement) {
        topbarElement.style.setProperty("--mobile-bar-translate-y", `${0 - barsState.readingBarsOffset}px`);
        topbarElement.toggleAttribute("inert", immersive);
        topbarElement.setAttribute("aria-hidden", immersive ? "true" : "false");
    }
    const breadcrumbElement = document.querySelector<HTMLElement>("#editor > .protyle-breadcrumb");
    breadcrumbElement?.style.setProperty("--mobile-bar-translate-y", `${0 - barsState.readingBarsOffset}px`);
    const bottomBarElement = document.getElementById("mobileBottomBar");
    if (bottomBarElement) {
        bottomBarElement.style.setProperty("--mobile-bar-translate-y", `${progress * 100}%`);
        bottomBarElement.style.setProperty("--mobile-bar-opacity", (1 - progress).toString());
        bottomBarElement.toggleAttribute("inert", !visibility.bottomBarVisible);
        bottomBarElement.setAttribute("aria-hidden", visibility.bottomBarVisible ? "false" : "true");
    }
};

const updatePanelState = () => {
    const open = isPanelOpen();
    if (barsState.panelOpen === open) {
        return;
    }
    barsState = reduceMobileBarsState(barsState, {
        type: "set-panel-open",
        open,
        scrollTop: scrollElement?.scrollTop,
    });
    renderMobileBars();
};

const updateSelectionState = () => {
    const selecting = hasTextSelection() || isMobileBlockSelecting();
    if (barsState.selecting === selecting) {
        return;
    }
    barsState = reduceMobileBarsState(barsState, {
        type: "set-selecting",
        active: selecting,
        scrollTop: scrollElement?.scrollTop,
    });
    renderMobileBars();
};

const onSelectionChange = () => {
    if (selectionFrame) {
        return;
    }
    selectionFrame = requestAnimationFrame(() => {
        selectionFrame = 0;
        updateSelectionState();
    });
};

const onScroll = () => {
    if (!scrollElement || scrollFrame) {
        return;
    }
    scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        if (!scrollElement) {
            return;
        }
        updatePanelState();
        updateSelectionState();
        barsState = reduceMobileBarsState(barsState, {
            type: "scroll",
            scrollTop: scrollElement.scrollTop,
        });
        renderMobileBars();
    });
};

export const bindMobileBarsScroll = (element: HTMLElement) => {
    if (scrollElement === element) {
        resetMobileBars(element.scrollTop);
        updateSelectionState();
        return;
    }
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    scrollElement?.removeEventListener("scroll", onScroll);
    selectionObserver?.disconnect();
    selectionObserver = undefined;
    scrollElement = element;
    scrollElement.addEventListener("scroll", onScroll, {passive: true});
    const selectionElement = element.closest(".protyle")?.querySelector(".protyle-util--mobile");
    if (selectionElement) {
        selectionObserver = new MutationObserver(updateSelectionState);
        selectionObserver.observe(selectionElement, {
            attributes: true,
            attributeFilter: ["class"],
            childList: true,
            subtree: true,
        });
    }
    resetMobileBars(element.scrollTop);
    updateSelectionState();
};

export const clearMobileBarsScroll = () => {
    cancelAnimationFrame(scrollFrame);
    cancelAnimationFrame(selectionFrame);
    scrollFrame = 0;
    selectionFrame = 0;
    scrollElement?.removeEventListener("scroll", onScroll);
    selectionObserver?.disconnect();
    selectionObserver = undefined;
    scrollElement = undefined;
    resetMobileBars(0);
};

export const resetMobileBars = (scrollTop = scrollElement?.scrollTop || 0) => {
    clearTimeout(programmaticScrollTimeout);
    barsState = reduceMobileBarsState(barsState, {type: "document-changed", scrollTop});
    renderMobileBars();
};

export const pauseMobileBarsScroll = (duration = 320) => {
    clearTimeout(programmaticScrollTimeout);
    barsState = reduceMobileBarsState(barsState, {
        type: "set-programmatic-scrolling",
        active: true,
        scrollTop: scrollElement?.scrollTop,
    });
    programmaticScrollTimeout = window.setTimeout(() => {
        barsState = reduceMobileBarsState(barsState, {
            type: "set-programmatic-scrolling",
            active: false,
            scrollTop: scrollElement?.scrollTop,
        });
        renderMobileBars();
    }, duration);
};

export const showMobileBars = () => {
    barsState = reduceMobileBarsState(barsState, {type: "set-reading-bars", visible: true});
    renderMobileBars();
};

export const initMobileBars = () => {
    if (initialized) {
        return;
    }
    initialized = true;
    window.addEventListener("siyuan-mobile-keyboard-change", ((event: CustomEvent<boolean>) => {
        barsState = reduceMobileBarsState(barsState, {
            type: "set-editing",
            active: event.detail,
            scrollTop: scrollElement?.scrollTop,
        });
        renderMobileBars();
    }) as EventListener);
    document.addEventListener("selectionchange", onSelectionChange);

    panelObserver?.disconnect();
    const panelElements = PANEL_IDS.map((id) => document.getElementById(id)).filter(Boolean);
    panelObserver = new MutationObserver(updatePanelState);
    panelElements.forEach((element) => panelObserver.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style"],
    }));
    barsState = createMobileBarsState(scrollElement?.scrollTop);
    renderMobileBars();
};
