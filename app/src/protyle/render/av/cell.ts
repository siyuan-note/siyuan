import {transaction} from "../../wysiwyg/transaction";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {openMenuPanel} from "./openMenuPanel";
import {updateAttrViewCellAnimation} from "./action";
import {isNotCtrl} from "../../util/compatibility";
import {isDynamicRef, objEquals} from "../../../util/functions";
import {fetchPost} from "../../../util/fetch";
import {focusBlock, focusByRange} from "../../util/selection";
import * as dayjs from "dayjs";
import {unicode2Emoji} from "../../../emoji";
import {getColIconByType} from "./col";
import {genAVValueHTML} from "./blockAttr";
import {Constants} from "../../../constants";
import {hintRef} from "../../hint/extend";
import {pathPosix} from "../../../util/pathName";
import {mergeAddOption} from "./select";
import {escapeAttr} from "../../../util/escape";
import {electronUndo} from "../../undo";

const renderCellURL = (urlContent: string) => {
    let host = urlContent;
    let suffix = "";
    try {
        const urlObj = new URL(urlContent);
        if (urlObj.protocol.startsWith("http")) {
            host = urlObj.host;
            suffix = urlObj.href.replace(urlObj.origin, "");
            if (suffix.length > 12) {
                suffix = suffix.substring(0, 4) + "..." + suffix.substring(suffix.length - 6);
            }
        }
    } catch (e) {
        // 不是 url 地址
        host = Lute.EscapeHTMLStr(urlContent);
    }
    // https://github.com/siyuan-note/siyuan/issues/9291
    return `<span class="av__celltext av__celltext--url" data-type="url" data-href="${escapeAttr(urlContent)}"><span>${host}</span><span class="ft__on-surface">${suffix}</span></span>`;
};

export const getCellText = (cellElement: HTMLElement | false) => {
    if (!cellElement) {
        return "";
    }
    let cellText = "";
    const textElements = cellElement.querySelectorAll(".b3-chip, .av__celltext--ref, .av__celltext");
    if (textElements.length > 0) {
        textElements.forEach(item => {
            if (item.querySelector(".av__cellicon")) {
                cellText += `${item.firstChild.textContent} → ${item.lastChild.textContent}, `;
            } else if (item.getAttribute("data-type") === "url") {
                cellText = item.getAttribute("data-href") + ", ";
            } else if (item.getAttribute("data-type") !== "block-more") {
                cellText += item.textContent + ", ";
            }
        });
        cellText = cellText.substring(0, cellText.length - 2);
    } else {
        cellText = cellElement.textContent;
    }
    return cellText;
};

