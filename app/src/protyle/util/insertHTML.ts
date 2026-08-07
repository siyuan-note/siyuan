import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    isInEmbedBlock
} from "./hasClosest";
import * as dayjs from "dayjs";
import {transaction, updateTransaction} from "../wysiwyg/transaction";
import {
    fixAdjacentTags,
    getContenteditableElement,
    getParentBlock,
    getPreviousBlockSibling
} from "../wysiwyg/getBlock";
import {
    fixTableRange,
    focusBlock,
    focusByRange,
    focusByWbr,
    getBlockRanges,
    getEditorRange,
    getSelectionOffset,
    getUndoFocusContext,
    setLastNodeRange,
} from "./selection";
import {Constants} from "../../constants";
import {highlightRender} from "../render/highlightRender";
import {scrollCenter} from "../../util/highlightById";
import {updateAttrViewCellAnimation, updateAVName} from "../render/av/action";
import {getDefaultDateFormat} from "../render/av/dateFormat";
import {genCellValue, updateCellsValue} from "../render/av/cell";
import {input} from "../wysiwyg/input";
import {updateListOrder} from "../wysiwyg/list";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {getTableRangeCells, isIncludeCell} from "./table";
import {getFieldIdByCellElement, getRowHTML} from "../render/av/row";
import {setFold} from "./blockFold";
import {removeFoldHeading} from "./heading";
import {
    AV_PASTE_READONLY_TYPES,
    getAVPasteCellValue,
    getAVPasteValueForType,
    getAVPasteMatrixWidth,
    getUniqueAVPasteColumnName,
    inferAVPasteColumnType,
    isAVPasteHeaderCandidate,
    removeAVPasteSkeleton,
    shouldShowAVPasteSkeleton,
    showAVPasteSkeleton,
} from "../render/av/paste";
import {getAVColumnFitWidth, getAVColumnTextMeasurer} from "../render/av/columnWidth";
import {Dialog} from "../../dialog";
import {isMobile} from "../../util/functions";
import {getCrossBlockMergeRemoveElement} from "../wysiwyg/removeRange";
import {getAVFilteredTipContext} from "../render/av/filteredTip";
import {getAVSelectedCells, IAVSelectedCell} from "../render/av/selectionState";
import {getAVSelectedTableCells} from "../render/av/virtualScroll";

// 粘贴时临时插入的占位行标记，遍历结束后统一移除，避免污染虚拟滚动的 renderedStart/renderedEnd/spacer 状态
const PLACEHOLDER_ROW_CLASS = "av__row--placeholder";

// 移除粘贴过程中插入的占位行，使 DOM 恢复到与虚拟滚动 bodyStates 一致的裁剪状态
const removePlaceholderRows = (blockElement: HTMLElement) => {
    blockElement.querySelectorAll("." + PLACEHOLDER_ROW_CLASS).forEach(item => item.remove());
};

const markFoldHeadingChildren = (parent: ParentNode) => {
    parent.querySelectorAll("[parent-heading]").forEach(item => {
        item.removeAttribute("parent-heading");
    });
    const foldedHeadings: {id: string, level: number}[] = [];
    Array.from(parent.children).forEach(item => {
        if (!item.hasAttribute("data-node-id")) {
            return;
        }

        const isHeading = item.getAttribute("data-type") === "NodeHeading";
        const level = isHeading ? parseInt(item.getAttribute("data-subtype").substring(1)) : 7;
        if (isHeading) {
            while (foldedHeadings.length > 0 && foldedHeadings[foldedHeadings.length - 1].level >= level) {
                foldedHeadings.pop();
            }
        }
        if (foldedHeadings.length > 0) {
            item.setAttribute("parent-heading", foldedHeadings[0].id);
        }
        if (isHeading && item.getAttribute("fold") === "1") {
            foldedHeadings.push({
                id: item.getAttribute("data-node-id"),
                level,
            });
        }
    });
};

const genEmptyAVCell = (column: IAVColumn, rowID: string, cellID = Lute.NewNodeID()): IAVCell => {
    const value = genCellValue(column.type, null);
    value.id = cellID;
    value.keyID = column.id;
    value.blockID = rowID;
    if (column.type === "block") {
        value.isDetached = true;
    }
    return {
        id: cellID,
        color: "",
        bgColor: "",
        value,
        valueType: column.type,
    };
};

const genEmptyAVRow = (view: IAVTable, rowID: string): IAVRow => {
    return {
        id: rowID,
        cells: view.columns.map(column => genEmptyAVCell(column, rowID)),
    };
};

const genAVPasteColumn = (id: string, name: string, type: TAVCol): IAVColumn => {
    const column: IAVColumn = {
        hidden: false,
        icon: "",
        id,
        name,
        desc: "",
        numberFormat: "",
        dateFormat: getDefaultDateFormat(type),
        pin: false,
        template: "",
        type,
        width: "",
        align: "",
        wrap: undefined,
        calc: null,
    };
    if (type === "date") {
        column.date = {
            autoFillNow: false,
            fillSpecificTime: false,
        };
    }
    return column;
};

const getAVPastePinIndex = (bodyElement: HTMLElement) => {
    return parseInt(bodyElement.querySelector(".av__row--header > .block__icons")?.getAttribute("data-pinindex") || "-1");
};

const insertAVPastePlaceholder = (bodyElement: HTMLElement, view: IAVTable, row: IAVRow, rowIndex: number) => {
    const bottomElement = bodyElement.querySelector(".av__row--util");
    bottomElement.insertAdjacentHTML("beforebegin", getRowHTML({
        data: view,
        row,
        rowIndex,
        pinIndex: getAVPastePinIndex(bodyElement),
        type: "table",
    }));
    const rowElement = bottomElement.previousElementSibling as HTMLElement;
    rowElement.classList.add(PLACEHOLDER_ROW_CLASS);
    return rowElement;
};

interface IAVPasteCellPlaceholder {
    element: HTMLElement;
    originalHTML?: string;
}

interface IAVPasteTargetColumn {
    column: IAVColumn;
    isNew: boolean;
    readonly: boolean;
    typeChanged: boolean;
}

type TAVPasteValue = string | IAVCellValue;

const restoreAVPasteCellPlaceholders = (placeholders: IAVPasteCellPlaceholder[]) => {
    placeholders.reverse().forEach(item => {
        if (item.originalHTML) {
            item.element.insertAdjacentHTML("beforebegin", item.originalHTML);
        }
        item.element.remove();
    });
};

const syncAVPasteRowCells = (options: {
    bodyElement: HTMLElement;
    rowElement: HTMLElement;
    row: IAVRow;
    rowIndex: number;
    view: IAVTable;
    columnIDs: Set<string>;
    placeholders: IAVPasteCellPlaceholder[];
}) => {
    const template = document.createElement("template");
    template.innerHTML = getRowHTML({
        data: options.view,
        row: options.row,
        rowIndex: options.rowIndex,
        pinIndex: getAVPastePinIndex(options.bodyElement),
        type: "table",
    });
    options.columnIDs.forEach(columnID => {
        const nextCell = template.content.querySelector(`.av__cell[data-col-id="${columnID}"]`) as HTMLElement;
        if (!nextCell) {
            return;
        }
        nextCell.classList.add("av__cell--paste-placeholder");
        const currentCell = options.rowElement.querySelector(`.av__cell[data-col-id="${columnID}"]`) as HTMLElement;
        if (currentCell) {
            options.placeholders.push({element: nextCell, originalHTML: currentCell.outerHTML});
            currentCell.replaceWith(nextCell);
            return;
        }

        const columnIndex = options.view.columns.findIndex(column => column.id === columnID);
        const previousColumn = options.view.columns.slice(0, columnIndex).reverse().find(column => !column.hidden);
        const previousCell = previousColumn
            ? options.rowElement.querySelector(`.av__cell[data-col-id="${previousColumn.id}"]`) as HTMLElement
            : undefined;
        const anchorElement = previousCell?.parentElement.classList.contains("av__colsticky")
            ? previousCell.parentElement
            : previousCell || options.rowElement.querySelector(".av__colsticky");
        if (anchorElement) {
            anchorElement.insertAdjacentElement("afterend", nextCell);
            options.placeholders.push({element: nextCell});
        }
    });
};

