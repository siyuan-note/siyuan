import {activeBlur} from "./keyboardToolbar";
import {Constants} from "../../constants";
import {destroyModel} from "../menu/model";
import {clearActiveMobileSecondaryEditor, getActiveMobileSecondaryEditor} from "./secondaryEditors";

let hidePanelMaskTimer = 0;

export const MOBILE_MENU_CLOSE_EVENT = "siyuan-mobile-menu-close";

export const showPanelMask = () => {
    clearTimeout(hidePanelMaskTimer);
    hidePanelMaskTimer = 0;
    const maskElement = document.querySelector(".side-mask") as HTMLElement;
    maskElement?.classList.remove("fn__none");
    return maskElement;
};

export const closePanel = (options: {preserveKeyboard?: boolean} = {}) => {
    const secondaryEditor = getActiveMobileSecondaryEditor();
    if (secondaryEditor?.protyle.element.closest("#sidebar, #sidebarRight")) {
        activeBlur(true);
    }
    clearActiveMobileSecondaryEditor();
    destroyModel();
    const menuElement = document.getElementById("menu");
    if (menuElement) {
        menuElement.dispatchEvent(new CustomEvent(MOBILE_MENU_CLOSE_EVENT, {detail: options}));
        menuElement.style.removeProperty("transform");
        menuElement.style.removeProperty("z-index");
    }
    document.getElementById("sidebar")?.style.removeProperty("transform");
    document.getElementById("sidebarRight")?.style.removeProperty("transform");
    document.getElementById("model")?.style.removeProperty("transform");
    const maskElement = document.querySelector(".side-mask") as HTMLElement;
    clearTimeout(hidePanelMaskTimer);
    hidePanelMaskTimer = window.setTimeout(() => {
        maskElement?.classList.add("fn__none");
        hidePanelMaskTimer = 0;
    }, Constants.TIMEOUT_TRANSITION);
    if (maskElement) {
        maskElement.style.opacity = "";
    }
    window.siyuan.menus.menu.remove();
};

export const closeModel = () => {
    activeBlur(true);
    destroyModel();
    document.getElementById("model").style.transform = "";
};
