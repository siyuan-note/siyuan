import {Menu} from "../../../../plugin/Menu";
import {Constants} from "../../../../constants";
import {transaction} from "../../../wysiwyg/transaction";
import {confirmDialog} from "../../../../dialog/confirmDialog";
import * as dayjs from "dayjs";
import {getAVData} from "../virtualScroll";
import {
    AV_MANAGE_CUSTOM_COLORS_TYPE,
    applyAVColorPalette,
    getAVColorGridHTML,
    getAVColorOrder,
    getAVCustomColors,
} from "../color";
import {openAVCustomColorDialog} from "../colorDialog";

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
    const data = getAVData(options.blockElement as HTMLElement);
    if (!option) {
        return;
    }
    applyAVColorPalette(menu.element, getAVCustomColors());

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
    const colorHTML = `<div class="b3-menu__labels">${window.siyuan.languages.color}</div>
<div class="fn__flex fn__flex-wrap" style="width:238px;max-height:238px;overflow:auto">${getAVColorGridHTML(
        getAVCustomColors(), option.color, window.siyuan.languages.manageColors, getAVColorOrder())}</div>`;
    menu.addItem({
        type: "empty",
        iconHTML: "",
        label: colorHTML,
        bind(element) {
            element.addEventListener("click", (event) => {
                const colorTarget = (event.target as HTMLElement).closest<HTMLElement>("button");
                if (colorTarget?.dataset.type === AV_MANAGE_CUSTOM_COLORS_TYPE) {
                    menu.close();
                    if (data) {
                        openAVCustomColorDialog({
                            protyle: options.protyle,
                            data,
                            blockElement: options.blockElement as HTMLElement,
                        });
                    }
                    return;
                }
                if (!colorTarget || !colorTarget.classList.contains("color__square") ||
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
