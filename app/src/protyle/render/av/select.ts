import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestByClassName} from "../../util/hasClosest";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {upDownHint} from "../../../util/upDownHint";
import {bindEditEvent, getEditHTML} from "./col";
import {updateAttrViewCellAnimation} from "./action";
import {genAVValueHTML} from "./blockAttr";

const filterSelectHTML = (key: string, options: { name: string, color: string }[]) => {
    let html = "";
    let hasMatch = false;
    if (options) {
        options.forEach(item => {
            if (!key ||
                (key.toLowerCase().indexOf(item.name.toLowerCase()) > -1 ||
                    item.name.toLowerCase().indexOf(key.toLowerCase()) > -1)) {
                html += `<button data-type="addColOptionOrCell" class="b3-menu__item${html ? "" : " b3-menu__item--current"}" draggable="true" data-name="${item.name}" data-color="${item.color}">
    <svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">
        <span class="b3-chip" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">
            <span class="fn__ellipsis">${item.name}</span>
        </span>
    </div>
    <svg class="b3-menu__action" data-type="setColOption"><use xlink:href="#iconEdit"></use></svg>
</button>`;
            }
            if (key === item.name) {
                hasMatch = true;
            }
        });
    }
    if (!hasMatch && key) {
        const colorIndex = (options?.length || 0) % 13 + 1;
        html = `<button data-type="addColOptionOrCell" class="b3-menu__item${html ? "" : " b3-menu__item--current"}" data-name="${key}" data-color="${colorIndex}">
<svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
<div class="fn__flex-1">
    <span class="b3-chip" style="background-color:var(--b3-font-background${colorIndex});color:var(--b3-font-color${colorIndex})">
        <span class="fn__ellipsis">${key}</span>
    </span>
</div>
<span class="b3-menu__accelerator">Enter</span>
</button>${html}`;
    }
    return html;
};

export const removeCellOption = (protyle: IProtyle, data: IAV, cellElements: HTMLElement[], target: HTMLElement) => {
    if (!target) {
        return;
    }
    const colId = cellElements[0].dataset.colId;
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    let newData: IAVCellSelectValue[];
    cellElements.forEach((item, elementIndex) => {
        const rowID = item.parentElement.dataset.id;
        const cellId = item.dataset.id;
        let cellData: IAVCell;
        data.view.rows.find(row => {
            if (row.id === rowID) {
                row.cells.find(cell => {
                    if (cell.id === cellId) {
                        cellData = cell;
                        return true;
                    }
                });
                return true;
            }
        });
        const oldValue = Object.assign([], cellData.value.mSelect);
        if (elementIndex === 0) {
            cellData.value.mSelect?.find((item: { content: string }, index: number) => {
                if (item.content === target.dataset.content) {
                    cellData.value.mSelect.splice(index, 1);
                    return true;
                }
            });
            newData = cellData.value.mSelect;
        } else {
            cellData.value.mSelect = newData;
        }

        doOperations.push({
            action: "updateAttrViewCell",
            id: cellId,
            keyID: colId,
            rowID,
            avID: data.id,
            data: cellData.value
        });
        undoOperations.push({
            action: "updateAttrViewCell",
            id: cellId,
            keyID: colId,
            rowID,
            avID: data.id,
            data: {
                mSelect: oldValue
            }
        });
        if (item.classList.contains("custom-attr__avvalue")) {
            item.innerHTML = genAVValueHTML(cellData.value);
        } else {
            updateAttrViewCellAnimation(item);
        }
    });
    transaction(protyle, doOperations, undoOperations);
    target.remove();
};

