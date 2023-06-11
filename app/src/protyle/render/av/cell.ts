import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock} from "../../util/hasClosest";

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
