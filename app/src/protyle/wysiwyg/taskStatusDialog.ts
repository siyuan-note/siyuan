import {openInputDialog} from "../../dialog/inputDialog";
import {showMessage} from "../../dialog/message";
import {isTaskListMarker} from "./taskListMarker";

export const getTaskStatusItems = (marker: string, setMarker: (marker: string) => void): IMenu[] => {
    const lang = window.siyuan.languages;
    return [
        {id: "taskStatusTodo", marker: " ", label: lang.taskStatusTodo, icon: "iconUncheck"},
        {id: "taskStatusInProgress", marker: "/", label: lang.taskStatusInProgress, icon: "iconTaskInProgress"},
        {id: "taskStatusDone", marker: "X", label: lang.taskStatusDone, icon: "iconCheck"},
        {id: "taskStatusCanceled", marker: "-", label: lang.taskStatusCanceled, icon: "iconIndeterminateCheck"},
    ].map(item => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        checked: marker?.toUpperCase() === item.marker,
        click: () => setMarker(item.marker),
    })).concat([{
        id: "customTaskStatus",
        label: lang.customTaskStatus,
        icon: "iconEdit",
        checked: ![" ", "/", "X", "-"].includes(marker?.toUpperCase()),
        click: () => openTaskStatusDialog(marker, setMarker),
    }]);
};

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
