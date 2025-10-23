import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {upDownHint} from "../../../util/upDownHint";
import {bindEditEvent, getColId, getEditHTML} from "./col";
import {updateAttrViewCellAnimation} from "./action";
import {genAVValueHTML, isCustomAttr} from "./blockAttr";
import {escapeAriaLabel, escapeAttr, escapeHtml} from "../../../util/escape";
import {genCellValueByElement, getTypeByCellElement} from "./cell";
import * as dayjs from "dayjs";
import {getFieldsByData} from "./view";
import {getFieldIdByCellElement} from "./row";
import {Constants} from "../../../constants";

let cellValues: IAVCellValue[];

const filterSelectHTML = (key: string, options: {
    name: string,
    color: string,
    desc?: string
}[], selected: string[] = []) => {
    let html = "";
    let hasMatch = false;
    if (selected.length === 0) {
        document.querySelectorAll(".av__panel .b3-chips .b3-chip").forEach((item: HTMLElement) => {
            selected.push(item.dataset.content);
        });
    }
    if (options) {
        const currentName = document.querySelector(".av__panel .b3-menu__item--current")?.getAttribute("data-name") || "";
        options.forEach(item => {
            if (!key ||
                (key.toLowerCase().indexOf(item.name.toLowerCase()) > -1 ||
                    item.name.toLowerCase().indexOf(key.toLowerCase()) > -1)) {
                const airaLabel = item.desc ? `${escapeAriaLabel(item.name)}<div class='ft__on-surface'>${escapeAriaLabel(item.desc || "")}</div>` : "";
                html += `<button data-type="addColOptionOrCell" class="b3-menu__item${currentName === item.name ? " b3-menu__item--current" : ""}" data-name="${escapeAttr(item.name)}" data-desc="${escapeAttr(item.desc || "")}" draggable="true" data-color="${item.color}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1 ariaLabel" data-position="parentW" aria-label="${airaLabel}">
        <span class="b3-chip" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">
            <span class="fn__ellipsis">${escapeHtml(item.name)}</span>
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
        const colorIndex = (options?.length || 0) % 14 + 1;
        html = `<button data-type="addColOptionOrCell" class="b3-menu__item b3-menu__item--current" data-name="${key}" data-color="${colorIndex}">
<svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
<div class="fn__flex-1">
    <span class="b3-chip" style="background-color:var(--b3-font-background${colorIndex});color:var(--b3-font-color${colorIndex})">
        <span class="fn__ellipsis">${escapeHtml(key)}</span>
    </span>
</div>
<span class="b3-menu__accelerator b3-menu__accelerator--hotkey">${window.siyuan.languages.enterKey}</span>
</button>${html}`;
    } else if (html.indexOf("b3-menu__item--current") === -1) {
        html = html.replace('class="b3-menu__item"', 'class="b3-menu__item b3-menu__item--current"');
    }
    return html;
};

export const removeCellOption = (protyle: IProtyle, cellElements: HTMLElement[], target: HTMLElement, blockElement: Element) => {
    if (!target) {
        return;
    }
    const viewType = blockElement.getAttribute("data-av-type") as TAVView;
    const colId = getColId(cellElements[0], viewType);
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    let mSelectValue: IAVCellSelectValue[];
    const avID = blockElement.getAttribute("data-av-id");
    cellElements.forEach((item, elementIndex) => {
        const rowID = getFieldIdByCellElement(item, viewType);
        if (!rowID) {
            return;
        }
        if (!blockElement.contains(item)) {
            if (viewType === "table") {
                item = cellElements[elementIndex] = (blockElement.querySelector(`.av__row[data-id="${rowID}"] .av__cell[data-col-id="${item.dataset.colId}"]`) ||
                    blockElement.querySelector(`.fn__flex-1[data-col-id="${item.dataset.colId}"]`)) as HTMLElement;
            } else {
                item = cellElements[elementIndex] = (blockElement.querySelector(`.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${item.dataset.fieldId}"]`)) as HTMLElement;
            }
        }
        const cellValue: IAVCellValue = cellValues[elementIndex];
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
            avID,
            data: cellValue
        });
        undoOperations.push({
            action: "updateAttrViewCell",
            id: cellValue.id,
            keyID: colId,
            rowID,
            avID,
            data: oldValue
        });
        if (item.classList.contains("custom-attr__avvalue")) {
            item.innerHTML = genAVValueHTML(cellValue);
        } else {
            updateAttrViewCellAnimation(item, cellValue);
        }
    });
    doOperations.push({
        action: "doUpdateUpdated",
        id: blockElement.getAttribute("data-node-id"),
        data: dayjs().format("YYYYMMDDHHmmss"),
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
    const blockID = blockElement.getAttribute("data-node-id");
    const viewType = blockElement.getAttribute("data-av-type") as TAVView;
    const colId = (cellElements && cellElements[0]) ? getColId(cellElements[0], viewType) : menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
    let name = target.parentElement.dataset.name;
    let desc = target.parentElement.dataset.desc;
    let color = target.parentElement.dataset.color;
    const fields = getFieldsByData(data);
    const menu = new Menu(Constants.MENU_AV_COL_OPTION, () => {
        if ((name === inputElement.value && desc === descElement.value) || !inputElement.value) {
            return;
        }
        // cell 不判断重名 https://github.com/siyuan-note/siyuan/issues/11484
        transaction(protyle, [{
            action: "updateAttrViewColOption",
            id: colId,
            avID: data.id,
            data: {
                newColor: color,
                oldName: name,
                newName: inputElement.value,
                newDesc: descElement.value
            },
        }, {
            action: "doUpdateUpdated",
            id: blockID,
            data: dayjs().format("YYYYMMDDHHmmss"),
        }], [{
            action: "updateAttrViewColOption",
            id: colId,
            avID: data.id,
            data: {
                newColor: color,
                oldName: inputElement.value,
                newName: name,
                newDesc: desc
            },
        }]);
        fields.find(column => {
            if (column.id === colId) {
                // 重名不进行更新 https://github.com/siyuan-note/siyuan/issues/13554
                const sameItem = column.options.find((item) => {
                    if (item.name === inputElement.value && item.desc === descElement.value) {
                        return true;
                    }
                });
                if (!sameItem) {
                    column.options.find((item) => {
                        if (item.name === name) {
                            item.name = inputElement.value;
                            item.desc = descElement.value;
                            return true;
                        }
                    });
                }
                return true;
            }
        });
        const oldScroll = menuElement.querySelector(".b3-menu__items").scrollTop;
        const selectedElement = menuElement.querySelector(".b3-chips");
        const oldChipsHeight = selectedElement ? selectedElement.clientHeight : 0;
        if (!cellElements) {
            menuElement.innerHTML = getEditHTML({protyle, data, colId, isCustomAttr});
            bindEditEvent({protyle, data, menuElement, isCustomAttr, blockID});
        } else {
            cellElements.forEach((cellElement: HTMLElement, index) => {
                const rowID = getFieldIdByCellElement(cellElement, viewType);
                if (viewType === "table" || isCustomAttr) {
                    cellElement = cellElements[index] = (blockElement.querySelector(`.av__row[data-id="${rowID}"] .av__cell[data-col-id="${cellElement.dataset.colId}"]`) ||
                        blockElement.querySelector(`.fn__flex-1[data-col-id="${cellElement.dataset.colId}"]`)) as HTMLElement;
                } else {
                    cellElement = cellElements[index] = (blockElement.querySelector(`.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${cellElement.dataset.fieldId}"]`)) as HTMLElement;
                }

                cellValues[index].mSelect.find((item) => {
                    if (item.content === name) {
                        item.content = inputElement.value;
                        return true;
                    }
                });
                if (cellElement.classList.contains("custom-attr__avvalue")) {
                    cellElement.innerHTML = genAVValueHTML(cellValues[index]);
                } else {
                    updateAttrViewCellAnimation(cellElement, cellValues[index]);
                }
            });
            menuElement.innerHTML = getSelectHTML(fields, cellElements, false, blockElement);
            bindSelectEvent(protyle, data, menuElement, cellElements, blockElement);
        }
        if (selectedElement) {
            menuElement.querySelector(".b3-menu__items").scrollTop = oldScroll + (menuElement.querySelector(".b3-chips").clientHeight - oldChipsHeight);
        }
    });
    if (menu.isOpen) {
        return;
    }
    menu.addItem({
        iconHTML: "",
        type: "empty",
        label: `<div class="fn__hr"></div>
<div class="b3-form__icona fn__block">
    <input class="b3-text-field b3-form__icona-input" type="text" size="16">
    <svg data-position="north" class="b3-form__icona-icon ariaLabel" aria-label="${desc ? escapeAriaLabel(desc) : window.siyuan.languages.addDesc}"><use xlink:href="#iconInfo"></use></svg>
</div>
<div class="fn__none">
    <div class="fn__hr"></div>
    <textarea rows="1" placeholder="${window.siyuan.languages.addDesc}" class="b3-text-field fn__block" type="text" data-value="${escapeAttr(desc)}">${desc}</textarea>
</div>
<div class="fn__hr--small"></div>`,
        bind(element) {
            const inputElement = element.querySelector("input");
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                if (event.key === "Enter") {
                    menu.close();
                }
            });
            inputElement.value = name;
            const descElement = element.querySelector("textarea");
            inputElement.nextElementSibling.addEventListener("click", () => {
                const descPanelElement = descElement.parentElement;
                descPanelElement.classList.toggle("fn__none");
                if (!descPanelElement.classList.contains("fn__none")) {
                    descElement.focus();
                }
            });
            descElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                if (event.key === "Enter") {
                    menu.close();
                }
            });
            descElement.addEventListener("input", () => {
                inputElement.nextElementSibling.setAttribute("aria-label", descElement.value ? escapeHtml(descElement.value) : window.siyuan.languages.addDesc);
            });
        }
    });
    menu.addItem({
        id: "delete",
        label: window.siyuan.languages.delete,
        icon: "iconTrashcan",
        click() {
            confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.confirmDelete, () => {
                let colOptions: { name: string, color: string }[] = [];
                fields.find(column => {
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
                }, {
                    action: "doUpdateUpdated",
                    id: blockID,
                    data: dayjs().format("YYYYMMDDHHmmss"),
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
                const oldScroll = menuElement.querySelector(".b3-menu__items").scrollTop;
                const selectedElement = menuElement.querySelector(".b3-chips");
                const oldChipsHeight = selectedElement ? selectedElement.clientHeight : 0;
                if (!cellElements) {
                    menuElement.innerHTML = getEditHTML({protyle, data, colId, isCustomAttr});
                    bindEditEvent({protyle, data, menuElement, isCustomAttr, blockID});
                } else {
                    cellElements.forEach((cellElement: HTMLElement, index) => {
                        const rowID = getFieldIdByCellElement(cellElement, viewType);
                        if (viewType === "table" || isCustomAttr) {
                            cellElement = cellElements[index] = (blockElement.querySelector(`.av__row[data-id="${rowID}"] .av__cell[data-col-id="${cellElement.dataset.colId}"]`) ||
                                blockElement.querySelector(`.fn__flex-1[data-col-id="${cellElement.dataset.colId}"]`)) as HTMLElement;
                        } else {
                            cellElement = cellElements[index] = (blockElement.querySelector(`.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${cellElement.dataset.fieldId}"]`)) as HTMLElement;
                        }
                        cellValues[index].mSelect.find((item, selectIndex) => {
                            if (item.content === newName) {
                                cellValues[index].mSelect.splice(selectIndex, 1);
                                return true;
                            }
                        });
                        if (cellElement.classList.contains("custom-attr__avvalue")) {
                            cellElement.innerHTML = genAVValueHTML(cellValues[index]);
                        } else {
                            updateAttrViewCellAnimation(cellElement, cellValues[index]);
                        }
                    });
                    menuElement.innerHTML = getSelectHTML(fields, cellElements, false, blockElement);
                    bindSelectEvent(protyle, data, menuElement, cellElements, blockElement);
                }
                if (selectedElement) {
                    menuElement.querySelector(".b3-menu__items").scrollTop = oldScroll + (menuElement.querySelector(".b3-chips").clientHeight - oldChipsHeight);
                }
            }, undefined, true);
        }
    });
    menu.addSeparator();
    let html = "<div class=\"fn__flex fn__flex-wrap\" style=\"width: 238px\">";
    Array.from(Array(14).keys()).forEach(index => {
        html += `<button data-color="${index + 1}" class="color__square${parseInt(color) === index + 1 ? " color__square--current" : ""}" style="color: var(--b3-font-color${index + 1});background-color: var(--b3-font-background${index + 1});">A</button>`;
    });
    menu.addItem({
        type: "empty",
        iconHTML: "",
        label: html + "</div>",
        bind(element) {
            element.addEventListener("click", (event) => {
                const colorTarget = event.target as HTMLElement;
                if (colorTarget.classList.contains("color__square") && !colorTarget.classList.contains("color__square--current")) {
                    element.querySelector(".color__square--current")?.classList.remove("color__square--current");
                    colorTarget.classList.add("color__square--current");
                    const newColor = colorTarget.getAttribute("data-color");
                    transaction(protyle, [{
                        action: "updateAttrViewColOption",
                        id: colId,
                        avID: data.id,
                        data: {
                            oldName: name,
                            newName: inputElement.value,
                            oldColor: color,
                            newColor,
                            newDesc: descElement.value
                        },
                    }, {
                        action: "doUpdateUpdated",
                        id: blockID,
                        data: dayjs().format("YYYYMMDDHHmmss"),
                    }], [{
                        action: "updateAttrViewColOption",
                        id: colId,
                        avID: data.id,
                        data: {
                            oldName: inputElement.value,
                            newName: name,
                            oldColor: newColor,
                            newColor: color,
                            newDesc: descElement.value
                        },
                    }]);

                    fields.find(column => {
                        if (column.id === colId) {
                            column.options.find((item) => {
                                if (item.name === name) {
                                    item.name = inputElement.value;
                                    item.color = newColor;
                                    return true;
                                }
                            });
                            return true;
                        }
                    });
                    const oldScroll = menuElement.querySelector(".b3-menu__items").scrollTop;
                    if (!cellElements) {
                        menuElement.innerHTML = getEditHTML({protyle, data, colId, isCustomAttr});
                        bindEditEvent({protyle, data, menuElement, isCustomAttr, blockID});
                    } else {
                        cellElements.forEach((cellElement: HTMLElement, cellIndex) => {
                            const rowID = getFieldIdByCellElement(cellElement, viewType);
                            if (viewType === "table") {
                                cellElement = cellElements[cellIndex] = (blockElement.querySelector(`.av__row[data-id="${rowID}"] .av__cell[data-col-id="${cellElement.dataset.colId}"]`) ||
                                    blockElement.querySelector(`.fn__flex-1[data-col-id="${cellElement.dataset.colId}"]`)) as HTMLElement;
                            } else {
                                cellElement = cellElements[cellIndex] = (blockElement.querySelector(`.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${cellElement.dataset.fieldId}"]`)) as HTMLElement;
                            }
                            cellValues[cellIndex].mSelect.find((item) => {
                                if (item.content === name) {
                                    item.content = inputElement.value;
                                    item.color = newColor;
                                    return true;
                                }
                            });
                            if (cellElement.classList.contains("custom-attr__avvalue")) {
                                cellElement.innerHTML = genAVValueHTML(cellValues[cellIndex]);
                            } else {
                                updateAttrViewCellAnimation(cellElement, cellValues[cellIndex]);
                            }
                        });
                        menuElement.innerHTML = getSelectHTML(fields, cellElements, false, blockElement);
                        bindSelectEvent(protyle, data, menuElement, cellElements, blockElement);
                    }
                    menuElement.querySelector(".b3-menu__items").scrollTop = oldScroll;
                    name = inputElement.value;
                    desc = descElement.value;
                    color = newColor;
                }
            });
        }
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
    const descElement = window.siyuan.menus.menu.element.querySelector("textarea");
};

export const bindSelectEvent = (protyle: IProtyle, data: IAV, menuElement: HTMLElement, cellElements: HTMLElement[], blockElement: Element) => {
    const inputElement = menuElement.querySelector("input");
    const colId = getColId(cellElements[0], blockElement.getAttribute("data-av-type") as TAVView);
    let colData: IAVColumn;
    getFieldsByData(data).find((item: IAVColumn) => {
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
    inputElement.addEventListener("compositionend", () => {
        listElement.innerHTML = filterSelectHTML(inputElement.value, colData.options);
    });
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        let currentElement = upDownHint(listElement, event, "b3-menu__item--current", listElement.firstElementChild);
        if (event.key === "Enter") {
            if (!currentElement) {
                currentElement = menuElement.querySelector(".b3-menu__item--current");
            }
            if (currentElement.querySelector(".b3-menu__checked")) {
                removeCellOption(protyle, cellElements, menuElement.querySelector(`.b3-chips .b3-chip[data-content="${escapeAttr(currentElement.dataset.name)}"]`), blockElement);
            } else {
                addColOptionOrCell(protyle, data, cellElements, currentElement, menuElement, blockElement);
            }
        } else if (event.key === "Backspace" && inputElement.value === "") {
            removeCellOption(protyle, cellElements, inputElement.previousElementSibling as HTMLElement, blockElement);
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
            const rowID = getFieldIdByCellElement(item, data.viewType);
            if (data.viewType === "table" || isCustomAttr(item)) {
                cellElements[index] = (blockElement.querySelector(`.av__row[data-id="${rowID}"] .av__cell[data-col-id="${item.dataset.colId}"]`) ||
                    blockElement.querySelector(`.fn__flex-1[data-col-id="${item.dataset.colId}"]`)) as HTMLElement;
            } else {
                cellElements[index] = (blockElement.querySelector(`.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${item.dataset.fieldId}"]`)) as HTMLElement;
            }
        });
    }
    const colId = getColId(cellElements[0], blockElement.getAttribute("data-av-type") as TAVView);
    let colData: IAVColumn;
    const fields = getFieldsByData(data);
    fields.find((item: IAVColumn) => {
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
        const rowID = getFieldIdByCellElement(item, data.viewType);
        if (!rowID) {
            return;
        }
        const cellValue: IAVCellValue = cellValues[index];
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
        cellDoOperations.push({
            action: "doUpdateUpdated",
            id: blockElement.getAttribute("data-node-id"),
            data: dayjs().format("YYYYMMDDHHmmss"),
        });
        transaction(protyle, cellDoOperations, [{
            action: "removeAttrViewColOption",
            id: colId,
            avID: data.id,
            data: currentElement.dataset.name,
        }]);
    } else {
        cellDoOperations.push({
            action: "doUpdateUpdated",
            id: blockElement.getAttribute("data-node-id"),
            data: dayjs().format("YYYYMMDDHHmmss"),
        });
        transaction(protyle, cellDoOperations, cellUndoOperations);
    }
    if (colData.type === "select") {
        blockElement.setAttribute("data-rendering", "true");
        menuElement.parentElement.dispatchEvent(new CustomEvent("click", {detail: "close"}));
    } else {
        const oldScroll = menuElement.querySelector(".b3-menu__items").scrollTop;
        const oldChipsHeight = menuElement.querySelector(".b3-chips").clientHeight;
        menuElement.innerHTML = getSelectHTML(fields, cellElements, false, blockElement);
        bindSelectEvent(protyle, data, menuElement, cellElements, blockElement);
        menuElement.querySelector("input").focus();
        menuElement.querySelector(".b3-menu__items").scrollTop = oldScroll + (menuElement.querySelector(".b3-chips").clientHeight - oldChipsHeight);
    }
};

export const getSelectHTML = (fields: IAVColumn[], cellElements: HTMLElement[], init = false, blockElement: Element) => {
    if (init) {
        // 快速选中后如果 render 了再使用 genCellValueByElement 获取的元素和当前选中的不一致， https://github.com/siyuan-note/siyuan/issues/11268
        cellValues = [];
        const isCustomAttr = cellElements[0].classList.contains("custom-attr__avvalue");
        cellElements.forEach(item => {
            cellValues.push(genCellValueByElement(isCustomAttr ? item.dataset.type as TAVCol : getTypeByCellElement(item), item));
        });
    }
    const colId = getColId(cellElements[0], blockElement.getAttribute("data-av-type") as TAVView);
    const colData = fields.find(item => {
        if (item.id === colId) {
            return item;
        }
    });
    let selectedHTML = "";
    const selected: string[] = [];
    cellValues[0].mSelect?.forEach((item) => {
        selected.push(item.content);
        selectedHTML += `<div class="b3-chip b3-chip--middle" data-content="${escapeAttr(item.content)}" style="white-space: nowrap;max-width:100%;background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})"><span class="fn__ellipsis">${escapeHtml(item.content)}</span><svg class="b3-chip__close" data-type="removeCellOption"><use xlink:href="#iconCloseRound"></use></svg></div>`;
    });

    return `<div class="b3-menu__items">
<div class="b3-chips" style="max-width: 50vw">
    ${selectedHTML}
    <input>
</div>
<div>${filterSelectHTML("", colData.options, selected)}</div>
</div>`;
};

export const mergeAddOption = (column: IAVColumn, cellValue: IAVCellValue, avID: string) => {
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    cellValue.mSelect.forEach((item: IAVCellSelectValue) => {
        if (!column.options) {
            column.options = [];
        }
        const needAdd = column.options.find((option: {
            name: string,
            color: string,
        }) => {
            if (option.name === item.content) {
                item.color = option.color;
                return true;
            }
        });
        if (!needAdd) {
            const newColor = ((column.options?.length || 0) % 14 + 1).toString();
            column.options.push({
                name: item.content,
                color: newColor
            });
            item.color = newColor;
            doOperations.push({
                action: "updateAttrViewColOptions",
                id: column.id,
                avID,
                data: column.options
            });
            undoOperations.push({
                action: "removeAttrViewColOption",
                id: column.id,
                avID,
                data: item.content,
            });
        }
    });
    return {
        doOperations,
        undoOperations
    };
};
