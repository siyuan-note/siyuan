import {openInputDialog} from "../../dialog/inputDialog";
import {showMessage} from "../../dialog/message";
import {isTaskListMarker} from "./taskListMarker";
import {Menu} from "../../plugin/Menu";

export const getTaskStatusItems = (marker: string, setMarker: (marker: string) => void): IMenu[] => {
    const lang = window.siyuan.languages;
    return [
        {id: "taskStatusTodo", marker: " ", label: lang.taskStatusTodo},
        {id: "taskStatusInProgress", marker: "/", label: lang.taskStatusInProgress},
        {id: "taskStatusDone", marker: "X", label: lang.taskStatusDone},
        {id: "taskStatusCanceled", marker: "-", label: lang.taskStatusCanceled},
    ].map(item => ({
        id: item.id,
        label: item.label,
        icon: marker?.toUpperCase() === item.marker ? "iconCheck" : "iconUncheck",
        click: () => setMarker(item.marker),
    })).concat([{
        id: "customTaskStatus",
        label: lang.customTaskStatus,
        icon: "iconEdit",
        click: () => openTaskStatusDialog(marker, setMarker),
    }]);
};

export const openTaskStatusMenu = (anchor: Element, marker: string, setMarker: (marker: string) => void) => {
    const menu = new Menu();
    getTaskStatusItems(marker, setMarker).forEach(item => menu.addItem(item));
    const rect = anchor.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom, h: rect.height});
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
