import {genCellValue, getTypeByCellElement, renderCell, renderCellAttr} from "../cell";
import {fetchPost} from "../../../../util/fetch";
import {setPage} from "../row";
import {Constants} from "../../../../constants";
import {clearSelect} from "../../../util/clear";

export const insertGalleryItemAnimation = (options: {
    blockElement: HTMLElement;
    protyle: IProtyle;
    srcIDs: string[];
    previousId: string;
    groupID?: string
}) => {
    const type = options.blockElement.getAttribute("data-av-type") as TAVView;
    (options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement).value = "";
    const groupQuery = options.groupID ? `.av__body[data-group-id="${options.groupID}"] ` : "";
    let sideItemElement = options.previousId ? options.blockElement.querySelector(groupQuery + `.av__gallery-item[data-id="${options.previousId}"]`) : options.blockElement.querySelector(groupQuery + ".av__gallery-item");
    const hasSort = options.blockElement.querySelector('.av__views [data-type="av-sort"]').classList.contains("block__icon--active");
    if (hasSort) {
        sideItemElement = options.blockElement.querySelector(groupQuery + ".av__gallery-add").previousElementSibling;
    }
    const bodyElement = options.blockElement.querySelector(`.av__body[data-group-id="${options.groupID}"] `);
    if (bodyElement && ["updated", "created"].includes(bodyElement.getAttribute("data-dtype")) &&
        bodyElement.getAttribute("data-content") !== "_@today@_") {
        sideItemElement = options.blockElement.querySelector('.av__body[data-content="_@today@_"] .av__gallery-add')?.previousElementSibling;
        if (!sideItemElement) {
            return;
        }
    }
    let cellsHTML = "";
    sideItemElement?.querySelectorAll(".av__cell").forEach((item: HTMLElement) => {
        let lineNumber = 1;
        const fieldType = getTypeByCellElement(item);
        if (fieldType === "lineNumber") {
            const lineNumberValue = item.querySelector(".av__celltext")?.getAttribute("data-value");
            if (lineNumberValue) {
                lineNumber = parseInt(lineNumberValue);
            }
        }

        const cellHTML = `<div class="av__cell${fieldType === "checkbox" ? " av__cell-uncheck" : ""}" 
data-field-id="${item.dataset.fieldId}" 
data-wrap="${item.dataset.wrap}" 
data-dtype="${item.dataset.dtype}" 
${fieldType === "block" ? ' data-detached="true"' : ""}>${renderCell(genCellValue(fieldType, null), lineNumber, false, type)}</div>`;
        if (item.previousElementSibling.classList.contains("av__gallery-name")) {
            cellsHTML += `<div class="av__gallery-field av__gallery-field--name" data-empty="${item.parentElement.dataset.empty}">
    ${item.previousElementSibling.outerHTML}
    ${cellHTML}
</div>`;
        } else {
            cellsHTML += `<div class="av__gallery-field" data-empty="${item.parentElement.dataset.empty}">
    ${item.previousElementSibling.outerHTML}
    ${cellHTML}
</div>`;
        }
    });
    clearSelect(["galleryItem"], options.blockElement);
    let html = "";
    const coverClass = sideItemElement?.querySelector(".av__gallery-cover")?.className || "fn__none";
    options.srcIDs.forEach(() => {
        html += `<div class="av__gallery-item" data-type="ghost">
    <div class="${coverClass}"><span style="width: 100%;height: 100%;border-radius: var(--b3-border-radius) var(--b3-border-radius) 0 0;" class="av__pulse"></span></div>
    <div class="av__gallery-fields">${cellsHTML}</div>
</div>`;
    });
    if (sideItemElement) {
        sideItemElement.insertAdjacentHTML("afterend", html);
    } else {
        options.blockElement.querySelector(groupQuery + ".av__gallery")?.insertAdjacentHTML("afterbegin", html);
    }
    fetchPost("/api/av/getAttributeViewAddingBlockDefaultValues", {
        avID: options.blockElement.getAttribute("data-av-id"),
        viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW),
        groupID: options.groupID,
        previousID: options.previousId,
    }, (response) => {
        if (response.data.values) {
            let popCellElement: HTMLElement;
            const updateIds = Object.keys(response.data.values);
            options.blockElement.querySelectorAll('[data-type="ghost"]').forEach(rowItem => {
                rowItem.querySelectorAll(".av__cell").forEach((cellItem: HTMLElement) => {
                    if (!popCellElement && cellItem.getAttribute("data-detached") === "true") {
                        popCellElement = cellItem;
                    }
                    if (updateIds.includes(cellItem.dataset.fieldId)) {
                        const cellValue = response.data.values[cellItem.dataset.fieldId];
                        if (cellValue.type === "checkbox" && cellItem.parentElement.querySelector(".av__gallery-tip")) {
                            cellValue.checkbox.content = cellItem.getAttribute("aria-label").split('<div class="ft__on-surface">')[0];
                        }
                        cellItem.innerHTML = renderCell(cellValue, undefined, false, type);
                        renderCellAttr(cellItem, cellValue);
                    }
                });
            });
        }
        setPage(options.blockElement);
    });
};
