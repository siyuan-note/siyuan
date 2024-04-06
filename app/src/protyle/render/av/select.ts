import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {upDownHint} from "../../../util/upDownHint";
import {bindEditEvent, getEditHTML} from "./col";
import {updateAttrViewCellAnimation} from "./action";
import {genAVValueHTML} from "./blockAttr";
import {escapeAttr} from "../../../util/escape";
import {genCellValueByElement, getTypeByCellElement} from "./cell";

const filterSelectHTML = (key: string, options: { name: string, color: string }[], selected: string[] = []) => {
    let html = "";
    let hasMatch = false;
    if (selected.length === 0) {
        document.querySelectorAll(".av__panel .b3-chips .b3-chip").forEach((item: HTMLElement) => {
            selected.push(item.dataset.content);
        });
    }
    const checkedName = document.querySelector('.av__panel .b3-menu__item--current[data-type="addColOptionOrCell"]')?.getAttribute("data-name") || "";
    if (options) {
        options.forEach(item => {
            if (!key ||
                (key.toLowerCase().indexOf(item.name.toLowerCase()) > -1 ||
                    item.name.toLowerCase().indexOf(key.toLowerCase()) > -1)) {
                html += `<button data-type="addColOptionOrCell" class="b3-menu__item${checkedName === item.name ? " b3-menu__item--current" : ""}" data-name="${item.name}" draggable="true" data-color="${item.color}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">
        <span class="b3-chip" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">
            <span class="fn__ellipsis">${item.name}</span>
        </span>
    </div>
    <svg class="b3-menu__action" data-type="setColOption"><use xlink:href="#iconEdit"></use></svg>
    ${selected.includes(item.name) ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg></span>' : ""}
</button>`;
            }
            if (key === item.name) {
                hasMatch = true;
            }
        });
    }
    if (!hasMatch && key) {
        html = html.replace('class="b3-menu__item b3-menu__item--current"', 'class="b3-menu__item"');
        const colorIndex = (options?.length || 0) % 13 + 1;
        html = `<button data-type="addColOptionOrCell" class="b3-menu__item b3-menu__item--current" data-name="${key}" data-color="${colorIndex}">
<svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
<div class="fn__flex-1">
    <span class="b3-chip" style="background-color:var(--b3-font-background${colorIndex});color:var(--b3-font-color${colorIndex})">
        <span class="fn__ellipsis">${key}</span>
    </span>
</div>
<span class="b3-menu__accelerator">Enter</span>
</button>${html}`;
    } else if (html.indexOf("b3-menu__item--current") === -1) {
        if (key) {
            html = html.replace(`class="b3-menu__item" data-name="${key}"`, `class="b3-menu__item b3-menu__item--current" data-name="${key}"`);
        } else {
            html = html.replace('class="b3-menu__item"', 'class="b3-menu__item b3-menu__item--current"');
        }
    }
    return html;
};

export const removeCellOption = (protyle: IProtyle, data: IAV, cellElements: HTMLElement[], target: HTMLElement, blockElement: Element) => {
    if (!target) {
        return;
    }
    const colId = cellElements[0].dataset.colId;
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    let mSelectValue: IAVCellSelectValue[];
    cellElements.forEach((item, elementIndex) => {
        if (!blockElement.contains(item)) {
            item = cellElements[elementIndex] = blockElement.querySelector(`.av__cell[data-id="${item.dataset.id}"]`) as HTMLElement;
        }
        const rowID = (hasClosestByClassName(item, "av__row") as HTMLElement).dataset.id;
        const cellValue = genCellValueByElement(getTypeByCellElement(item) || item.dataset.type as TAVCol, item);
        const oldValue = JSON.parse(JSON.stringify(cellValue));
        if (elementIndex === 0) {
            cellValue.mSelect?.find((item, index) => {
                if (item.content === target.dataset.content) {
                    cellValue.mSelect.splice(index, 1);
                    return true;
                }
            });
            mSelectValue = cellValue.mSelect;
        } else {
            cellValue.mSelect = mSelectValue;
        }
        doOperations.push({
            action: "updateAttrViewCell",
            id: cellValue.id,
            keyID: colId,
            rowID,
            avID: data.id,
            data: cellValue
        });
        undoOperations.push({
            action: "updateAttrViewCell",
            id: cellValue.id,
            keyID: colId,
            rowID,
            avID: data.id,
            data: oldValue
        });
        data.view.rows.find(row => {
            if (row.id === rowID) {
                row.cells.find(cell => {
                    if (cell.id === cellValue.id) {
                        cell.value = cellValue;
                        return true;
                    }
                });
                return true;
            }
        });
        if (item.classList.contains("custom-attr__avvalue")) {
            item.innerHTML = genAVValueHTML(cellValue);
        } else {
            updateAttrViewCellAnimation(item, cellValue);
        }
    });
    transaction(protyle, doOperations, undoOperations);
    Array.from(document.querySelectorAll(".av__panel .b3-menu__item")).find((item: HTMLElement) => {
        if (item.dataset.name === target.dataset.content) {
            item.querySelector(".b3-menu__checked")?.remove();
            return true;
        }
    });
    target.remove();
};

