import {openModel} from "../menu/model";
import {ai} from "../../config/ai";

export const initAI = () => {
    openModel({
        title: "AI",
        icon: "iconSparkles",
        html: ai.genHTML(),
        bindEvent(modelMainElement: HTMLElement) {
            ai.element = modelMainElement;
            ai.bindEvent();
        }
    });
};
