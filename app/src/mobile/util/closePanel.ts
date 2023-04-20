import {activeBlur, hideKeyboardToolbar} from "./keyboardToolbar";

export const closePanel = () => {
    document.getElementById("menu").style.transform = "";
    document.getElementById("sidebar").style.transform = "";
    document.getElementById("model").style.transform = "";
    const maskElement = document.querySelector(".side-mask") as HTMLElement;
    maskElement.classList.add("fn__none");
    maskElement.style.opacity = "";
    window.siyuan.menus.menu.remove();
};

export const closeModel = () => {
    document.getElementById("model").style.transform = "";
    activeBlur();
    hideKeyboardToolbar();
};
