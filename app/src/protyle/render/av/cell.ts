import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {openMenuPanel} from "./openMenuPanel";
import {updateAttrViewCellAnimation} from "./action";
import {isNotCtrl} from "../../util/compatibility";
import {objEquals} from "../../../util/functions";
import {fetchPost} from "../../../util/fetch";
import {focusBlock} from "../../util/selection";
import * as dayjs from "dayjs";

export const genCellValue = (colType: TAVCol, value: string | any) => {
    let cellValue: IAVCellValue;
    if (typeof value === "string") {
        if (colType === "number") {
            if (value) {
                cellValue = {
                    type: colType,
                    number: {
                        content: parseFloat(value),
                        isNotEmpty: true
                    }
                };
            } else {
                cellValue = {
                    type: colType,
                    number: {
                        isNotEmpty: false
                    }
                };
            }
        } else if (["text", "block", "url", "phone", "email", "template"].includes(colType)) {
            cellValue = {
                type: colType,
                [colType]: {
                    content: value
                }
            };
        } else if (colType === "mSelect" || colType === "select") {
            cellValue = {
                type: colType,
                mSelect: [{
                    content: value,
                    color: ""
                }]
            };
        } else if (["date", "created", "updated"].includes(colType) && value === "") {
            cellValue = {
                type: colType,
                [colType]: {
                    content: null,
                    isNotEmpty: false,
                    content2: null,
                    isNotEmpty2: false,
                    hasEndDate: false,
                    isNotTime: true,
                }
            };
        }
    } else {
        if (colType === "mSelect" || colType === "select") {
            cellValue = {
                type: colType,
                mSelect: value as IAVCellSelectValue[]
            };
        } else if (["date", "created", "updated"].includes(colType)) {
            cellValue = {
                type: colType,
                [colType]: value as IAVCellDateValue
            };
        } else if (colType === "mAsset") {
            cellValue = {
                type: colType,
                mAsset: value as IAVCellAssetValue[]
            };
        } else if (colType === "checkbox") {
            cellValue = {
                type: colType,
                checkbox: {
                    checked: value ? true : false
                }
            };
        }
    }
    return cellValue;
};

export const cellScrollIntoView = (blockElement: HTMLElement, cellElement: Element, onlyHeight = true) => {
    const cellRect = cellElement.getBoundingClientRect();
    if (!onlyHeight) {
        const avScrollElement = blockElement.querySelector(".av__scroll");
        if (avScrollElement) {
            const avScrollRect = avScrollElement.getBoundingClientRect();
            if (avScrollRect.right < cellRect.right) {
                avScrollElement.scrollLeft = avScrollElement.scrollLeft + cellRect.right - avScrollRect.right;
            } else {
                const rowElement = hasClosestByClassName(cellElement, "av__row");
                if (rowElement) {
                    const stickyElement = rowElement.querySelector(".av__colsticky");
                    if (stickyElement) {
                        const stickyRight = stickyElement.getBoundingClientRect().right;
                        if (stickyRight > cellRect.left) {
                            avScrollElement.scrollLeft = avScrollElement.scrollLeft + cellRect.left - stickyRight;
                        }
                    } else if (avScrollRect.left > cellRect.left) {
                        avScrollElement.scrollLeft = avScrollElement.scrollLeft + cellRect.left - avScrollRect.left;
                    }
                }
            }
        }
    }
    if (!blockElement.querySelector(".av__header")) {
        // 属性面板
        return;
    }
    const avHeaderRect = blockElement.querySelector(".av__row--header").getBoundingClientRect();
    if (avHeaderRect.bottom > cellRect.top) {
        const contentElement = hasClosestByClassName(blockElement, "protyle-content", true);
        if (contentElement) {
            contentElement.scrollTop = contentElement.scrollTop + cellRect.top - avHeaderRect.bottom;
        }
    } else {
        const avFooterRect = blockElement.querySelector(".av__row--footer").getBoundingClientRect();
        if (avFooterRect.top < cellRect.bottom) {
            const contentElement = hasClosestByClassName(blockElement, "protyle-content", true);
            if (contentElement) {
                contentElement.scrollTop = contentElement.scrollTop + cellRect.bottom - avFooterRect.top;
            }
        }
    }
};

export const getTypeByCellElement = (cellElement: Element) => {
    const scrollElement = hasClosestByClassName(cellElement, "av__scroll");
    if (!scrollElement) {
        return;
    }
    return scrollElement.querySelector(".av__row--header").querySelector(`[data-col-id="${cellElement.getAttribute("data-col-id")}"]`).getAttribute("data-dtype") as TAVCol;
};

