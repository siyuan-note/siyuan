import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestByClassName} from "../../util/hasClosest";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {setPosition} from "../../../util/setPosition";
import {upDownHint} from "../../../util/upDownHint";

const filterSelectHTML = (key: string, options: { name: string, color: string }[]) => {
    let html = "";
    let hasMatch = false;
    if (options) {
        options.forEach(item => {
            if (!key ||
                (key.toLowerCase().indexOf(item.name.toLowerCase()) > -1 ||
                    item.name.toLowerCase().indexOf(key.toLowerCase()) > -1)) {
                html += `<button data-type="addSelectColAndCell" class="b3-menu__item${html ? "" : " b3-menu__item--current"}" draggable="true" data-name="${item.name}" data-color="${item.color}">
    <svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">
        <span class="b3-chip" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">
            <span class="fn__ellipsis">${item.name}</span>
        </span>
    </div>
    <svg class="b3-menu__action" data-type="setSelectCol"><use xlink:href="#iconEdit"></use></svg>
</button>`;
            }
            if (key === item.name) {
                hasMatch = true;
            }
        });
    }
    if (!hasMatch && key) {
        const colorIndex = (options?.length || 0) % 13 + 1;
        html = `<button data-type="addSelectColAndCell" class="b3-menu__item${html ? "" : " b3-menu__item--current"}" data-name="${key}" data-color="${colorIndex}">
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

export const removeSelectCell = (protyle: IProtyle, data: IAV, options: {
    cellElement: HTMLElement
}, target: HTMLElement) => {
    if (!target) {
        return;
    }
    const rowId = options.cellElement.parentElement.dataset.id;
    const colId = options.cellElement.dataset.colId;
    const cellId = options.cellElement.dataset.id;
    let colData: IAVColumn;
    data.columns.find((item: IAVColumn) => {
        if (item.id === colId) {
            colData = item;
            return;
        }
    });
    if (!colData.options) {
        colData.options = [];
    }
    let cellData: IAVCell;
    data.rows.find(row => {
        if (row.id === rowId) {
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
    cellData.value.mSelect?.find((item: { content: string }, index: number) => {
        if (item.content === target.dataset.content) {
            cellData.value.mSelect.splice(index, 1);
            return true;
        }
    });
    target.remove();

    transaction(protyle, [{
        action: "updateAttrViewCell",
        id: cellId,
        rowID: rowId,
        parentID: data.id,
        data: cellData.value
    }], [{
        action: "updateAttrViewCell",
        id: cellId,
        rowID: rowId,
        parentID: data.id,
        data: {
            [colData.type]: oldValue
        }
    }]);
}

export const setSelectCol = (protyle: IProtyle, data: IAV, options: {
    cellElement: HTMLElement;
}, target: HTMLElement,) => {
    const menuElement = hasClosestByClassName(target, "b3-menu");
    if (!menuElement) {
        return;
    }
    let name = target.parentElement.dataset.name;
    let color = target.parentElement.dataset.color;
    const menu = new Menu("av-select-option", () => {
        if (name === inputElement.value) {
            return;
        }
        transaction(protyle, [{
            action: "updateAttrViewColOption",
            id: colId,
            parentID: data.id,
            data: {
                newColor: color,
                oldName: name,
                newName: inputElement.value
            },
        }], [{
            action: "updateAttrViewColOption",
            id: colId,
            parentID: data.id,
            data: {
                newColor: color,
                oldName: inputElement.value,
                newName: name
            },
        }]);
        data.columns.find(column => {
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
        data.rows.find(row => {
            if (row.id === options.cellElement.parentElement.dataset.id) {
                row.cells.find(cell => {
                    if (cell.id === options.cellElement.dataset.id) {
                        cell.value.mSelect.find((item) => {
                            if (item.content === name) {
                                item.content = inputElement.value;
                                return true;
                            }
                        });
                        return true;
                    }
                });
                return true;
            }
        });
        menuElement.innerHTML = getSelectHTML(data, options);
        bindSelectEvent(protyle, data, menuElement, options);
    });
    if (menu.isOpen) {
        return;
    }
    const colId = options.cellElement.dataset.colId;
    menu.addItem({
        iconHTML: "",
        label: `<input class="b3-text-field" style="margin: 4px 0" value="${name}">`
    });
    menu.addItem({
        label: window.siyuan.languages.delete,
        icon: "iconTrashcan",
        click() {
            confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.confirmDelete, () => {
                let colOptions: { name: string, color: string }[] = [];
                data.columns.find(column => {
                    if (column.id === colId) {
                        colOptions = column.options;
                        return true;
                    }
                });
                const newName = target.parentElement.dataset.name;
                transaction(protyle, [{
                    action: "removeAttrViewColOption",
                    id: colId,
                    parentID: data.id,
                    data: newName,
                }], [{
                    action: "updateAttrViewColOptions",
                    id: colId,
                    parentID: data.id,
                    data: colOptions
                }]);
                colOptions.find((item, index) => {
                    if (item.name === newName) {
                        colOptions.splice(index, 1);
                        return true;
                    }
                });
                data.rows.find(row => {
                    if (row.id === options.cellElement.parentElement.dataset.id) {
                        row.cells.find(cell => {
                            if (cell.id === options.cellElement.dataset.id) {
                                cell.value.mSelect.find((item, index) => {
                                    if (item.content === newName) {
                                        cell.value.mSelect.splice(index, 1);
                                        return true;
                                    }
                                });
                                return true;
                            }
                        });
                        return true;
                    }
                })
                menuElement.innerHTML = getSelectHTML(data, options);
                bindSelectEvent(protyle, data, menuElement, options);
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
                    return
                }
                element.parentElement.querySelector(".b3-menu__accelerator")?.remove();
                element.insertAdjacentHTML("beforeend", '<span class="b3-menu__accelerator"><svg class="svg" style="height: 30px; float: left;"><use xlink:href="#iconSelect"></use></svg></span>');
                transaction(protyle, [{
                    action: "updateAttrViewColOption",
                    id: colId,
                    parentID: data.id,
                    data: {
                        oldName: name,
                        newName: inputElement.value,
                        oldColor: color,
                        newColor: (index + 1).toString()
                    },
                }], [{
                    action: "updateAttrViewColOption",
                    id: colId,
                    parentID: data.id,
                    data: {
                        oldName: inputElement.value,
                        newName: name,
                        oldColor: (index + 1).toString(),
                        newColor: color
                    },
                }]);

                data.columns.find(column => {
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
                data.rows.find(row => {
                    if (row.id === options.cellElement.parentElement.dataset.id) {
                        row.cells.find(cell => {
                            if (cell.id === options.cellElement.dataset.id) {
                                cell.value.mSelect.find((item) => {
                                    if (item.content === name) {
                                        item.content = inputElement.value;
                                        item.color = (index + 1).toString();
                                        return true;
                                    }
                                });
                                return true;
                            }
                        });
                        return true;
                    }
                });
                name = inputElement.value;
                color = (index + 1).toString();
                menuElement.innerHTML = getSelectHTML(data, options);
                bindSelectEvent(protyle, data, menuElement, options);
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

export const bindSelectEvent = (protyle: IProtyle, data: IAV, menuElement: HTMLElement, options: {
    cellElement: HTMLElement
}) => {
    const inputElement = menuElement.querySelector("input");
    const colId = options.cellElement.dataset.colId;
    let colData: IAVColumn;
    data.columns.find((item: IAVColumn) => {
        if (item.id === colId) {
            colData = item;
            return;
        }
    });
    if (!colData.options) {
        colData.options = [];
    }
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        menuElement.lastElementChild.innerHTML = filterSelectHTML(inputElement.value, colData.options);
    });
    inputElement.addEventListener("compositionend", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        menuElement.lastElementChild.innerHTML = filterSelectHTML(inputElement.value, colData.options);
    });
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        let currentElement = upDownHint(menuElement.lastElementChild, event, "b3-menu__item--current");
        if (event.key === "Enter") {
            if (!currentElement) {
                currentElement = menuElement.querySelector(".b3-menu__item--current");
            }
            addSelectColAndCell(protyle, data, options, currentElement, menuElement);
        } else if (event.key === "Backspace" && inputElement.value === "") {
            removeSelectCell(protyle, data, options, inputElement.previousElementSibling as HTMLElement);
        }
    });
};

export const addSelectColAndCell = (protyle: IProtyle, data: IAV, options: {
    cellElement: HTMLElement
}, currentElement: HTMLElement, menuElement: HTMLElement) => {
    const rowId = options.cellElement.parentElement.dataset.id;
    const colId = options.cellElement.dataset.colId;
    const cellId = options.cellElement.dataset.id;
    let colData: IAVColumn;
    data.columns.find((item: IAVColumn) => {
        if (item.id === colId) {
            colData = item;
            return;
        }
    });
    if (!colData.options) {
        colData.options = [];
    }
    let cellData: IAVCell;
    data.rows.find(row => {
        if (row.id === rowId) {
            row.cells.find(cell => {
                if (cell.id === cellId) {
                    cellData = cell;
                    if (!cellData.value.mSelect) {
                        cellData.value.mSelect = [];
                    }
                    return true;
                }
            });
            return true;
        }
    });

    const oldValue = Object.assign([], cellData.value.mSelect);
    if (colData.type === "mSelect") {
        cellData.value.mSelect.push({
            color: currentElement.dataset.color,
            content: currentElement.dataset.name
        });
    } else {
        cellData.value.mSelect = [{
            color: currentElement.dataset.color,
            content: currentElement.dataset.name
        }];
    }

    if (currentElement.querySelector(".b3-menu__accelerator")) {
        colData.options.push({
            color: currentElement.dataset.color,
            name: currentElement.dataset.name
        });
        transaction(protyle, [{
            action: "updateAttrViewColOptions",
            id: colId,
            parentID: data.id,
            data: colData.options
        }, {
            action: "updateAttrViewCell",
            id: cellId,
            rowID: rowId,
            parentID: data.id,
            data: cellData.value
        }], [{
            action: "removeAttrViewColOption",
            id: colId,
            parentID: data.id,
            data: currentElement.dataset.name,
        }]);
    } else {
        transaction(protyle, [{
            action: "updateAttrViewCell",
            id: cellId,
            rowID: rowId,
            parentID: data.id,
            data: cellData.value
        }], [{
            action: "updateAttrViewCell",
            id: cellId,
            rowID: rowId,
            parentID: data.id,
            data: {
                [colData.type]: oldValue
            }
        }]);
    }
    if (colData.type === "select") {
        menuElement.parentElement.remove();
    }
}

export const getSelectHTML = (data: IAV, options: { cellElement: HTMLElement }) => {
    const cellId = options.cellElement.dataset.id;
    const colId = options.cellElement.dataset["colId"];
    const colData = data.columns.find(item => {
        if (item.id === colId) {
            return item;
        }
    });
    let selectedHTML = "";
    data.rows.find(row => {
        if (options.cellElement.parentElement.dataset.id === row.id) {
            row.cells.find(cell => {
                if (cell.id === cellId && cell.value) {
                    cell.value.mSelect?.forEach((item: { content: string, color: string }) => {
                        selectedHTML += `<div class="b3-chip b3-chip--middle" data-content="${item.content}" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${item.content}<svg class="b3-chip__close" data-type="removeSelectCell"><use xlink:href="#iconCloseRound"></use></svg></div>`;
                    });
                    return true;
                }
            });
            return true;
        }
    });
    return `<div class="b3-chips">
    ${selectedHTML}
    <input>
</div>
<div>${filterSelectHTML("", colData.options)}</div>`;
};