const confirmAVPasteHeader = () => {
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (useHeader: boolean) => {
            if (!settled) {
                settled = true;
                resolve(useHeader);
            }
        };
        const dialog = new Dialog({
            title: window.siyuan.languages.avPasteHeaderTitle,
            content: `<div class="b3-dialog__content">
    <div class="ft__breakword">${window.siyuan.languages.avPasteHeaderTip}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-action="data">${window.siyuan.languages.avPasteHeaderAsData}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-action="header">${window.siyuan.languages.avPasteHeaderAsField}</button>
</div>`,
            width: isMobile() ? "92vw" : "520px",
            destroyCallback: () => finish(false),
        });
        dialog.element.addEventListener("click", (event) => {
            const isDispatch = typeof event.detail === "string";
            if (isDispatch) {
                if (event.detail === "Escape") {
                    finish(false);
                    dialog.destroy();
                } else if (event.detail === "Enter") {
                    finish(true);
                    dialog.destroy();
                }
                return;
            }
            let target = event.target as HTMLElement;
            while (target && target !== dialog.element) {
                const action = target.dataset.action;
                if (action === "data" || action === "header") {
                    finish(action === "header");
                    dialog.destroy();
                    break;
                }
                target = target.parentElement;
            }
        });
        dialog.element.setAttribute("data-key", Constants.DIALOG_CONFIRM);
        (dialog.element.querySelector('[data-action="header"]') as HTMLButtonElement).focus();
    });
};

const pasteAVMatrix = async (options: {
    values: TAVPasteValue[][],
    protyle: IProtyle,
    blockElement: HTMLElement,
    startCell?: HTMLElement,
    start?: IAVSelectedCell,
    columns: IAVColumn[],
    html: string,
    cellHTML?: string[][],
    header?: string[],
}) => {
    const startRowElement = options.startCell ?
        hasClosestByClassName(options.startCell, "av__row") as HTMLElement : undefined;
    const sourceWidth = getAVPasteMatrixWidth(options.values, options.header);
    const startItemID = options.start?.rowID || startRowElement?.dataset.id;
    const startColID = options.start?.colID || options.startCell?.dataset.colId;
    if (!startItemID || !startColID || sourceWidth === 0) {
        return;
    }
    const bodyElement = (startRowElement ? hasClosestByClassName(startRowElement, "av__body") :
        Array.from(options.blockElement.querySelectorAll<HTMLElement>(".av__body")).find(item =>
            (item.dataset.groupId || "") === (options.start?.groupID || ""))) as HTMLElement;
    if (!bodyElement) {
        return;
    }

    const groupID = bodyElement.dataset.groupId || "";
    const response = await fetchSyncPost("/api/av/getAttributeViewPasteRows", {
        avID: options.blockElement.dataset.avId,
        blockID: options.blockElement.dataset.nodeId,
        viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
        groupID,
        query: options.blockElement.querySelector('[data-type="av-search"]')?.textContent || "",
        startItemID,
        count: Math.max(options.values.length, 1),
    });
    const view = response.data?.view as IAVTable;
    const rows = view?.rows;
    if (response.code !== 0 || !Array.isArray(rows) || rows.length === 0) {
        return;
    }

    const originalColumns = view.columns.map(column => ({...column}));
    const originalCellValues = new Map<string, IAVCellValue>();
    rows.forEach(row => {
        row.cells.forEach((cell, index) => {
            const column = originalColumns[index];
            if (column) {
                originalCellValues.set(`${row.id}:${column.id}`, JSON.parse(JSON.stringify(cell.value)));
            }
        });
    });

    const schemaDoOperations: IOperation[] = [];
    const schemaUndoOperations: IOperation[] = [];
    const widthDoOperations: IOperation[] = [];
    const widthUndoOperations: IOperation[] = [];
    const newColumnUndoOperations: IOperation[] = [];
    const inferableKeyIDs = new Set<string>(response.data?.inferableKeyIDs || []);
    const visibleColumns = view.columns.filter(column => !column.hidden);
    const startColumnIndex = visibleColumns.findIndex(column => column.id === startColID);
    if (startColumnIndex < 0) {
        return;
    }
    const availableColumns = visibleColumns.slice(startColumnIndex);
    const usedNames = new Set(options.columns.map(column => column.name));
    const changedCellColumnIDs = new Set<string>();
    const targetColumns: IAVPasteTargetColumn[] = [];
    const measureText = getAVColumnTextMeasurer(options.blockElement);
    let previousColumnID = visibleColumns[visibleColumns.length - 1].id;

    for (let sourceIndex = 0; sourceIndex < sourceWidth; sourceIndex++) {
        const headerName = options.header?.[sourceIndex]?.trim() || "";
        const sourceCellValues = options.values.flatMap(row =>
            sourceIndex < row.length ? [row[sourceIndex]] : []);
        const sourceValues = sourceCellValues.flatMap(value => {
            if (typeof value === "string") {
                return [value];
            }
            if (value.type === "mAsset") {
                return [(value.mAsset || []).map(item => item.name || item.content).join(", ")];
            }
            return [];
        });
        const inferredType = options.header ? inferAVPasteColumnType(sourceCellValues) : "text";
        const currentColumn = availableColumns[sourceIndex];
        if (currentColumn) {
            const readonly = AV_PASTE_READONLY_TYPES.has(currentColumn.type);
            const oldColumn = {...currentColumn};
            const nextName = options.header && headerName && !readonly ? headerName : currentColumn.name;
            const nextType = options.header && inferableKeyIDs.has(currentColumn.id) &&
            currentColumn.type !== "block" && !readonly
                ? inferredType
                : currentColumn.type;
            const compactWidth = options.header && (!oldColumn.width || oldColumn.width === "200px")
                ? getAVColumnFitWidth(nextName, nextType, sourceValues, measureText)
                : oldColumn.width;
            const typeChanged = oldColumn.type !== nextType;
            currentColumn.name = nextName;
            currentColumn.type = nextType;
            currentColumn.width = compactWidth;
            if (typeChanged && nextType === "date") {
                currentColumn.date = {
                    autoFillNow: false,
                    fillSpecificTime: false,
                };
            }
            const valueColumn = options.columns.find(column => column.id === currentColumn.id);
            if (valueColumn) {
                valueColumn.name = nextName;
                valueColumn.type = nextType;
                valueColumn.width = compactWidth;
                if (typeChanged && nextType === "date") {
                    valueColumn.date = currentColumn.date;
                }
            }
            usedNames.add(nextName);
            if (oldColumn.name !== nextName || typeChanged) {
                schemaDoOperations.push({
                    action: "updateAttrViewCol",
                    id: currentColumn.id,
                    avID: options.blockElement.dataset.avId,
                    name: nextName,
                    type: nextType,
                });
                schemaUndoOperations.push({
                    action: "updateAttrViewCol",
                    id: currentColumn.id,
                    avID: options.blockElement.dataset.avId,
                    name: oldColumn.name,
                    type: oldColumn.type,
                });
            }
            if (compactWidth && oldColumn.width !== compactWidth) {
                const widthOperation = {
                    action: "setAttrViewColWidth" as const,
                    id: currentColumn.id,
                    avID: options.blockElement.dataset.avId,
                    blockID: options.blockElement.dataset.nodeId,
                    viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
                };
                widthDoOperations.push({
                    ...widthOperation,
                    data: compactWidth,
                });
                widthUndoOperations.push({
                    ...widthOperation,
                    data: oldColumn.width || "200px",
                });
            }
            if (typeChanged) {
                const columnIndex = view.columns.findIndex(column => column.id === currentColumn.id);
                rows.forEach(row => {
                    row.cells[columnIndex] = genEmptyAVCell(currentColumn, row.id, row.cells[columnIndex]?.id);
                });
                changedCellColumnIDs.add(currentColumn.id);
            }
            targetColumns.push({column: currentColumn, isNew: false, readonly, typeChanged});
            continue;
        }

        const id = Lute.NewNodeID();
        const baseName = headerName || window.siyuan.languages.text;
        const name = headerName ? headerName : getUniqueAVPasteColumnName(baseName, usedNames);
        const type = options.header ? inferredType : "text";
        const column = genAVPasteColumn(id, name, type);
        column.width = getAVColumnFitWidth(name, type, sourceValues, measureText);
        const previousIndex = view.columns.findIndex(item => item.id === previousColumnID);
        view.columns.splice(previousIndex + 1, 0, column);
        rows.forEach(row => {
            row.cells.splice(previousIndex + 1, 0, genEmptyAVCell(column, row.id));
        });
        options.columns.push(column);
        usedNames.add(name);
        schemaDoOperations.push({
            action: "addAttrViewCol",
            name,
            avID: options.blockElement.dataset.avId,
            type,
            format: getDefaultDateFormat(type),
            id,
            previousID: previousColumnID,
        });
        widthDoOperations.push({
            action: "setAttrViewColWidth",
            id,
            avID: options.blockElement.dataset.avId,
            data: column.width,
            blockID: options.blockElement.dataset.nodeId,
            viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
        });
        newColumnUndoOperations.unshift({
            action: "removeAttrViewCol",
            id,
            avID: options.blockElement.dataset.avId,
        });
        previousColumnID = id;
        changedCellColumnIDs.add(id);
        targetColumns.push({column, isNew: true, readonly: false, typeChanged: false});
    }

    const existingRows = rows.slice(0, options.values.length);
    const rowElements: HTMLElement[] = [];
    const pasteRows: IAVRow[] = [];
    const startIndex = options.start?.rowIndex ?? parseInt(startRowElement?.dataset.index || "0");
    const cellPlaceholders: IAVPasteCellPlaceholder[] = [];
    existingRows.forEach((row, index) => {
        let rowElement = bodyElement.querySelector(`.av__row[data-id="${row.id}"]`) as HTMLElement;
        if (!rowElement) {
            rowElement = insertAVPastePlaceholder(bodyElement, view, row, startIndex + index);
        } else if (changedCellColumnIDs.size > 0) {
            syncAVPasteRowCells({
                bodyElement,
                rowElement,
                row,
                rowIndex: startIndex + index,
                view,
                columnIDs: changedCellColumnIDs,
                placeholders: cellPlaceholders,
            });
        }
        rowElements.push(rowElement);
        pasteRows.push(row);
    });

    const srcs: IOperationSrcs[] = [];
    const newRowIDs: string[] = [];
    for (let i = existingRows.length; i < options.values.length; i++) {
        const rowID = Lute.NewNodeID();
        newRowIDs.push(rowID);
        srcs.push({
            itemID: rowID,
            id: Lute.NewNodeID(),
            isDetached: true,
            content: "",
        });
        const row = genEmptyAVRow(view, rowID);
        pasteRows.push(row);
        rowElements.push(insertAVPastePlaceholder(bodyElement, view, row, startIndex + i));
    }

    const rowDoOperations: IOperation[] = [];
    const rowUndoOperations: IOperation[] = [];
    if (srcs.length > 0) {
        rowDoOperations.push({
            action: "insertAttrViewBlock",
            avID: options.blockElement.dataset.avId,
            previousID: existingRows[existingRows.length - 1].id,
            srcs,
            blockID: options.blockElement.dataset.nodeId,
            viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
            groupID,
            context: getAVFilteredTipContext("target", options.protyle),
        });
        rowUndoOperations.push({
            action: "removeAttrViewBlock",
            srcIDs: newRowIDs,
            avID: options.blockElement.dataset.avId,
        });
    }

    const cellDoOperations: IOperation[] = [];
    const cellUndoOperations: IOperation[] = [];
    const newRowIDSet = new Set(newRowIDs);
    try {
        for (let i = 0; i < options.values.length; i++) {
            for (let j = 0; j < options.values[i].length && j < targetColumns.length; j++) {
                const targetColumn = targetColumns[j];
                if (targetColumn.readonly) {
                    continue;
                }
                const cellElement = rowElements[i].querySelector(
                    `.av__cell[data-col-id="${targetColumn.column.id}"]`,
                ) as HTMLElement;
                if (!cellElement) {
                    continue;
                }
                const isNewRow = newRowIDSet.has(pasteRows[i].id);
                const pasteValue = getAVPasteValueForType(options.values[i][j], targetColumn.column.type);
                const operations = await updateCellsValue(options.protyle, options.blockElement, pasteValue,
                    [cellElement], options.columns, options.cellHTML?.[i]?.[j] || options.html,
                    true, isNewRow || targetColumn.isNew || targetColumn.typeChanged, true, undefined, false);
                if (operations.doOperations.length > 0) {
                    cellDoOperations.push(...operations.doOperations);
                    const hasCellUpdate = operations.doOperations.some(operation => operation.action === "updateAttrViewCell");
                    operations.undoOperations.forEach(operation => {
                        if (operation.action !== "updateAttrViewCell") {
                            cellUndoOperations.push(operation);
                        }
                    });
                    if (hasCellUpdate && !isNewRow && !targetColumn.isNew) {
                        const originalValue = originalCellValues.get(`${pasteRows[i].id}:${targetColumn.column.id}`);
                        if (originalValue) {
                            cellUndoOperations.push({
                                action: "updateAttrViewCell",
                                id: originalValue.id || cellElement.dataset.id,
                                avID: options.blockElement.dataset.avId,
                                keyID: targetColumn.column.id,
                                rowID: pasteRows[i].id,
                                data: originalValue,
                            });
                        }
                    }
                }
            }
        }
    } finally {
        restoreAVPasteCellPlaceholders(cellPlaceholders);
        removePlaceholderRows(options.blockElement);
    }

    const doOperations = [...schemaDoOperations, ...widthDoOperations, ...rowDoOperations, ...cellDoOperations];
    if (doOperations.length === 0) {
        return;
    }
    const undoOperations = [
        ...cellUndoOperations,
        ...rowUndoOperations,
        ...widthUndoOperations.reverse(),
        ...schemaUndoOperations.reverse(),
        ...newColumnUndoOperations,
    ];
    doOperations.push({
        action: "doUpdateUpdated",
        id: options.blockElement.dataset.nodeId,
        data: dayjs().format("YYYYMMDDHHmmss"),
    });
    undoOperations.push({
        action: "doUpdateUpdated",
        id: options.blockElement.dataset.nodeId,
        data: options.blockElement.getAttribute("updated"),
    });
    transaction(options.protyle, doOperations, undoOperations);
    return true;
};

