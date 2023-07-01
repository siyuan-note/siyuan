import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {Menu} from "../../../plugin/Menu";
import {getColIconByType} from "./col";

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
    const menu = new Menu("av-header-cell", () => {
        const newValue = (window.siyuan.menus.menu.element.querySelector(".b3-text-field") as HTMLInputElement).value;
        if (newValue === cellElement.textContent.trim()) {
            return;
        }
        transaction(protyle, [{
            action: "updateAttrViewCol",
            id: cellElement.getAttribute("data-id"),
            parentID: blockElement.getAttribute("data-av-id"),
            name: newValue,
            type,
        }], [{
            action: "updateAttrViewCol",
            id: cellElement.getAttribute("data-id"),
            parentID: blockElement.getAttribute("data-av-id"),
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
                const id = cellElement.getAttribute("data-id");
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
                removeCol(cellElement);
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
};