export const setColOption = (protyle: IProtyle, data: IAV, target: HTMLElement, cellElements?: HTMLElement[]) => {
    const menuElement = hasClosestByClassName(target, "b3-menu");
    if (!menuElement) {
        return;
    }
    const colId = cellElements ? cellElements[0].dataset.colId : menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
    let name = target.parentElement.dataset.name;
    let color = target.parentElement.dataset.color;
    const menu = new Menu("av-col-option", () => {
        if (name === inputElement.value) {
            return;
        }
        transaction(protyle, [{
            action: "updateAttrViewColOption",
            id: colId,
            avID: data.id,
            data: {
                newColor: color,
                oldName: name,
                newName: inputElement.value
            },
        }], [{
            action: "updateAttrViewColOption",
            id: colId,
            avID: data.id,
            data: {
                newColor: color,
                oldName: inputElement.value,
                newName: name
            },
        }]);
        data.view.columns.find(column => {
            if (column.id === colId) {
                column.options.find((item) => {
                    if (item.name === name) {
                        item.name = inputElement.value;
                        return true;
                    }
                });
                return true;
            }
        });
        if (!cellElements) {
            menuElement.innerHTML = getEditHTML({protyle, data, colId});
            bindEditEvent({protyle, data, menuElement});
        } else {
            cellElements.forEach((cellElement: HTMLMediaElement) => {
                data.view.rows.find(row => {
                    if (row.id === cellElement.parentElement.dataset.id) {
                        row.cells.find(cell => {
                            if (cell.id === cellElement.dataset.id) {
                                cell.value.mSelect.find((item) => {
                                    if (item.content === name) {
                                        item.content = inputElement.value;
                                        return true;
                                    }
                                });
                                if (cellElement.classList.contains("custom-attr__avvalue")) {
                                    cellElement.innerHTML = genAVValueHTML(cell.value);
                                } else {
                                    updateAttrViewCellAnimation(cellElement);
                                }
                                return true;
                            }
                        });
                        return true;
                    }
                });
            });
            menuElement.innerHTML = getSelectHTML(data.view, cellElements);
            bindSelectEvent(protyle, data, menuElement, cellElements);
        }
    });
    if (menu.isOpen) {
        return;
    }
    menu.addItem({
        iconHTML: "",
        label: `<input class="b3-text-field" style="margin: 4px 0" value="${name}">`,
        bind(element) {
            element.querySelector("input").addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                if (event.key === "Enter") {
                    menu.close();
                }
            });
        }
    });
    menu.addItem({
        label: window.siyuan.languages.delete,
        icon: "iconTrashcan",
        click() {
            confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.confirmDelete, () => {
                let colOptions: { name: string, color: string }[] = [];
                data.view.columns.find(column => {
                    if (column.id === colId) {
                        colOptions = column.options;
                        return true;
                    }
                });
                const newName = target.parentElement.dataset.name;
                transaction(protyle, [{
                    action: "removeAttrViewColOption",
                    id: colId,
                    avID: data.id,
                    data: newName,
                }], [{
                    action: "updateAttrViewColOptions",
                    id: colId,
                    avID: data.id,
                    data: colOptions
                }]);
                colOptions.find((item, index) => {
                    if (item.name === newName) {
                        colOptions.splice(index, 1);
                        return true;
                    }
                });
                if (!cellElements) {
                    menuElement.innerHTML = getEditHTML({protyle, data, colId});
                    bindEditEvent({protyle, data, menuElement});
                } else {
                    cellElements.forEach((cellElement: HTMLElement) => {
                        data.view.rows.find(row => {
                            if (row.id === cellElement.parentElement.dataset.id) {
                                row.cells.find(cell => {
                                    if (cell.id === cellElement.dataset.id) {
                                        cell.value.mSelect.find((item, index) => {
                                            if (item.content === newName) {
                                                cell.value.mSelect.splice(index, 1);
                                                return true;
                                            }
                                        });
                                        if (cellElement.classList.contains("custom-attr__avvalue")) {
                                            cellElement.innerHTML = genAVValueHTML(cell.value);
                                        } else {
                                            updateAttrViewCellAnimation(cellElement);
                                        }
                                        return true;
                                    }
                                });
                                return true;
                            }
                        });
                    });
                    menuElement.innerHTML = getSelectHTML(data.view, cellElements);
                    bindSelectEvent(protyle, data, menuElement, cellElements);
                }
            });
        }
    });
    menu.addSeparator();
    Array.from(Array(13).keys()).forEach(index => {
        menu.addItem({
            accelerator: parseInt(color) === index + 1 ? '<svg class="svg" style="height: 30px; float: left;"><use xlink:href="#iconSelect"></use></svg>' : undefined,
            iconHTML: "",
            label: `<span class="color__square"  style="padding: 5px;margin: 2px;color: var(--b3-font-color${index + 1});background-color: var(--b3-font-background${index + 1});">A</span>`,
            click(element) {
                if (element.lastElementChild.classList.contains("b3-menu__accelerator")) {
                    return;
                }
                element.parentElement.querySelector(".b3-menu__accelerator")?.remove();
                element.insertAdjacentHTML("beforeend", '<span class="b3-menu__accelerator"><svg class="svg" style="height: 30px; float: left;"><use xlink:href="#iconSelect"></use></svg></span>');
                transaction(protyle, [{
                    action: "updateAttrViewColOption",
                    id: colId,
                    avID: data.id,
                    data: {
                        oldName: name,
                        newName: inputElement.value,
                        oldColor: color,
                        newColor: (index + 1).toString()
                    },
                }], [{
                    action: "updateAttrViewColOption",
                    id: colId,
                    avID: data.id,
                    data: {
                        oldName: inputElement.value,
                        newName: name,
                        oldColor: (index + 1).toString(),
                        newColor: color
                    },
                }]);

                data.view.columns.find(column => {
                    if (column.id === colId) {
                        column.options.find((item) => {
                            if (item.name === name) {
                                item.name = inputElement.value;
                                item.color = (index + 1).toString();
                                return true;
                            }
                        });
                        return true;
                    }
                });
                if (!cellElements) {
                    menuElement.innerHTML = getEditHTML({protyle, data, colId});
                    bindEditEvent({protyle, data, menuElement});
                } else {
                    cellElements.forEach((cellElement: HTMLElement) => {
                        data.view.rows.find(row => {
                            if (row.id === cellElement.parentElement.dataset.id) {
                                row.cells.find(cell => {
                                    if (cell.id === cellElement.dataset.id) {
                                        cell.value.mSelect.find((item) => {
                                            if (item.content === name) {
                                                item.content = inputElement.value;
                                                item.color = (index + 1).toString();
                                                return true;
                                            }
                                        });
                                        if (cellElement.classList.contains("custom-attr__avvalue")) {
                                            cellElement.innerHTML = genAVValueHTML(cell.value);
                                        } else {
                                            updateAttrViewCellAnimation(cellElement);
                                        }
                                        return true;
                                    }
                                });
                                return true;
                            }
                        });
                    });
                    menuElement.innerHTML = getSelectHTML(data.view, cellElements);
                    bindSelectEvent(protyle, data, menuElement, cellElements);
                }
                name = inputElement.value;
                color = (index + 1).toString();
                return true;
            }
        });
    });
    const rect = target.getBoundingClientRect();
    menu.open({
        x: rect.right,
        y: rect.bottom,
        w: rect.width,
        h: rect.height,
    });
    const inputElement = window.siyuan.menus.menu.element.querySelector("input");
    inputElement.select();
};

