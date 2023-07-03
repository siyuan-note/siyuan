import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {Menu} from "../../../plugin/Menu";
import {getColIconByType} from "./col";
import {fetchPost} from "../../../util/fetch";

export const popTextCell = (protyle: IProtyle, cellElement: HTMLElement) => {
    const type = cellElement.parentElement.parentElement.firstElementChild.children[parseInt(cellElement.getAttribute("data-index")) + 1].getAttribute("data-dtype") as TAVCol;
    const cellRect = cellElement.getBoundingClientRect();
    let html = "";
    if (type === "block" || type === "text") {
        html = `<textarea style="position:absolute;left: ${cellRect.left}px;top: ${cellRect.top}px;width:${Math.max(cellRect.width, 200)}px;height: ${cellRect.height}px" class="b3-text-field">${cellElement.textContent}</textarea>`;
    }
    document.body.insertAdjacentHTML("beforeend", `<div class="av__mask">
    ${html}
</div>`);
    const avMaskElement = document.querySelector(".av__mask");
    const inputElement = avMaskElement.querySelector(".b3-text-field") as HTMLInputElement;
    if (inputElement) {
        inputElement.select();
        inputElement.focus();
        inputElement.addEventListener("blur", () => {
            updateCellValue(protyle, cellElement, type);
        });
        inputElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Escape" || event.key === "Enter") {
                updateCellValue(protyle, cellElement, type);
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }
    avMaskElement.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).classList.contains("av__mask")) {
            avMaskElement?.remove();
        }
    });
};

const updateCellValue = (protyle: IProtyle, cellElement: HTMLElement, type: TAVCol) => {
    const rowElement = hasClosestByClassName(cellElement, "av__row");
    if (!rowElement) {
        return;
    }
    const blockElement = hasClosestBlock(rowElement);
    if (!blockElement) {
        return;
    }
    const avMaskElement = document.querySelector(".av__mask");
    const inputElement = avMaskElement.querySelector(".b3-text-field") as HTMLInputElement;
    const cellId = cellElement.getAttribute("data-id");
    const avId = blockElement.getAttribute("data-av-id");
    const rowId = rowElement.getAttribute("data-id");
    transaction(protyle, [{
        action: "updateAttrViewCell",
        id: cellId,
        rowID: rowId,
        parentID: avId,
        data: {
            [type]: {content: inputElement.value}
        }
    }], [{
        action: "updateAttrViewCell",
        id: cellId,
        rowID: rowId,
        parentID: avId,
        data: {
            [type]: {content: cellElement.textContent.trim()}
        }
    }]);
    setTimeout(() => {
        avMaskElement.remove();
    });
};

const removeCol = (cellElement: HTMLElement) => {
    const index = cellElement.getAttribute("data-index");
    const blockElement = hasClosestBlock(cellElement);
    if (!blockElement) {
        return false;
    }
    blockElement.querySelectorAll(".av__row").forEach((item) => {
        item.querySelector(`[data-index="${index}"]`).remove();
    });
};

export const showHeaderCellMenu = (protyle: IProtyle, blockElement: HTMLElement, cellElement: HTMLElement) => {
    const type = cellElement.getAttribute("data-dtype") as TAVCol;
    const colId = cellElement.getAttribute("data-id");
    const avId = blockElement.getAttribute("data-av-id");
    const menu = new Menu("av-header-cell", () => {
        const newValue = (window.siyuan.menus.menu.element.querySelector(".b3-text-field") as HTMLInputElement).value;
        if (newValue === cellElement.textContent.trim()) {
            return;
        }
        transaction(protyle, [{
            action: "updateAttrViewCol",
            id: colId,
            parentID: avId,
            name: newValue,
            type,
        }], [{
            action: "updateAttrViewCol",
            id: colId,
            parentID: avId,
            name: cellElement.textContent.trim(),
            type,
        }]);
    });
    menu.addItem({
        icon: getColIconByType(type),
        label: `<input style="margin: 4px 0" class="b3-text-field" type="text" value="${cellElement.innerText.trim()}">`,
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
            fetchPost("/api/av/renderAttributeView", {id: avId}, (response) => {
                transaction(protyle, [{
                    action: "setAttrView",
                    id: avId,
                    data: {
                        sorts: [{
                            column: colId,
                            order: "ASC"
                        }]
                    }
                }], [{
                    action: "setAttrView",
                    id: avId,
                    data: {
                        sorts: response.data.av.sorts
                    }
                }]);
            });
        }
    });
    menu.addItem({
        icon: "iconDown",
        label: window.siyuan.languages.fileNameNatDESC,
        click() {
            fetchPost("/api/av/renderAttributeView", {id: avId}, (response) => {
                transaction(protyle, [{
                    action: "setAttrView",
                    id: avId,
                    data: {
                        sorts: [{
                            column: colId,
                            order: "DESC"
                        }]
                    }
                }], [{
                    action: "setAttrView",
                    id: avId,
                    data: {
                        sorts: response.data.av.sorts
                    }
                }]);
            });
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
                transaction(protyle, [{
                    action: "setAttrViewColHidden",
                    id: colId,
                    parentID: avId,
                    data: true
                }], [{
                    action: "setAttrViewColHidden",
                    id: colId,
                    parentID: avId,
                    data: false
                }]);
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
                transaction(protyle, [{
                    action: "removeAttrViewCol",
                    id: colId,
                    parentID: avId,
                }], [{
                    action: "addAttrViewCol",
                    name: cellElement.textContent.trim(),
                    parentID: avId,
                    type: type,
                    id: colId
                }]);
                removeCol(cellElement);
            }
        });
        menu.addSeparator();
    }
    menu.addItem({
        label: `<div class="fn__flex" style="margin: 4px 0"><span>${window.siyuan.languages.wrap}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch fn__flex-center"${cellElement.style.whiteSpace === "nowrap" ? "" : " checked"}></div>`,
        bind(element) {
            const inputElement = element.querySelector("input") as HTMLInputElement;
            inputElement.addEventListener("change", () => {
                transaction(protyle, [{
                    action: "setAttrViewColWrap",
                    id: colId,
                    parentID: avId,
                    data: inputElement.checked
                }], [{
                    action: "setAttrViewColWrap",
                    id: colId,
                    parentID: avId,
                    data: !inputElement.checked
                }]);
            });
        }
    });
    const cellRect = cellElement.getBoundingClientRect();
    menu.open({
        x: cellRect.left,
        y: cellRect.bottom,
        h: cellRect.height
    });
    const inputElement = window.siyuan.menus.menu.element.querySelector(".b3-text-field") as HTMLInputElement;
    if (inputElement) {
        inputElement.select();
        inputElement.focus();
    }
};
