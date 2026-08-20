import {activeBlur} from "./keyboardToolbar";
import {Constants} from "../../constants";
import {destroyModel} from "../menu/model";

export const closePanel = () => {
    destroyModel();
    document.getElementById("menu").style.transform = "";
    document.getElementById("sidebar").style.transform = "";
    document.getElementById("model").style.transform = "";
    const maskElement = document.querySelector(".side-mask") as HTMLElement;
    setTimeout(() => {
        maskElement.classList.add("fn__none");
    }, Constants.TIMEOUT_TRANSITION);
    maskElement.style.opacity = "";
    window.siyuan.menus.menu.remove();
};

export const closeModel = () => {
    activeBlur();
    destroyModel();
    document.getElementById("model").style.transform = "";
};
