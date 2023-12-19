import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {openMenuPanel} from "./openMenuPanel";
import {updateAttrViewCellAnimation} from "./action";
import {isNotCtrl} from "../../util/compatibility";
import {objEquals} from "../../../util/functions";
import {fetchPost} from "../../../util/fetch";
import {focusBlock} from "../../util/selection";
import * as dayjs from "dayjs";
import {unicode2Emoji} from "../../../emoji";
import {getColIconByType} from "./col";

export const getCellText = (cellElement: HTMLElement | false) => {
    if (!cellElement) {
        return "";
    }
    let cellText = "";
    const textElement = cellElement.querySelector(".av__celltext");
    if (textElement) {
        if (textElement.querySelector(".av__cellicon")) {
            cellText = `${textElement.firstChild.textContent} → ${textElement.lastChild.textContent}`;
        } else {
            cellText = textElement.textContent;
        }
    } else {
        cellText = cellElement.textContent;
    }
    return cellText;
};

const genCellValueByElement = (colType: TAVCol, cellElement: HTMLElement) => {
    let cellValue: IAVCellValue;
    if (colType === "number") {
        const value = cellElement.querySelector(".av__celltext").getAttribute("data-content");
        cellValue = {
            type: colType,
            number: {
                content: parseFloat(value) || 0,
                isNotEmpty: !!value
            }
        };
    } else if (["text", "block", "url", "phone", "email", "template"].includes(colType)) {
        cellValue = {
            type: colType,
            [colType]: {
                content: cellElement.querySelector(".av__celltext").textContent.trim()
            }
        };
    } else if (colType === "mSelect" || colType === "select") {
        const mSelect: IAVCellSelectValue[] = [];
        cellElement.querySelectorAll(".b3-chip").forEach((item: HTMLElement) => {
            mSelect.push({
                content: item.textContent.trim(),
                color: item.style.color.replace("var(--b3-font-color", "").replace(")", "")
            });
        });
        cellValue = {
            type: colType,
            mSelect
        };
    } else if (["date", "created", "updated"].includes(colType)) {
        cellValue = {
            type: colType,
            [colType]: JSON.parse(cellElement.querySelector(".av__celltext").getAttribute("data-value"))
        };
    } else if (colType === "checkbox") {
        cellValue = {
            type: colType,
            checkbox: {
                checked: cellElement.querySelector("use").getAttribute("xlink:href") === "#iconCheck" ? true : false
            }
        };
    }
    if (colType === "block") {
        cellValue.isDetached = cellElement.dataset.detached === "true";
    }
    return cellValue;
};

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
                        content: 0,
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
                    color: value ? "1" : ""
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
        } else if (colType === "checkbox") {
            cellValue = {
                type: colType,
                checkbox: {
                    checked: value ? true : false
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
    if (colType === "block") {
        cellValue.isDetached = true;
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
            updateCellValueByInput(protyle, type, cellElements);
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
                updateCellValueByInput(protyle, type, cellElements);
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
            updateCellValueByInput(protyle, type, cellElements);
            avMaskElement?.remove();
        }
    });
};

const updateCellValueByInput = (protyle: IProtyle, type: TAVCol, cellElements: HTMLElement[]) => {
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
                tempElement = protyle.wysiwyg.element.querySelector(`.av__row[data-id="${rowElement.dataset.id}"] .av__cell[data-col-id="${cellElements[0].dataset.colId}"]`) as HTMLElement;
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
                    [type]: inputValue,
                    isDetached: true,
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
                    [type]: oldValue,
                    isDetached: true,
                }
            }, {
                action: "doUpdateUpdated",
                id,
                data: blockElement.getAttribute("updated"),
            });
            if (!hasClosestByClassName(cellElements[0], "custom-attr")) {
                updateAttrViewCellAnimation(item, {
                    [type]: inputValue,
                    isDetached: true,
                    type
                });
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

export const updateCellsValue = (protyle: IProtyle, nodeElement: HTMLElement, value = "") => {
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];

    const avID = nodeElement.dataset.avId;
    const id = nodeElement.dataset.nodeId;
    let text = "";
    const cellElements: Element[] = Array.from(nodeElement.querySelectorAll(".av__cell--select")) || [];
    if (cellElements.length === 0) {
        nodeElement.querySelectorAll(".av__row--select:not(.av__row--header)").forEach(rowElement => {
            rowElement.querySelectorAll(".av__cell").forEach(cellElement => {
                cellElements.push(cellElement);
            });
        });
    }
    cellElements.forEach((item: HTMLElement) => {
        const rowElement = hasClosestByClassName(item, "av__row");
        if (!rowElement) {
            return;
        }
        const type = getTypeByCellElement(item);
        if (["created", "updated", "template"].includes(type)) {
            return;
        }
        const rowID = rowElement.getAttribute("data-id");
        const cellId = item.getAttribute("data-id");
        const colId = item.getAttribute("data-col-id");

        text += getCellText(item);
        const cellValue = genCellValue(type, value);
        doOperations.push({
            action: "updateAttrViewCell",
            id: cellId,
            avID,
            keyID: colId,
            rowID,
            data: cellValue
        });
        undoOperations.push({
            action: "updateAttrViewCell",
            id: cellId,
            avID,
            keyID: colId,
            rowID,
            data: genCellValueByElement(type, item)
        });
        if (!hasClosestByClassName(cellElements[0], "custom-attr")) {
            updateAttrViewCellAnimation(item, cellValue);
        }
    });
    if (doOperations.length > 0) {
        doOperations.push({
            action: "doUpdateUpdated",
            id,
            data: dayjs().format("YYYYMMDDHHmmss"),
        });
        undoOperations.push({
            action: "doUpdateUpdated",
            id,
            data: nodeElement.getAttribute("updated"),
        });
        transaction(protyle, doOperations, undoOperations);
    }
    return text;
};

