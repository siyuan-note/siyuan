import {openModel} from "../menu/model";
import {image} from "../../config/image";
import {App} from "../../index";

export const initConfigAssets = (app: App) => {
    openModel({
        title: window.siyuan.languages.assets,
        icon: "iconImage",
        html: image.genHTML(),
        bindEvent(modelMainElement: HTMLElement) {
            image.element = modelMainElement.firstElementChild;
            image.bindEvent(app);
        }
    });
};
