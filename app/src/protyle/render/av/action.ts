import {Menu} from "../../../plugin/Menu";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {transaction} from "../../wysiwyg/transaction";
import {openEditorTab} from "../../../menus/util";
import {copySubMenu} from "../../../menus/commonMenuItem";
import {popTextCell, showHeaderCellMenu} from "./cell";
import {getColIconByType} from "./col";

export const avClick = (protyle: IProtyle, event: MouseEvent & { target: HTMLElement }) => {
    const blockElement = hasClosestBlock(event.target);
    if (!blockElement) {
        return false;
    }
    const addElement = hasClosestByAttribute(event.target, "data-type", "av-header-add");
    if (addElement) {
        const menu = new Menu("av-header-add");
        menu.addItem({
            icon: "iconAlignLeft",
            label: window.siyuan.languages.text,
            click() {
                const id = Lute.NewNodeID();
                const type = "text";
                transaction(protyle, [{
                    action: "addAttrViewCol",
                    name: "Text",
                    parentID: blockElement.getAttribute("data-av-id"),
                    type,
                    id
                }], [{
                    action: "removeAttrViewCol",
                    id,
                    parentID: blockElement.getAttribute("data-av-id"),
                }]);
            }
        });
        const addRect = addElement.getBoundingClientRect();
        menu.open({
            x: addRect.left,
            y: addRect.bottom,
            h: addRect.height
        });
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const checkElement = hasClosestByClassName(event.target, "av__firstcol");
    if (checkElement) {
        // TODO
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    const cellElement = hasClosestByClassName(event.target, "av__cell");
    if (cellElement) {
        if (cellElement.parentElement.classList.contains("av__row--header")) {
            showHeaderCellMenu(protyle, blockElement, cellElement);
            event.preventDefault();
            event.stopPropagation();
        } else {
            popTextCell(protyle, cellElement);
        }
        return true;
    }
    return false;
};

export const avContextmenu = (protyle: IProtyle, event: MouseEvent & { detail: any }, target: HTMLElement) => {
    const rowElement = hasClosestByClassName(target, "av__row");
    if (!rowElement) {
        return false;
    }
    const blockElement = hasClosestBlock(rowElement);
    if (!blockElement) {
        return false;
    }
    event.preventDefault();
    event.stopPropagation();

    blockElement.querySelectorAll(".av__row--select").forEach(item => {
        item.classList.remove("av__row--select");
    });
    const rowId = rowElement.getAttribute("data-id");
    const menu = new Menu("av-row");
    if (menu.isOpen) {
        return true;
    }
    rowElement.classList.add("av__row--select");
    menu.addItem({
        icon: "iconCopy",
        label: window.siyuan.languages.duplicate,
        click() {

        }
    });
    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click() {
            transaction(protyle, [{
                action: "removeAttrViewBlock",
                id: blockElement.getAttribute("data-node-id"),
                parentID: blockElement.getAttribute("data-av-id"),
            }], [{
                action: "insertAttrViewBlock",
                id: blockElement.getAttribute("data-node-id"),
                parentID: blockElement.getAttribute("data-av-id"),
                previousID: rowElement.previousElementSibling?.getAttribute("data-id") || "",
                srcIDs: [rowId],
            }]);
            rowElement.remove();
        }
    });
    menu.addSeparator();
    openEditorTab(protyle.app, rowId);
    menu.addItem({
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        type: "submenu",
        submenu: copySubMenu(rowId)
    });
    menu.addSeparator();
    menu.addItem({
        icon: "iconEdit",
        label: window.siyuan.languages.edit,
        click() {

        }
    });
    const editAttrSubmenu: IMenu[] = [];
    rowElement.parentElement.querySelectorAll(".av__row--header .av__cell").forEach((cellElement) => {
        editAttrSubmenu.push({
            icon: getColIconByType(cellElement.getAttribute("data-dtype") as TAVCol),
            label: cellElement.textContent.trim(),
            click() {
            }
        });
    });
    menu.addItem({
        icon: "iconList",
        label: window.siyuan.languages.attr,
        type: "submenu",
        submenu: editAttrSubmenu
    });
    menu.open({
        x: event.clientX,
        y: event.clientY,
    });
    return true;
};