const pasteAVMatrixWithSkeleton = async (options: Parameters<typeof pasteAVMatrix>[0]) => {
    const showSkeleton = shouldShowAVPasteSkeleton(options.values) &&
        showAVPasteSkeleton(options.blockElement, getAVPasteMatrixWidth(options.values, options.header));
    if (showSkeleton) {
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    }
    try {
        const submitted = await pasteAVMatrix(options);
        if (showSkeleton && !submitted) {
            removeAVPasteSkeleton(options.blockElement);
        } else if (showSkeleton) {
            window.setTimeout(() => removeAVPasteSkeleton(options.blockElement), 30000);
        }
    } catch (error) {
        if (showSkeleton) {
            removeAVPasteSkeleton(options.blockElement);
        }
        throw error;
    }
};

const processAV = (range: Range, html: string, protyle: IProtyle, blockElement: HTMLElement) => {
    const tempElement = document.createElement("template");
    tempElement.innerHTML = html;
    let values: TAVPasteValue[][] = [];
    const cellHTML: string[][] = [];
    let headerCandidate = false;
    if (html.endsWith("]") && html.startsWith("[")) {
        try {
            values = JSON.parse(html);
        } catch (e) {
            console.warn("insert cell: JSON.parse error");
        }
    } else {
        const tableElement = tempElement.content.querySelector("table");
        const firstRowElement = tableElement?.querySelector("tr");
        if (firstRowElement) {
            headerCandidate = firstRowElement.parentElement?.tagName === "THEAD" ||
                Boolean(firstRowElement.querySelector("th"));
        }
        tableElement?.querySelectorAll("tr").forEach(item => {
            if (item.closest("table") !== tableElement) {
                return;
            }
            const rowValues: TAVPasteValue[] = [];
            const rowHTML: string[] = [];
            Array.from(item.children).forEach(cell => {
                if (cell.tagName === "TD" || cell.tagName === "TH") {
                    const links = Array.from(cell.querySelectorAll<HTMLElement>(
                        'a[href], [data-type~="a"][data-href]',
                    )).map(link => ({
                        content: link.textContent,
                        href: link.getAttribute("data-href") || link.getAttribute("href") || "",
                    }));
                    const unlinkedCell = cell.cloneNode(true) as HTMLElement;
                    unlinkedCell.querySelectorAll('a[href], [data-type~="a"][data-href]').forEach(link => link.remove());
                    rowValues.push(getAVPasteCellValue(cell.textContent, links, unlinkedCell.textContent));
                    rowHTML.push(cell.outerHTML);
                }
            });
            if (rowValues.length > 0) {
                values.push(rowValues);
                cellHTML.push(rowHTML);
            }
        });
        headerCandidate = isAVPasteHeaderCandidate(values, headerCandidate);
    }
    const avID = blockElement.dataset.avId;
    fetchPost("/api/av/getAttributeViewKeysByAvID", {avID}, async (response) => {
        const columns: IAVColumn[] = response.data;
        const selectedCells = getAVSelectedCells(blockElement);
        const selectedRowCells = selectedCells.length === 0 ? getAVSelectedTableCells(blockElement) : [];
        const stableStartCell = selectedCells[0] || selectedRowCells[0];
        const cellElements: HTMLElement[] = Array.from(blockElement.querySelectorAll(".av__cell--active, .av__cell--select")) || [];
        if (values && Array.isArray(values) && values.length > 0) {
            if (cellElements.length === 0 && !stableStartCell) {
                cellElements.push(blockElement.querySelector(".av__row:not(.av__row--header) .av__cell"));
            }
            if (cellElements[0] || stableStartCell) {
                const useHeader = headerCandidate ? await confirmAVPasteHeader() : false;
                const header = useHeader ?
                    values[0].map(value => typeof value === "string" ? value : "") : undefined;
                await pasteAVMatrixWithSkeleton({
                    values: useHeader ? values.slice(1) : values,
                    protyle,
                    blockElement,
                    startCell: cellElements[0],
                    start: stableStartCell,
                    columns,
                    html,
                    cellHTML: useHeader ? cellHTML.slice(1) : cellHTML,
                    header,
                });
            }
            return;
        }

        const contenteditableElement = getContenteditableElement(tempElement.content.firstElementChild);
        if (contenteditableElement && contenteditableElement.childNodes.length === 1 && contenteditableElement.firstElementChild?.getAttribute("data-type") === "block-ref") {
            const selectCellElement = blockElement.querySelector(".av__cell--select") as HTMLElement;
            if (selectCellElement) {
                const sourceId = contenteditableElement.firstElementChild.getAttribute("data-id");
                const previousID = getFieldIdByCellElement(selectCellElement, blockElement.getAttribute("data-av-type") as TAVView);
                transaction(protyle, [{
                    action: "replaceAttrViewBlock",
                    avID,
                    previousID,
                    nextID: sourceId,
                    isDetached: false,
                }], [{
                    action: "replaceAttrViewBlock",
                    avID,
                    previousID: sourceId,
                    nextID: previousID,
                    isDetached: selectCellElement.dataset.detached === "true",
                }]);
                updateAttrViewCellAnimation(selectCellElement, {
                    type: "block",
                    isDetached: false,
                    block: {content: contenteditableElement.firstElementChild.textContent, id: sourceId}
                });
                return;
            }
        }

        const text = protyle.lute.BlockDOM2Content(html);

        const textRows = text.split("\n");
        while (textRows.length > 1 && textRows[textRows.length - 1] === "") {
            textRows.pop();
        }
        const normalizedText = textRows.join("\n");
        const textJSON = textRows.map(row => row.split("\t"));
        if (selectedRowCells.length > 0 && textJSON.length === 1 && textJSON[0].length === 1) {
            updateCellsValue(protyle, blockElement as HTMLElement, normalizedText, undefined, columns, html,
                false, false, false, selectedRowCells);
            return;
        }
        if (cellElements.length > 0) {
            if (textJSON.length === 1 && textJSON[0].length === 1) {
                updateCellsValue(protyle, blockElement as HTMLElement, normalizedText,
                    selectedCells.length > 0 ? undefined : cellElements, columns, html);
            } else {
                await pasteAVMatrixWithSkeleton({
                    values: textJSON,
                    protyle,
                    blockElement,
                    startCell: cellElements[0],
                    start: stableStartCell,
                    columns,
                    html,
                });
            }
            document.querySelector(".av__panel")?.remove();
        } else if (stableStartCell) {
            if (textJSON.length === 1 && textJSON[0].length === 1) {
                updateCellsValue(protyle, blockElement as HTMLElement, normalizedText, undefined, columns, html);
            } else {
                await pasteAVMatrixWithSkeleton({
                    values: textJSON,
                    protyle,
                    blockElement,
                    start: stableStartCell,
                    columns,
                    html,
                });
            }
            document.querySelector(".av__panel")?.remove();
        } else if (hasClosestByClassName(range.startContainer, "av__title")) {
            const node = document.createTextNode(text);
            range.insertNode(node);
            range.setEnd(node, text.length);
            range.collapse(false);
            focusByRange(range);
            updateAVName(protyle, blockElement);
        }
    });
};

