import {openInputDialog} from "../dialog/inputDialog";
import {clearAIEditorHistory, startAIWriting} from "./editor";
import {showMessage} from "../dialog/message";
import {isDisabledFeature} from "../protyle/util/compatibility";

export const AIChat = (protyle: IProtyle, element: HTMLElement) => {
    if (isDisabledFeature("ai")) {
        return;
    }
    openInputDialog({
        title: "✨ " + window.siyuan.languages.aiWriting,
        value: "",
        multiline: true,
        resize: "vertical",
        onConfirm: (inputValue, dialog) => {
            if (!inputValue.trim()) {
                showMessage(window.siyuan.languages["_kernel"][142]);
                return;
            }
            dialog.destroy();
            if (inputValue === "Clear context") {
                clearAIEditorHistory(protyle);
                showMessage(window.siyuan.languages.clearContextSucc);
                return;
            }
            startAIWriting(protyle, element, inputValue);
        },
    });
};
