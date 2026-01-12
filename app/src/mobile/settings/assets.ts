import {openModel} from "../menu/model";
import {image} from "../../config/image";

export const initAssets = () => {
    openModel({
        title: window.siyuan.languages.assets,
        icon: "iconImage",
        html: image.genHTML(),
        bindEvent(modelMainElement: HTMLElement) {
            image.element = modelMainElement.firstElementChild;
            image.bindEvent();
        }
    });
};