export const genCellValueByElement = (colType: TAVCol, cellElement: HTMLElement) => {
    const cellValue: IAVCellValue = {
        type: colType,
        id: cellElement.dataset.id,
    };
    if (colType === "number") {
        const value = cellElement.querySelector(".av__celltext").getAttribute("data-content");
        cellValue.number = {
            content: parseFloat(value) || 0,
            isNotEmpty: !!value
        };
    } else if (["text", "block", "url", "phone", "email", "template"].includes(colType)) {
        const textElement = cellElement.querySelector(".av__celltext") as HTMLElement;
        cellValue[colType as "text"] = {
            content: colType === "url" ? textElement.dataset.href : textElement.textContent
        };
        if (colType === "block" && textElement.dataset.id) {
            cellValue.block.id = textElement.dataset.id;
        }
    } else if (colType === "mSelect" || colType === "select") {
        const mSelect: IAVCellSelectValue[] = [];
        cellElement.querySelectorAll(".b3-chip").forEach((item: HTMLElement) => {
            mSelect.push({
                content: item.textContent.trim(),
                color: item.style.color.replace("var(--b3-font-color", "").replace(")", "")
            });
        });
        cellValue.mSelect = mSelect;
    } else if (["date", "created", "updated"].includes(colType)) {
        cellValue[colType as "date"] = JSON.parse(cellElement.querySelector(".av__celltext").getAttribute("data-value"));
    } else if (colType === "checkbox") {
        cellValue.checkbox = {
            checked: cellElement.querySelector("use").getAttribute("xlink:href") === "#iconCheck" ? true : false
        };
    } else if (colType === "relation") {
        const blockIDs: string[] = [];
        const contents: IAVCellValue[] = [];
        Array.from(cellElement.querySelectorAll("span")).forEach((item: HTMLElement) => {
            blockIDs.push(item.dataset.id);
            contents.push({
                isDetached: !item.classList.contains("av__celltext--ref"),
                block: {
                    content: item.textContent,
                    id: item.dataset.id,
                },
                type: "block"
            });
        });
        cellValue.relation = {
            blockIDs,
            contents
        };
    } else if (colType === "mAsset") {
        const mAsset: IAVCellAssetValue[] = [];
        Array.from(cellElement.children).forEach((item) => {
            if (item.classList.contains("av__drag-fill")) {
                return;
            }
            const isImg = item.classList.contains("av__cellassetimg");
            mAsset.push({
                type: isImg ? "image" : "file",
                content: isImg ? item.getAttribute("src") : item.getAttribute("data-url"),
                name: isImg ? "" : item.getAttribute("data-name")
            });
        });
        cellValue.mAsset = mAsset;
    }
    if (colType === "block") {
        cellValue.isDetached = cellElement.dataset.detached === "true";
    }
    return cellValue;
};