interface ITablePasteTarget {
    table: HTMLTableElement;
    anchorCell: HTMLTableCellElement;
}

const getTablePasteTarget = (range: Range): ITablePasteTarget | undefined => {
    const anchorCell = (hasClosestByTag(range.startContainer, "TD") ||
        hasClosestByTag(range.startContainer, "TH")) as HTMLTableCellElement;
    if (!anchorCell) {
        return undefined;
    }
    const table = anchorCell.closest("table");
    if (!table) {
        return undefined;
    }
    return {table, anchorCell};
};

const processTable = (range: Range, html: string, protyle: IProtyle, blockElement: HTMLElement,
                       pasteTarget?: ITablePasteTarget) => {
    const tempElement = document.createElement("template");
    tempElement.innerHTML = html;
    const pasteNodes = Array.from(tempElement.content.childNodes).filter(item =>
        item.nodeType === Node.ELEMENT_NODE ||
        (item.nodeType === Node.TEXT_NODE && item.textContent.trim() !== ""));
    if (pasteNodes.length !== 1 || pasteNodes[0].nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    const pasteElement = pasteNodes[0] as HTMLElement;
    let copyTableElement: HTMLTableElement | undefined;
    if (pasteElement.tagName === "TABLE") {
        copyTableElement = pasteElement as HTMLTableElement;
    } else if (pasteElement.getAttribute("data-type") === "NodeTable") {
        copyTableElement = pasteElement.querySelector("table") || undefined;
    }
    if (!copyTableElement) {
        return false;
    }
    const copyCells = getTableRangeCells(copyTableElement);
    if (copyCells.length === 0) {
        return false;
    }
    const tableElement = blockElement.querySelector("table") as HTMLTableElement;
    const tableSelectElement = blockElement.querySelector(".table__select") as HTMLElement;
    const targetCells = getTableRangeCells(tableElement);
    let anchorCell: HTMLTableCellElement | undefined;
    if (tableSelectElement.clientWidth > 0) {
        const selectedCell = targetCells.find(item =>
            !item.cell.classList.contains("fn__none") && isIncludeCell({
                tableSelectElement,
                item: item.cell,
            }));
        if (selectedCell) {
            anchorCell = selectedCell.cell;
        }
    }
    if (!anchorCell && pasteTarget?.table === tableElement) {
        anchorCell = pasteTarget.anchorCell;
    }
    if (!anchorCell) {
        return false;
    }
    const anchor = targetCells.find(item => item.cell === anchorCell);
    if (!anchor) {
        return false;
    }
    const targetCellMap = new Map(targetCells.map(item => [`${item.row}:${item.col}`, item.cell]));
    const matchedCells: { source: HTMLTableCellElement; target: HTMLTableCellElement }[] = [];
    copyCells.forEach(item => {
        const target = targetCellMap.get(`${anchor.row + item.row}:${anchor.col + item.col}`);
        if (target) {
            matchedCells.push({source: item.cell, target});
        }
    });
    if (matchedCells.length === 0) {
        return false;
    }
    tableSelectElement.removeAttribute("style");
    const oldHTML = blockElement.outerHTML;
    blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    matchedCells.forEach((item, index) => {
        item.target.innerHTML = item.source.innerHTML;
        if (index === matchedCells.length - 1) {
            setLastNodeRange(item.target, range, false);
        }
    });
    range.collapse(false);
    updateTransaction(protyle, blockElement, oldHTML);
    return true;
};

export const insertHTML = (html: string, protyle: IProtyle, isBlock = false,
                           // 移动端插入嵌入块时，获取到的 range 为旧值
                           useProtyleRange = false,
                           // 在开头粘贴块则插入上方
                           insertByCursor = false,
                           // 根据块级拖拽指示线强制插入方向
                           insertPosition?: "before" | "after") => {
    if (html === "") {
        return;
    }
    const range = useProtyleRange ? protyle.toolbar.range : getEditorRange(protyle.wysiwyg.element);
    const rangeStartBlockElement = hasClosestBlock(range.startContainer);
    const rangeEndBlockElement = hasClosestBlock(range.endContainer);
    if (!range.collapsed && rangeStartBlockElement && rangeEndBlockElement &&
        rangeStartBlockElement !== rangeEndBlockElement) {
        const hasUnsupportedBoundary = [
            {blockElement: rangeStartBlockElement, container: range.startContainer},
            {blockElement: rangeEndBlockElement, container: range.endContainer},
        ].some(item => {
            if (item.blockElement.classList.contains("av") || isInEmbedBlock(item.blockElement)) {
                return true;
            }
            const editableElement = getContenteditableElement(item.blockElement);
            return !editableElement ||
                (item.container !== item.blockElement && !editableElement.contains(item.container));
        });
        if (hasUnsupportedBoundary) {
            return;
        }
    }
    const tablePasteTarget = getTablePasteTarget(range);
    fixTableRange(range);
    let unSpinHTML;
    if (hasClosestByAttribute(range.startContainer, "data-type", "NodeTable") && !isBlock) {
        if (hasClosestByTag(range.startContainer, "TABLE")) {
            unSpinHTML = protyle.lute.BlockDOM2InlineBlockDOM(html);
        } else {
            // https://github.com/siyuan-note/siyuan/issues/9411
            isBlock = true;
        }
    }
    let blockElement = hasClosestBlock(range.startContainer) as HTMLElement;
    if (!blockElement) {
        // 使用鼠标点击选则模版提示列表后 range 丢失
        if (protyle.toolbar.range) {
            blockElement = hasClosestBlock(protyle.toolbar.range.startContainer) as HTMLElement;
        } else {
            blockElement = protyle.wysiwyg.element.firstElementChild as HTMLElement;
        }
    }
    if (!blockElement) {
        return;
    }

    if (blockElement.classList.contains("av")) {
        const avTitleElement = hasClosestByClassName(range.startContainer, "av__title");
        if (!avTitleElement || (avTitleElement && !isBlock)) {
            range.deleteContents();
            processAV(range, html, protyle, blockElement as HTMLElement);
            return;
        }
    }
    if (blockElement.classList.contains("table") &&
        processTable(range, html, protyle, blockElement, tablePasteTarget)) {
        return;
    }

    const blockRanges = !range.collapsed ? getBlockRanges(protyle.wysiwyg.element, range) : [];
    const isCrossBlockRange = blockRanges.length > 1 && blockRanges[0].blockElement === blockElement;
    let crossBlockUndoFocusContext: Record<string, string> | undefined;
    if (isCrossBlockRange) {
        const undoRange = document.createRange();
        undoRange.setStart(blockRanges[0].range.startContainer, blockRanges[0].range.startOffset);
        const endRange = blockRanges[blockRanges.length - 1].range;
        undoRange.setEnd(endRange.endContainer, endRange.endOffset);
        crossBlockUndoFocusContext = getUndoFocusContext(protyle.wysiwyg.element, undoRange, true);
        if (crossBlockUndoFocusContext) {
            crossBlockUndoFocusContext.undoFocusCollapseToEnd = "true";
        }
    }
    const removeElements: HTMLElement[] = [];
    if (isCrossBlockRange) {
        const startElement = blockRanges[0].blockElement;
        const endElement = blockRanges[blockRanges.length - 1].blockElement;
        const selectedElements: HTMLElement[] = [];
        range.cloneContents().querySelectorAll<HTMLElement>("[data-node-id]").forEach(item => {
            const element = protyle.wysiwyg.element.querySelector<HTMLElement>(
                `[data-node-id="${item.getAttribute("data-node-id")}"]`
            );
            if (!element || selectedElements.includes(element) || element === startElement || element === endElement ||
                element.contains(startElement) || element.contains(endElement) || isInEmbedBlock(element)) {
                return;
            }
            const elementRange = document.createRange();
            elementRange.selectNode(element);
            if (range.compareBoundaryPoints(Range.START_TO_START, elementRange) <= 0 &&
                range.compareBoundaryPoints(Range.END_TO_END, elementRange) >= 0) {
                selectedElements.push(element);
            }
        });
        const selectedSet = new Set(selectedElements);
        removeElements.push(...selectedElements.filter(item =>
            !selectedSet.has(item.parentElement.closest<HTMLElement>("[data-node-id]"))
        ));

        const endBlockRange = blockRanges.slice().reverse().find(item => item.blockElement === endElement);
        if (endBlockRange && endElement.getAttribute("data-type") !== "NodeTable") {
            const contentRange = document.createRange();
            contentRange.selectNodeContents(endBlockRange.editableElement);
            const selectedPosition = getSelectionOffset(
                endBlockRange.editableElement, undefined, endBlockRange.range, true
            );
            const contentPosition = getSelectionOffset(
                endBlockRange.editableElement, undefined, contentRange, true
            );
            const mediaSelector = "img, video, audio, iframe, canvas";
            const fullySelected = selectedPosition.start === 0 && selectedPosition.end === contentPosition.end &&
                endBlockRange.range.cloneContents().querySelectorAll(mediaSelector).length ===
                contentRange.cloneContents().querySelectorAll(mediaSelector).length;
            if (fullySelected) {
                const topElement = getCrossBlockMergeRemoveElement(
                    protyle.wysiwyg.element, startElement, endElement);
                if (topElement) {
                    for (let i = removeElements.length - 1; i >= 0; i--) {
                        if (topElement.contains(removeElements[i])) {
                            removeElements.splice(i, 1);
                        }
                    }
                    removeElements.push(topElement);
                }
            }
        }
    }
    const crossBlockData = removeElements.map(element => ({
        element,
        oldHTML: element.outerHTML,
        previousID: getPreviousBlockSibling(element)?.getAttribute("data-node-id"),
        parentID: getParentBlock(element)?.getAttribute("data-node-id") || protyle.block.parentID,
        remove: true
    }));
    if (isCrossBlockRange) {
        Array.from(new Set(blockRanges.map(item => item.blockElement))).slice(1).forEach(element => {
            if (removeElements.some(removeElement => removeElement.contains(element))) {
                return;
            }
            crossBlockData.push({
                element,
                oldHTML: element.outerHTML,
                previousID: getPreviousBlockSibling(element)?.getAttribute("data-node-id"),
                parentID: getParentBlock(element)?.getAttribute("data-node-id") || protyle.block.parentID,
                remove: false
            });
        });
    }
    const crossBlockOldHTML = isCrossBlockRange ? blockElement.outerHTML : undefined;
    let id = blockElement.getAttribute("data-node-id");
    const rangeStartWbrElement = document.createElement("wbr");
    range.insertNode(rangeStartWbrElement);
    if (isCrossBlockRange) {
        range.setStartAfter(rangeStartWbrElement);
    }
    let oldHTML = crossBlockOldHTML ?? blockElement.outerHTML;
    const type = blockElement.getAttribute("data-type");
    const isNodeCodeBlock = type === "NodeCodeBlock";
    const editableElement = getContenteditableElement(blockElement);
    const crossBlockDoOperations: IOperation[] = [];
    const crossBlockUndoOperations: IOperation[] = [];
    const processCrossBlockData = () => {
        crossBlockData.forEach(item => {
            if (item.remove) {
                item.element.remove();
                crossBlockDoOperations.push({
                    action: "delete",
                    id: item.element.getAttribute("data-node-id")
                });
                crossBlockUndoOperations.push({
                    action: "insert",
                    id: item.element.getAttribute("data-node-id"),
                    data: item.oldHTML,
                    previousID: item.previousID,
                    parentID: item.parentID
                });
            } else if (item.element.isConnected && item.oldHTML !== item.element.outerHTML) {
                item.element.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                item.element.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
                crossBlockDoOperations.push({
                    action: "update",
                    id: item.element.getAttribute("data-node-id"),
                    data: item.element.outerHTML
                });
                crossBlockUndoOperations.push({
                    action: "update",
                    id: item.element.getAttribute("data-node-id"),
                    data: item.oldHTML
                });
            }
        });
    };
    if (!isBlock &&
        (isNodeCodeBlock || protyle.toolbar.getCurrentType(range).includes("code"))) {
        range.deleteContents();
        if (isCrossBlockRange && rangeStartWbrElement.isConnected) {
            range.setStartAfter(rangeStartWbrElement);
            range.collapse(true);
        }
        // 代码块需保持至少一个 \n https://github.com/siyuan-note/siyuan/pull/13271#issuecomment-2502672155
        let codeBlockIsEmpty = false;
        if (isNodeCodeBlock && editableElement.textContent === "") {
            codeBlockIsEmpty = true;
        }
        range.insertNode(document.createTextNode(html.replace(/\r\n|\r|\u2028|\u2029/g, "\n")));
        range.collapse(false);
        range.insertNode(document.createElement("wbr"));
        if (codeBlockIsEmpty) {
            // 代码块为空添加的 \n 需放在最后 https://github.com/siyuan-note/siyuan/issues/15399
            range.collapse(false);
            range.insertNode(document.createTextNode("\n"));
        }
        if (isNodeCodeBlock) {
            blockElement.querySelector('[data-render="true"]')?.removeAttribute("data-render");
            highlightRender(blockElement);
        } else {
            focusByWbr(blockElement, range);
        }
        blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        if (isCrossBlockRange) {
            processCrossBlockData();
            blockElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            transaction(protyle, [{
                action: "update",
                id,
                data: blockElement.outerHTML
            }, ...crossBlockDoOperations], [{
                action: "update",
                id,
                data: oldHTML,
                context: crossBlockUndoFocusContext
            }, ...crossBlockUndoOperations]);
        } else {
            updateTransaction(protyle, blockElement, oldHTML);
        }
        setTimeout(() => {
            scrollCenter(protyle, undefined, "nearest", "smooth");
        }, Constants.TIMEOUT_LOAD);
        return;
    }

    const undoOperation: IOperation[] = [];
    const doOperation: IOperation[] = [];
    if (range.toString() !== "" || isCrossBlockRange) {
        const inlineMathElement = hasClosestByAttribute(range.commonAncestorContainer, "data-type", "inline-math");
        if (inlineMathElement) {
            // 表格内选中数学公式 https://ld246.com/article/1631708573504
            inlineMathElement.remove();
        } else if (range.startContainer.nodeType === 3 && range.startContainer.parentElement.getAttribute("data-type")?.indexOf("block-ref") > -1) {
            // 选中 ref**bbb** 后 alt+[
            range.deleteContents();
            // https://github.com/siyuan-note/siyuan/issues/14035
            if (range.startContainer.nodeType !== 3 && (range.startContainer as Element).tagName === "SPAN" &&
                range.startContainer.textContent === "") {
                // ref 选中处理 https://ld246.com/article/1629214377537
                (range.startContainer as HTMLElement).remove();
            }
        } else {
            // 跨块删除时浏览器会连块内最后一个 protyle-attr 一起移除，这里提前保存并在删除后恢复
            const preserveAttrElements = [
                blockElement,
                rangeEndBlockElement,
            ].filter((item): item is HTMLElement => Boolean(item)).map(item => ({
                element: item,
                attrHTML: item.querySelector(":scope > .protyle-attr")?.outerHTML || "",
            }));
            range.deleteContents();
            preserveAttrElements.forEach(({element, attrHTML}) => {
                if (attrHTML && !element.querySelector(":scope > .protyle-attr") && element.isConnected) {
                    element.insertAdjacentHTML("beforeend", attrHTML);
                }
            });
        }
        range.insertNode(document.createElement("wbr"));
        blockElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
        undoOperation.push({
            action: "update",
            id,
            data: oldHTML,
            context: crossBlockUndoFocusContext
        });
        doOperation.push({
            action: "update",
            id,
            data: blockElement.outerHTML
        });
        processCrossBlockData();
    }
    const tempElement = document.createElement("template");

    // https://github.com/siyuan-note/siyuan/issues/14162 & https://github.com/siyuan-note/siyuan/issues/14965
    if (/^\s*&gt;|\*|-|\+|\d*.|\[ \]|[x]/.test(html) &&
        editableElement.textContent.replace(Constants.ZWSP, "") !== "") {
        unSpinHTML = html;
    }

    let innerHTML = unSpinHTML || // 在 table 中插入需要使用转换好的行内元素 https://github.com/siyuan-note/siyuan/issues/9358
        html;   // 空格会被 Spin 不再，需要使用原文
    // 粘贴纯文本时会进行内部转义，这里需要进行反转义 https://github.com/siyuan-note/siyuan/issues/10620
    innerHTML = innerHTML.replace(/;;;lt;;;/g, "&lt;").replace(/;;;gt;;;/g, "&gt;");
    tempElement.innerHTML = innerHTML;

    let block2text = false;
    if ((
            editableElement.textContent.replace(Constants.ZWSP, "") !== "" ||
            type === "NodeHeading"
        ) &&
        tempElement.content.childElementCount === 1 &&
        tempElement.content.firstChild.nodeType !== 3 &&
        tempElement.content.firstElementChild.getAttribute("data-type") === "NodeHeading") {
        if (!isCrossBlockRange) {
            // https://github.com/siyuan-note/siyuan/issues/14114
            isBlock = false;
            block2text = true;
        }
    }
    // 使用 lute 方法会添加 p 元素，只有一个 p 元素或者只有一个字符串或者为 <u>b</u> 时的时候只拷贝内部
    if (!isBlock) {
        if (tempElement.content.firstChild.nodeType === 3 || block2text ||
            (tempElement.content.firstChild.nodeType !== 3 &&
                ((tempElement.content.firstElementChild.classList.contains("p") && tempElement.content.childElementCount === 1) ||
                    tempElement.content.firstElementChild.tagName !== "DIV"))) {
            if (tempElement.content.firstChild.nodeType !== 3 && tempElement.content.firstElementChild.classList.contains("p")) {
                tempElement.innerHTML = tempElement.content.firstElementChild.firstElementChild.innerHTML.trim();
            }
            // 粘贴带样式的行内元素到另一个行内元素中需进行切割
            const spanElement = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer as HTMLElement;
            const splitElements: HTMLElement[] = [];
            if (spanElement.tagName === "SPAN" && spanElement === (range.endContainer.nodeType === 3 ? range.endContainer.parentElement : range.endContainer) &&
                // 粘贴纯文本不需切割 https://ld246.com/article/1665556907936
                // emoji 图片需要切割 https://github.com/siyuan-note/siyuan/issues/9370
                tempElement.content.querySelector("span, img")
            ) {
                const afterElement = document.createElement("span");
                const attributes = spanElement.attributes;
                for (let i = 0; i < attributes.length; i++) {
                    afterElement.setAttribute(attributes[i].name, attributes[i].value);
                }
                range.setEnd(spanElement.lastChild, spanElement.lastChild.textContent.length);
                afterElement.append(range.extractContents());
                spanElement.after(afterElement);
                range.setStartBefore(afterElement);
                range.collapse(true);
                splitElements.push(spanElement, afterElement);
            }
            if (isCrossBlockRange) {
                let rangeStartParentElement = rangeStartWbrElement.parentElement;
                while (rangeStartParentElement && rangeStartParentElement !== editableElement &&
                    rangeStartParentElement.textContent.replace(Constants.ZWSP, "") === "" &&
                    Array.from(rangeStartParentElement.querySelectorAll("*")).every(item => item.tagName === "WBR")) {
                    rangeStartParentElement.before(rangeStartWbrElement);
                    rangeStartParentElement.remove();
                    rangeStartParentElement = rangeStartWbrElement.parentElement;
                }
                if (rangeStartWbrElement.isConnected) {
                    range.setStartAfter(rangeStartWbrElement);
                    range.collapse(true);
                }
            }
            range.insertNode(tempElement.content.cloneNode(true));
            range.collapse(false);
            blockElement.querySelector("wbr")?.remove();
            // 移除行级元素边界插入时产生的空拆分元素，避免相邻标签修复在新标签后插入空格
            splitElements.forEach((item) => {
                if (item.childElementCount === 0 && item.textContent.split(Constants.ZWSP).join("") === "") {
                    item.remove();
                }
            });
            // 相邻标签之间插入空格区隔，避免后续 SpinBlockDOM 解析时合并为一个标签 https://github.com/siyuan-note/siyuan/issues/18191
            fixAdjacentTags(getContenteditableElement(blockElement));
            protyle.wysiwyg.lastHTMLs[id] = oldHTML;
            input(protyle, blockElement as HTMLElement, range, true, undefined, isCrossBlockRange ? {
                doOperations: crossBlockDoOperations,
                undoOperations: crossBlockUndoOperations,
                undoContext: crossBlockUndoFocusContext,
            } : undefined);
            return;
        }
    }
    // 光标是否在列表项的第一个段落块（紧挨 protyle-action）
    const isFirstBlockInLi = hasClosestByClassName(blockElement, "li") &&
        blockElement.previousElementSibling?.classList.contains("protyle-action");
    const cursorLiElement = hasClosestByClassName(blockElement, "li");
    const firstPastedElement = tempElement.content.firstElementChild;
    const isPastedListItem = firstPastedElement?.getAttribute("data-type") === "NodeListItem";
    const pastedListElement = firstPastedElement?.getAttribute("data-type") === "NodeList" ? firstPastedElement : undefined;
    const pastedListHasRefCount = pastedListElement?.querySelector(".protyle-attr--refcount");
    const shouldFlattenList = Boolean(cursorLiElement && isFirstBlockInLi && pastedListElement && !pastedListHasRefCount);
    const shouldMergeIntoTargetList = Boolean(cursorLiElement && (isPastedListItem || shouldFlattenList));
    // 列表项并入目标列表时统一顶层列表类型 https://github.com/siyuan-note/siyuan/issues/17890
    if (shouldMergeIntoTargetList && cursorLiElement && firstPastedElement) {
        const targetSubtype = cursorLiElement.getAttribute("data-subtype");
        if (firstPastedElement.getAttribute("data-subtype") !== targetSubtype) {
            const listItemElements = Array.from(pastedListElement?.children || tempElement.content.children).filter(item =>
                item.getAttribute("data-type") === "NodeListItem");
            listItemElements.forEach(li => {
                li.setAttribute("data-subtype", targetSubtype);
                li.classList.remove("protyle-task--done");
                const actionElement = li.querySelector(".protyle-action");
                if (!actionElement) return;
                if (targetSubtype === "o") {
                    li.removeAttribute("data-task");
                    li.setAttribute("data-marker", "1.");
                    actionElement.className = "protyle-action protyle-action--order";
                    actionElement.setAttribute("contenteditable", "false");
                    actionElement.textContent = "1.";
                } else if (targetSubtype === "t") {
                    li.setAttribute("data-marker", "*");
                    li.setAttribute("data-task", " ");
                    actionElement.className = "protyle-action protyle-action--task";
                    actionElement.removeAttribute("contenteditable");
                    actionElement.innerHTML = "<svg><use xlink:href=\"#iconUncheck\"></use></svg>";
                } else {
                    li.removeAttribute("data-task");
                    li.setAttribute("data-marker", "*");
                    actionElement.className = "protyle-action";
                    actionElement.removeAttribute("contenteditable");
                    actionElement.innerHTML = "<svg><use xlink:href=\"#iconDot\"></use></svg>";
                }
            });
        }
    }
    let isListPaste = false;
    let keepEmptyBlock = false;
    // 列表项不能单独进行粘贴 https://ld246.com/article/1628681120576/comment/1628681209731#comments
    if (isPastedListItem) {
        isListPaste = true;
        if (cursorLiElement) {
            blockElement = cursorLiElement;
            id = blockElement.getAttribute("data-node-id");
            oldHTML = blockElement.outerHTML;
        } else {
            const liItemElement = tempElement.content.children[0];
            const subType = liItemElement.getAttribute("data-subtype");
            tempElement.innerHTML = `<div${subType === "o" ? " data-marker=\"1.\"" : ""} data-subtype="${subType}" data-node-id="${Lute.NewNodeID()}" data-type="NodeList" class="list">${html}<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
        }
    } else if (shouldFlattenList && cursorLiElement && pastedListElement) {
        isListPaste = true;
        // 列表项首个内容块粘贴列表块时拆开为同级列表项 https://github.com/siyuan-note/siyuan/issues/17890
        blockElement = cursorLiElement;
        id = blockElement.getAttribute("data-node-id");
        oldHTML = blockElement.outerHTML;
        tempElement.innerHTML = "";
        while (pastedListElement.firstElementChild) {
            if (pastedListElement.firstElementChild.classList.contains("protyle-attr")) {
                pastedListElement.firstElementChild.remove();
                continue;
            }
            tempElement.content.appendChild(pastedListElement.firstElementChild);
        }
    } else if (isFirstBlockInLi && cursorLiElement && pastedListElement) {
        // 有 refcount 的列表直接作为子列表插入到空段落后，不拆开不清理 https://github.com/siyuan-note/siyuan/issues/17890
        keepEmptyBlock = true;
    }
    let lastElement: Element;
    let insertBefore = insertPosition === "before";
    if (!insertPosition && !range.toString() && insertByCursor) {
        const positon = getSelectionOffset(blockElement, protyle.wysiwyg.element, range);
        if (positon.start === 0 && editableElement.textContent !== "") {
            insertBefore = true;
        }
    }
    // https://github.com/siyuan-note/siyuan/issues/15768
    if (tempElement.content.firstChild.nodeType === 3 || (tempElement.content.firstChild.nodeType === 1 && tempElement.content.firstElementChild.tagName !== "DIV")) {
        tempElement.innerHTML = protyle.lute.SpinBlockDOM(tempElement.innerHTML);
    }
    markFoldHeadingChildren(tempElement.content);
    (insertBefore ? Array.from(tempElement.content.children) : Array.from(tempElement.content.children).reverse()).find((item) => {
        let addId = item.getAttribute("data-node-id");
        const hasParentHeading = item.getAttribute("parent-heading");
        item.removeAttribute("parent-heading");
        if (addId === id) {
            item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            doOperation.push({
                action: "update",
                data: item.outerHTML,
                id: addId,
            });
            undoOperation.push({
                action: "update",
                id: addId,
                data: oldHTML,
            });
        } else {
            if (item.classList.contains("li") && !blockElement.parentElement.classList.contains("list")) {
                // https://github.com/siyuan-note/siyuan/issues/6534
                addId = Lute.NewNodeID();
                const liElement = document.createElement("div");
                liElement.setAttribute("data-subtype", item.getAttribute("data-subtype"));
                liElement.setAttribute("data-node-id", addId);
                liElement.setAttribute("data-type", "NodeList");
                liElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                liElement.classList.add("list");
                liElement.append(item);
                item = liElement;
            }
            doOperation.push({
                action: "insert",
                data: item.outerHTML,
                id: addId,
                context: {ignoreProcess: hasParentHeading ? "true" : "false"},
                nextID: insertBefore ? id : undefined,
                previousID: insertBefore ? undefined : id
            });
            undoOperation.push({
                action: "delete",
                id: addId,
            });
        }
        if (!hasParentHeading) {
            Array.from(item.querySelectorAll('[data-type="NodeHeading"][fold="1"]')).reverse().forEach(heading => {
                removeFoldHeading(heading);
            });
            const rendersElement = [];
            if (item.classList.contains("render-node") && item.getAttribute("data-type") === "NodeCodeBlock") {
                rendersElement.push(item);
            } else {
                rendersElement.push(...item.querySelectorAll('.render-node[data-type="NodeCodeBlock"]'));
            }
            rendersElement.forEach((renderItem) => {
                renderItem.querySelector(".protyle-icons")?.remove();
                const spinElement = renderItem.querySelector('[spin="1"]');
                if (spinElement) {
                    spinElement.innerHTML = "";
                }
                renderItem.removeAttribute("data-render");
            });
            if (insertBefore) {
                blockElement.before(item);
            } else {
                blockElement.after(item);
            }
        }
        if (!lastElement && !hasParentHeading) {
            lastElement = item;
        }
    });
    const emptyStartType = blockElement.getAttribute("data-type");
    const canRemoveEmptyStart = emptyStartType === "NodeParagraph" ||
        emptyStartType === "NodeCodeBlock" ||
        (emptyStartType === "NodeHeading" && blockElement.getAttribute("fold") !== "1");
    const startTextIsEmpty = editableElement &&
        editableElement.textContent.split(Constants.ZWSP).join("").replace(/\n/g, "") === "";
    if (!insertPosition && startTextIsEmpty && canRemoveEmptyStart && !keepEmptyBlock &&
        !editableElement?.querySelector("img, video, audio, iframe, canvas, .emoji")) {
        // 选中当前块所有内容粘贴再撤销会导致异常 https://ld246.com/article/1662542137636
        doOperation.find((item, index) => {
            if (item.id === id) {
                doOperation.splice(index, 1);
                return true;
            }
        });
        doOperation.push({
            action: "delete",
            id
        });
        // 选中当前块所有内容粘贴再撤销会导致异常 https://ld246.com/article/1662542137636
        undoOperation.find((item, index) => {
            if (item.id === id && item.action === "update") {
                undoOperation.splice(index, 1);
                return true;
            }
        });
        undoOperation.push({
            action: "insert",
            data: oldHTML,
            id,
            previousID: getPreviousBlockSibling(blockElement)?.getAttribute("data-node-id") || "",
            parentID: getParentBlock(blockElement).getAttribute("data-node-id") || protyle.block.parentID,
            context: crossBlockUndoFocusContext
        });
        blockElement.remove();
    }
    if (lastElement) {
        // https://github.com/siyuan-note/siyuan/issues/5591
        focusBlock(lastElement, undefined, false);
    }
    protyle.wysiwyg.element.querySelectorAll("wbr").forEach(item => {
        item.remove();
    });
    // 复制容器块中包含折叠标题块
    protyle.wysiwyg.element.querySelectorAll("[parent-heading]").forEach(item => {
        item.remove();
    });
    doOperation.push(...crossBlockDoOperations);
    undoOperation.push(...crossBlockUndoOperations);
    let foldData;
    if (blockElement.getAttribute("data-type") === "NodeHeading" &&
        blockElement.getAttribute("fold") === "1" && !insertBefore) {
        fetchPost("/api/block/getHeadingChildrenIDs", {id: blockElement.getAttribute("data-node-id")}, (response) => {
            const childrenIDs: string[] = response.data;
            const previousId = (childrenIDs && childrenIDs.length > 0) ? childrenIDs[childrenIDs.length - 1] : blockElement.getAttribute("data-node-id");
            foldData = setFold(protyle, blockElement, true, false, false, true);
            foldData.doOperations[0].context = {
                focusId: lastElement?.getAttribute("data-node-id"),
            };
            doOperation.forEach(item => {
                if (item.action === "insert") {
                    item.previousID = previousId;
                }
            });
            doOperation.splice(0, 0, ...foldData.doOperations);
            undoOperation.push(...foldData.undoOperations);
            transaction(protyle, doOperation, undoOperation);
        });
        return;
    }
    // 粘贴到空列表项（第一个段落为空）后删除空列表项 https://github.com/siyuan-note/siyuan/issues/17890
    if (isListPaste && cursorLiElement && isFirstBlockInLi) {
        const editEl = getContenteditableElement(cursorLiElement);
        if (editEl && editEl.textContent.replace(Constants.ZWSP, "").trim() === "") {
            // 把空列表项的子列表移到粘贴的最后一项下面
            const subList = cursorLiElement.querySelector(":scope > [data-type='NodeList']");
            if (subList && lastElement && lastElement.classList.contains("li")) {
                const movedList = subList.cloneNode(true) as HTMLElement;
                const existSubList = lastElement.querySelector(":scope > [data-type='NodeList']");
                if (existSubList) {
                    // 最后一项已有子列表，合并子列表项
                    Array.from(movedList.querySelectorAll(":scope > .li")).forEach(li => {
                        existSubList.appendChild(li);
                    });
                } else {
                    lastElement.appendChild(movedList);
                }
                // 更新最后一项的 update 操作 data
                const lastUpdateOp = doOperation.find(op => op.action === "insert" && op.id === lastElement.getAttribute("data-node-id"));
                if (lastUpdateOp) {
                    lastUpdateOp.data = lastElement.outerHTML;
                }
            }
            const liId = cursorLiElement.getAttribute("data-node-id");
            const liHTML = cursorLiElement.outerHTML;
            doOperation.push({action: "delete", id: liId});
            undoOperation.push({
                action: "insert",
                data: liHTML,
                id: liId,
                previousID: cursorLiElement.previousElementSibling?.getAttribute("data-node-id"),
                parentID: cursorLiElement.parentElement?.getAttribute("data-node-id")
            });
            cursorLiElement.remove();
        }
    }
    // 粘贴后修正有序列表序号 https://github.com/siyuan-note/siyuan/issues/17890
    const orderLists = new Set<Element>();
    if (cursorLiElement) {
        // cursorLiElement 可能已被清理删除，用 parentList 引用
        const cursorList = cursorLiElement.classList.contains("list") ? cursorLiElement : cursorLiElement.parentElement;
        if (cursorList?.getAttribute("data-subtype") === "o") {
            orderLists.add(cursorList);
        }
        // 粘贴的最后一项所在的列表
        if (lastElement?.parentElement?.getAttribute("data-subtype") === "o") {
            orderLists.add(lastElement.parentElement);
        }
    }
    // 粘贴产生的子列表也可能是有序列表
    doOperation.forEach(op => {
        if (op.action === "insert") {
            const tempEl = document.createElement("template");
            tempEl.innerHTML = op.data;
            tempEl.content.querySelectorAll("[data-type='NodeList'][data-subtype='o']").forEach(list => {
                const existing = protyle.wysiwyg.element.querySelector(`[data-node-id="${list.getAttribute("data-node-id")}"]`);
                if (existing) {
                    orderLists.add(existing);
                }
            });
        }
    });
    orderLists.forEach(orderList => {
        for (const operation of doOperation) {
            if (operation.action !== "insert") {
                continue;
            }
            const insertedRoot = orderList.closest(`[data-node-id="${operation.id}"]`);
            if (!insertedRoot) {
                continue;
            }
            updateListOrder(orderList);
            operation.data = insertedRoot.outerHTML;
            return;
        }
        // 保存原有列表项的原始状态用于撤销
        const originalItems: {id: string, html: string}[] = [];
        orderList.querySelectorAll(":scope > .li").forEach(li => {
            const liId = li.getAttribute("data-node-id");
            if (!doOperation.find(o => o.id === liId && o.action === "insert")) {
                originalItems.push({id: liId, html: li.outerHTML});
            }
        });
        updateListOrder(orderList);
        // 更新 doOperation 中受影响列表项的 data，原有项补充 update 操作用于撤销
        orderList.querySelectorAll(":scope > .li").forEach(li => {
            const liId = li.getAttribute("data-node-id");
            const op = doOperation.find(o => o.id === liId && o.action === "insert");
            if (op) {
                op.data = li.outerHTML;
            } else {
                const original = originalItems.find(item => item.id === liId);
                if (original && original.html !== li.outerHTML) {
                    doOperation.push({action: "update", id: liId, data: li.outerHTML});
                    undoOperation.push({action: "update", id: liId, data: original.html});
                }
            }
        });
    });
    transaction(protyle, doOperation, undoOperation);
};