export const renderCell = (cellValue: IAVCellValue, wrap: boolean) => {
    let text = "";
    if (["text", "template"].includes(cellValue.type)) {
        text = `<span class="av__celltext">${cellValue ? (cellValue[cellValue.type as "text"].content || "") : ""}</span>`;
    } else if (["url", "email", "phone"].includes(cellValue.type)) {
        const urlContent = cellValue ? cellValue[cellValue.type as "url"].content : "";
        // https://github.com/siyuan-note/siyuan/issues/9291
        let urlAttr = "";
        if (cellValue.type === "url") {
            urlAttr = ` data-href="${urlContent}"`;
        }
        text = `<span class="av__celltext av__celltext--url" data-type="${cellValue.type}"${urlAttr}>${urlContent}</span>`;
    } else if (cellValue.type === "block") {
        if (cellValue?.isDetached) {
            text = `<span class="av__celltext${cellValue?.isDetached ? "" : " av__celltext--ref"}">${cellValue.block.content || ""}</span>
<span class="b3-chip b3-chip--info b3-chip--small" data-type="block-more">${window.siyuan.languages.more}</span>`;
        } else {
            text = `<span data-type="block-ref" data-id="${cellValue.block.id}" data-subtype="s" class="av__celltext${cellValue?.isDetached ? "" : " av__celltext--ref"}">${cellValue.block.content || ""}</span>
<span class="b3-chip b3-chip--info b3-chip--small popover__block" data-id="${cellValue.block.id}" data-type="block-more">${window.siyuan.languages.update}</span>`;
        }
    } else if (cellValue.type === "number") {
        text = `<span style="float: right;${wrap ? "word-break: break-word;" : ""}" class="av__celltext" data-content="${cellValue?.number.isNotEmpty ? cellValue?.number.content : ""}">${cellValue?.number.formattedContent || cellValue?.number.content || ""}</span>`;
    } else if (cellValue.type === "mSelect" || cellValue.type === "select") {
        cellValue?.mSelect?.forEach((item) => {
            text += `<span class="b3-chip" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${item.content}</span>`;
        });
    } else if (cellValue.type === "date") {
        const dataValue = cellValue ? cellValue.date : null;
        text = `<span class="av__celltext" data-value='${JSON.stringify(dataValue)}'>`;
        if (dataValue && dataValue.isNotEmpty) {
            text += dayjs(dataValue.content).format(dataValue.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
        }
        if (dataValue && dataValue.hasEndDate && dataValue.isNotEmpty && dataValue.isNotEmpty2) {
            text += `<svg class="av__cellicon"><use xlink:href="#iconForward"></use></svg>${dayjs(dataValue.content2).format(dataValue.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm")}`;
        }
        text += "</span>";
    } else if (["created", "updated"].includes(cellValue.type)) {
        const dataValue = cellValue ? cellValue[cellValue.type as "date"] : null;
        text = `<span class="av__celltext" data-value='${JSON.stringify(dataValue)}'>`;
        if (dataValue && dataValue.isNotEmpty) {
            text += dayjs(dataValue.content).format("YYYY-MM-DD HH:mm");
        }
        text += "</span>";
    } else if (cellValue.type === "mAsset") {
        cellValue?.mAsset?.forEach((item) => {
            if (item.type === "image") {
                text += `<img class="av__cellassetimg" src="${item.content}">`;
            } else {
                text += `<span class="b3-chip av__celltext--url" data-url="${item.content}">${item.name}</span>`;
            }
        });
    } else if (cellValue.type === "checkbox") {
        text += `<svg class="av__checkbox"><use xlink:href="#icon${cellValue?.checkbox?.checked ? "Check" : "Uncheck"}"></use></svg>`;
    }
    if (["text", "template", "url", "email", "phone", "number", "date", "created", "updated"].includes(cellValue.type) &&
        cellValue && cellValue[cellValue.type as "url"].content) {
        text += `<span ${cellValue.type !== "number" ? "" : 'style="right:auto;left:5px"'} data-type="copy" class="block__icon"><svg><use xlink:href="#iconCopy"></use></svg></span>`;
    }
    return text;
}

export const updateHeaderCell = (cellElement: HTMLElement, headerValue: {
    icon?: string,
    name?: string,
    pin?: boolean,
}) => {
    if (typeof headerValue.icon !== "undefined") {
        cellElement.dataset.icon = headerValue.icon;
        cellElement.querySelector(".av__cellheadericon").outerHTML = headerValue.icon ? unicode2Emoji(headerValue.icon, "av__cellheadericon", true) : `<svg class="av__cellheadericon"><use xlink:href="#${getColIconByType(cellElement.dataset.dtype as TAVCol)}"></use></svg>`
    }
    if (typeof headerValue.name !== "undefined") {
        cellElement.querySelector(".av__celltext").textContent = headerValue.name;
    }
    if (typeof headerValue.pin !== "undefined") {
        const textElement = cellElement.querySelector(".av__celltext")
        if (headerValue.pin) {
            if (!textElement.nextElementSibling) {
                textElement.insertAdjacentHTML("afterend", '<div class="fn__flex-1"></div><svg class="av__cellheadericon"><use xlink:href="#iconPin"></use></svg>')
            }
        } else {
            if (textElement.nextElementSibling) {
                textElement.nextElementSibling.nextElementSibling.remove();
                textElement.nextElementSibling.remove();
            }
        }
    }
}
