import {activeBlur} from "../util/keyboardToolbar";

export const openDock = (type: string) => {
    activeBlur();
    const tabElement = document.querySelector(`[data-type="sidebar-${type}-tab"]`);
    const sidePanelElement = tabElement?.closest(".side-panel") as HTMLElement;
    if (!sidePanelElement || tabElement.classList.contains("fn__none")) {
        return;
    }
    document.querySelectorAll<HTMLElement>("#sidebar, #sidebarRight").forEach(item => {
        if (item !== sidePanelElement) {
            item.style.transform = "";
        }
    });
    sidePanelElement.style.transform = "translateX(0px)";
    sidePanelElement.firstElementChild.dispatchEvent(new CustomEvent("click", {detail: type}));
};
