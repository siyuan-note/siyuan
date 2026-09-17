import {getMobileSidebarConfig} from "./mobileBarsConfig";
import {getSidebarDock, getSidebarElement, openSidebar} from "./sidebar";
import type {MobileSidebarSide} from "./touchPanelGesture";

const sides: MobileSidebarSide[] = ["left", "right"];
const getButton = (side: MobileSidebarSide) =>
    document.getElementById(side === "left" ? "toolbarSidebarLeft" : "toolbarSidebarRight");

export const updateSidebarButtons = () => {
    const {sidebarButtons} = getMobileSidebarConfig();
    sides.forEach(side => {
        getButton(side)?.classList.toggle("fn__none", !sidebarButtons || !getSidebarDock(getSidebarElement(side)));
    });
};

export const initSidebarButtons = () => {
    sides.forEach(side => {
        const button = getButton(side);
        button.setAttribute("aria-label", side === "left" ?
            window.siyuan.languages.openLeftSidebar : window.siyuan.languages.openRightSidebar);
        button.addEventListener("click", () => openSidebar(side));
    });
    updateSidebarButtons();
};