export const bindSelectEvent = (protyle: IProtyle, data: IAV, menuElement: HTMLElement, cellElements: HTMLElement[]) => {
    const inputElement = menuElement.querySelector("input");
    const colId = cellElements[0].dataset.colId;
    let colData: IAVColumn;
    data.view.columns.find((item: IAVColumn) => {
        if (item.id === colId) {
            colData = item;
            return;
        }
    });
    if (!colData.options) {
        colData.options = [];
    }
    const listElement = menuElement.lastElementChild.lastElementChild as HTMLElement;
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        listElement.innerHTML = filterSelectHTML(inputElement.value, colData.options);
    });
    inputElement.addEventListener("compositionend", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        listElement.innerHTML = filterSelectHTML(inputElement.value, colData.options);
    });
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        let currentElement = upDownHint(listElement, event, "b3-menu__item--current");
        if (event.key === "Enter") {
            if (!currentElement) {
                currentElement = menuElement.querySelector(".b3-menu__item--current");
            }
            addColOptionOrCell(protyle, data, cellElements, currentElement, menuElement);
        } else if (event.key === "Backspace" && inputElement.value === "") {
            removeCellOption(protyle, data, cellElements, inputElement.previousElementSibling as HTMLElement);
        } else if (event.key === "Escape") {
            menuElement.parentElement.remove();
        }
    });
};

