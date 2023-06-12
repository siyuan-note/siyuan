import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock} from "../../util/hasClosest";
import {Menu} from "../../../plugin/Menu";
import {getColIconByType} from "./col";

export const popTextCell = (protyle: IProtyle, cellElement: HTMLElement) => {
    const type = cellElement.parentElement.parentElement.firstElementChild.children[parseInt(cellElement.getAttribute("data-index")) + 1].getAttribute("data-dtype") as TAVCol;
    const cellRect = cellElement.getBoundingClientRect();
    let html = "";
    if (type === "block" || type === "text") {
        html = `<textarea style="position:absolute;left: ${cellRect.left}px;top: ${cellRect.top}px;width:${Math.max(cellRect.width, 200)}px" class="b3-text-field">${cellElement.textContent}</textarea>`;
    }
    document.body.insertAdjacentHTML("beforeend", `<div class="av__mask">
    ${html}
</div>`);
    const avMaskElement = document.querySelector(".av__mask");
    const inputElement = avMaskElement.querySelector(".b3-text-field") as HTMLInputElement;
    if (inputElement) {
        inputElement.select();
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
    const avMaskElement = document.querySelector(".av__mask");
    const inputElement = avMaskElement.querySelector(".b3-text-field") as HTMLInputElement;
    const blockElement = hasClosestBlock(cellElement);
    if (!blockElement) {
        return;
    }
    transaction(protyle, [{
        action: "updateAttrViewCell",
        id: blockElement.getAttribute("data-node-id"),
        rowID: blockElement.getAttribute("data-av-id"),
        type,
        data: inputElement.value,
    }], [{
        action: "updateAttrViewCell",
        id: blockElement.getAttribute("data-node-id"),
        rowID: blockElement.getAttribute("data-av-id"),
        type,
        data: cellElement.textContent.trim(),
    }]);
    cellElement.textContent = inputElement.value;
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
    const menu = new Menu("av-header-cell");
    menu.addItem({
        icon: getColIconByType(type),
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
