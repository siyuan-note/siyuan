import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {transaction} from "../../wysiwyg/transaction";
import {Menu} from "../../../plugin/API";
import {getIconByType} from "./render";
import {openEditorTab} from "../../../menus/util";
import {copySubMenu} from "../../../menus/commonMenuItem";
import {popTextCell} from "./cell";

export const avClick = (protyle: IProtyle, event: MouseEvent & { target: HTMLElement }) => {
    const blockElement = hasClosestBlock(event.target);
    const addElement = hasClosestByAttribute(event.target, "data-type", "av-header-add");
    if (addElement && blockElement) {
        const menu = new Menu("av-header-add");
        menu.addItem({
            icon: "iconAlignLeft",
            label: window.siyuan.languages.text,
            click() {
                const id = Lute.NewNodeID();
                transaction(protyle, [{
                    action: "addAttrViewCol",
                    name: "Text",
                    parentID: blockElement.getAttribute("data-av-id"),
                    type: "text",
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

    const cellElement = hasClosestByClassName(event.target, "av__cell");
    if (cellElement && blockElement) {
        const type = cellElement.getAttribute("data-dtype") as TAVCol;
        if (cellElement.parentElement.classList.contains("av__row--header")) {
            const menu = new Menu("av-header-cell");
            menu.addItem({
                icon: getIconByType(type),
                label: `<input style="margin: 4px 0" class="b3-text-field" type="text" value="${cellElement.innerText.trim()}">`,
                bind() {

                }
            });
            if (type !== "block") {
                menu.addItem({
                    icon: "iconEdit",
                    label: window.siyuan.languages.edit,
                    click() {

                    }
                });
            }
            menu.addSeparator();
            menu.addItem({
                icon: "iconUp",
                label: window.siyuan.languages.fileNameNatASC,
                click() {

                }
            });
            menu.addItem({
                icon: "iconDown",
                label: window.siyuan.languages.fileNameNatDESC,
                click() {

                }
            });
            menu.addItem({
                icon: "iconFilter",
                label: window.siyuan.languages.filter,
                click() {

                }
            });
            menu.addSeparator();
            if (type !== "block") {
                menu.addItem({
                    icon: "iconEyeoff",
                    label: window.siyuan.languages.hide,
                    click() {

                    }
                });
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
                        const id = cellElement.getAttribute("data-id")
                        transaction(protyle, [{
                            action: "removeAttrViewCol",
                            id,
                            parentID: blockElement.getAttribute("data-av-id"),
                        }], [{
                            action: "addAttrViewCol",
                            name: cellElement.textContent.trim(),
                            parentID: blockElement.getAttribute("data-av-id"),
                            type: type,
                            id
                        }]);
                    }
                });
                menu.addSeparator();
            }
            menu.addItem({
                label: `<div class="fn__flex" style="margin-bottom: 4px"><span>${window.siyuan.languages.wrap}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch fn__flex-center"${cellElement.getAttribute("data-wrap") === "true" ? " checked" : ""}></div>`,
                click() {

                }
            });
            const cellRect = cellElement.getBoundingClientRect();
            menu.open({
                x: cellRect.left,
                y: cellRect.bottom,
                h: cellRect.height
            });
            (window.siyuan.menus.menu.element.querySelector(".b3-text-field") as HTMLInputElement)?.select();
            event.preventDefault();
            event.stopPropagation();
        } else {
            popTextCell()
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
    const rowId = rowElement.getAttribute("data-id");
    const menu = new Menu("av-row");
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
    })
    const editAttrSubmenu: IMenu[] = []
    rowElement.parentElement.querySelectorAll(".av__row--header .av__cell").forEach((cellElement) => {
        editAttrSubmenu.push({
            icon: getIconByType(cellElement.getAttribute("data-dtype") as TAVCol),
            label: cellElement.textContent.trim(),
            click() {
            }
        })
    });
    menu.addItem({
        icon: "iconList",
        label: window.siyuan.languages.attr,
        type: "submenu",
        submenu: editAttrSubmenu
    })
    menu.open({
        x: event.clientX,
        y: event.clientY,
    });
    event.preventDefault();
    event.stopPropagation();
    return true;
}