export const addColOptionOrCell = (protyle: IProtyle, data: IAV, cellElements: HTMLElement[], currentElement: HTMLElement, menuElement: HTMLElement) => {
    let hasSelected = false;
    Array.from(menuElement.querySelectorAll(".b3-chips .b3-chip")).find((item: HTMLElement) => {
        if (item.dataset.content === currentElement.dataset.name) {
            hasSelected = true;
            return true;
        }
    });
    if (hasSelected) {
        menuElement.querySelector("input").focus();
        return;
    }

    const colId = cellElements[0].dataset.colId;
    let cellIndex: number;
    Array.from(cellElements[0].parentElement.querySelectorAll(".av__cell")).find((item: HTMLElement, index) => {
        if (item.dataset.id === cellElements[0].dataset.id) {
            cellIndex = index;
            return true;
        }
    });
    let colData: IAVColumn;
    data.view.columns.find((item: IAVColumn) => {
        if (item.id === colId) {
            colData = item;
            if (!colData.options) {
                colData.options = [];
            }
            return;
        }
    });

    const cellDoOperations: IOperation[] = [];
    const cellUndoOperations: IOperation[] = [];
    let newValue: IAVCellSelectValue[];
    cellElements.forEach((item, index) => {
        let cellData: IAVCell;
        const rowID = item.parentElement.dataset.id;
        data.view.rows.find(row => {
            if (row.id === rowID) {
                if (typeof cellIndex === "number") {
                    cellData = row.cells[cellIndex];
                    // 为空时 cellId 每次请求都不一致
                    cellData.id = item.dataset.id;
                    if (!cellData.value || !cellData.value.mSelect) {
                        cellData.value = {mSelect: []} as IAVCellValue;
                    }
                } else {
                    cellData = row.cells.find(cellItem => {
                        if (cellItem.id === item.dataset.id) {
                            return true;
                        }
                    });
                }
                return true;
            }
        });

        const oldValue = Object.assign([], cellData.value.mSelect);
        if (colData.type === "mSelect") {
            if (index === 0) {
                let hasOption = false;
                cellData.value.mSelect.find((item) => {
                    if (item.content === currentElement.dataset.name) {
                        hasOption = true;
                        return true;
                    }
                });
                if (!hasOption) {
                    cellData.value.mSelect.push({
                        color: currentElement.dataset.color,
                        content: currentElement.dataset.name
                    });
                }
                newValue = cellData.value.mSelect;
            } else {
                cellData.value.mSelect = newValue;
            }
        } else {
            if (index === 0) {
                cellData.value.mSelect = [{
                    color: currentElement.dataset.color,
                    content: currentElement.dataset.name
                }];
                newValue = cellData.value.mSelect;
            } else {
                cellData.value.mSelect = newValue;
            }
        }
        cellDoOperations.push({
            action: "updateAttrViewCell",
            id: cellData.id,
            keyID: colId,
            rowID,
            avID: data.id,
            data: cellData.value
        });
        cellUndoOperations.push({
            action: "updateAttrViewCell",
            id: cellData.id,
            keyID: colId,
            rowID,
            avID: data.id,
            data: {
                [colData.type]: oldValue
            }
        });
        if (item.classList.contains("custom-attr__avvalue")) {
            item.innerHTML = genAVValueHTML(cellData.value);
        } else {
            updateAttrViewCellAnimation(item);
        }
    });

    if (currentElement.querySelector(".b3-menu__accelerator")) {
        colData.options.push({
            color: currentElement.dataset.color,
            name: currentElement.dataset.name
        });
        cellDoOperations.splice(0, 0, {
            action: "updateAttrViewColOptions",
            id: colId,
            avID: data.id,
            data: colData.options
        });
        transaction(protyle, cellDoOperations, [{
            action: "removeAttrViewColOption",
            id: colId,
            avID: data.id,
            data: currentElement.dataset.name,
        }]);
    } else {
        transaction(protyle, cellDoOperations, cellUndoOperations);
    }
    if (colData.type === "select") {
        menuElement.parentElement.remove();
    } else {
        menuElement.innerHTML = getSelectHTML(data.view, cellElements);
        bindSelectEvent(protyle, data, menuElement, cellElements);
        menuElement.querySelector("input").focus();
    }
};

export const getSelectHTML = (data: IAVTable, cellElements: HTMLElement[]) => {
    const colId = cellElements[0].dataset["colId"];
    const colData = data.columns.find(item => {
        if (item.id === colId) {
            return item;
        }
    });

    let allUniqueOptions: IAVCellSelectValue[] = [];
    data.rows.find(row => {
        if (cellElements[0].parentElement.dataset.id === row.id) {
            row.cells.find(cell => {
                if (cell.id === cellElements[0].dataset.id) {
                    if (cell.value && cell.value.mSelect) {
                        allUniqueOptions = cell.value.mSelect;
                    }
                    return true;
                }
            });
            return true;
        }
    });

    let selectedHTML = "";
    allUniqueOptions.forEach((unique) => {
        selectedHTML += `<div class="b3-chip b3-chip--middle" data-content="${unique.content}" style="background-color:var(--b3-font-background${unique.color});color:var(--b3-font-color${unique.color})">${unique.content}<svg class="b3-chip__close" data-type="removeCellOption"><use xlink:href="#iconCloseRound"></use></svg></div>`;
    });

    return `<div class="b3-menu__items">
<div class="b3-chips">
    ${selectedHTML}
    <input>
</div>
<div>${filterSelectHTML("", colData.options)}</div>
</div>`;
};