export const setColOption = (protyle: IProtyle, data: IAV, target: HTMLElement, blockElement: Element, isCustomAttr: boolean, cellElements?: HTMLElement[]) => {
    const menuElement = hasClosestByClassName(target, "b3-menu");
    if (!menuElement) {
        return;
    }
    const colId = cellElements ? cellElements[0].dataset.colId : menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
    let name = target.parentElement.dataset.name;
    let color = target.parentElement.dataset.color;
    const menu = new Menu("av-col-option", () => {
        if (name === inputElement.value || !inputElement.value) {
            return;
        }
        let hasName = false;
        data.view.columns.find(column => {
            if (column.id === colId) {
                column.options.find((item) => {
                    if (item.name === inputElement.value) {
                        hasName = true;
                        return true;
                    }
                });
                return true;
            }
        });
        if (hasName) {
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
            menuElement.innerHTML = getEditHTML({protyle, data, colId, isCustomAttr});
            bindEditEvent({protyle, data, menuElement, isCustomAttr});
        } else {
            cellElements.forEach((cellElement: HTMLMediaElement) => {
                data.view.rows.find(row => {
                    if (row.id === (hasClosestByClassName(cellElement, "av__row") as HTMLElement).dataset.id) {
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
                                    updateAttrViewCellAnimation(cellElement, cell.value);
                                }
                                return true;
                            }
                        });
                        return true;
                    }
                });
            });
            menuElement.innerHTML = getSelectHTML(data.view, cellElements);
            bindSelectEvent(protyle, data, menuElement, cellElements, blockElement);
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
                    menuElement.innerHTML = getEditHTML({protyle, data, colId, isCustomAttr});
                    bindEditEvent({protyle, data, menuElement, isCustomAttr});
                } else {
                    cellElements.forEach((cellElement: HTMLElement) => {
                        data.view.rows.find(row => {
                            if (row.id === (hasClosestByClassName(cellElement, "av__row") as HTMLElement).dataset.id) {
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
                                            updateAttrViewCellAnimation(cellElement, cell.value);
                                        }
                                        return true;
                                    }
                                });
                                return true;
                            }
                        });
                    });
                    menuElement.innerHTML = getSelectHTML(data.view, cellElements);
                    bindSelectEvent(protyle, data, menuElement, cellElements, blockElement);
                }
            });
        }
    });
    menu.addSeparator();
    Array.from(Array(13).keys()).forEach(index => {
        menu.addItem({
            checked: parseInt(color) === index + 1,
            iconHTML: "",
            label: `<span class="color__square"  style="padding: 5px;margin: 2px;color: var(--b3-font-color${index + 1});background-color: var(--b3-font-background${index + 1});">A</span>`,
            click(element) {
                if (element.lastElementChild.classList.contains("b3-menu__checked")) {
                    return;
                }
                element.parentElement.querySelector(".b3-menu__checked")?.remove();
                element.insertAdjacentHTML("beforeend", '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg></span>');
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
                    menuElement.innerHTML = getEditHTML({protyle, data, colId, isCustomAttr});
                    bindEditEvent({protyle, data, menuElement, isCustomAttr});
                } else {
                    cellElements.forEach((cellElement: HTMLElement) => {
                        data.view.rows.find(row => {
                            if (row.id === (hasClosestByClassName(cellElement, "av__row") as HTMLElement).dataset.id) {
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
                                            updateAttrViewCellAnimation(cellElement, cell.value);
                                        }
                                        return true;
                                    }
                                });
                                return true;
                            }
                        });
                    });
                    menuElement.innerHTML = getSelectHTML(data.view, cellElements);
                    bindSelectEvent(protyle, data, menuElement, cellElements, blockElement);
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

export const bindSelectEvent = (protyle: IProtyle, data: IAV, menuElement: HTMLElement, cellElements: HTMLElement[], blockElement: Element) => {
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
            if (currentElement.querySelector(".b3-menu__checked")) {
                removeCellOption(protyle, data, cellElements, menuElement.querySelector(`.b3-chips .b3-chip[data-content="${escapeAttr(currentElement.dataset.name)}"]`), blockElement);
            } else {
                addColOptionOrCell(protyle, data, cellElements, currentElement, menuElement, blockElement);
            }
        } else if (event.key === "Backspace" && inputElement.value === "") {
            removeCellOption(protyle, data, cellElements, inputElement.previousElementSibling as HTMLElement, blockElement);
        }
    });
};

