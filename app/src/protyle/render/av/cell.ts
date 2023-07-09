import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {openMenuPanel} from "./openMenuPanel";

export const popTextCell = (protyle: IProtyle, cellElement: HTMLElement) => {
    const type = cellElement.parentElement.parentElement.firstElementChild.querySelector(`[data-col-id="${cellElement.getAttribute("data-col-id")}"]`).getAttribute("data-dtype") as TAVCol;
    const cellRect = cellElement.getBoundingClientRect();
    let html = "";
    const style = `style="position:absolute;left: ${cellRect.left}px;top: ${cellRect.top}px;width:${Math.max(cellRect.width, 200)}px;height: ${cellRect.height}px"`;
    const blockElement = hasClosestBlock(cellElement);
    if (type === "block" || type === "text") {
        html = `<textarea ${style} class="b3-text-field">${cellElement.textContent}</textarea>`;
    } else if (type === "number") {
        html = `<input type="number" value="${cellElement.textContent}" ${style} class="b3-text-field">`;
    } else if (type === "select" && blockElement) {
        openMenuPanel(protyle, blockElement, "select", {cellElement});
        return;
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
    const cellId = cellElement.getAttribute("data-id");
    const avId = blockElement.getAttribute("data-av-id");
    const rowId = rowElement.getAttribute("data-id");
    let inputValue: string | number = (avMaskElement.querySelector(".b3-text-field") as HTMLInputElement).value;
    let oldValue: string | number = cellElement.textContent.trim();
    if (type === "number") {
        inputValue = parseFloat(inputValue);
        oldValue = parseFloat(oldValue);
    }
    transaction(protyle, [{
        action: "updateAttrViewCell",
        id: cellId,
        rowID: rowId,
        parentID: avId,
        data: {
            [type]: {content: inputValue}
        }
    }], [{
        action: "updateAttrViewCell",
        id: cellId,
        rowID: rowId,
        parentID: avId,
        data: {
            [type]: {content: oldValue}
        }
    }]);
    setTimeout(() => {
        avMaskElement.remove();
    });
};