export const popTextCell = (protyle: IProtyle, cellElements: HTMLElement[], type?: TAVCol) => {
    if (cellElements.length === 0 || (cellElements.length === 1 && !cellElements[0])) {
        return;
    }
    if (!type) {
        type = getTypeByCellElement(cellElements[0]);
    }
    if (type === "updated" || type === "created" || document.querySelector(".av__mask")) {
        return;
    }
    if (type === "block" && (cellElements.length > 1 || !cellElements[0].getAttribute("data-detached"))) {
        return;
    }
    const blockElement = hasClosestBlock(cellElements[0]);
    let cellRect = cellElements[0].getBoundingClientRect();
    if (blockElement) {
        /// #if MOBILE
        const contentElement = hasClosestByClassName(blockElement, "protyle-content", true);
        if (contentElement) {
            contentElement.scrollTop = contentElement.scrollTop + cellRect.top - 110;
        }
        /// #else
        cellScrollIntoView(blockElement, cellElements[0], false);
        /// #endif
    }
    cellRect = cellElements[0].getBoundingClientRect();
    let html = "";
    const style = `style="padding-top: 6.5px;position:absolute;left: ${cellRect.left}px;top: ${cellRect.top}px;width:${Math.max(cellRect.width, 25)}px;height: ${cellRect.height}px"`;
    if (["text", "url", "email", "phone", "block", "template"].includes(type)) {
        html = `<textarea ${style} class="b3-text-field">${cellElements[0].firstElementChild.textContent}</textarea>`;
    } else if (type === "number") {
        html = `<input type="number" value="${cellElements[0].firstElementChild.getAttribute("data-content")}" ${style} class="b3-text-field">`;
    } else if (blockElement) {
        if (["select", "mSelect"].includes(type)) {
            openMenuPanel({protyle, blockElement, type: "select", cellElements});
        } else if (type === "mAsset") {
            openMenuPanel({protyle, blockElement, type: "asset", cellElements});
        } else if (type === "date") {
            openMenuPanel({protyle, blockElement, type: "date", cellElements});
        } else if (type === "checkbox") {
            updateCellValue(protyle, type, cellElements);
        }
        if (!hasClosestByClassName(cellElements[0], "custom-attr")) {
            cellElements[0].classList.add("av__cell--select");
        }
        return;
    }
    window.siyuan.menus.menu.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="av__mask" style="z-index: ${++window.siyuan.zIndex}">
    ${html}
</div>`);
    const avMaskElement = document.querySelector(".av__mask");
    const inputElement = avMaskElement.querySelector(".b3-text-field") as HTMLInputElement;
    if (inputElement) {
        inputElement.select();
        inputElement.focus();
        if (blockElement && type === "template") {
            fetchPost("/api/av/renderAttributeView", {id: blockElement.dataset.avId}, (response) => {
                response.data.view.columns.find((item: IAVColumn) => {
                    if (item.id === cellElements[0].dataset.colId) {
                        inputElement.value = item.template;
                        inputElement.dataset.template = item.template;
                        return true;
                    }
                });
            });
        }
        inputElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Escape" || event.key === "Tab" ||
                (event.key === "Enter" && !event.shiftKey && isNotCtrl(event))) {
                updateCellValue(protyle, type, cellElements);
                if (event.key === "Tab") {
                    protyle.wysiwyg.element.dispatchEvent(new KeyboardEvent("keydown", {
                        shiftKey: event.shiftKey,
                        ctrlKey: event.ctrlKey,
                        altKey: event.altKey,
                        metaKey: event.metaKey,
                        key: "Tab",
                        keyCode: 9
                    }));
                }
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }
    avMaskElement.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).classList.contains("av__mask")) {
            updateCellValue(protyle, type, cellElements);
            avMaskElement?.remove();
        }
    });
};

const updateCellValue = (protyle: IProtyle, type: TAVCol, cellElements: HTMLElement[]) => {
    const rowElement = hasClosestByClassName(cellElements[0], "av__row");
    if (!rowElement) {
        return;
    }
    if (!document.contains(cellElements[0]) && cellElements.length === 1) {
        // 原始 cell 已被更新
        const avid = rowElement.dataset.avid;
        if (avid) {
            // 新增行后弹出的输入框
            const previousId = rowElement.dataset.previousId;
            cellElements[0] = protyle.wysiwyg.element.querySelector(previousId ? `[data-av-id="${avid}"] .av__row[data-id="${previousId}"]` : `[data-av-id="${avid}"] .av__row--header`).nextElementSibling.querySelector('[data-detached="true"]');
        } else {
            // 修改单元格后立即修改其他单元格
            let tempElement = protyle.wysiwyg.element.querySelector(`.av__cell[data-id="${cellElements[0].dataset.id}"]`) as HTMLElement;
            if (!tempElement) {
                // 修改单元格后修改其他没有内容的单元格（id 会随机）
                tempElement = protyle.wysiwyg.element.querySelector(`.av__row[data-id="${rowElement.dataset.id}"] .av__cell[data-col-id="${cellElements[0].dataset.colId}"]`) as HTMLElement
            }
            if (!tempElement) {
                return;
            }
            cellElements[0] = tempElement;
        }
    }
    if (cellElements.length === 1 && cellElements[0].dataset.detached === "true" && !rowElement.dataset.id) {
        return;
    }
    const blockElement = hasClosestBlock(cellElements[0]);
    if (!blockElement) {
        return;
    }
    const avMaskElement = document.querySelector(".av__mask");
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const avID = blockElement.getAttribute("data-av-id");
    const id = blockElement.getAttribute("data-node-id");
    if (type === "template") {
        const colId = cellElements[0].getAttribute("data-col-id");
        const textElement = avMaskElement.querySelector(".b3-text-field") as HTMLInputElement;
        if (textElement.value !== textElement.dataset.template) {
            transaction(protyle, [{
                action: "updateAttrViewColTemplate",
                id: colId,
                avID,
                data: textElement.value,
                type: "template",
            }], [{
                action: "updateAttrViewColTemplate",
                id: colId,
                avID,
                data: textElement.dataset.template,
                type: "template",
            }]);
        }
    } else {
        cellElements.forEach((item) => {
            const rowElement = hasClosestByClassName(item, "av__row");
            if (!rowElement) {
                return;
            }
            const rowID = rowElement.getAttribute("data-id");
            const cellId = item.getAttribute("data-id");
            const colId = item.getAttribute("data-col-id");
            const inputValue: {
                content?: string | number,
                isNotEmpty?: boolean,
                checked?: boolean,
            } = {};
            const oldValue: {
                content?: string | number,
                isNotEmpty?: boolean,
                checked?: boolean,
            } = {};
            if (type === "number") {
                oldValue.content = parseFloat(item.textContent.trim());
                oldValue.isNotEmpty = typeof oldValue.content === "number" && !isNaN(oldValue.content);
                inputValue.content = parseFloat((avMaskElement.querySelector(".b3-text-field") as HTMLInputElement).value);
                inputValue.isNotEmpty = typeof inputValue.content === "number" && !isNaN(inputValue.content);
                if (!inputValue.isNotEmpty) {
                    // 后端仅支持传入数字，因此在为空的时候需要设置为 0
                    inputValue.content = 0;
                }
            } else if (type === "checkbox") {
                const useElement = item.querySelector("use");
                inputValue.checked = useElement.getAttribute("xlink:href") === "#iconUncheck";
                oldValue.checked = !inputValue.checked;
                useElement.setAttribute("xlink:href", inputValue.checked ? "#iconCheck" : "#iconUncheck");
            } else {
                inputValue.content = (avMaskElement.querySelector(".b3-text-field") as HTMLInputElement).value;
                oldValue.content = type === "block" ? item.firstElementChild.textContent.trim() : item.textContent.trim();
            }
            if (objEquals(inputValue, oldValue)) {
                return;
            }
            doOperations.push({
                action: "updateAttrViewCell",
                id: cellId,
                avID,
                keyID: colId,
                rowID,
                data: {
                    [type]: inputValue
                }
            }, {
                action: "doUpdateUpdated",
                id,
                data: dayjs().format("YYYYMMDDHHmmss"),
            });
            undoOperations.push({
                action: "updateAttrViewCell",
                id: cellId,
                avID,
                keyID: colId,
                rowID,
                data: {
                    [type]: oldValue
                }
            }, {
                action: "doUpdateUpdated",
                id,
                data: blockElement.getAttribute("updated"),
            });
            if (!hasClosestByClassName(cellElements[0], "custom-attr")) {
                updateAttrViewCellAnimation(item);
            }
        });
    }
    if (doOperations.length > 0) {
        transaction(protyle, doOperations, undoOperations);
    }
    if (!hasClosestByClassName(cellElements[0], "custom-attr")) {
        cellElements[0].classList.add("av__cell--select");
    }
    if (blockElement &&
        // 单元格编辑中 ctrl+p 光标定位
        !document.querySelector(".b3-dialog")) {
        focusBlock(blockElement);
    }
    document.querySelectorAll(".av__mask").forEach((item) => {
        item.remove();
    });
};