export const genCellValue = (colType: TAVCol, value: string | any) => {
    let cellValue: IAVCellValue = {
        type: colType,
        [colType === "select" ? "mSelect" : colType]: value as IAVCellDateValue
    };
    if (typeof value === "string" && value) {
        if (colType === "number") {
            cellValue = {
                type: colType,
                number: {
                    content: parseFloat(value) || 0,
                    isNotEmpty: true
                }
            };
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
                    color: "1"
                }]
            };
        } else if (colType === "checkbox") {
            cellValue = {
                type: colType,
                checkbox: {
                    checked: true
                }
            };
        } else if (colType === "date") {
            cellValue = {
                type: colType,
                date: {
                    content: null,
                    isNotEmpty: false,
                    content2: null,
                    isNotEmpty2: false,
                    hasEndDate: false,
                    isNotTime: true,
                }
            };
        } else if (colType === "relation") {
            cellValue = {
                type: colType,
                relation: {blockIDs: [value], contents: []}
            };
        } else if (colType === "mAsset") {
            const type = pathPosix().extname(value).toLowerCase();
            cellValue = {
                type: colType,
                mAsset: [{
                    type: Constants.SIYUAN_ASSETS_IMAGE.includes(type) ? "image" : "file",
                    content: value,
                    name: "",
                }]
            };
        }
    } else if (typeof value === "undefined" || !value) {
        if (colType === "number") {
            cellValue = {
                type: colType,
                number: {
                    content: null,
                    isNotEmpty: false
                }
            };
        } else if (["text", "block", "url", "phone", "email", "template"].includes(colType)) {
            cellValue = {
                type: colType,
                [colType]: {
                    content: ""
                }
            };
        } else if (colType === "mSelect" || colType === "select" || colType === "mAsset") {
            cellValue = {
                type: colType,
                [colType === "select" ? "mSelect" : colType]: []
            };
        } else if (["date", "created", "updated"].includes(colType)) {
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
                    checked: false
                }
            };
        } else if (colType === "relation") {
            cellValue = {
                type: colType,
                relation: {blockIDs: [], contents: []}
            };
        } else if (colType === "rollup") {
            cellValue = {
                type: colType,
                rollup: {contents: []}
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
        const footerElement = blockElement.querySelector(".av__row--footer");
        if (footerElement.querySelector(".av__calc--ashow")) {
            const avFooterRect = footerElement.getBoundingClientRect();
            if (avFooterRect.top < cellRect.bottom) {
                const contentElement = hasClosestByClassName(blockElement, "protyle-content", true);
                if (contentElement) {
                    contentElement.scrollTop = contentElement.scrollTop + cellRect.bottom - avFooterRect.top;
                }
            }
        } else {
            const contentElement = hasClosestByClassName(blockElement, "protyle-content", true);
            if (contentElement) {
                const contentRect = contentElement.getBoundingClientRect();
                if (cellRect.bottom > contentRect.bottom) {
                    contentElement.scrollTop = contentElement.scrollTop + (cellRect.top - contentRect.top - 33);
                }
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
    if (!blockElement) {
        return;
    }
    let cellRect = cellElements[0].getBoundingClientRect();
    const contentElement = hasClosestByClassName(blockElement, "protyle-content", true);
    /// #if MOBILE
    if (contentElement) {
        contentElement.scrollTop = contentElement.scrollTop + cellRect.top - 110;
    }
    /// #else
    cellScrollIntoView(blockElement, cellElements[0], false);
    /// #endif
    cellRect = cellElements[0].getBoundingClientRect();
    let html = "";
    let height = cellRect.height;
    if (contentElement) {
        const contentRect = contentElement.getBoundingClientRect();
        if (cellRect.bottom > contentRect.bottom) {
            height = contentRect.bottom - cellRect.top;
        }
    }
    const style = `style="padding-top: 6.5px;position:absolute;left: ${cellRect.left}px;top: ${cellRect.top}px;width:${Math.max(cellRect.width, 25)}px;height: ${height}px"`;
    if (["text", "email", "phone", "block", "template"].includes(type)) {
        html = `<textarea ${style} spellcheck="false" class="b3-text-field">${cellElements[0].firstElementChild.textContent}</textarea>`;
    } else if (type === "url") {
        html = `<textarea ${style} spellcheck="false" class="b3-text-field">${cellElements[0].firstElementChild.getAttribute("data-href")}</textarea>`;
    } else if (type === "number") {
        html = `<input type="number" spellcheck="false" value="${cellElements[0].firstElementChild.getAttribute("data-content")}" ${style} class="b3-text-field">`;
    } else {
        if (["select", "mSelect"].includes(type)) {
            openMenuPanel({protyle, blockElement, type: "select", cellElements});
        } else if (type === "mAsset") {
            openMenuPanel({protyle, blockElement, type: "asset", cellElements});
            focusBlock(blockElement);
        } else if (type === "date") {
            openMenuPanel({protyle, blockElement, type: "date", cellElements});
        } else if (type === "checkbox") {
            updateCellValueByInput(protyle, type, blockElement, cellElements);
        } else if (type === "relation") {
            openMenuPanel({protyle, blockElement, type: "relation", cellElements});
        } else if (type === "rollup") {
            openMenuPanel({protyle, blockElement, type: "rollup", cellElements, colId: cellElements[0].dataset.colId});
        }
        if (!hasClosestByClassName(cellElements[0], "custom-attr")) {
            cellElements[0].classList.add("av__cell--select");
            addDragFill(cellElements[0]);
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
        if (type === "template") {
            fetchPost("/api/av/renderAttributeView", {
                id: blockElement.dataset.avId,
                viewID: blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW)
            }, (response) => {
                response.data.view.columns.find((item: IAVColumn) => {
                    if (item.id === cellElements[0].dataset.colId) {
                        inputElement.value = item.template;
                        inputElement.dataset.template = item.template;
                        return true;
                    }
                });
            });
        }
        if (type === "block") {
            inputElement.addEventListener("input", (event: InputEvent) => {
                if (Constants.BLOCK_HINT_KEYS.includes(inputElement.value.substring(0, 2))) {
                    protyle.toolbar.range = document.createRange();
                    if (!blockElement.contains(cellElements[0])) {
                        const rowElement = hasClosestByClassName(cellElements[0], "av__row") as HTMLElement;
                        if (cellElements[0]) {
                            cellElements[0] = blockElement.querySelector(`.av__row[data-id="${rowElement.dataset.id}"] .av__cell[data-col-id="${cellElements[0].dataset.colId}"]`) as HTMLElement;
                        }
                    }
                    protyle.toolbar.range.selectNodeContents(cellElements[0].lastChild);
                    focusByRange(protyle.toolbar.range);
                    cellElements[0].classList.add("av__cell--select");
                    addDragFill(cellElements[0]);
                    let textPlain = inputElement.value;
                    if (isDynamicRef(textPlain)) {
                        textPlain = textPlain.substring(2, 22 + 2);
                    } else {
                        textPlain = textPlain.substring(2);
                    }
                    hintRef(textPlain, protyle, "av");
                    avMaskElement?.remove();
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
        }
        inputElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (electronUndo(event)) {
                return;
            }
            if (event.key === "Escape" || event.key === "Tab" ||
                (event.key === "Enter" && !event.shiftKey && isNotCtrl(event))) {
                updateCellValueByInput(protyle, type, blockElement, cellElements);
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

    const removeAvMask = (event: Event) => {
        if ((event.target as HTMLElement).classList.contains("av__mask")
            && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
            updateCellValueByInput(protyle, type, blockElement, cellElements);
            avMaskElement?.remove();
        }
    };
    avMaskElement.addEventListener("click", (event) => {
        removeAvMask(event);
    });
    avMaskElement.addEventListener("contextmenu", (event) => {
        removeAvMask(event);
    });
};

const updateCellValueByInput = (protyle: IProtyle, type: TAVCol, blockElement: HTMLElement, cellElements: HTMLElement[]) => {
    const rowElement = hasClosestByClassName(cellElements[0], "av__row");
    if (!rowElement) {
        return;
    }
    if (cellElements.length === 1 && cellElements[0].dataset.detached === "true" && !rowElement.dataset.id) {
        return;
    }
    const avMaskElement = document.querySelector(".av__mask");
    const avID = blockElement.getAttribute("data-av-id");
    if (type === "template") {
        const colId = cellElements[0].getAttribute("data-col-id");
        const textElement = avMaskElement.querySelector(".b3-text-field") as HTMLInputElement;
        if (textElement.value !== textElement.dataset.template && !blockElement.getAttribute("data-loading")) {
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
            blockElement.setAttribute("data-loading", "true");
        }
    } else {
        updateCellsValue(protyle, blockElement, type === "checkbox" ? {
            checked: cellElements[0].querySelector("use").getAttribute("xlink:href") === "#iconUncheck"
        } : (avMaskElement.querySelector(".b3-text-field") as HTMLInputElement).value, cellElements);
    }
    if (cellElements[0] // 兼容新增行后台隐藏
        && !hasClosestByClassName(cellElements[0], "custom-attr")) {
        cellElements[0].classList.add("av__cell--select");
        addDragFill(cellElements[0]);
    }
    //  单元格编辑中 ctrl+p 光标定位
    if (!document.querySelector(".b3-dialog")) {
        focusBlock(blockElement);
    }
    document.querySelectorAll(".av__mask").forEach((item) => {
        item.remove();
    });
};

export const updateCellsValue = (protyle: IProtyle, nodeElement: HTMLElement, value?: any, cElements?: HTMLElement[],
                                 columns?: IAVColumn[], html?: string) => {
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];

    const avID = nodeElement.dataset.avId;
    const id = nodeElement.dataset.nodeId;
    let text = "";
    const json: IAVCellValue[][] = [];
    let cellElements: Element[];
    if (cElements?.length > 0) {
        cellElements = cElements;
    } else {
        cellElements = Array.from(nodeElement.querySelectorAll(".av__cell--active, .av__cell--select"));
        if (cellElements.length === 0) {
            nodeElement.querySelectorAll(".av__row--select:not(.av__row--header)").forEach(rowElement => {
                rowElement.querySelectorAll(".av__cell").forEach(cellElement => {
                    cellElements.push(cellElement);
                });
            });
        }
    }
    const isCustomAttr = hasClosestByClassName(cellElements[0], "custom-attr");
    cellElements.forEach((item: HTMLElement, elementIndex) => {
        const rowElement = hasClosestByClassName(item, "av__row");
        if (!rowElement) {
            return;
        }
        if (!nodeElement.contains(item)) {
            item = cellElements[elementIndex] = (nodeElement.querySelector(`.av__row[data-id="${rowElement.dataset.id}"] .av__cell[data-col-id="${item.dataset.colId}"]`) ||
                nodeElement.querySelector(`.fn__flex-1[data-col-id="${item.dataset.colId}"]`)) as HTMLElement;
        }
        if (!item) {
            // 兼容新增行后台隐藏
            return;
        }
        const type = getTypeByCellElement(item) || item.dataset.type as TAVCol;
        if (["created", "updated", "template", "rollup"].includes(type)) {
            return;
        }
        const rowID = rowElement.getAttribute("data-id");
        const cellId = item.dataset.id;   // 刚创建时无 id，更新需和 oldValue 保持一致
        const colId = item.dataset.colId;

        text += getCellText(item) + ((cellElements[elementIndex + 1] && item.nextElementSibling && item.nextElementSibling.isSameNode(cellElements[elementIndex + 1])) ? "\t" : "\n\n");
        const oldValue = genCellValueByElement(type, item);
        if (elementIndex === 0 || !cellElements[elementIndex - 1].isSameNode(item.previousElementSibling)) {
            json.push([]);
        }
        json[json.length - 1].push(oldValue);
        // relation 为全部更新，以下类型为添加
        if (type === "mAsset") {
            if (Array.isArray(value)) {
                value = oldValue.mAsset.concat(value);
            } else if (typeof value !== "undefined") { // 不传入为删除，传入字符串不进行处理
                let link = protyle.lute.GetLinkDest(value);
                let name = "";
                let imgSrc = "";
                if (html) {
                    const tempElement = document.createElement("template");
                    tempElement.innerHTML = html;
                    const aElement = tempElement.content.querySelector('[data-type~="a"]');
                    if (aElement) {
                        link = aElement.getAttribute("data-href");
                        name = aElement.textContent;
                    } else {
                        const imgElement = tempElement.content.querySelector(".img img");
                        if (imgElement) {
                            imgSrc = imgElement.getAttribute("data-src");
                        }
                    }
                }
                if (!link && !name && !imgSrc) {
                    return;
                }
                if (imgSrc) {
                    // 支持解析 ![]() https://github.com/siyuan-note/siyuan/issues/11487
                    value = oldValue.mAsset.concat({
                        type: "image",
                        content: imgSrc,
                        name: ""
                    });
                } else {
                    // 支持解析 https://github.com/siyuan-note/siyuan/issues/11463
                    value = oldValue.mAsset.concat({
                        type: "file",
                        content: link,
                        name
                    });
                }
            }
        } else if (type === "mSelect") {
            // 不传入为删除
            if (typeof value === "string") {
                value = oldValue.mSelect.concat({
                    content: value,
                    color: (oldValue.mSelect.length + 1).toString()
                });
            }
        }
        const cellValue = genCellValue(type, value);
        cellValue.id = cellId;
        if ((cellValue.type === "date" && typeof cellValue.date === "string") ||
            (cellValue.type === "relation" && typeof cellValue.relation === "string")) {
            return;
        }
        if (columns && (type === "select" || type === "mSelect")) {
            const operations = mergeAddOption(columns.find(e => e.id === colId), cellValue, avID);
            doOperations.push(...operations.doOperations);
            undoOperations.push(...operations.undoOperations);
        }
        if (objEquals(cellValue, oldValue)) {
            return;
        }
        if (type === "block" && !item.dataset.detached) {
            const newId = Lute.NewNodeID();
            doOperations.push({
                action: "unbindAttrViewBlock",
                id: rowID,
                nextID: newId,
                avID,
            });
            rowElement.dataset.id = newId;
            item.dataset.blockId = newId;
        } else {
            doOperations.push({
                action: "updateAttrViewCell",
                id: cellId,
                avID,
                keyID: colId,
                rowID,
                data: cellValue
            });
        }
        undoOperations.push({
            action: "updateAttrViewCell",
            id: cellId,
            avID,
            keyID: colId,
            rowID,
            data: oldValue
        });
        if (isCustomAttr) {
            item.innerHTML = genAVValueHTML(cellValue);
        } else {
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
    return {text: text.substring(0, text.length - 2), json};
};

export const renderCellAttr = (cellElement: Element, value: IAVCellValue) => {
    if (value.type === "checkbox") {
        if (value.checkbox.checked) {
            cellElement.classList.add("av__cell-check");
            cellElement.classList.remove("av__cell-uncheck");
        } else {
            cellElement.classList.remove("av__cell-check");
            cellElement.classList.add("av__cell-uncheck");
        }
    } else if (value.type === "block") {
        if (value.block.id) {
            // 不能设置为空，否则编辑后会临时无 id
            cellElement.setAttribute("data-block-id", value.block.id);
        }
        if (value.isDetached) {
            cellElement.setAttribute("data-detached", "true");
        } else {
            cellElement.removeAttribute("data-detached");
        }
    }
};

export const renderCell = (cellValue: IAVCellValue, rowIndex = 0) => {
    let text = "";
    if ("template" === cellValue.type) {
        text = `<span class="av__celltext">${cellValue ? (cellValue.template.content || "") : ""}</span>`;
    } else if ("text" === cellValue.type) {
        text = `<span class="av__celltext">${cellValue ? Lute.EscapeHTMLStr(cellValue.text.content || "") : ""}</span>`;
    } else if (["email", "phone"].includes(cellValue.type)) {
        text = `<span class="av__celltext av__celltext--url" data-type="${cellValue.type}">${cellValue ? Lute.EscapeHTMLStr(cellValue[cellValue.type as "email"].content || "") : ""}</span>`;
    } else if ("url" === cellValue.type) {
        text = renderCellURL(cellValue?.url?.content || "");
    } else if (cellValue.type === "block") {
        // 不可使用换行 https://github.com/siyuan-note/siyuan/issues/11365
        if (cellValue?.isDetached) {
            text = `<span class="av__celltext">${cellValue.block.content || ""}</span><span class="b3-chip b3-chip--info b3-chip--small" data-type="block-more">${window.siyuan.languages.more}</span>`;
        } else {
            text = `<span data-type="block-ref" data-id="${cellValue.block.id}" data-subtype="s" class="av__celltext av__celltext--ref">${cellValue.block.content || window.siyuan.languages.untitled}</span><span class="b3-chip b3-chip--info b3-chip--small" data-type="block-more">${window.siyuan.languages.update}</span>`;
        }
    } else if (cellValue.type === "number") {
        text = `<span class="av__celltext" data-content="${cellValue?.number.isNotEmpty ? cellValue?.number.content : ""}">${cellValue?.number.formattedContent || cellValue?.number.content || ""}</span>`;
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
    } else if (["lineNumber"].includes(cellValue.type)) {
        // 渲染行号
        text = `<span class="av__celltext" data-value='${rowIndex + 1}'>${rowIndex + 1}</span>`;
    } else if (cellValue.type === "mAsset") {
        cellValue?.mAsset?.forEach((item) => {
            if (item.type === "image") {
                text += `<img class="av__cellassetimg ariaLabel" aria-label="${item.content}" src="${item.content}">`;
            } else {
                text += `<span class="b3-chip av__celltext--url ariaLabel" aria-label="${escapeAttr(item.content)}" data-name="${escapeAttr(item.name)}" data-url="${escapeAttr(item.content)}">${item.name || item.content}</span>`;
            }
        });
    } else if (cellValue.type === "checkbox") {
        text += `<svg class="av__checkbox"><use xlink:href="#icon${cellValue?.checkbox?.checked ? "Check" : "Uncheck"}"></use></svg>`;
    } else if (cellValue.type === "rollup") {
        cellValue?.rollup?.contents?.forEach((item) => {
            const rollupText = ["select", "mSelect", "mAsset", "checkbox", "relation"].includes(item.type) ? renderCell(item) : renderRollup(item);
            if (rollupText) {
                text += rollupText + ", ";
            }
        });
        if (text && text.endsWith(", ")) {
            text = text.substring(0, text.length - 2);
        }
    } else if (cellValue.type === "relation") {
        cellValue?.relation?.contents?.forEach((item) => {
            if (item && item.block) {
                text += renderRollup(item) + ", ";
            }
        });
        if (text && text.endsWith(", ")) {
            text = text.substring(0, text.length - 2);
        }
    }

    if ((["text", "template", "url", "email", "phone", "number", "date", "created", "updated"].includes(cellValue.type) && cellValue[cellValue.type as "url"]?.content) ||
        cellValue.type === "lineNumber" ||
        (cellValue.type === "block" && cellValue.block?.content)) {
        text += `<span ${cellValue.type !== "number" ? "" : 'style="right:auto;left:5px"'} data-type="copy" class="block__icon"><svg><use xlink:href="#iconCopy"></use></svg></span>`;
    }
    return text;
};

const renderRollup = (cellValue: IAVCellValue) => {
    let text = "";
    if (["text"].includes(cellValue.type)) {
        text = cellValue ? (cellValue[cellValue.type as "text"].content || "") : "";
    } else if (["email", "phone"].includes(cellValue.type)) {
        const emailContent = cellValue ? cellValue[cellValue.type as "email"].content : "";
        if (emailContent) {
            text = `<span class="av__celltext av__celltext--url" data-type="${cellValue.type}">${emailContent}</span>`;
        }
    } else if ("url" === cellValue.type) {
        const urlContent = cellValue?.url?.content || "";
        if (urlContent) {
            text = renderCellURL(urlContent);
        }
    } else if (cellValue.type === "block") {
        if (cellValue?.isDetached) {
            text = `<span class="av__celltext" data-id="${cellValue.block?.id}">${cellValue.block?.content || window.siyuan.languages.untitled}</span>`;
        } else {
            text = `<span data-type="block-ref" data-id="${cellValue.block?.id}" data-subtype="s" class="av__celltext av__celltext--ref">${cellValue.block?.content || window.siyuan.languages.untitled}</span>`;
        }
    } else if (cellValue.type === "number") {
        text = cellValue?.number.formattedContent || cellValue?.number.content.toString() || "";
    } else if (cellValue.type === "date") {
        const dataValue = cellValue ? cellValue.date : null;
        if (dataValue.formattedContent) {
            text = dataValue.formattedContent;
        } else {
            if (dataValue && dataValue.isNotEmpty) {
                text = dayjs(dataValue.content).format(dataValue.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
            }
            if (dataValue && dataValue.hasEndDate && dataValue.isNotEmpty && dataValue.isNotEmpty2) {
                text = `<svg class="av__cellicon"><use xlink:href="#iconForward"></use></svg>${dayjs(dataValue.content2).format(dataValue.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm")}`;
            }
        }
        if (text) {
            text = `<span class="av__celltext">${text}</span>`;
        }
    }
    return text;
};

export const updateHeaderCell = (cellElement: HTMLElement, headerValue: {
    icon?: string,
    name?: string,
    pin?: boolean,
}) => {
    if (typeof headerValue.icon !== "undefined") {
        cellElement.dataset.icon = headerValue.icon;
        cellElement.querySelector(".av__cellheadericon").outerHTML = headerValue.icon ? unicode2Emoji(headerValue.icon, "av__cellheadericon", true) : `<svg class="av__cellheadericon"><use xlink:href="#${getColIconByType(cellElement.dataset.dtype as TAVCol)}"></use></svg>`;
    }
    if (typeof headerValue.name !== "undefined") {
        cellElement.querySelector(".av__celltext").textContent = headerValue.name;
    }
    if (typeof headerValue.pin !== "undefined") {
        const textElement = cellElement.querySelector(".av__celltext");
        if (headerValue.pin) {
            if (!cellElement.querySelector(".av__cellheadericon--pin")) {
                textElement.insertAdjacentHTML("afterend", '<svg class="av__cellheadericon av__cellheadericon--pin"><use xlink:href="#iconPin"></use></svg>');
            }
        } else {
            cellElement.querySelector(".av__cellheadericon--pin")?.remove();
        }
    }
};

export const getPositionByCellElement = (cellElement: HTMLElement) => {
    let rowElement = hasClosestByClassName(cellElement, "av__row");
    if (!rowElement) {
        return;
    }
    let rowIndex = -1;
    while (rowElement) {
        rowElement = rowElement.previousElementSibling as HTMLElement;
        rowIndex++;
    }
    let celIndex = -2;
    while (cellElement) {
        cellElement = cellElement.previousElementSibling as HTMLElement;
        if (cellElement && cellElement.classList.contains("av__colsticky")) {
            cellElement = cellElement.lastElementChild as HTMLElement;
        }
        celIndex++;
    }
    return {rowIndex, celIndex};
};

export const dragFillCellsValue = (protyle: IProtyle, nodeElement: HTMLElement, originData: {
    [key: string]: IAVCellValue[]
}, originCellIds: string[]) => {
    nodeElement.querySelector(".av__drag-fill")?.remove();
    const newData: { [key: string]: Array<IAVCellValue & { colId?: string, element?: HTMLElement }> } = {};
    nodeElement.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
        if (originCellIds.includes(item.dataset.id)) {
            return;
        }
        const rowElement = hasClosestByClassName(item, "av__row");
        if (!rowElement) {
            return;
        }
        if (!newData[rowElement.dataset.id]) {
            newData[rowElement.dataset.id] = [];
        }
        const value: IAVCellValue & {
            colId?: string,
            element?: HTMLElement
        } = genCellValueByElement(getTypeByCellElement(item), item);
        value.colId = item.dataset.colId;
        value.element = item;
        newData[rowElement.dataset.id].push(value);
    });
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const avID = nodeElement.dataset.avId;
    const originKeys = Object.keys(originData);
    Object.keys(newData).forEach((rowID, index) => {
        newData[rowID].forEach((item, cellIndex) => {
            if (["rollup", "template", "created", "updated"].includes(item.type) ||
                (item.type === "block" && item.element.getAttribute("data-detached") !== "true")) {
                return;
            }
            // https://ld246.com/article/1707975507571 数据库下拉填充数据后异常
            const data = JSON.parse(JSON.stringify(originData[originKeys[index % originKeys.length]][cellIndex]));
            data.id = item.id;
            const keyID = item.colId;
            if (data.type === "block") {
                data.isDetached = true;
                delete data.block.id;
            }
            doOperations.push({
                action: "updateAttrViewCell",
                id: item.id,
                avID,
                keyID,
                rowID,
                data
            });
            item.element.innerHTML = renderCell(data);
            renderCellAttr(item.element, data);
            delete item.colId;
            delete item.element;
            undoOperations.push({
                action: "updateAttrViewCell",
                id: item.id,
                avID,
                keyID,
                rowID,
                data: item
            });
        });
    });
    focusBlock(nodeElement);
    if (doOperations.length > 0) {
        transaction(protyle, doOperations, undoOperations);
    }
};

export const addDragFill = (cellElement: Element) => {
    if (!cellElement) {
        return;
    }
    cellElement.classList.add("av__cell--active");
    if (!cellElement.querySelector(".av__drag-fill")) {
        cellElement.insertAdjacentHTML("beforeend", `<div aria-label="${window.siyuan.languages.dragFill}" class="av__drag-fill ariaLabel"></div>`);
    }
};
