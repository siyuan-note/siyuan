import {Menu} from "../../../../plugin/Menu";
import {Constants} from "../../../../constants";
import {transaction} from "../../../wysiwyg/transaction";
import {confirmDialog} from "../../../../dialog/confirmDialog";
import * as dayjs from "dayjs";

export const openKanbanGroupMenu = (options: {
    protyle: IProtyle,
    blockElement: Element,
    target: HTMLElement,
}) => {
    const menu = new Menu(Constants.MENU_AV_KANBAN_GROUP);
    if (menu.isOpen) {
        return;
    }
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    const groupID = options.target.dataset.groupId;
    const colID = options.target.dataset.colId;
    const name = options.target.dataset.name;
    const kanbanElement = options.blockElement.querySelector(".av__kanban") as HTMLElement;
    const colOptions = JSON.parse(kanbanElement.dataset.groupOptions || "[]") as {
        name: string,
        color: string,
        desc?: string,
    }[];
    const option = colOptions.find(item => item.name === name);
    if (!option) {
        return;
    }

    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        warning: true,
        click() {
            confirmDialog(
                window.siyuan.languages.deleteKanbanGroupConfirm,
                window.siyuan.languages.deleteKanbanGroupTip,
                () => {
                    transaction(options.protyle, [{
                        action: "removeAttrViewColOption",
                        id: colID,
                        avID,
                        data: name,
                    }, {
                        action: "doUpdateUpdated",
                        id: blockID,
                        data: dayjs().format("YYYYMMDDHHmmss"),
                    }], [{
                        action: "updateAttrViewColOptions",
                        id: colID,
                        avID,
                        data: colOptions,
                    }]);
                },
                undefined,
                true
            );
        }
    });
    menu.addItem({
        icon: "iconEyeoff",
        label: window.siyuan.languages.hide,
        click() {
            transaction(options.protyle, [{
                action: "hideAttrViewGroup",
                avID,
                blockID,
                id: groupID,
                data: 2,
            }], [{
                action: "hideAttrViewGroup",
                avID,
                blockID,
                id: groupID,
                data: 0,
            }]);
        }
    });
    menu.addSeparator();
    let colorHTML = `<div class="b3-menu__labels">${window.siyuan.languages.color}</div>
<div class="fn__flex fn__flex-wrap" style="width: 238px">`;
    Array.from(Array(14).keys()).forEach(index => {
        colorHTML += `<button data-color="${index + 1}" class="color__square${parseInt(option.color) === index + 1 ? " color__square--current" : ""}" style="color: var(--b3-font-color${index + 1});background-color: var(--b3-font-background${index + 1});">A</button>`;
    });
    menu.addItem({
        type: "empty",
        iconHTML: "",
        label: colorHTML + "</div>",
        bind(element) {
            element.addEventListener("click", (event) => {
                const colorTarget = event.target as HTMLElement;
                if (!colorTarget.classList.contains("color__square") ||
                    colorTarget.classList.contains("color__square--current")) {
                    return;
                }
                const newColor = colorTarget.dataset.color;
                transaction(options.protyle, [{
                    action: "updateAttrViewColOption",
                    id: colID,
                    avID,
                    data: {
                        oldName: name,
                        newName: name,
                        oldColor: option.color,
                        newColor,
                        newDesc: option.desc || "",
                    },
                }, {
                    action: "doUpdateUpdated",
                    id: blockID,
                    data: dayjs().format("YYYYMMDDHHmmss"),
                }], [{
                    action: "updateAttrViewColOption",
                    id: colID,
                    avID,
                    data: {
                        oldName: name,
                        newName: name,
                        oldColor: newColor,
                        newColor: option.color,
                        newDesc: option.desc || "",
                    },
                }]);
                menu.close();
            });
        }
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom,
        h: rect.height,
    });
};
