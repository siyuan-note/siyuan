import {activeBlur} from "./keyboardToolbar";
import {closeAVCellEditor} from "../../protyle/render/av/cellEditor";
import {closePanel, showPanelMask} from "./closePanel";
import type {MobileSidebarSide} from "./touchPanelGesture";

export const getSidebarElement = (side: MobileSidebarSide) => {
    return document.getElementById(side === "left" ? "sidebar" : "sidebarRight");
};

export const getSidebarDock = (sidebarElement: HTMLElement | null) => {
    if (!sidebarElement) {
        return;
    }
    const toolbarElement = sidebarElement.querySelector(".toolbar--border");
    const tabElements = Array.from(toolbarElement?.querySelectorAll<HTMLElement>("[data-type]") || []);
    const activeElement = tabElements.find(item =>
        item.classList.contains("toolbar__icon--active") && !item.classList.contains("fn__none")) ||
        tabElements.find(item => !item.classList.contains("fn__none"));
    const type = activeElement?.dataset.type?.replace(/^sidebar-/, "").replace(/-tab$/, "");
    if (toolbarElement && type) {
        return {toolbarElement, type};
    }
};

export const popSidebar = (side: MobileSidebarSide, render = true) => {
    activeBlur();
    const sidebarElement = getSidebarElement(side);
    if (!sidebarElement) {
        return;
    }
    let dock: ReturnType<typeof getSidebarDock>;
    if (render) {
        dock = getSidebarDock(sidebarElement);
        if (!dock) {
            sidebarElement.style.removeProperty("transform");
            closePanel();
            return;
        }
    }
    closeAVCellEditor();
    const otherSidebar = side === "left" ? "right" : "left";
    getSidebarElement(otherSidebar)?.style.removeProperty("transform");
    sidebarElement.style.transform = "translateX(0px)";
    if (render) {
        dock.toolbarElement.dispatchEvent(new CustomEvent("click", {detail: dock.type}));
    }
};

export const openSidebar = (side: MobileSidebarSide) => {
    if (!getSidebarDock(getSidebarElement(side))) {
        return;
    }
    closePanel();
    const mask = showPanelMask();
    mask.style.zIndex = (++window.siyuan.zIndex).toString();
    mask.style.opacity = "1";
    getSidebarElement(side).style.zIndex = (++window.siyuan.zIndex).toString();
    popSidebar(side);
};
