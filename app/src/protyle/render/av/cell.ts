import {getAVCellShowIcon} from "./entryIcon";
import {hasAVScalarContent, isAVDateType, isAVReadonlyType, isAVRichTextType, isAVSelectType, isAVTextType, isAVTimestampType, usesAVRollupCellRenderer} from "./capabilities";
import {isTableLikeView} from "./viewType";
import {ensureAVColumnWindow} from "./columnWindow";
import {isAVRenderData} from "./renderData";
import {transaction} from "../../wysiwyg/transaction";
import {hasClosestByClassName} from "../../util/hasClosest";
import {canEditAVHost, getAVHost as hasClosestBlock, getAVHostBlockID, getAVHostIdentity, getAVRelationHost} from "./host";
import {openMenuPanel} from "./openMenuPanel";
import {updateAttrViewCellAnimation} from "./action";
import {isNotCtrl} from "../../util/compatibility";
import {isDynamicRef, objEquals} from "../../../util/functions";
import {fetchPost, fetchSyncPost} from "../../../util/fetch";
import {focusBlock} from "../../util/selection";
import {focusByRange} from "../../util/selectionOffsets";
import dayjs from "dayjs";
import {openEmojiPanel, unicode2Emoji} from "../../../emoji";
import {getColIconByType, getColId} from "./col";
import {genAVRelationHTML, genAVValueHTML, getAVTemplateHTML} from "./attributeValue";
import {Constants} from "../../../constants";
import {hintRef} from "../../hint/extend";
import {getAssetExtension, getAssetName} from "../../../util/pathName";
import {mergeAddOption} from "./select";
import {escapeAriaLabel, escapeAttr, escapeHtml, escapeHtmlTextAndAttr} from "../../../util/escape";
import {electronUndo} from "../../undo";
import {formatDateDisplay, formatDateValue, parseDateValue} from "./dateFormat";
import {getFieldIdByCellElement} from "./row";
import {getFieldsByData} from "./view";
import {getCompressURL, removeCompressURL} from "../../../util/image";
import {isBrowserRenderableImagePath} from "../../../util/imageURL";
import {callMobileAppShowKeyboard} from "../../../mobile/util/mobileAppUtil";
/// #if MOBILE
import {activeBlur} from "../../../mobile/util/keyboardToolbar";
/// #endif
import {
    cellValueIsEmpty,
    cloneAVCellValueSnapshot,
    createAVCellUpdateOperation,
    createAVStableTextCell,
    genEmptyAVCellValue,
    genRelationAVCellValue,
    getAVBlockRefSubtype,
    getConvertedEmptyAVCellValue,
    hasAVCachedCellType,
    hasAVRenderTemplateResult,
    updateAVCachedCellValue,
} from "./cellValue";
import {setPosition} from "../../../util/setPosition";
import {getAVSelectedCells, IAVSelectedCell, resolveAVSelectedCell, updateAVSelectedCellValue} from "./selectionState";
import {getAVColorStyle} from "./color";
import {
    getAVBatchDisplayValue,
    getAVBatchEditMode,
    getAVBatchSourceValue,
    mergeAVBatchRelationValue,
    setAVBatchDisplayValue
} from "./batchValue";
import {genAVDragFillValue, rebindAVCellValue} from "./dragFillValue";
import {
    getAVRichTextPreviewHTML,
    getAVTextCopyContent,
    getAVTextSource,
    renderAVRichTextElements,
} from "./richText";
import {openAVRichTextEditor} from "./richTextEditor";
import {getAVPrimaryPreviewHTML} from "./primaryRich";
import {getAVData, getAVPrimaryCell} from "./virtualScroll";
import {AV_CELL_EDITOR_CLOSE_EVENT, getAVCellEditorOwner} from "./cellEditor";
import {getAVBlockIconHTML, renderAVBlockIcon} from "./blockIcon";
import {bindAnchoredInputPosition} from "../../../dialog/anchoredInputPosition";
import {createAVLocationFromText, createAVLocationReplacement, getAVLocationDisplayText, getAVLocationText, isAVLocationEmpty} from "./locationValue";
import {openAVLocationEditor} from "./locationEditor";
import {showMessage} from "../../../dialog/message";
import {isAVContinuousInputKey, prepareAVContinuousInput} from "./continuousInput";

export {cellValueIsEmpty} from "./cellValue";