export const addColOptionOrCell = (protyle: IProtyle, data: IAV, cellElements: HTMLElement[], currentElement: HTMLElement, menuElement: HTMLElement, blockElement: Element) => {
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

    const nodeElement = hasClosestBlock(cellElements[0]);
    if (!nodeElement) {
        cellElements.forEach((item, index) => {
            const rowElement = hasClosestByClassName(item, "av__row");
            if (rowElement) {
                cellElements[index] = blockElement.querySelector(`.av__row[data-id="${rowElement.dataset.id}"] .av__cell[data-col-id="${item.dataset.colId}"]`) as HTMLElement;
            }
        });
    }
    const colId = cellElements[0].dataset.colId;
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
    let mSelectValue: IAVCellSelectValue[];
    cellElements.forEach((item, index) => {
        const itemRowElement = hasClosestByClassName(item, "av__row");
        if (!itemRowElement) {
            return;
        }
        const cellValue = genCellValueByElement(colData.type, item);
        const oldValue = JSON.parse(JSON.stringify(cellValue));
        if (index === 0) {
            if (colData.type === "mSelect") {
                let hasOption = false;
                cellValue.mSelect.find((item) => {
                    if (item.content === currentElement.dataset.name) {
                        hasOption = true;
                        return true;
                    }
                });
                if (!hasOption) {
                    cellValue.mSelect.push({
                        color: currentElement.dataset.color,
                        content: currentElement.dataset.name
                    });
                }
            } else {
                cellValue.mSelect = [{
                    color: currentElement.dataset.color,
                    content: currentElement.dataset.name
                }];
            }
            mSelectValue = cellValue.mSelect;
        } else {
            cellValue.mSelect = mSelectValue;
        }
        const rowID = itemRowElement.dataset.id;
        cellDoOperations.push({
            action: "updateAttrViewCell",
            id: cellValue.id,
            keyID: colId,
            rowID,
            avID: data.id,
            data: cellValue
        });
        cellUndoOperations.push({
            action: "updateAttrViewCell",
            id: cellValue.id,
            keyID: colId,
            rowID,
            avID: data.id,
            data: oldValue
        });
        data.view.rows.find(row => {
            if (row.id === rowID) {
                row.cells.find(cell => {
                    if (cell.id === cellValue.id) {
                        cell.value = cellValue;
                        return true;
                    }
                });
                return true;
            }
        });
        if (item.classList.contains("custom-attr__avvalue")) {
            item.innerHTML = genAVValueHTML(cellValue);
        } else {
            updateAttrViewCellAnimation(item, cellValue);
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
        bindSelectEvent(protyle, data, menuElement, cellElements, blockElement);
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

    let selectedHTML = "";
    const selected: string[] = [];
    genCellValueByElement(colData.type, cellElements[0]).mSelect?.forEach((item) => {
        selected.push(item.content);
        selectedHTML += `<div class="b3-chip b3-chip--middle" data-content="${escapeAttr(item.content)}" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${item.content}<svg class="b3-chip__close" data-type="removeCellOption"><use xlink:href="#iconCloseRound"></use></svg></div>`;
    });

    return `<div class="b3-menu__items">
<div class="b3-chips">
    ${selectedHTML}
    <input>
</div>
<div>${filterSelectHTML("", colData.options, selected)}</div>
</div>`;
};
