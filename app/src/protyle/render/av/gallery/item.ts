import {showMessage} from "../../../../dialog/message";
import {
    genCellValue,
    getTypeByCellElement, popTextCell,
    renderCell,
    renderCellAttr
} from "../cell";
import {fetchPost} from "../../../../util/fetch";
import {setPage} from "../row";
import {Constants} from "../../../../constants";
import {clearSelect} from "../../../util/clearSelect";
import {hasClosestByClassName} from "../../../util/hasClosest";

export const insertGalleryItemAnimation = (options: {
    blockElement: HTMLElement;
    protyle: IProtyle;
    srcIDs: string[];
    previousId: string;
    groupID?: string
}) => {
    (options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement).value = "";
    const groupQuery = options.groupID ? `.av__body[data-group-id="${options.groupID}"] ` : "";
    let sideItemElement = options.previousId ? options.blockElement.querySelector(`.av__gallery-item[data-id="${options.previousId}"]`) : options.blockElement.querySelector(groupQuery + ".av__gallery-item");
    const hasSort = options.blockElement.querySelector('.av__views [data-type="av-sort"]').classList.contains("block__icon--active");
    if (hasSort) {
        sideItemElement = options.blockElement.querySelector(groupQuery + ".av__gallery-add").previousElementSibling;
    }
    let cellsHTML = "";
    sideItemElement.querySelectorAll(".av__cell").forEach((item: HTMLElement) => {
        let lineNumber = 1;
        const fieldType = getTypeByCellElement(item);
        if (fieldType === "lineNumber") {
            const lineNumberValue = item.querySelector(".av__celltext")?.getAttribute("data-value");
            if (lineNumberValue) {
                lineNumber = parseInt(lineNumberValue);
            }
        }
        cellsHTML += `<div class="av__cell${fieldType === "checkbox" ? " av__cell-uncheck" : ""}" data-field-id="${item.dataset.fieldId}" 
data-wrap="${item.dataset.wrap}" 
data-dtype="${item.dataset.dtype}" 
data-empty="${item.dataset.empty}"
${fieldType === "block" ? ' data-detached="true"' : ""}>${renderCell(genCellValue(fieldType, null), lineNumber, false, "gallery")}</div>`;
    });
    clearSelect(["galleryItem"], options.blockElement);
    let html = "";
    const coverClass = sideItemElement?.querySelector(".av__gallery-cover")?.className || "fn__none";
    options.srcIDs.forEach((id) => {
        const blockCellElement = options.blockElement.querySelector(`[data-block-id="${id}"]`);
        if (!blockCellElement) {
            html += `<div class="av__gallery-item" data-type="ghost">
    <div class="${coverClass}"><span style="width: 100%;height: 100%;border-radius: var(--b3-border-radius) var(--b3-border-radius) 0 0;" class="av__pulse"></span></div>
    <div class="av__gallery-fields">${cellsHTML}</div>
</div>`;
        } else {
            const galleryItemElement = hasClosestByClassName(blockCellElement, "av__gallery-item");
            if (galleryItemElement) {
                galleryItemElement.classList.add("av__gallery-item--select");
            }
        }
    });
    if (sideItemElement) {
        sideItemElement.insertAdjacentHTML("afterend", html);
    } else {
        options.blockElement.querySelector(groupQuery + ".av__gallery").insertAdjacentHTML("afterbegin", html);
    }
    fetchPost("/api/av/getAttributeViewAddingBlockDefaultValues", {
        avID: options.blockElement.getAttribute("data-av-id"),
        viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW),
        groupID: options.groupID,
        previousID: options.previousId,
    }, (response) => {
        if (!response.data.values) {
            showMessage(window.siyuan.languages.insertRowTip);
        } else {
            let popCellElement: HTMLElement;
            const updateIds = Object.keys(response.data.values);
            options.blockElement.querySelectorAll('[data-type="ghost"]').forEach(rowItem => {
                rowItem.querySelectorAll(".av__cell").forEach((cellItem: HTMLElement) => {
                    if (!popCellElement && cellItem.getAttribute("data-detached") === "true") {
                        popCellElement = cellItem;
                    }
                    if (updateIds.includes(cellItem.dataset.fieldId)) {
                        const cellValue = response.data.values[cellItem.dataset.fieldId];
                        if (cellValue.type === "checkbox") {
                            cellValue.checkbox.content = cellItem.getAttribute("aria-label");
                        }
                        cellItem.innerHTML = renderCell(cellValue, undefined, false, "gallery");
                        renderCellAttr(cellItem, cellValue);
                    }
                });
            });
            if (options.srcIDs.length === 1) {
                popTextCell(options.protyle, [popCellElement], "block");
            }
        }
        setPage(options.blockElement);
    });
};