export const openAVCellIcon = (protyle: IProtyle, target: HTMLElement) => {
    if (protyle.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
        protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    const relationElement = target.closest<HTMLElement>(".av__cell--relation");
    const relationValue = relationElement?.dataset.relationValue ?
        JSON.parse(decodeURIComponent(relationElement.dataset.relationValue)) as IAVCellValue : undefined;
    const hostElement = hasClosestBlock(target);
    if (hostElement && getAVRelationHost(hostElement) && relationValue) {
        showMessage(window.siyuan.languages._attrView.relatedDatabaseViewSharedTip);
        return;
    }
    if (relationValue?.isDetached) {
        return openAVRelationIcon(protyle, target, relationElement, relationValue);
    }
    const cellElement = target.closest<HTMLElement>('.av__cell[data-dtype="block"], [data-type="block"][data-cell-value]');
    const value = cellElement ? genCellValueByElement("block", cellElement) : undefined;
    const blockID = value ? value.block?.id : target.nextElementSibling?.getAttribute("data-id");
    const isDetached = value?.isDetached === true;
    if (hostElement && getAVRelationHost(hostElement) && !isDetached) {
        showMessage(window.siyuan.languages._attrView.relatedDatabaseViewSharedTip);
        return;
    }
    if (!isDetached && !blockID) {
        return;
    }
    const blockElement = hasClosestBlock(target);
    if (!blockElement) {
        return;
    }
    const rowID = isDetached ? getFieldIdByCellElement(cellElement, blockElement.dataset.avType as TAVView) : "";
    const colID = cellElement?.dataset.colId || cellElement?.dataset.fieldId;
    if (isDetached && (!rowID || !colID)) {
        return;
    }
    const rect = target.getBoundingClientRect();
    openEmojiPanel(isDetached ? "" : blockID, isDetached ? "av" : "doc", {
        x: rect.left, y: rect.bottom, h: rect.height, w: rect.width,
    }, (unicode) => {
        if (protyle.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
            protyle.options.history?.created || protyle.options.history?.snapshot) {
            return;
        }
        if (!isDetached) {
            target.dataset.unicode = unicode;
            target.innerHTML = getAVBlockIconHTML({block: {content: "", icon: unicode}});
            return;
        }
        // 图标面板打开期间可能发生虚拟滚动或重新绑定，按原项目定位并读取当前值。
        const currentCell = getAVPrimaryCell(blockElement, rowID);
        const currentValue = currentCell?.value || (cellElement.isConnected ? genCellValueByElement("block", cellElement) : value);
        if (!currentValue.isDetached) {
            return;
        }
        const oldValue = cloneAVCellValueSnapshot(currentValue);
        oldValue.block.icon = oldValue.block.icon || "";
        // 图标更新保留条目的绑定状态，兼容仍带有块 ID 的旧版非绑定条目。
        void updateCellsValue(protyle, blockElement, {
            ...oldValue,
            block: {...oldValue.block, icon: unicode},
        }, undefined, undefined, undefined, false, false, false, [{
                groupID: "", rowID, colID, rowIndex: 0, colIndex: -1,
                cell: {...currentCell, id: currentCell?.id || cellElement.dataset.id, value: oldValue},
                column: {id: colID, type: "block"} as IAVColumn,
            }]);
    }, target.querySelector("img"), {ownerElement: protyle.element});
};

const openAVRelationIcon = async (protyle: IProtyle, target: HTMLElement, relationElement: HTMLElement, value: IAVCellValue) => {
    const sourceCell = relationElement.closest<HTMLElement>('.av__cell[data-dtype="relation"], [data-type="relation"][data-av-id]');
    const sourceBlock = hasClosestBlock(target);
    const keyID = sourceCell?.dataset.colId || sourceCell?.dataset.fieldId;
    const rowID = relationElement.dataset.rowId;
    if (!sourceBlock || !keyID || !rowID) {
        return;
    }
    const sourceAVID = sourceBlock.dataset.avId;
    const response = await fetchSyncPost("/api/av/getAttributeViewKeysByID", {avID: sourceAVID, keyIDs: [keyID]});
    const avID = response.code === 0 ? response.data?.[0]?.relation?.avID : "";
    if (!avID || !target.isConnected || protyle.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
        protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    const rect = target.getBoundingClientRect();
    openEmojiPanel("", "av", {
        x: rect.left, y: rect.bottom, h: rect.height, w: rect.width,
    }, async (unicode) => {
        if (protyle.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
            protyle.options.history?.created || protyle.options.history?.snapshot) {
            return;
        }
        // 关联字段修改目标数据库的主键值，读取当前条目，避免覆盖后续编辑或重新绑定。
        const current = await fetchSyncPost("/api/av/getAttributeViewKeys", {
            id: rowID, avID, itemID: rowID, valueID: value.id,
        });
        const table = current.code === 0 ? current.data?.find(item => item.avID === avID) : undefined;
        const primary = table?.keyValues.find(item => item.key.type === "block");
        const currentValue = primary?.values?.[0];
        const blockID = table?.blockIDs?.[0];
        if (!currentValue?.isDetached || !blockID || protyle.disabled || window.siyuan.config.readonly ||
            window.siyuan.isPublish || protyle.options.history?.created || protyle.options.history?.snapshot) {
            return;
        }
        const oldValue = cloneAVCellValueSnapshot(currentValue);
        oldValue.block.icon = oldValue.block.icon || "";
        const newValue = cloneAVCellValueSnapshot(oldValue);
        newValue.block.icon = unicode;
        const options = {valueID: oldValue.id, avID, blockID, keyID: primary.key.id, rowID: oldValue.blockID};
        transaction(protyle, [createAVCellUpdateOperation({...options, data: newValue})],
            [createAVCellUpdateOperation({...options, data: oldValue})]);
        if (target.isConnected && relationElement.dataset.rowId === rowID) {
            relationElement.dataset.relationValue = encodeURIComponent(JSON.stringify(newValue));
            target.dataset.unicode = unicode;
            target.innerHTML = getAVBlockIconHTML(newValue);
        }
    }, target.querySelector("img"), {ownerElement: protyle.element});
};

const renderCellURL = (urlContent: string) => {
    return `<span class="av__celltext av__celltext--url" data-type="url" data-href="${escapeAttr(urlContent)}">${escapeHtmlTextAndAttr(urlContent)}</span>`;
};

const getStoredCellValueByElement = (cellElement: HTMLElement) => {
    const valueElement = cellElement.dataset.cellValue ? cellElement :
        cellElement.querySelector<HTMLElement>("[data-cell-value]");
    if (!valueElement?.dataset.cellValue) {
        return;
    }
    try {
        return JSON.parse(decodeURIComponent(valueElement.dataset.cellValue)) as IAVCellValue;
    } catch {
        return;
    }
};

export const getCellText = (cellElement: HTMLElement | false, purpose: "copy" | "display" = "copy") => {
    if (!cellElement) {
        return "";
    }
    const formatLocation = purpose === "display" ? getAVLocationDisplayText : getAVLocationText;
    const ownValue = cellElement.dataset?.cellValue && cellElement.matches(".av__celltext") ?
        getStoredCellValueByElement(cellElement) : undefined;
    if (ownValue?.type === "location" && !cellElement.matches(".av__celltext--template")) {
        return formatLocation(ownValue.location);
    }
    if (ownValue?.type === "block" && !cellElement.matches(".av__celltext--template")) { return ownValue.block?.content || ""; }
    const richTextElement = cellElement.matches(".av__celltext--rich[data-cell-value]") ? cellElement :
        cellElement.querySelector<HTMLElement>(".av__celltext--rich[data-cell-value]");
    const storedCellValue = richTextElement ? getStoredCellValueByElement(richTextElement) : undefined;
    if (storedCellValue?.type === "block") { return storedCellValue.block?.content || ""; }
    if (storedCellValue?.type === "text" && getAVTextSource(storedCellValue).kind === "rich") {
        return getAVTextCopyContent(storedCellValue);
    }
    let cellText = "";
    const textElements = cellElement.querySelectorAll(".b3-chip, .av__celltext--ref, .av__celltext");
    if (textElements.length > 0) {
        textElements.forEach(item => {
            const storedValue = (item as HTMLElement).dataset?.cellValue ? getStoredCellValueByElement(item as HTMLElement) : undefined;
            if (storedValue?.type === "location" && !item.matches(".av__celltext--template")) {
                cellText += formatLocation(storedValue.location) + ", ";
            } else if (item.querySelector(".av__cellicon")) {
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
    const storedCellValue = getStoredCellValueByElement(cellElement);
    if (storedCellValue) {
        const cellValue = storedCellValue;
        if (colType === "mAsset" && !cellValue.mAsset) {
            cellValue.mAsset = [];
        } else if ((colType === "mSelect" || colType === "select") && !cellValue.mSelect) {
            cellValue.mSelect = [];
        } else if (colType === "location") {
            cellValue.location = createAVLocationReplacement(cellValue.location);
        }
        return cellValue;
    }
    const cellValue: IAVCellValue = {
        type: colType,
        id: cellElement.dataset.id,
    };
    if (colType === "location") {
        cellValue.location = createAVLocationReplacement();
    } else if (colType === "number") {
        const value = (cellElement.querySelector("input") as HTMLInputElement)?.value ||
            cellElement.querySelector(".av__celltext")?.getAttribute("data-content");
        cellValue.number = {
            content: parseFloat(value) || 0,
            isNotEmpty: !!value
        };
    } else if (isAVTextType(colType)) {
        const inputElement = cellElement.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement;
        const textElement = cellElement.querySelector(".av__celltext") as HTMLElement ||
            cellElement.querySelector(":scope > .fn__flex-1") as HTMLElement;
        cellValue[colType as "text"] = {
            content: inputElement ? inputElement.value :
                (colType === "url" ? textElement?.dataset.href : textElement?.textContent) || ""
        };
        if (colType === "block") {
            if (inputElement?.dataset.id || textElement?.dataset.id) {
                cellValue.block.id = inputElement?.dataset.id || textElement.dataset.id;
            }
            cellValue.block.icon = cellElement.querySelector<HTMLElement>(".b3-menu__avemoji")?.dataset.unicode || "";
        }
    } else if (colType === "mSelect" || colType === "select") {
        const mSelect: IAVCellSelectValue[] = [];
        cellElement.querySelectorAll(".b3-chip").forEach((item: HTMLElement) => {
            mSelect.push({
                content: item.textContent.trim(),
                color: item.dataset.color || item.style.color.replace("var(--b3-font-color", "").replace(")", "")
            });
        });
        cellValue.mSelect = mSelect;
    } else if (isAVDateType(colType)) {
        cellValue[colType as "date"] = JSON.parse(cellElement.querySelector(".av__celltext").getAttribute("data-value"));
    } else if (colType === "checkbox") {
        cellValue.checkbox = {
            checked: cellElement.querySelector("use").getAttribute("xlink:href") === "#iconCheck" ? true : false
        };
    } else if (colType === "relation") {
        const blockIDs: string[] = [];
        const contents: IAVCellValue[] = [];
        Array.from(cellElement.querySelectorAll(".av__cell--relation")).forEach((relationItem: HTMLElement) => {
            const item = relationItem.querySelector(".av__celltext") as HTMLElement;
            blockIDs.push(relationItem.dataset.rowId);
            if (relationItem.dataset.relationValue) {
                contents.push(JSON.parse(decodeURIComponent(relationItem.dataset.relationValue)));
                return;
            }
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
            if (!item.classList.contains("av__celltext--url") && !item.classList.contains("av__cellassetimg")) {
                return;
            }
            const isImg = item.classList.contains("av__cellassetimg");
            mAsset.push({
                type: isImg ? "image" : "file",
                content: isImg ? removeCompressURL(decodeURI(item.getAttribute("src"))) : item.getAttribute("data-url"),
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

const getCellValueContent = (value: IAVCellValue): string => {
    if (value.type === "location") {
        return getAVLocationText(value.location);
    }
    if (hasAVScalarContent(value.type)) {
        return value[value.type as "text"].content;
    }
    if (isAVSelectType(value.type)) {
        return value.mSelect[0].content;
    }
    if (value.type === "rollup") {
        return value.rollup?.contents?.[0] ? getCellValueContent(value.rollup.contents[0]) : "";
    }
    if (value.type === "checkbox") {
        return value.checkbox.checked ? "true" : "false";
    }
    if (value.type === "relation") {
        return getCellValueContent(value.relation.contents[0]);
    }
    if (isAVDateType(value.type)) {
        return dayjs(value[value.type as "date"].content).format("YYYY-MM-DD HH:mm");
    }
    if (value.type === "lineNumber") {
        return "";
    }
};

const transformCellValue = (colType: TAVCol, value: IAVCellValue): IAVCellValue => {
    if (colType === value.type) {
        return value;
    }
    const emptyValue = getConvertedEmptyAVCellValue(colType, value);
    if (emptyValue) {
        return emptyValue;
    }
    const newValue: IAVCellValue = {
        type: colType,
    };
    if (colType === "location") {
        newValue.location = createAVLocationFromText(getCellValueContent(value) || "");
    } else if (colType === "number") {
        if (isAVDateType(value.type)) {
            newValue.number = {
                content: value[value.type as "date"].content,
                isNotEmpty: value[value.type as "date"].isNotEmpty
            };
        } else {
            newValue.number = {
                content: parseFloat(getCellValueContent(value)) || 0,
                isNotEmpty: true
            };
        }
    } else if (isAVTextType(colType)) {
        newValue[colType as "text"] = {
            content: getCellValueContent(value).toString()
        };
    } else if (colType === "mSelect" || colType === "select") {
        newValue.mSelect = [{
            content: getCellValueContent(value).toString(),
            color: "1"
        }];
        if (!newValue.mSelect[0].content) {
            newValue.mSelect = [];
        }
    } else if (colType === "rollup") {
        newValue.rollup = {contents: [value]};
    } else if (colType === "checkbox") {
        newValue.checkbox = {
            checked: true
        };
    } else if (colType === "relation") {
        return genRelationAVCellValue(value);
    } else if (colType === "mAsset") {
        const content = getCellValueContent(value).toString();
        newValue.mAsset = [{
            type: Constants.SIYUAN_ASSETS_IMAGE.includes(getAssetExtension(content).toLowerCase()) &&
                isBrowserRenderableImagePath(content) ? "image" : "file",
            content,
            name: "",
        }];
    } else if (isAVDateType(colType)) {
        if (isAVDateType(value.type)) {
            newValue[colType as "date"] = JSON.parse(JSON.stringify(value[value.type as "date"]));
        } else {
            newValue[colType as "date"] = {
                content: null,
                isNotEmpty: false,
                content2: null,
                isNotEmpty2: false,
                hasEndDate: false,
                isNotTime: true,
            };
        }
    } else if (colType === "lineNumber") {
        return {
            type: "lineNumber"
        };
    }
    return newValue;
};

export const genCellValue = (colType: TAVCol, value: string | any, dateFormat: TAVDateFormat = "") => {
    let cellValue: IAVCellValue = {
        type: colType,
        [colType === "select" ? "mSelect" : colType]: value as IAVCellDateValue
    };
    if (typeof value === "string" && value) {
        if (colType === "location") {
            cellValue = {type: colType, location: createAVLocationFromText(value)};
        } else if (colType === "number") {
            cellValue = {
                type: colType,
                number: {
                    content: parseFloat(value) || 0,
                    isNotEmpty: true
                }
            };
        } else if (isAVTextType(colType)) {
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
        } else if (isAVDateType(colType)) {
            cellValue = {
                type: colType,
                [colType]: parseDateValue(value, dateFormat)
            };
        } else if (colType === "relation") {
            cellValue = {
                type: colType,
                relation: {blockIDs: [value], contents: []}
            };
        } else if (colType === "mAsset") {
            const type = getAssetExtension(value).toLowerCase();
            cellValue = {
                type: colType,
                mAsset: [{
                    type: Constants.SIYUAN_ASSETS_IMAGE.includes(type) &&
                        isBrowserRenderableImagePath(value) ? "image" : "file",
                    content: value,
                    name: "",
                }]
            };
        }
    } else if (typeof value === "undefined" || !value) {
        cellValue = genEmptyAVCellValue(colType);
    }
    if (colType === "location") {
        cellValue.location = createAVLocationReplacement(cellValue.location);
    }
    if (colType === "block") {
        if (typeof value === "object" && value && value.id) {
            cellValue.isDetached = false;
        } else {
            cellValue.isDetached = true;
        }
    }
    return cellValue;
};

export const cellScrollIntoView = (blockElement: HTMLElement, cellElement: Element, onlyHeight = true) => {
    const columnID = cellElement.getAttribute("data-col-id");
    if (columnID) {
        ensureAVColumnWindow(blockElement, columnID);
    }
    const cellRect = cellElement.getBoundingClientRect();
    if (!onlyHeight) {
        const avScrollElement = cellElement.closest(".av__scroll") || blockElement.querySelector(".av__scroll");
        const rowElement = hasClosestByClassName(cellElement, "av__row");
        if (avScrollElement && rowElement) {
            const stickyElement = rowElement.querySelector(".av__colsticky");
            const unfreeze = rowElement.parentElement.classList.contains("av__body--unfreeze");
            if (unfreeze || !stickyElement.contains(cellElement)) { // https://github.com/siyuan-note/siyuan/issues/12162
                const avScrollRect = avScrollElement.getBoundingClientRect();
                const stickyRight = unfreeze ? avScrollRect.left : stickyElement.getBoundingClientRect().right;
                if (stickyRight > cellRect.left || avScrollRect.right < cellRect.left) {
                    avScrollElement.scrollLeft = avScrollElement.scrollLeft + cellRect.left - stickyRight;
                } else if (stickyRight < cellRect.left && avScrollRect.right < cellRect.right) {
                    if (cellRect.width + stickyRight > avScrollRect.right) {
                        avScrollElement.scrollLeft = avScrollElement.scrollLeft + cellRect.left - stickyRight;
                    } else {
                        avScrollElement.scrollLeft = avScrollElement.scrollLeft + cellRect.right - avScrollRect.right;
                    }
                }
            }
        }
    }
    /// #if MOBILE
    const contentElement = hasClosestByClassName(blockElement, "protyle-content", true);
    if (contentElement && cellElement.getAttribute("data-dtype") !== "checkbox") {
        let keyboardToolbarTop = window.innerHeight / 2 - 48;
        if (window.siyuan.mobile.size.isLandscape) {
            if (window.siyuan.mobile.size.landscape.height1 !== window.siyuan.mobile.size.landscape.height2) {
                keyboardToolbarTop = window.siyuan.mobile.size.landscape.height2 - 48;
            }
        } else {
            if (window.siyuan.mobile.size.portrait.height1 !== window.siyuan.mobile.size.portrait.height2) {
                keyboardToolbarTop = window.siyuan.mobile.size.portrait.height2 - 48;
            }
        }
        if (cellRect.bottom > keyboardToolbarTop) {
            contentElement.scrollTop = contentElement.scrollTop + (cellRect.bottom - keyboardToolbarTop);
        } else if (cellRect.top < 110) {
            contentElement.scrollTop -= 110 - cellRect.top;
        }
    }
    /// #else
    if (!blockElement.querySelector(".av__header")) {
        // 属性面板
        return;
    }
    const bodyElement = hasClosestByClassName(cellElement, "av__body");
    if (!bodyElement) {
        return;
    }
    const isList = blockElement.getAttribute("data-av-type") === "list";
    const avHeaderRect = (isList ? blockElement.querySelector(".av__views") :
        bodyElement.querySelector(".av__row--header")).getBoundingClientRect();
    if (avHeaderRect.bottom > cellRect.top) {
        const contentElement = hasClosestByClassName(blockElement, "protyle-content", true);
        if (contentElement) {
            contentElement.scrollTop = contentElement.scrollTop + cellRect.top - avHeaderRect.bottom;
        }
    } else {
        const footerElement = isList ? null : bodyElement.querySelector(".av__row--footer");
        if (footerElement?.querySelector(".av__calc--ashow")) {
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
                    contentElement.scrollTop = contentElement.scrollTop + (cellRect.bottom - contentRect.bottom);
                }
            }
        }
    }
    /// #endif
};

export const getTypeByCellElement = (cellElement: Element) => {
    if (cellElement.parentElement.classList.contains("av__gallery-field")) {
        return cellElement.getAttribute("data-dtype") as TAVCol;
    }
    const scrollElement = hasClosestByClassName(cellElement, "av__scroll");
    if (!scrollElement) {
        return;
    }
    return scrollElement.querySelector(".av__row--header").querySelector(`[data-col-id="${cellElement.getAttribute("data-col-id")}"]`).getAttribute("data-dtype") as TAVCol;
};

const getStableTextCells = (cellElements: HTMLElement[], blockElement: HTMLElement, type: "text" | "block") => {
    const viewType = blockElement.dataset.avType as TAVView;
    const stableCells: IAVSelectedCell[] = [];
    cellElements.forEach((cellElement) => {
        const rowID = getFieldIdByCellElement(cellElement, viewType);
        const colID = getColId(cellElement, viewType);
        const value = getStoredCellValueByElement(cellElement) || genCellValueByElement(type, cellElement);
        const rowElement = hasClosestByClassName(cellElement,
            isTableLikeView(viewType) ? "av__row" : "av__gallery-item");
        const groupElement = hasClosestByClassName(cellElement, "av__body");
        const rowIndex = parseInt(rowElement ? rowElement.getAttribute("data-index") || "0" : "0") || 0;
        const stableCell = createAVStableTextCell({
            groupID: groupElement ? groupElement.getAttribute("data-group-id") || "" : "",
            rowID,
            colID,
            rowIndex,
            colIndex: Array.from(cellElement.parentElement?.querySelectorAll(":scope > .av__cell") || [])
                .indexOf(cellElement),
            cellID: cellElement.dataset.id,
            value,
        });
        if (stableCell) {
            stableCells.push(stableCell);
        }
    });
    return stableCells;
};

const createCellInputTarget = (protyle: IProtyle, blockElement: HTMLElement,
                               cellElements: HTMLElement[], type: TAVCol) => {
    const avID = blockElement.dataset.avId;
    const hostID = getAVHostIdentity(blockElement);
    const rootID = protyle.block.rootID;
    const attributeSelect = (type === "select" || type === "mSelect") && cellElements.every(element =>
        element.classList.contains("custom-attr__avvalue") && !element.dataset.avBatchOriginalValue);
    const cellOwner = getAVCellEditorOwner(blockElement);
    const ownerElement = attributeSelect ?
        cellOwner.closest<HTMLElement>(".protyle-db-attr, .protyle-db-row, .b3-dialog__container") || cellOwner : cellOwner;
    const attributeID = blockElement.dataset.attributeId;
    const viewType = blockElement.dataset.avType as TAVView;
    const initialData = getAVData(blockElement);
    const viewID = initialData?.viewID || initialData?.view.id;
    const viewAttribute = blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
    const relationHost = getAVRelationHost(blockElement);
    const relationViewID = relationHost?.viewID;
    const relationBlockID = relationHost?.sourceBlockID;
    const relationContext = relationHost ? {...relationHost.relationContext} : undefined;
    const targets = cellElements.map(element => ({
        element,
        rowID: getFieldIdByCellElement(element, viewType),
        colID: getColId(element, viewType),
        groupID: element.closest<HTMLElement>(".av__body")?.dataset.groupId || "",
        isBatch: Boolean(element.dataset.avBatchOriginalValue),
    }));
    const resolveCell = (view: IAVView, target: typeof targets[number], root = true): IAVSelectedCell | undefined => {
        if (target.isBatch || (target.groupID ? view.id === target.groupID : root && !view.groups?.length)) {
            const columns = (view as IAVTable).columns || (view as IAVGallery).fields || [];
            const rows: Array<IAVRow | IAVGalleryItem> = (view as IAVTable).rows || (view as IAVGallery).cards || [];
            const colIndex = columns.findIndex(column => column.id === target.colID && column.type === type);
            const rowIndex = rows.findIndex(row => row.id === target.rowID);
            const row = rows[rowIndex];
            const cell = row && ("cells" in row ? row.cells : row.values)[colIndex];
            if (cell) {
                return {
                    groupID: target.groupID, rowID: target.rowID, colID: target.colID, rowIndex, colIndex,
                    cell: {...cell, value: cloneAVCellValueSnapshot(cell.value)}, column: columns[colIndex],
                };
            }
        }
        for (const group of view.groups || []) {
            const cell = resolveCell(group, target, false);
            if (cell) return cell;
        }
    };
    return () => {
        if (attributeSelect && !blockElement.isConnected) {
            // 属性栏刷新会替换数据库容器，只在原面板内恢复同一属性目标。
            const currentBlock = ownerElement.querySelector<HTMLElement>(
                `[data-av-id="${escapeAttr(avID)}"][data-attribute-id="${escapeAttr(attributeID || "")}"]` +
                `[data-node-id="${escapeAttr(hostID)}"]`);
            if (!currentBlock) return;
            blockElement = currentBlock;
        }
        const currentRelationHost = getAVRelationHost(blockElement);
        if (!blockElement.isConnected || !ownerElement.contains(blockElement) ||
            (attributeSelect && blockElement.dataset.attributeId !== attributeID) ||
            blockElement.dataset.avId !== avID || getAVHostIdentity(blockElement) !== hostID ||
            blockElement.dataset.avType !== viewType || protyle.block.rootID !== rootID ||
            blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) !== viewAttribute ||
            currentRelationHost !== relationHost || currentRelationHost?.viewID !== relationViewID ||
            currentRelationHost?.sourceBlockID !== relationBlockID ||
            currentRelationHost?.relationContext.sourceAvID !== relationContext?.sourceAvID ||
            currentRelationHost?.relationContext.sourceItemID !== relationContext?.sourceItemID ||
            currentRelationHost?.relationContext.relationKeyID !== relationContext?.relationKeyID ||
            !canEditAVHost(blockElement, protyle)) {
            return;
        }
        const data = getAVData(blockElement);
        if (initialData && (!data || (data.viewID || data.view.id) !== viewID)) return;
        const cells: IAVSelectedCell[] = [];
        const values: IAVCellValue[] = [];
        const attributeElements: HTMLElement[] = [];
        for (const target of targets) {
            if (!target.rowID || !target.colID) return;
            if (attributeSelect) {
                const element = blockElement.querySelector<HTMLElement>(
                    `.custom-attr__avvalue[data-row-id="${escapeAttr(target.rowID)}"]` +
                    `[data-col-id="${escapeAttr(target.colID)}"][data-type="${type}"]`);
                if (!element) return;
                attributeElements.push(element);
                values.push(genCellValueByElement(type, element));
            } else if (data) {
                // 从当前模型读取撤销值和块绑定，行卸载及字段重排不会改变原编辑目标。
                const cell = resolveCell(data.view, target);
                if (!cell) return;
                cells.push(cell);
            } else if (!blockElement.contains(target.element) ||
                getFieldIdByCellElement(target.element, viewType) !== target.rowID ||
                getColId(target.element, viewType) !== target.colID ||
                (target.element.dataset.dtype || target.element.dataset.type) !== type) {
                return;
            }
        }
        if (attributeSelect) {
            attributeElements.forEach((element, index) => cellElements[index] = element);
            return {cells, values, elements: attributeElements, blockElement};
        }
        // 批量代理保存显示值供销毁回调同步，普通单元格的显示更新只绑定当前挂载的原分组条目。
        return {cells, values, blockElement, elements: targets.map(target => {
            if (!data || target.isBatch) return target.element;
            const group = target.groupID ? `.av__body[data-group-id="${escapeAttr(target.groupID)}"] ` : "";
            return blockElement.querySelector<HTMLElement>(`${group}` +
                `.${isTableLikeView(viewType) ? "av__row" : "av__gallery-item"}[data-id="${target.rowID}"] ` +
                `.av__cell[${isTableLikeView(viewType) ? "data-col-id" : "data-field-id"}="${target.colID}"]`);
        })};
    };
};

export interface IAVCellInputElements extends Array<HTMLElement> {
    resolveAVCellInput?: ReturnType<typeof createCellInputTarget>;
    assetPanelValues?: IAVCellAssetValue[];
}

export const captureAVCellInput = (protyle: IProtyle, blockElement: HTMLElement,
                                   cellElements: IAVCellInputElements) => {
    const element = cellElements[0];
    const type = (element.dataset.dtype || element.dataset.type) as TAVCol || getTypeByCellElement(element);
    // 面板各入口共享同一集合；解析器保留打开时的标识，不能被重绘后的选区或节点替换覆盖。
    Object.defineProperty(cellElements, "resolveAVCellInput", {
        configurable: true,
        value: createCellInputTarget(protyle, blockElement, cellElements, type),
    });
};

export const popTextCell = (protyle: IProtyle, cellElements: HTMLElement[], type?: TAVCol, options?: {
    scrollIntoView?: boolean;
    data?: IAV;
    destroyCallback?: () => void;
    keepMenuOpen?: boolean;
    positionByMenu?: boolean;
    requireExplicitChange?: boolean;
}) => {
    if (cellElements.length === 0 || (cellElements.length === 1 && !cellElements[0])) {
        options?.destroyCallback?.();
        return;
    }
    if (!type) {
        type = getTypeByCellElement(cellElements[0]);
    }
    if (type === "updated" || type === "created" || document.querySelector(".av__mask, [data-av-location-editor]")) {
        options?.destroyCallback?.();
        return;
    }
    const blockElement = hasClosestBlock(cellElements[0]);
    if (!blockElement) {
        options?.destroyCallback?.();
        return;
    }
    if (type === "template" && getAVRelationHost(blockElement)) {
        showMessage(window.siyuan.languages._attrView.relatedDatabaseViewSharedTip);
        options?.destroyCallback?.();
        return;
    }
    const viewType = blockElement.getAttribute("data-av-type") as TAVView;
    let cellRect = cellElements[0].getBoundingClientRect();
    const contentElement = hasClosestByClassName(blockElement, "protyle-content", true);
    if (isTableLikeView(viewType) && options?.scrollIntoView !== false) {
        cellScrollIntoView(blockElement, cellElements[0], false);
    }
    cellRect = cellElements[0].getBoundingClientRect();
    let html = "";
    const cssStyle = getComputedStyle(cellElements[0]);
    const storedCellValue = getStoredCellValueByElement(cellElements[0]);
    if (type === "location") {
        const ownerElement = getAVCellEditorOwner(blockElement);
        const avID = blockElement.dataset.avId;
        const blockID = getAVHostIdentity(blockElement);
        const rootID = protyle.block.rootID;
        const locationCells: IAVSelectedCell[] = cellElements.map(element => {
            const value = cloneAVCellValueSnapshot(genCellValueByElement("location", element));
            return {
                groupID: element.closest<HTMLElement>(".av__body")?.dataset.groupId || "",
                rowID: getFieldIdByCellElement(element, viewType),
                colID: getColId(element, viewType),
                rowIndex: 0,
                colIndex: -1,
                cell: {id: value.id || element.dataset.id || "", color: "", bgColor: "", value, valueType: "location"},
                column: {id: getColId(element, viewType), type: "location"} as IAVColumn,
            };
        });
        const isCurrentTarget = () => {
            if (!blockElement.isConnected || !ownerElement.contains(blockElement) ||
                blockElement.dataset.avId !== avID || getAVHostIdentity(blockElement) !== blockID ||
                protyle.block.rootID !== rootID) {
                return false;
            }
            const data = getAVData(blockElement);
            return locationCells.every(item => data ?
                hasAVCachedCellType(data.view, item.rowID, item.colID, "location") :
                !!blockElement.querySelector(`[data-row-id="${item.rowID}"][data-col-id="${item.colID}"][data-type="location"]`));
        };
        if (!options?.keepMenuOpen) {
            window.siyuan.menus.menu.remove();
        }
        openAVLocationEditor({
            value: (storedCellValue || genCellValueByElement(type, cellElements[0])).location,
            ownerElement,
            avBlockID: blockID,
            isValid: isCurrentTarget,
            onSave: async value => {
                if (!isCurrentTarget() || protyle.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
                    protyle.options.history?.created || protyle.options.history?.snapshot) {
                    return;
                }
                const batchCells = cellElements[0].dataset.avBatchOriginalValue ? cellElements : undefined;
                await updateCellsValue(protyle, blockElement, value, batchCells, undefined, undefined,
                    false, false, false, locationCells, true, true);
            },
            onDestroy: options?.destroyCallback,
        });
        return;
    }
    const hasRenderedTemplate = cellElements[0].matches(".av__celltext--template") ||
        Boolean(cellElements[0].querySelector(":scope > .av__celltext--template, :scope > .av__primary-container > .av__cellprimary > .av__celltext--template"));
    if ((type === "text" || type === "block") && !hasRenderedTemplate) {
        const stableCells = getStableTextCells(cellElements, blockElement, type);
        if (stableCells.length > 0) {
            if (!options?.keepMenuOpen) {
                window.siyuan.menus.menu.remove();
            }
            openAVRichTextEditor({
                protyle,
                nodeElement: blockElement,
                anchorElement: cellElements[0],
                value: stableCells[0].cell.value,
                stableCells,
                onSave: async (value, nodeElement, selectedCells) => {
                    await updateCellsValue(protyle, nodeElement, value, undefined, undefined, undefined,
                        false, false, false, selectedCells, true, true);
                },
                onDestroy: options?.destroyCallback,
                prepareNextInput: anchorElement => cellElements.length === 1 ?
                    prepareAVContinuousInput(protyle, blockElement, [anchorElement], cell => popTextCell(protyle, [cell])) : undefined,
            });
            return;
        }
    }
    let style = `font-family:${cssStyle.fontFamily};font-size:${cssStyle.fontSize};line-height:${cssStyle.lineHeight};padding:${cssStyle.padding};position:absolute;`;
    if (options?.positionByMenu) {
        style += `height:${cellRect.height}px;width:${Math.max(cellRect.width, 200)}px;left:${cellRect.left}px;top:${cellRect.bottom}px;`;
    }
    style = `style='${style}'`;

    if (isAVRichTextType(type)) {
        html = `<textarea ${style} spellcheck="false" class="b3-text-field"></textarea>`;
    } else if (type === "url") {
        const content = storedCellValue?.url?.content ?? cellElements[0].querySelector(".av__celltext")?.getAttribute("data-href") ?? "";
        html = `<textarea ${style} spellcheck="false" class="b3-text-field">${escapeHtml(content)}</textarea>`;
    } else if (type === "number") {
        const content = storedCellValue?.number?.isNotEmpty ? (storedCellValue.number.content ?? "").toString() :
            cellElements[0].querySelector(".av__celltext")?.getAttribute("data-content") || "";
        html = `<input type="number" spellcheck="false" value="${escapeAttr(content)}" ${style} class="b3-text-field">`;
    } else {
        /// #if MOBILE
        activeBlur(true);
        /// #endif
        if (isAVSelectType(type)) {
            if (blockElement.getAttribute("data-rendering") === "true") {
                options?.destroyCallback?.();
                return;
            }
            openMenuPanel({
                protyle,
                blockElement,
                type: "select",
                cellElements,
                data: options?.data,
                destroyCallback: options?.destroyCallback,
                keepMenuOpen: options?.keepMenuOpen,
                requireExplicitChange: options?.requireExplicitChange,
            });
        } else if (type === "mAsset") {
            openMenuPanel({
                protyle,
                blockElement,
                type: "asset",
                cellElements,
                data: options?.data,
                destroyCallback: options?.destroyCallback,
                keepMenuOpen: options?.keepMenuOpen,
            });
            if (!hasClosestByClassName(cellElements[0], "custom-attr")) {
                focusBlock(blockElement);
            }
        } else if (type === "date") {
            openMenuPanel({
                protyle,
                blockElement,
                type: "date",
                cellElements,
                data: options?.data,
                destroyCallback: options?.destroyCallback,
                keepMenuOpen: options?.keepMenuOpen,
                requireExplicitChange: options?.requireExplicitChange,
            });
        } else if (type === "checkbox") {
            updateCellValueByInput(protyle, type, blockElement, cellElements);
            options?.destroyCallback?.();
        } else if (type === "relation") {
            openMenuPanel({
                protyle,
                blockElement,
                type: "relation",
                cellElements,
                data: options?.data,
                destroyCallback: options?.destroyCallback,
                keepMenuOpen: options?.keepMenuOpen,
            });
        } else if (type === "rollup") {
            openMenuPanel({
                protyle,
                blockElement,
                type: "rollup",
                cellElements,
                colId: getColId(cellElements[0], viewType),
                data: options?.data,
                destroyCallback: options?.destroyCallback,
                keepMenuOpen: options?.keepMenuOpen,
            });
        } else {
            options?.destroyCallback?.();
        }
        if (isTableLikeView(viewType) && !hasClosestByClassName(cellElements[0], "custom-attr")) {
            cellElements[0].classList.add("av__cell--select");
            addDragFill(cellElements[0]);
        }
        return;
    }
    if (!options?.keepMenuOpen) {
        window.siyuan.menus.menu.remove();
    }
    const inputTarget = type === "template" ? undefined : createCellInputTarget(protyle, blockElement, cellElements, type);
    document.body.insertAdjacentHTML("beforeend", `<div class="av__mask" data-av-block-id="${escapeAttr(getAVHostIdentity(blockElement))}" style="z-index: ${++window.siyuan.zIndex}">
    ${html}
    </div>`);
    const avMaskElement = document.querySelector(".av__mask");
    let savingContinuousInput = false;
    avMaskElement.addEventListener(AV_CELL_EDITOR_CLOSE_EVENT, () => {
        if (savingContinuousInput) {
            avMaskElement.remove();
            return;
        }
        updateCellValueByInput(protyle, type, blockElement, cellElements, false, inputTarget);
        avMaskElement.remove();
    }, {once: true});
    if (options?.destroyCallback) {
        const parentElement = avMaskElement.parentElement;
        const observer = new MutationObserver(() => {
            if (!avMaskElement.isConnected) {
                observer.disconnect();
                options.destroyCallback();
            }
        });
        observer.observe(parentElement, {childList: true});
    }
    const inputElement = avMaskElement.querySelector(".b3-text-field") as HTMLInputElement;
    if (inputElement) {
        let getInputAnchor = () => cellElements[0];
        if (options?.positionByMenu) {
            setPosition(inputElement, cellRect.left, cellRect.bottom, cellRect.height);
        } else {
            const anchorRow = cellElements[0].closest<HTMLElement>(".av__row[data-id], .av__gallery-item[data-id]");
            const groupID = cellElements[0].closest<HTMLElement>(".av__body[data-group-id]")?.dataset.groupId;
            const fieldAttr = isTableLikeView(viewType) ? "data-col-id" : "data-field-id";
            const fieldID = cellElements[0].getAttribute(fieldAttr);
            const anchorSelector = anchorRow && fieldID ?
                `${groupID ? `.av__body[data-group-id="${escapeAttr(groupID)}"] ` : ""}` +
                `.${anchorRow.classList.contains("av__row") ? "av__row" : "av__gallery-item"}[data-id="${anchorRow.dataset.id}"] .av__cell[${fieldAttr}="${fieldID}"]` : "";
            getInputAnchor = () => {
                if (!cellElements[0].isConnected && anchorSelector && blockElement.isConnected) {
                    // 行重绘后按原分组、行和字段重新绑定，输入内容继续保留在同一个编辑框中。
                    const anchor = blockElement.querySelector<HTMLElement>(anchorSelector);
                    if (anchor) {
                        cellElements[0] = anchor;
                    }
                }
                return cellElements[0];
            };
            bindAnchoredInputPosition(inputElement, getInputAnchor, contentElement || undefined);
        }
        if (isAVRichTextType(type)) {
            const storedContent = type === "template" ? undefined :
                storedCellValue?.[type as "text"]?.content;
            inputElement.value = typeof storedContent === "string" ? storedContent :
                cellElements[0].querySelector(".av__celltext")?.textContent || "";
        }
        if (type !== "template") {
            inputElement.addEventListener("input", () => {
                inputElement.dataset.changed = "true";
            });
        }
        inputElement.select();
        inputElement.focus();
        callMobileAppShowKeyboard();
        if (type === "template") {
            inputElement.value = "";
            inputElement.disabled = true;
            fetchPost("/api/av/renderAttributeView", {
                id: blockElement.dataset.avId,
                blockID: blockElement.dataset.nodeId,
                ignoreRows: true,
            }, (response) => {
                if (!avMaskElement.isConnected || response.code !== 0 || !isAVRenderData(response.data)) {
                    return;
                }
                getFieldsByData(response.data).find((item: IAVColumn) => {
                    if (item.id === getColId(cellElements[0], viewType)) {
                        inputElement.value = item.template;
                        inputElement.dataset.template = item.template;
                        inputElement.disabled = false;
                        inputElement.focus();
                        inputElement.select();
                        return true;
                    }
                });
            });
        }
        if (type === "block" && !cellElements[0].dataset.avId && !getAVRelationHost(blockElement)) {
            inputElement.addEventListener("input", (event: InputEvent) => {
                if (Constants.BLOCK_HINT_KEYS.includes(inputElement.value.substring(0, 2))) {
                    const anchor = getInputAnchor();
                    if (!anchor?.isConnected || !blockElement.contains(anchor) || !inputTarget()) return;
                    protyle.toolbar.range = document.createRange();
                    protyle.toolbar.range.selectNodeContents(anchor.lastChild);
                    focusByRange(protyle.toolbar.range);
                    if (isTableLikeView(viewType)) {
                        cellElements[0].classList.add("av__cell--select");
                        addDragFill(cellElements[0]);
                    }
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
        inputElement.addEventListener("keydown", async (event) => {
            if (savingContinuousInput) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (event.isComposing) {
                return;
            }
            if (electronUndo(event)) {
                return;
            }
            if (isAVContinuousInputKey(event, true) && type !== "template" && type !== "text") {
                const next = prepareAVContinuousInput(protyle, blockElement, cellElements,
                    cell => popTextCell(protyle, [cell]));
                if (next) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.repeat) return;
                    savingContinuousInput = true;
                    inputElement.disabled = true;
                    try {
                        const saved = await updateCellValueByInput(protyle, type, blockElement, cellElements, true, inputTarget, true);
                        if (saved) next();
                    } catch (error) {
                        console.error(error);
                        if (avMaskElement.isConnected) showMessage(window.siyuan.languages.settingsPendingSaveError);
                    } finally {
                        savingContinuousInput = false;
                        inputElement.disabled = false;
                    }
                    return;
                }
            }
            if (event.key === "Escape" || event.key === "Tab" ||
                (event.key === "Enter" && type !== "text" && !event.shiftKey && isNotCtrl(event))) {
                updateCellValueByInput(protyle, type, blockElement, cellElements, true, inputTarget);
                if (event.key === "Tab" && !getAVRelationHost(blockElement)) {
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
        if (savingContinuousInput) return;
        if ((event.target as HTMLElement).classList.contains("av__mask")
            && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
            updateCellValueByInput(protyle, type, blockElement, cellElements, true, inputTarget);
            avMaskElement?.remove();
            if (options?.keepMenuOpen) {
                window.siyuan.menus.menu.remove();
            }
        }
    };
    avMaskElement.addEventListener("click", (event) => {
        removeAvMask(event);
    });
    avMaskElement.addEventListener("contextmenu", (event) => {
        removeAvMask(event);
    });
    avMaskElement.addEventListener("mousedown", (event: MouseEvent & { target: HTMLElement }) => {
        if (event.button === 1) {
            if (event.target.classList.contains("av__mask") && document.activeElement && document.activeElement.nodeType === 1) {
                (document.activeElement as HTMLElement).blur();
            }
            removeAvMask(event);
        }
    });
};

const updateCellValueByInput = async (protyle: IProtyle, type: TAVCol, blockElement: HTMLElement, cellElements: HTMLElement[],
                                     restoreFocus = true, inputTarget?: ReturnType<typeof createCellInputTarget>, awaitSave = false) => {
    const viewType = blockElement.getAttribute("data-av-type") as TAVView;
    if (!inputTarget && isTableLikeView(viewType) && !cellElements[0].dataset.avId) {
        const rowElement = hasClosestByClassName(cellElements[0], "av__row");
        if (!rowElement) {
            return false;
        }
        if (cellElements.length === 1 && cellElements[0].dataset.detached === "true" && !rowElement.dataset.id) {
            return false;
        }
    }
    const avMaskElement = document.querySelector(".av__mask");
    const avID = blockElement.getAttribute("data-av-id");
    if (type === "template") {
        const colId = getColId(cellElements[0], viewType);
        const textElement = avMaskElement.querySelector(".b3-text-field") as HTMLInputElement;
        if (textElement.dataset.template !== undefined && !textElement.disabled &&
            textElement.value !== textElement.dataset.template && !blockElement.getAttribute("data-loading")) {
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
        const inputElement = avMaskElement?.querySelector(".b3-text-field") as HTMLInputElement;
        const unchanged = type !== "checkbox" && inputElement?.dataset.changed !== "true";
        if (unchanged) {
            document.querySelectorAll(".av__mask").forEach((item) => {
                item.remove();
            });
            if (restoreFocus) {
                focusBlock(blockElement);
            }
            return true;
        }
        const target = inputTarget?.();
        if (inputTarget && !target) {
            avMaskElement?.remove();
            return false;
        }
        const value = type === "checkbox" ? {
            checked: !genCellValueByElement(type, cellElements[0]).checkbox?.checked
        } : inputElement.value;
        if (target) {
            if (awaitSave) {
                await updateCellsValue(protyle, blockElement, value, target.elements, undefined, undefined,
                    false, false, false, target.cells, true, true);
            } else {
                updateCellsValue(protyle, blockElement, value, target.elements, undefined, undefined,
                    false, false, false, target.cells);
            }
        } else {
            if (awaitSave) {
                await updateCellsValue(protyle, blockElement, value, cellElements, undefined, undefined,
                    false, false, false, undefined, true, true);
            } else {
                updateCellsValue(protyle, blockElement, value, cellElements);
            }
        }
    }
    if (awaitSave && (!blockElement.isConnected || !avMaskElement?.isConnected)) return false;
    if (awaitSave && document.activeElement !== document.body && !avMaskElement.contains(document.activeElement)) {
        avMaskElement.remove();
        return false;
    }
    if (isTableLikeView(viewType) &&
        // 兼容新增行后台隐藏
        cellElements[0] &&
        !hasClosestByClassName(cellElements[0], "custom-attr")) {
        cellElements[0].classList.add("av__cell--select");
        addDragFill(cellElements[0]);
    }
    //  单元格编辑中 ctrl+p 光标定位
    if (restoreFocus && !document.querySelector(".b3-dialog")) {
        focusBlock(blockElement);
    }
    if (awaitSave) avMaskElement.remove();
    else document.querySelectorAll(".av__mask").forEach(item => item.remove());
    return true;
};

export const updateCellsValue = async (protyle: IProtyle, nodeElement: HTMLElement, value?: any,
                                       cElements?: HTMLElement[], columns?: IAVColumn[], html?: string, getOperations = false,
                                       forceOperation = false, replaceSelectValues = false,
                                       stableCells?: IAVSelectedCell[], updateElements = true, awaitSave = false) => {
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const updateSavedElements: Array<() => void> = [];
    const resolveInput = (cElements as IAVCellInputElements)?.resolveAVCellInput;
    const inputTarget = resolveInput?.();
    if (resolveInput && !inputTarget) {
        return getOperations ? {doOperations, undoOperations} : {text: "", json: [] as IAVCellValue[][]};
    }
    if (inputTarget) {
        stableCells = inputTarget.cells;
        cElements = inputTarget.elements;
    }

    const avID = nodeElement.dataset.avId;
    const id = nodeElement.dataset.nodeId;
    let text = "";
    const json: IAVCellValue[][] = [];
    let cellElements: Element[] = [];
    let selectedCells: IAVSelectedCell[] = [];
    if (stableCells?.length > 0) {
        selectedCells = stableCells;
        cellElements = cElements || [];
    } else if (cElements?.length > 0) {
        cellElements = cElements;
    } else {
        selectedCells = stableCells || getAVSelectedCells(nodeElement);
        if (selectedCells.length === 0) {
            cellElements = Array.from(nodeElement.querySelectorAll(".av__cell--active, .av__cell--select"));
        }
        if (cellElements.length === 0 && selectedCells.length === 0) {
            nodeElement.querySelectorAll(".av__row--select:not(.av__row--header)").forEach(rowElement => {
                rowElement.querySelectorAll(".av__cell").forEach(cellElement => {
                    cellElements.push(cellElement);
                });
            });
        }
    }
    const sources: Array<{ element?: HTMLElement, selectedCell?: IAVSelectedCell }> = selectedCells.length > 0 ?
        selectedCells.map((selectedCell, index) => ({selectedCell, element: cellElements[index] as HTMLElement})) :
        cellElements.map((element: HTMLElement) => ({element}));
    if (sources.length === 0) {
        return {text: "", json};
    }
    const isCustomAttr = !getAVRelationHost(nodeElement) && sources[0].element ?
        Boolean(hasClosestByClassName(sources[0].element, "custom-attr")) : false;
    const viewType = nodeElement.getAttribute("data-av-type") as TAVView;
    let batchDisplayValue: IAVCellValue;
    let nextBatchDisplayValue: IAVCellValue;
    for (let elementIndex = 0; elementIndex < sources.length; elementIndex++) {
        const source = sources[elementIndex];
        let item = source.element;
        const rowID = source.selectedCell?.rowID || (item ? getFieldIdByCellElement(item, viewType) : "");
        if (!rowID) {
            continue;
        }
        if (item && !source.selectedCell && !nodeElement.contains(item)) {
            if (isTableLikeView(viewType)) {
                item = source.element = (nodeElement.querySelector(`.av__row[data-id="${rowID}"] .av__cell[data-col-id="${item.dataset.colId}"]`) ||
                    nodeElement.querySelector(`.fn__flex-1[data-col-id="${item.dataset.colId}"]`)) as HTMLElement;
            } else {
                item = source.element = nodeElement.querySelector(
                    `.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${item.dataset.fieldId}"]`) as HTMLElement;
            }
        }
        if (!item && !source.selectedCell) {
            // 兼容新增行后台隐藏
            continue;
        }
        const type = source.selectedCell?.column.type ||
            (item ? item.dataset.dtype as TAVCol || getTypeByCellElement(item) || item.dataset.type as TAVCol : undefined);
        if (!type) {
            continue;
        }
        const readonly = isAVReadonlyType(type);
        const cellId = source.selectedCell?.cell.id || item?.dataset.id || "";
        const colId = source.selectedCell?.colID || (item ? getColId(item, viewType) : "");
        const renderedOldValue = source.selectedCell?.cell.value ||
            (item ? genCellValueByElement(type, item) : undefined);
        const sourceOldValue = !source.selectedCell && item && renderedOldValue ?
            getAVBatchSourceValue(item, renderedOldValue) : renderedOldValue;
        if (!colId || !sourceOldValue) {
            continue;
        }
        const oldValue = cloneAVCellValueSnapshot(sourceOldValue);
        if (oldValue.type === "location") {
            oldValue.location = createAVLocationReplacement(oldValue.location);
        }
        if (type === "block") {
            oldValue.block.icon = oldValue.block.icon || "";
        }
        const batchMode = getAVBatchEditMode(item);
        if (elementIndex === 0 && item && batchMode !== "replace") {
            batchDisplayValue = getAVBatchDisplayValue(item, renderedOldValue);
        }
        if (!getOperations) {
            const nextSource = sources[elementIndex + 1];
            const sameNextRow = nextSource && (source.selectedCell ?
                nextSource.selectedCell?.rowID === rowID :
                Boolean(item?.nextElementSibling && item.nextElementSibling === nextSource.element));
            const cellText = item ? getCellText(item) :
                getCellValueText(oldValue, source.selectedCell?.column, source.selectedCell?.rowIndex);
            text += cellText + (sameNextRow ? "\t" : "\n\n");
            const previousSource = sources[elementIndex - 1];
            const samePreviousRow = previousSource && (source.selectedCell ?
                previousSource.selectedCell?.rowID === rowID :
                previousSource.element === item?.previousElementSibling);
            if (!samePreviousRow) {
                json.push([]);
            }
            json[json.length - 1].push(oldValue);
        }
        if (readonly) {
            continue;
        }
        let newValue = value;
        if (type === "location" && (typeof newValue === "string" ||
            (newValue?.type && newValue.type !== "location" && !cellValueIsEmpty(newValue)))) {
            const content = typeof newValue === "string" ? newValue : getCellValueContent(newValue) || "";
            try {
                createAVLocationFromText(content);
            } catch {
                showMessage(window.siyuan.languages.locationPasteInEditor, 6000, "error");
                continue;
            }
        }
        // relation 为全部更新，以下类型为添加
        if (type === "mAsset") {
            if (Array.isArray(value)) {
                newValue = (oldValue.mAsset || []).concat(value);
            } else if (typeof value !== "undefined" && typeof value !== "object") { // 不传入为删除，传入字符串不进行处理
                const htmlValue: IAVCellAssetValue[] = [];
                let link = protyle.lute.GetLinkDest(value);
                let name = "";
                // https://github.com/siyuan-note/siyuan/issues/13892
                if (!link && value.startsWith("assets/")) {
                    link = value;
                    name = getAssetName(value) + getAssetExtension(value);
                }
                // https://github.com/siyuan-note/siyuan/issues/12308
                if (html) {
                    const tempElement = document.createElement("template");
                    tempElement.innerHTML = html;
                    tempElement.content.querySelectorAll('[data-type~="a"], .img img').forEach(linkItem => {
                        if (linkItem.tagName === "IMG") {
                            htmlValue.push({
                                type: "image",
                                content: linkItem.getAttribute("data-src"),
                                name: ""
                            });
                        } else {
                            htmlValue.push({
                                type: "file",
                                content: linkItem.getAttribute("data-href"),
                                name: linkItem.textContent
                            });
                        }
                    });
                }
                if (link) {
                    const hasExited = htmlValue.find(valueItem => {
                        if (valueItem.content === link) {
                            return true;
                        }
                    });
                    if (!hasExited) {
                        htmlValue.push({
                            type: "file",
                            content: link,
                            name
                        });
                    }
                }
                if (htmlValue.length === 0 && value) {
                    htmlValue.push({
                        type: "file",
                        content: "",
                        name: value
                    });
                }
                newValue = (oldValue.mAsset || []).concat(htmlValue);
            }
        } else if (type === "mSelect" || type === "select") {
            // 不传入为删除
            if (typeof value === "string") {
                const oldSelectValues = replaceSelectValues ? [] : oldValue.mSelect || [];
                const newMSelectValue: IAVCellSelectValue[] = [];
                let colorIndex = oldSelectValues.length;
                // 以逗号分隔，去重，去空，去换行后做为选项
                [...new Set(value.split(",").map(v => v.trim().replace(/\n|\r\n|\r|\u2028|\u2029/g, "")))].forEach((item) => {
                    if (!item) {
                        return;
                    }
                    let hasSameContent = false;
                    oldSelectValues.find((mSelectItem) => {
                        if (mSelectItem.content === item) {
                            hasSameContent = true;
                            return true;
                        }
                    });
                    if (hasSameContent) {
                        return;
                    }
                    colorIndex++;
                    newMSelectValue.push({
                        content: item,
                        color: colorIndex.toString()
                    });
                });
                newValue = oldSelectValues.concat(newMSelectValue);
            }
        } else if (type === "relation" && batchMode !== "replace" && batchDisplayValue?.relation &&
            value?.blockIDs && value?.contents) {
            newValue = mergeAVBatchRelationValue(oldValue.relation, batchDisplayValue.relation, value, batchMode);
            nextBatchDisplayValue = genCellValue("relation", value);
        } else if (type === "block" && typeof value === "string" && oldValue.block.id) {
            newValue = {
                content: value,
                id: oldValue.block.id,
            };
            if (oldValue.block.icon) {
                newValue.icon = oldValue.block.icon;
            }
        }
        let column = source.selectedCell?.column || columns?.find(columnItem => columnItem.id === colId);
        if (type === "date" && !column) {
            const response = await fetchSyncPost("/api/av/getAttributeViewKeysByID", {avID, keyIDs: [colId]});
            if (response.code !== 0) {
                return;
            }
            column = response.data?.[0];
            if (resolveInput && !resolveInput()) {
                return getOperations ? {doOperations: [] as IOperation[], undoOperations: [] as IOperation[]} :
                    {text: "", json: [] as IAVCellValue[][]};
            }
        }
        let cellValue: IAVCellValue;
        if (typeof newValue === "object" && newValue.type) {
            cellValue = transformCellValue(type, newValue);
        } else {
            cellValue = genCellValue(type, newValue, column?.dateFormat);
            // 非空文本解析失败时跳过该单元格，空文本和清空操作仍可删除日期。
            if (type === "date" && typeof newValue === "string" && newValue.trim() && !cellValue.date.isNotEmpty) {
                continue;
            }
        }
        if (cellValue.type === "location") {
            cellValue.location = createAVLocationReplacement(cellValue.location);
        }
        if (type === "block" && typeof cellValue.block.icon === "undefined") {
            cellValue.block.icon = oldValue.block.icon || "";
        }
        if (type === "block") {
            if (cellValue.block.rich === undefined && cellValue.block.richBlockDOM === undefined) { cellValue.block.rich = null; }
        }
        cellValue = rebindAVCellValue(cellValue, {
            id: cellId,
            keyID: colId,
            blockID: rowID,
        });
        if ((cellValue.type === "date" && typeof cellValue.date === "string") ||
            (cellValue.type === "relation" && typeof cellValue.relation === "string")) {
            break;
        }
        if (columns && (type === "select" || type === "mSelect")) {
            const operations = mergeAddOption(columns.find(e => e.id === colId), cellValue, avID);
            doOperations.push(...operations.doOperations);
            undoOperations.push(...operations.undoOperations);
        }
        if (type === "date") {
            if (!(value && typeof value === "object" && typeof value.isNotTime === "boolean")) {
                if (column?.date) {
                    cellValue.date.isNotTime = !column.date.fillSpecificTime;
                }
            }
            cellValue.date.formattedContent = formatDateValue(cellValue.date, column?.dateFormat);
        }
        if (forceOperation || !objEquals(cellValue, oldValue)) {
            doOperations.push(createAVCellUpdateOperation({
                valueID: cellId,
                avID,
                blockID: id,
                keyID: colId,
                rowID,
                data: cellValue
            }));

            undoOperations.push(createAVCellUpdateOperation({
                valueID: cellId,
                avID,
                blockID: id,
                keyID: colId,
                rowID,
                data: oldValue
            }));
            const update = () => {
                if (!isCustomAttr && item) {
                    updateAttrViewCellAnimation(item, cellValue);
                }
                updateAttrViewCellInOtherElements(protyle, avID, rowID, colId, cellValue, item);
                updateAVSelectedCellValue(nodeElement, rowID, colId, cellValue);
            };
            if (updateElements) {
                if (awaitSave) updateSavedElements.push(update);
                else update();
            }
        }
    }
    if (nextBatchDisplayValue && updateElements) {
        setAVBatchDisplayValue(cellElements as HTMLElement[], nextBatchDisplayValue);
    }
    if (getOperations) {
        return {doOperations, undoOperations};
    }
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
        if (awaitSave) {
            await transaction(protyle, doOperations, undoOperations, {awaitResponse: true});
            if (nodeElement.isConnected) updateSavedElements.forEach(update => update());
        } else {
            transaction(protyle, doOperations, undoOperations);
        }
    }
    return {text: text.substring(0, text.length - 2), json};
};

export const updateAttrViewCellInOtherElements = (protyle: IProtyle, avID: string, rowID: string, colID: string,
                                                  value: IAVCellValue, sourceElement?: HTMLElement) => {
    const sourceWasMounted = sourceElement?.isConnected !== false;
    const updateCustomAttr = (cellElement: HTMLElement) => {
        const renderTemplate = cellElement.dataset.renderTemplate;
        const preserveTemplateDisplay = Boolean(renderTemplate?.trim()) &&
            typeof value.renderedContent !== "string" &&
            Boolean(cellElement.querySelector(".av__celltext--template"));
        if (cellElement.dataset.avBatchOriginalValue) {
            cellElement.dataset.avBatchChanged = "true";
        }
        if (value.id) {
            cellElement.dataset.id = value.id;
        } else {
            cellElement.removeAttribute("data-id");
        }
        cellElement.dataset.cellValue = encodeURIComponent(JSON.stringify(cloneAVCellValueSnapshot(value)));
        if (value.type === "checkbox") {
            renderCellAttr(cellElement, value);
        }
        if (!preserveTemplateDisplay) {
            cellElement.parentElement.dataset.empty = cellValueIsEmpty(value, true, renderTemplate).toString();
            // 输入框失焦保存时保留打开按钮，使随后的点击仍能到达该按钮。
            const sourceURLLink = cellElement === sourceElement && value.type === "url" &&
                cellElement.querySelector<HTMLAnchorElement>("a.block__icon");
            if (sourceURLLink) {
                if (value.url.content) {
                    sourceURLLink.setAttribute("href", value.url.content);
                } else {
                    sourceURLLink.removeAttribute("href");
                }
            } else {
                cellElement.innerHTML = genAVValueHTML(value, cellElement.dataset.dateFormat as TAVDateFormat,
                    renderTemplate, cellElement.dataset.relationExpanded === "true" ? Infinity : 5);
                renderAVRichTextElements(cellElement);
            }
        }
        if (value.type === "block") {
            const iconElement = cellElement.querySelector<HTMLElement>(".b3-menu__avemoji");
            if (iconElement) {
                iconElement.dataset.unicode = value.block.icon || "";
                iconElement.innerHTML = getAVBlockIconHTML(value);
            }
            const databaseRowElement = cellElement.closest<HTMLElement>(".protyle-db-row");
            if (databaseRowElement) {
                const title = value.block?.content || window.siyuan.languages.untitled;
                databaseRowElement.querySelector(".protyle-db-row__title span").textContent = title;
                databaseRowElement.dispatchEvent(new CustomEvent("database-row-title-update", {
                    bubbles: true,
                    detail: title,
                }));
            }
        }
    };
    if (sourceElement?.dataset.avId) {
        updateCustomAttr(sourceElement);
    }
    protyle.wysiwyg.element.querySelectorAll<HTMLElement>(`.av[data-av-id="${avID}"]`).forEach(item => {
        const data = getAVData(item);
        if (data) {
            updateAVCachedCellValue(data.view, rowID, colID, value);
        }
        updateAVSelectedCellValue(item, rowID, colID, value);
        // 列窗口保留卸载的节点；先恢复目标列再更新内容，避免横滚后显示旧值。
        ensureAVColumnWindow(item, colID, rowID);
        item.querySelectorAll<HTMLElement>(
            `.av__row[data-id="${rowID}"] .av__cell[data-col-id="${colID}"], ` +
            `.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${colID}"]` +
            (value.type === "checkbox" ? `, .av__calendar-item[data-id="${rowID}"] .av__calendar-field[data-col-id="${colID}"]` : "")
        ).forEach(cellElement => {
            if (cellElement === sourceElement && sourceWasMounted) {
                return;
            }
            if (value.id) {
                cellElement.dataset.id = value.id;
            } else {
                cellElement.removeAttribute("data-id");
            }
            updateAttrViewCellAnimation(cellElement, value);
        });
    });
    document.querySelectorAll<HTMLElement>(
        `.custom-attr [data-av-id="${avID}"] [data-row-id="${rowID}"][data-col-id="${colID}"]`
    ).forEach(cellElement => {
        if (cellElement === sourceElement) {
            return;
        }
        updateCustomAttr(cellElement);
    });
};

export const renderCellAttr = (cellElement: Element, value: IAVCellValue) => {
    if (value.type === "checkbox") {
        if (cellElement.getAttribute("role") === "checkbox") {
            cellElement.setAttribute("aria-checked", String(!!value.checkbox?.checked));
        }
        if (value.checkbox.checked) {
            cellElement.classList.add("av__cell-check");
            cellElement.classList.remove("av__cell-uncheck");
        } else {
            cellElement.classList.remove("av__cell-check");
            cellElement.classList.add("av__cell-uncheck");
        }
    } else if (value.type === "block") {
        if (value.isDetached) {
            cellElement.setAttribute("data-detached", "true");
        } else {
            cellElement.querySelector(".av__celltext").setAttribute("data-id", value.block.id);
            cellElement.removeAttribute("data-detached");
        }
    }
};

export const renderCell = (cellValue: IAVCellValue, rowIndex = 0, showIcon = true, type: TAVView = "table",
                           selectOptions?: IAVColumn["options"], dateFormat: TAVDateFormat = "",
                           renderTemplate?: string, showCopy = true) => {
    let text = "";
    if (hasAVRenderTemplateResult(cellValue, renderTemplate)) {
        const storedValue = cloneAVCellValueSnapshot(cellValue);
        text = `<span class="av__celltext av__celltext--template" data-cell-value="${escapeAttr(encodeURIComponent(JSON.stringify(storedValue)))}">${getAVTemplateHTML(cellValue.renderedContent || "")}</span>`;
        if (cellValue.type === "block") {
            text = `<span class="av__cellprimary">${renderAVBlockIcon(cellValue, showIcon)}${text}</span>`;
        }
    } else if ("template" === cellValue.type) {
        text = `<span class="av__celltext av__celltext--template">${cellValue ? getAVTemplateHTML(cellValue.template.content || "") : ""}</span>`;
    } else if ("text" === cellValue.type) {
        const source = getAVTextSource(cellValue);
        if (source.kind === "rich") {
            const storedValue = cloneAVCellValueSnapshot(cellValue);
            text = `<div class="av__celltext av__celltext--rich b3-typography" data-protyle-lite-render="safe" data-cell-value="${escapeAttr(encodeURIComponent(JSON.stringify(storedValue)))}">${getAVRichTextPreviewHTML(source.content)}</div>`;
        } else {
            text = `<span class="av__celltext">${cellValue ? escapeHtmlTextAndAttr(cellValue.text.content || "") : ""}</span>`;
        }
    } else if (cellValue.type === "location") {
        text = `<span class="av__celltext" data-cell-value="${escapeAttr(encodeURIComponent(JSON.stringify(cloneAVCellValueSnapshot(cellValue))))}">${escapeHtmlTextAndAttr(getAVLocationDisplayText(cellValue.location))}</span>`;
    } else if ((cellValue.type === "email" || cellValue.type === "phone")) {
        text = `<span class="av__celltext av__celltext--url" data-type="${cellValue.type}">${cellValue ? escapeHtmlTextAndAttr(cellValue[cellValue.type as "email"].content || "") : ""}</span>`;
    } else if ("url" === cellValue.type) {
        text = renderCellURL(cellValue?.url?.content || "");
    } else if (cellValue.type === "block") {
        const primaryContent = cellValue.block.richBlockDOM ? getAVPrimaryPreviewHTML(cellValue) : escapeHtmlTextAndAttr(cellValue.block.content || "");
        const primaryAttributes = cellValue.block.richBlockDOM ? ` data-protyle-lite-render="safe" data-cell-value="${escapeAttr(encodeURIComponent(JSON.stringify(cloneAVCellValueSnapshot(cellValue))))}"` : "";
        const primaryClass = cellValue.block.richBlockDOM ? " av__celltext--rich b3-typography document-title-preview" : "";
        // 不可使用换行 https://github.com/siyuan-note/siyuan/issues/11365
        if (cellValue?.isDetached) {
            text = `${renderAVBlockIcon(cellValue, showIcon)}<span class="av__celltext${primaryClass}"${primaryAttributes}>${primaryContent}</span>`;
        } else {
            text = `${renderAVBlockIcon(cellValue, showIcon)}<span data-type="block-ref" data-id="${cellValue.block.id}" data-subtype="${getAVBlockRefSubtype(cellValue)}" class="av__celltext av__celltext--ref${primaryClass}"${primaryAttributes}>${primaryContent}</span>`;
        }
        text = `<span class="av__cellprimary">${text}</span>`;
    } else if (cellValue.type === "number") {
        text = `<span class="av__celltext" data-content="${cellValue?.number.isNotEmpty ? cellValue?.number.content : ""}">${cellValue?.number.formattedContent || cellValue?.number.content || ""}</span>`;
    } else if (cellValue.type === "mSelect" || cellValue.type === "select") {
        cellValue?.mSelect?.forEach((item, index) => {
            if (cellValue.type === "select" && index > 0) {
                return;
            }
            const option = selectOptions?.find(selectOption => selectOption.name === item.content);
            const desc = option?.desc;
            const tooltip = desc ?
                ` data-position="north" aria-label="${escapeAriaLabel(item.content)}<div class='ft__on-surface'>${escapeAriaLabel(desc)}</div>"` :
                "";
            text += `<span class="b3-chip${desc ? " ariaLabel" : ""}"${tooltip} data-color="${escapeAttr(option ? option.color : item.color)}" style="${getAVColorStyle({
                color: option ? option.color : item.color,
                resolvedColor: option ? option.resolvedColor : item.resolvedColor,
            })}">${escapeHtml(item.content)}</span>`;
        });
    } else if (cellValue.type === "date") {
        const dataValue = cellValue ? cellValue.date : null;
        text = `<span class="av__celltext" data-value='${JSON.stringify(dataValue)}'>`;
        if (dataValue && dataValue.isNotEmpty) {
            text += escapeHtml(formatDateDisplay(dataValue.content, dateFormat, dataValue.isNotTime));
        }
        if (dataValue && dataValue.hasEndDate && dataValue.isNotEmpty && dataValue.isNotEmpty2) {
            text += `<svg class="av__cellicon"><use xlink:href="#iconForward"></use></svg>${escapeHtml(formatDateDisplay(dataValue.content2, dateFormat, dataValue.isNotTime))}`;
        }
        text += "</span>";
    } else if (isAVTimestampType(cellValue.type)) {
        const dataValue = cellValue ? cellValue[cellValue.type as "date"] : null;
        text = `<span class="av__celltext" data-value='${JSON.stringify(dataValue)}'>`;
        if (dataValue && dataValue.isNotEmpty) {
            text += escapeHtml(dataValue.formattedContent || formatDateValue(dataValue, dateFormat));
        }
        text += "</span>";
    } else if (cellValue.type === "lineNumber") {
        // 渲染行号
        text = `<span class="av__celltext" data-value='${rowIndex + 1}'>${rowIndex + 1}</span>`;
    } else if (cellValue.type === "mAsset") {
        cellValue?.mAsset?.forEach((item) => {
            if (item.type === "image" && isBrowserRenderableImagePath(item.content)) {
                text += `<img loading="lazy" class="av__cellassetimg ariaLabel" aria-label="${escapeAriaLabel(item.content)}" src="${escapeAttr(getCompressURL(item.content))}">`;
            } else {
                text += `<span class="b3-chip av__celltext--url ariaLabel" aria-label="${escapeAriaLabel(item.content)}" data-name="${escapeAttr(item.name)}" data-url="${escapeAttr(item.content)}">${escapeHtml(item.name || item.content)}</span>`;
            }
        });
    } else if (cellValue.type === "checkbox") {
        text += `<div class="fn__flex"><svg class="av__checkbox"><use xlink:href="#icon${cellValue?.checkbox?.checked ? "Check" : "Uncheck"}"></use></svg>`;
        if (["gallery", "kanban"].includes(type) && cellValue?.checkbox?.content) {
            text += `<span class="fn__space"></span>${escapeHtmlTextAndAttr(cellValue.checkbox.content)}`;
        }
        text += "</div>";
    } else if (cellValue.type === "rollup") {
        let rollupType;
        cellValue?.rollup?.contents?.forEach((item) => {
            const rollupText = usesAVRollupCellRenderer(item.type) ? renderCell(item, rowIndex, showIcon, type, undefined, "", undefined, false) : renderRollup(item, showIcon);
            if (rollupText) {
                text += rollupText + (item.type === "checkbox" ? "" : ", ");
            }
            rollupType = item.type;
        });
        if (text) {
            if (rollupType === "checkbox") {
                text = `<div class="fn__flex">${text}</div>`;
            } else if (text.endsWith(", ")) {
                text = text.substring(0, text.length - 2);
            }
        }
    } else if (cellValue.type === "relation") {
        cellValue?.relation?.contents?.forEach((item, index) => {
            text += genAVRelationHTML(item, cellValue.relation.blockIDs[index], showIcon);
        });
        if (text && text.endsWith(", ")) {
            text = text.substring(0, text.length - 2);
        }
    }

    if (cellValue.type === "block") {
        const bindLabel = cellValue.isDetached ? window.siyuan.languages.bind : window.siyuan.languages.rebind;
        const updateIcon = cellValue.isDetached ? "iconRef" : "iconRefresh";
        text = `<span class="av__primary-container">${text}<span class="av__row-actions"><button class="av__row-action av__cell-action ariaLabel" type="button" data-position="4north" aria-label="${window.siyuan.languages.openBy}" data-type="av-row-open"><svg><use xlink:href="#iconOpen"></use></svg></button><button class="av__row-action av__cell-action ariaLabel" type="button" data-position="4north" aria-label="${bindLabel}" data-type="av-row-update"><svg><use xlink:href="#${updateIcon}"></use></svg></button><button class="av__row-action av__row-more av__cell-action ariaLabel" type="button" data-position="4north" aria-label="${window.siyuan.languages.more}" aria-haspopup="menu" data-type="av-row-more"><svg><use xlink:href="#iconMore"></use></svg></button></span></span>`;
    }

    if (showCopy && cellValue.type === "rollup" && text) {
        text += `<button class="av__cell-action ariaLabel" type="button" data-position="4north" aria-label="${window.siyuan.languages.copy}" data-type="copy" data-rollup-value="${escapeAttr(encodeURIComponent(JSON.stringify(cellValue.rollup?.contents || [])))}"><svg><use xlink:href="#iconCopy"></use></svg></button>`;
    } else if (showCopy && ((((isAVTextType(cellValue.type) && cellValue.type !== "block") || isAVDateType(cellValue.type)) && cellValue[cellValue.type as "url"]?.content) ||
        cellValue.type === "lineNumber" || (cellValue.type === "location" && !isAVLocationEmpty(cellValue.location)) ||
        (cellValue.type === "number" && cellValue.number?.isNotEmpty) ||
        (cellValue.type === "block" && cellValue.block?.content))) {
        text += `<button class="av__cell-action ariaLabel" type="button" data-position="4north" aria-label="${window.siyuan.languages.copy}" data-type="copy"><svg><use xlink:href="#iconCopy"></use></svg></button>`;
    }
    return text;
};

export const getCellValueText = (value: IAVCellValue, column?: IAVColumn, rowIndex = 0) => {
    if (value.type === "block" && !hasAVRenderTemplateResult(value, column?.renderTemplate)) { return value.block?.content || ""; }
    if (value.type === "location" && !hasAVRenderTemplateResult(value, column?.renderTemplate)) {
        return getAVLocationText(value.location);
    }
    if (value.type === "text" && !hasAVRenderTemplateResult(value, column?.renderTemplate) &&
        getAVTextSource(value).kind === "rich") {
        return getAVTextCopyContent(value);
    }
    const cellElement = document.createElement("div");
    cellElement.innerHTML = renderCell(value, rowIndex, true, "table", column?.options, column?.dateFormat,
        column?.renderTemplate);
    return getCellText(cellElement);
};

export const getAVCellData = (selectedCells: IAVSelectedCell[]) => {
    const json: IAVCellValue[][] = [];
    let text = "";
    selectedCells.forEach((item, index) => {
        if (index === 0 || selectedCells[index - 1].rowID !== item.rowID) {
            json.push([]);
        }
        json[json.length - 1].push(cloneAVCellValueSnapshot(item.cell.value));
        text += getCellValueText(item.cell.value, item.column, item.rowIndex);
        text += index === selectedCells.length - 1 || selectedCells[index + 1].rowID !== item.rowID ? "\n" : "\t";
    });
    return {
        json,
        text: text.substring(0, text.length - 1),
    };
};

export const getAVSelectedCellData = (blockElement: HTMLElement) => {
    return getAVCellData(getAVSelectedCells(blockElement));
};

const renderRollup = (cellValue: IAVCellValue, showIcon: boolean) => {
    let text = "";
    if (cellValue.type === "text") {
        text = cellValue ? escapeHtmlTextAndAttr(cellValue[cellValue.type as "text"].content || "") : "";
    } else if ((cellValue.type === "email" || cellValue.type === "phone")) {
        const emailContent = cellValue ? cellValue[cellValue.type as "email"].content : "";
        if (emailContent) {
            text = `<span class="av__celltext av__celltext--url" data-type="${cellValue.type}">${escapeHtmlTextAndAttr(emailContent)}</span>`;
        }
    } else if ("url" === cellValue.type) {
        const urlContent = cellValue?.url?.content || "";
        if (urlContent) {
            text = renderCellURL(urlContent);
        }
    } else if (cellValue.type === "block") {
        if (cellValue.block?.richBlockDOM) { return renderCell(cellValue, 0, showIcon, "table", undefined, "", undefined, false); }
        if (cellValue?.isDetached) {
            text = `${renderAVBlockIcon(cellValue, showIcon)}<span class="av__celltext">${escapeHtmlTextAndAttr(cellValue.block?.content || window.siyuan.languages.untitled)}</span>`;
        } else {
            text = `${renderAVBlockIcon(cellValue, showIcon)}<span data-type="block-ref" data-id="${cellValue.block?.id}" data-subtype="${getAVBlockRefSubtype(cellValue)}" class="av__celltext av__celltext--ref">${escapeHtmlTextAndAttr(cellValue.block?.content || window.siyuan.languages.untitled)}</span>`;
        }
    } else if (cellValue.type === "number") {
        text = cellValue?.number.formattedContent || cellValue?.number.content.toString() || "";
    } else if (cellValue.type === "checkbox") {
        text += `<svg class="av__checkbox"><use xlink:href="#icon${cellValue?.checkbox?.checked ? "Check" : "Uncheck"}"></use></svg><span class="fn__space"></span>`;
    } else if (isAVDateType(cellValue.type)) {
        const dataValue = cellValue ? cellValue[cellValue.type as "date"] : null;
        if (dataValue.formattedContent) {
            text = dataValue.formattedContent;
        } else {
            if (dataValue && dataValue.isNotEmpty) {
                text = formatDateDisplay(dataValue.content, "", dataValue.isNotTime);
            }
            if (dataValue && dataValue.hasEndDate && dataValue.isNotEmpty && dataValue.isNotEmpty2) {
                text = `<svg class="av__cellicon"><use xlink:href="#iconForward"></use></svg>${formatDateDisplay(dataValue.content2, "", dataValue.isNotTime)}`;
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
}) => {
    if (typeof headerValue.icon !== "undefined") {
        cellElement.dataset.icon = headerValue.icon;
        cellElement.querySelector(".av__cellheadericon").outerHTML = headerValue.icon ? unicode2Emoji(headerValue.icon, "av__cellheadericon", true) : `<svg class="av__cellheadericon"><use xlink:href="#${getColIconByType(cellElement.dataset.dtype as TAVCol)}"></use></svg>`;
    }
    if (typeof headerValue.name !== "undefined") {
        cellElement.querySelector(".av__celltext").textContent = headerValue.name;
    }
};

export const getPositionByCellElement = (cellElement: HTMLElement) => {
    const rowElement = hasClosestByClassName(cellElement, "av__row");
    if (!rowElement) {
        return;
    }
    // 直接取该行在 body 内 .av__row 列表中的序号，与划选/拖拽填充遍历 querySelectorAll(".av__row")
    // 时的 index 保持同一基准，避免固定表头占位、虚拟滚动 spacer 等结构导致 previousElementSibling 计数错位
    const bodyElement = hasClosestByClassName(rowElement, "av__body");
    let rowIndex = -1;
    if (bodyElement) {
        Array.from(bodyElement.querySelectorAll(".av__row")).find((item: HTMLElement, index: number) => {
            if (item === rowElement) {
                rowIndex = index;
                return true;
            }
        });
    }
    let celIndex = -2;
    let currentCellElement = cellElement;
    while (currentCellElement) {
        currentCellElement = currentCellElement.previousElementSibling as HTMLElement;
        if (currentCellElement && currentCellElement.classList.contains("av__colsticky")) {
            currentCellElement = currentCellElement.lastElementChild as HTMLElement;
        }
        celIndex++;
    }
    return {rowIndex, celIndex};
};

export const dragFillCellsValue = (protyle: IProtyle, nodeElement: HTMLElement, originData: {
    [key: string]: IAVCellValue[]
}, originCellIds: string[]) => {
    nodeElement.querySelector(".av__drag-fill")?.remove();
    const blockID = getAVHostBlockID(nodeElement);
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const commit = () => {
        if (doOperations.length === 0) return;
        // 单元格数据保存在数据库文件中，同时更新宿主块，使填充进入该文档的撤销栈。
        doOperations.push({action: "doUpdateUpdated", id: blockID, data: dayjs().format("YYYYMMDDHHmmss")});
        undoOperations.push({action: "doUpdateUpdated", id: blockID, data: nodeElement.getAttribute("updated")});
        transaction(protyle, doOperations, undoOperations);
    };
    const selectedCells = getAVSelectedCells(nodeElement);
    if (selectedCells.length > 0) {
        const data = getAVData(nodeElement);
        if (!data || !canEditAVHost(nodeElement, protyle)) return;
        const originKeys = Object.keys(originData);
        const targetRows = new Map<string, IAVSelectedCell[]>();
        selectedCells.forEach(cell => {
            if ((cell.cell.id && originCellIds.includes(cell.cell.id)) || originData[cell.rowID]) return;
            const key = `${cell.groupID}:${cell.rowID}`;
            const cells = targetRows.get(key) || [];
            cells.push(cell);
            targetRows.set(key, cells);
        });
        Array.from(targetRows.values()).forEach((cells, rowIndex) => {
            cells.forEach((selectedCell, colIndex) => {
                const originValues = originData[originKeys[rowIndex % originKeys.length]];
                const originValue = originValues?.some(value => value.keyID) ?
                    originValues.find(value => value.keyID === selectedCell.colID) : originValues?.[colIndex];
                const target = resolveAVSelectedCell(data, selectedCell);
                if (!originValue || !target || originValue.type !== target.column.type ||
                    isAVReadonlyType(target.column.type) ||
                    (target.column.type === "block" && !target.cell.value.isDetached)) {
                    return;
                }
                const oldValue = cloneAVCellValueSnapshot(target.cell.value);
                const value = genAVDragFillValue(originValue, {
                    id: target.cell.id, keyID: target.colID, blockID: target.rowID,
                });
                if (value.type === "block") {
                    value.isDetached = true;
                    delete value.block.id;
                }
                const operation = {avID: nodeElement.dataset.avId, blockID, valueID: target.cell.id,
                    keyID: target.colID, rowID: target.rowID};
                doOperations.push(createAVCellUpdateOperation({...operation, data: value}));
                undoOperations.push(createAVCellUpdateOperation({...operation, data: oldValue}));
                // 范围可以跨越未挂载的行列，先同步模型，再更新当前显示的同一条目。
                updateAVCachedCellValue(data.view, target.rowID, target.colID, value);
                updateAttrViewCellInOtherElements(protyle, nodeElement.dataset.avId, target.rowID, target.colID, value);
                updateAVSelectedCellValue(nodeElement, target.rowID, target.colID, value);
            });
        });
        focusBlock(nodeElement);
        commit();
        return;
    }
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
    const avID = nodeElement.dataset.avId;
    const originKeys = Object.keys(originData);
    const iconView = getAVData(nodeElement)?.view;
    Object.keys(newData).forEach((rowID, index) => {
        newData[rowID].forEach((item, cellIndex) => {
            if (isAVReadonlyType(item.type) ||
                (item.type === "block" && item.element.getAttribute("data-detached") !== "true")) {
                return;
            }
            // https://ld246.com/article/1707975507571 数据库下拉填充数据后异常
            const keyID = item.colId;
            const originValue = originData[originKeys[index % originKeys.length]]?.[cellIndex];
            if (!originValue) {
                return;
            }
            const data = genAVDragFillValue(originValue, {
                id: item.id,
                keyID,
                blockID: rowID,
            });
            if (data.type === "block") {
                data.isDetached = true;
                delete data.block.id;
            }
            doOperations.push({
                action: "updateAttrViewCell",
                id: item.id,
                avID,
                blockID,
                keyID,
                rowID,
                data
            });
            const contentElement = item.element.querySelector(".av__cellcontent") || item.element;
            contentElement.innerHTML = renderCell(data, 0, getAVCellShowIcon(iconView, data.type), "table", undefined,
                item.element.dataset.dateFormat as TAVDateFormat);
            renderCellAttr(item.element, data);
            renderAVRichTextElements(item.element);
            updateAVSelectedCellValue(nodeElement, rowID, keyID, data);
            delete item.colId;
            delete item.element;
            undoOperations.push({
                action: "updateAttrViewCell",
                id: item.id,
                avID,
                blockID,
                keyID,
                rowID,
                data: item
            });
        });
    });
    focusBlock(nodeElement);
    commit();
};

export const addDragFill = (cellElement: Element) => {
    if (!cellElement) {
        return;
    }
    cellElement.classList.add("av__cell--active");
    if (!cellElement.querySelector(".av__drag-fill")) {
        const cellType = cellElement.getAttribute("data-dtype") as TAVCol;
        if (isAVReadonlyType(cellType)) {
            return;
        }
        cellElement.insertAdjacentHTML("beforeend", `<div aria-label="${window.siyuan.languages.dragFill}" class="av__drag-fill ariaLabel"></div>`);
    }
};
