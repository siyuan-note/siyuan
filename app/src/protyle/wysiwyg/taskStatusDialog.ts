import {openInputDialog} from "../../dialog/inputDialog";
import {showMessage} from "../../dialog/message";
import {isTaskListMarker} from "./taskListMarker";

export const openTaskStatusDialog = (marker: string, setMarker: (marker: string) => void) => {
    openInputDialog({
        title: window.siyuan.languages.customTaskStatus,
        value: marker || " ",
        maxLength: 1,
        onConfirm: (value, dialog) => {
            const next = value || " ";
            if (!isTaskListMarker(next)) {
                showMessage(window.siyuan.languages.invalid, 3000, "error");
                return;
            }
            setMarker(next);
            dialog.destroy();
        },
    });
};
