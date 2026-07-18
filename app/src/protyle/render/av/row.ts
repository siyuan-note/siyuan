import {hasClosestBlock, hasClosestByClassName, hasTopClosestByAttribute} from "../../util/hasClosest";
import {focusBlock} from "../../util/selection";
import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {
    cellValueIsEmpty,
    genCellValue,
    genCellValueByElement,
    getTypeByCellElement,
    renderCell,
    renderCellAttr
} from "./cell";
import {fetchPost} from "../../../util/fetch";
import * as dayjs from "dayjs";
import {Constants} from "../../../constants";
import {insertGalleryItemAnimation} from "./gallery/item";
import {clearSelect} from "../../util/clear";
import {isCustomAttr} from "./blockAttr";
import {getColIconByType, getColNameByType} from "./col";
import {unicode2Emoji} from "../../../emoji";
import {escapeAttr} from "../../../util/escape";
import {getCompressURL} from "../../../util/image";
import {getAVSelectStat, getAvBodyData, resetAVRowSelect, updateAVRowSelect} from "./virtualScroll";
import {getCardCoverImageHTML} from "./cover";

export const getRowHTML = (options: {
    data: IAVView
    row: IAVRow | IAVGalleryItem
    rowIndex: number
    type: TAVView
    pinIndex?: number
}) => {
    let html = "";
    if (options.type === "gallery") {
        const galleryRow = options.row as IAVGalleryItem;
        const kanbanData = options.data as IAVGallery;
        html += `<div data-id="${galleryRow.id}" data-index="${options.rowIndex}" draggable="true" class="av__gallery-item">`;
        if (kanbanData.coverFrom !== 0) {
            const coverClass = "av__gallery-cover av__gallery-cover--" + kanbanData.cardAspectRatio;
            if (galleryRow.coverURL) {
                html += `<div class="${coverClass}">${getCardCoverImageHTML(galleryRow.coverURL, getCompressURL(galleryRow.coverURL), kanbanData.fitImage)}</div>`;
            } else if (galleryRow.coverContent) {
                html += `<div class="${coverClass}"><div class="av__gallery-content">${galleryRow.coverContent}</div><div></div></div>`;
            } else {
                html += `<div class="${coverClass}"></div>`;
            }
        }
        html += '<div class="av__gallery-fields">';
        galleryRow.values.forEach((cell, fieldsIndex) => {
            if (kanbanData.fields[fieldsIndex].hidden) {
                return;
            }
            let checkClass = "";
            if (cell.valueType === "checkbox") {
                checkClass = cell.value?.checkbox?.checked ? " av__cell-check" : " av__cell-uncheck";
            }
            const isEmpty = cellValueIsEmpty(cell.value);
            // NOTE: innerHTML 中不能换行否则 https://github.com/siyuan-note/siyuan/issues/15132
            let ariaLabel = escapeAttr(kanbanData.fields[fieldsIndex].name) || getColNameByType(kanbanData.fields[fieldsIndex].type);
            if (kanbanData.fields[fieldsIndex].desc) {
                ariaLabel += escapeAttr(`<div class="ft__on-surface">${kanbanData.fields[fieldsIndex].desc}</div>`);
            }

            if (cell.valueType === "checkbox" && !kanbanData.displayFieldName) {
                cell.value.checkbox.content = kanbanData.fields[fieldsIndex].name || getColNameByType(kanbanData.fields[fieldsIndex].type);
            }
            const cellHTML = `<div class="av__cell${checkClass}${kanbanData.displayFieldName ? "" : " ariaLabel"}" 
data-wrap="${kanbanData.fields[fieldsIndex].wrap}" 
aria-label="${ariaLabel}" 
data-position="5west"
data-id="${cell.id}" 
data-field-id="${kanbanData.fields[fieldsIndex].id}" 
data-dtype="${cell.valueType}" 
${cell.value?.isDetached ? ' data-detached="true"' : ""} 
style="${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${cell.color ? `color:${cell.color};` : ""}">${renderCell(cell.value, options.rowIndex, kanbanData.showIcon, "gallery")}</div>`;
            if (kanbanData.displayFieldName) {
                html += `<div class="av__gallery-field av__gallery-field--name" data-empty="${isEmpty}">
    <div class="av__gallery-name">
        ${kanbanData.fields[fieldsIndex].icon ? unicode2Emoji(kanbanData.fields[fieldsIndex].icon, undefined, true) : `<svg><use xlink:href="#${getColIconByType(kanbanData.fields[fieldsIndex].type)}"></use></svg>`}${Lute.EscapeHTMLStr(kanbanData.fields[fieldsIndex].name)}
        ${kanbanData.fields[fieldsIndex].desc ? `<svg aria-label="${kanbanData.fields[fieldsIndex].desc}" data-position="north" class="ariaLabel"><use xlink:href="#iconInfo"></use></svg>` : ""}
    </div>
    ${cellHTML}
</div>`;
            } else {
                html += `<div class="av__gallery-field" data-empty="${isEmpty}">
    <div class="av__gallery-tip">
        ${kanbanData.fields[fieldsIndex].icon ? unicode2Emoji(kanbanData.fields[fieldsIndex].icon, undefined, true) : `<svg><use xlink:href="#${getColIconByType(kanbanData.fields[fieldsIndex].type)}"></use></svg>`}${window.siyuan.languages.edit} ${Lute.EscapeHTMLStr(kanbanData.fields[fieldsIndex].name)}
    </div>
    ${cellHTML}
</div>`;
            }
        });
        html += `</div>
    <div class="av__gallery-actions">
        <span class="protyle-icon protyle-icon--first ariaLabel" data-position="4north" aria-label="${window.siyuan.languages.displayEmptyFields}" data-type="av-gallery-edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
        <span class="protyle-icon protyle-icon--last ariaLabel" data-position="4north" aria-label="${window.siyuan.languages.more}" data-type="av-gallery-more"><svg><use xlink:href="#iconMore"></use></svg></span>
    </div>
</div>`;
        return html;
    }
    if (options.type === "kanban") {
        const kanbanRow = options.row as IAVGalleryItem;
        const kanbanData = options.data as IAVKanban;
        html += `<div data-id="${kanbanRow.id}" data-index="${options.rowIndex}" draggable="true" class="av__gallery-item">`;
        if (kanbanData.coverFrom !== 0) {
            const coverClass = "av__gallery-cover av__gallery-cover--" + kanbanData.cardAspectRatio;
            if (kanbanRow.coverURL) {
                html += `<div class="${coverClass}">${getCardCoverImageHTML(kanbanRow.coverURL, getCompressURL(kanbanRow.coverURL), kanbanData.fitImage)}</div>`;
            } else if (kanbanRow.coverContent.trim()) {
                html += `<div class="${coverClass}"><div class="av__gallery-content">${kanbanRow.coverContent}</div><div></div></div>`;
            }
        }
        html += '<div class="av__gallery-fields">';
        kanbanRow.values.forEach((cell, fieldsIndex) => {
            if (kanbanData.fields[fieldsIndex].hidden) {
                return;
            }
            let checkClass = "";
            if (cell.valueType === "checkbox") {
                checkClass = cell.value?.checkbox?.checked ? " av__cell-check" : " av__cell-uncheck";
            }
            const isEmpty = cellValueIsEmpty(cell.value);
            // NOTE: innerHTML 中不能换行否则 https://github.com/siyuan-note/siyuan/issues/15132
            let ariaLabel = escapeAttr(kanbanData.fields[fieldsIndex].name) || getColNameByType(kanbanData.fields[fieldsIndex].type);
            if (kanbanData.fields[fieldsIndex].desc) {
                ariaLabel += escapeAttr(`<div class="ft__on-surface">${kanbanData.fields[fieldsIndex].desc}</div>`);
            }

            if (cell.valueType === "checkbox" && !kanbanData.displayFieldName) {
                cell.value.checkbox.content = kanbanData.fields[fieldsIndex].name || getColNameByType(kanbanData.fields[fieldsIndex].type);
            }
            const cellHTML = `<div class="av__cell${checkClass}${kanbanData.displayFieldName ? "" : " ariaLabel"}" 
data-wrap="${kanbanData.fields[fieldsIndex].wrap}" 
aria-label="${ariaLabel}" 
data-position="5west"
data-id="${cell.id}" 
data-field-id="${kanbanData.fields[fieldsIndex].id}" 
data-dtype="${cell.valueType}" 
${cell.value?.isDetached ? ' data-detached="true"' : ""} 
style="${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${cell.color ? `color:${cell.color};` : ""}">${renderCell(cell.value, options.rowIndex, kanbanData.showIcon, "kanban")}</div>`;
            if (kanbanData.displayFieldName) {
                html += `<div class="av__gallery-field av__gallery-field--name" data-empty="${isEmpty}">
    <div class="av__gallery-name">
        ${kanbanData.fields[fieldsIndex].icon ? unicode2Emoji(kanbanData.fields[fieldsIndex].icon, undefined, true) : `<svg><use xlink:href="#${getColIconByType(kanbanData.fields[fieldsIndex].type)}"></use></svg>`}${Lute.EscapeHTMLStr(kanbanData.fields[fieldsIndex].name)}
        ${kanbanData.fields[fieldsIndex].desc ? `<svg aria-label="${kanbanData.fields[fieldsIndex].desc}" data-position="north" class="ariaLabel"><use xlink:href="#iconInfo"></use></svg>` : ""}
    </div>
    ${cellHTML}
</div>`;
            } else {
                html += `<div class="av__gallery-field" data-empty="${isEmpty}">
    <div class="av__gallery-tip">
        ${kanbanData.fields[fieldsIndex].icon ? unicode2Emoji(kanbanData.fields[fieldsIndex].icon, undefined, true) : `<svg><use xlink:href="#${getColIconByType(kanbanData.fields[fieldsIndex].type)}"></use></svg>`}${window.siyuan.languages.edit} ${Lute.EscapeHTMLStr(kanbanData.fields[fieldsIndex].name)}
    </div>
    ${cellHTML}
</div>`;
            }
        });
        html += `</div>
    <div class="av__gallery-actions">
        <span class="protyle-icon protyle-icon--first ariaLabel" data-position="4north" aria-label="${window.siyuan.languages.displayEmptyFields}" data-type="av-gallery-edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
        <span class="protyle-icon protyle-icon--last ariaLabel" data-position="4north" aria-label="${window.siyuan.languages.more}" data-type="av-gallery-more"><svg><use xlink:href="#iconMore"></use></svg></span>
    </div>
</div>`;
        return html;
    }
    const tableRow = options.row as IAVRow;
    const tableData = options.data as IAVTable;

    html = `<div class="av__row" data-index="${options.rowIndex}" data-id="${tableRow.id}">`;
    if (options.pinIndex > -1) {
        html += '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
    } else {
        html += '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div></div>';
    }

    tableRow.cells.forEach((cell, index) => {
        const column = tableData.columns[index];
        if (column.hidden) {
            return;
        }
        // https://github.com/siyuan-note/siyuan/issues/10262
        let checkClass = "";
        if (cell.valueType === "checkbox") {
            checkClass = cell.value?.checkbox?.checked ? " av__cell-check" : " av__cell-uncheck";
        }
        html += `<div class="av__cell${checkClass}" data-id="${cell.id}" data-col-id="${column.id}" 
data-wrap="${column.wrap}" 
data-dtype="${column.type}" 
data-align="${column.align || ""}"
${cell.value?.isDetached ? ' data-detached="true"' : ""} 
style="width: ${column.width || "200px"};
${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${cell.color ? `color:${cell.color};` : ""}">${renderCell(cell.value, options.rowIndex, tableData.showIcon)}</div>`;

        if (options.pinIndex === index) {
            html += "</div>";
        }
    });
    return html + "<div></div></div>";
};

export const getFieldIdByCellElement = (cellElement: Element, viewType: TAVView): string => {
    if (isCustomAttr(cellElement)) {
        return cellElement.getAttribute("data-row-id");
    }
    return (hasClosestByClassName(cellElement, viewType === "table" ? "av__row" : "av__gallery-item") as HTMLElement).dataset.id;
};

export const selectRow = (checkElement: Element, type: "toggle" | "select" | "unselect" | "unselectAll") => {
    const rowElement = hasClosestByClassName(checkElement, "av__row");
    if (!rowElement) {
        return;
    }
    const useElement = checkElement.querySelector("use");
    const bodyElement = hasClosestByClassName(rowElement, "av__body") as HTMLElement;
    if (rowElement.classList.contains("av__row--header") || type === "unselectAll") {
        if ("#iconCheck" === useElement.getAttribute("xlink:href") || type === "unselectAll") {
            rowElement.parentElement.querySelectorAll(".av__firstcol").forEach(item => {
                item.querySelector("use").setAttribute("xlink:href", "#iconUncheck");
                const rowItemElement = hasClosestByClassName(item, "av__row");
                if (rowItemElement) {
                    rowItemElement.classList.remove("av__row--select");
                }
            });
            // 全不选：清空选中快照，避免被 trim 掉的行回填后仍带选中态
            if (bodyElement) {
                resetAVRowSelect(bodyElement, []);
            }
        } else {
            // 全选：范围以当前已加载的分页行（dataStore 的 view.rows）为准，而非仅 DOM 内已渲染的行。
            // 虚拟滚动下被 trim 掉的行 ID 一并存入快照，回填时由 restoreSelect 恢复高亮。
            rowElement.parentElement.querySelectorAll(".av__firstcol").forEach(item => {
                item.querySelector("use").setAttribute("xlink:href", "#iconCheck");
                const rowItemElement = hasClosestByClassName(item, "av__row");
                if (rowItemElement) {
                    rowItemElement.classList.add("av__row--select");
                }
            });
            const allRowIds: string[] = [];
            if (bodyElement) {
                const view = getAvBodyData(bodyElement) as IAVTable;
                if (view?.rows) {
                    view.rows.forEach((row: IAVRow) => {
                        if (row.id) {
                            allRowIds.push(row.id);
                        }
                    });
                }
                resetAVRowSelect(bodyElement, allRowIds);
            }
        }
    } else {
        const rowId = rowElement.getAttribute("data-id");
        if (type === "select" || (useElement.getAttribute("xlink:href") === "#iconUncheck" && type === "toggle")) {
            rowElement.classList.add("av__row--select");
            useElement.setAttribute("xlink:href", "#iconCheck");
            if (bodyElement && rowId) {
                updateAVRowSelect(bodyElement, rowId, true);
            }
        } else if (type === "unselect" || (useElement.getAttribute("xlink:href") === "#iconCheck" && type === "toggle")) {
            rowElement.classList.remove("av__row--select");
            useElement.setAttribute("xlink:href", "#iconUncheck");
            if (bodyElement && rowId) {
                updateAVRowSelect(bodyElement, rowId, false);
            }
        }
    }
    focusBlock(hasClosestBlock(rowElement) as HTMLElement);
    updateHeader(rowElement);
};

export const updateHeader = (rowElement: HTMLElement) => {
    const blockElement = hasClosestBlock(rowElement);
    if (!blockElement) {
        return;
    }
    const avType = blockElement.getAttribute("data-av-type") as TAVView;
    let selectCount: number;
    if (avType === "table") {
        const bodyElement = rowElement.parentElement as HTMLElement;
        // 虚拟滚动下 DOM 内只有渲染窗口的行，直接计数会低估；优先用选中快照与已加载行总数。
        const stat = getAVSelectStat(bodyElement);
        selectCount = stat ? stat.selectCount : bodyElement.querySelectorAll(".av__row--select:not(.av__row--header)").length;
        const count = stat ? stat.loadedCount : bodyElement.querySelectorAll(".av__row:not(.av__row--header)").length;
        const headElement = bodyElement.firstElementChild as HTMLElement;
        const headUseElement = headElement.querySelector("use");
        if (count === selectCount && count !== 0) {
            headElement.classList.add("av__row--select");
            headUseElement.setAttribute("xlink:href", "#iconCheck");
        } else if (selectCount === 0) {
            headElement.classList.remove("av__row--select");
            headUseElement.setAttribute("xlink:href", "#iconUncheck");
        } else if (selectCount > 0) {
            headElement.classList.add("av__row--select");
            headUseElement.setAttribute("xlink:href", "#iconIndeterminateCheck");
        }
    } else {
        // 卡片/看板视图按分组（.av__body）聚合选中数，看板与分组卡片视图存在多个 body。
        selectCount = 0;
        blockElement.querySelectorAll(".av__body").forEach((bodyItem: HTMLElement) => {
            const stat = getAVSelectStat(bodyItem);
            selectCount += stat ? stat.selectCount : bodyItem.querySelectorAll(".av__gallery-item--select").length;
        });
    }

    const counterElement = blockElement.querySelector(".av__counter");
    if (selectCount === 0) {
        counterElement.classList.add("fn__none");
        return;
    }
    counterElement.classList.remove("fn__none");
    counterElement.innerHTML = `${selectCount} ${window.siyuan.languages.selected}`;
};

export const setPage = (blockElement: Element) => {
    const avType = blockElement.getAttribute("data-av-type") as TAVView;
    blockElement.querySelectorAll(".av__body").forEach((item: HTMLElement) => {
        const pageSize = item.dataset.pageSize;
        if (pageSize) {
            const currentCount = item.querySelectorAll(avType === "table" ? ".av__row:not(.av__row--header)" : ".av__gallery-item").length;
            if (parseInt(pageSize) < currentCount) {
                item.dataset.pageSize = currentCount.toString();
            }
        }
    });
};

/**
 * 前端插入一假行
 * @param options.protyle
 * @param options.blockElement
 * @param options.srcIDs
 * @param options.previousId
 * @param options.avId 存在为新增否则为拖拽插入
 */
export const insertAttrViewBlockAnimation = (options: {
    protyle: IProtyle,
    blockElement: Element,
    srcIDs: string[],   // node id
    previousId: string,
    groupID?: string
}) => {
    options.blockElement.querySelector('[data-type="av-search"]').textContent = "";
    const groupQuery = options.groupID ? `.av__body[data-group-id="${options.groupID}"] ` : "";
    let previousElement = options.blockElement.querySelector(groupQuery + `.av__row[data-id="${options.previousId}"]`) || options.blockElement.querySelector(groupQuery + ".av__row--header");
    // 有排序需要加入最后一行
    const hasSort = options.blockElement.querySelector('.av__views [data-type="av-sort"]').classList.contains("block__icon--active");
    if (hasSort) {
        previousElement = options.blockElement.querySelector(groupQuery + ".av__row--util").previousElementSibling;
    }
    const bodyElement = options.blockElement.querySelector(`.av__body[data-group-id="${options.groupID}"] `);
    if (bodyElement && ["updated", "created"].includes(bodyElement.getAttribute("data-dtype")) &&
        bodyElement.getAttribute("data-content") !== "_@today@_") {
        previousElement = options.blockElement.querySelector('.av__body[data-content="_@today@_"] .av__row--util')?.previousElementSibling;
    }
    if (!previousElement) {
        return;
    }
    let cellsHTML = '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div></div>';
    const pinIndex = previousElement.querySelectorAll(".av__colsticky .av__cell").length - 1;
    if (pinIndex > -1) {
        cellsHTML = '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
    }
    previousElement.querySelectorAll(".av__cell").forEach((item: HTMLElement, index) => {
        let lineNumber = 1;
        const colType = getTypeByCellElement(item);
        if (colType === "lineNumber") {
            const lineNumberValue = item.querySelector(".av__celltext")?.getAttribute("data-value");
            if (lineNumberValue) {
                lineNumber = parseInt(lineNumberValue);
            }
        }
        cellsHTML += `<div class="av__cell${colType === "checkbox" ? " av__cell-uncheck" : ""}" data-col-id="${item.dataset.colId}" 
data-wrap="${item.dataset.wrap}" 
data-dtype="${item.dataset.dtype}" 
data-align="${item.dataset.align || ""}"
style="width: ${item.style.width};"
${colType === "block" ? ' data-detached="true"' : ""}>${renderCell(genCellValue(colType, null), lineNumber)}</div>`;
        if (pinIndex === index) {
            cellsHTML += "</div>";
        }
    });
    let html = "";
    clearSelect(["cell", "row"], options.blockElement);
    options.srcIDs.forEach(() => {
        html += `<div class="av__row" data-type="ghost">
    ${cellsHTML}
</div>`;
    });
    previousElement.insertAdjacentHTML("afterend", html);
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
                    if (updateIds.includes(cellItem.dataset.colId)) {
                        const cellValue = response.data.values[cellItem.dataset.colId];
                        cellItem.innerHTML = renderCell(cellValue);
                        renderCellAttr(cellItem, cellValue);
                    }
                });
            });
        }
        setPage(options.blockElement);
    });
};

const applyFixedClip = (el: HTMLElement, scrollEl: HTMLElement) => {
    const scrollLeft = scrollEl.scrollLeft;
    const clientWidth = scrollEl.clientWidth;
    const scrollWidth = scrollEl.scrollWidth;
    if (scrollWidth <= clientWidth) {
        if (el.style.clipPath) {
            el.style.clipPath = "";
        }
        return;
    }
    const right = Math.max(0, scrollWidth - scrollLeft - clientWidth);
    el.style.clipPath = `inset(0 ${right}px 0 ${scrollLeft}px)`;
};

const stickyScrollElMap = new WeakMap<HTMLElement, HTMLElement>();

const bindHeaderScrollSync = (blockElement: HTMLElement, scrollEl: HTMLElement) => {
    if (stickyScrollElMap.get(blockElement) === scrollEl) {
        return;
    }
    stickyScrollElMap.set(blockElement, scrollEl);
    const syncHeaders = () => {
        const x = -scrollEl.scrollLeft;
        blockElement.querySelectorAll(".av__row--header--fixed, .av__row--footer--fixed").forEach((el: HTMLElement) => {
            el.style.transform = `translateX(${x}px)`;
            applyFixedClip(el, scrollEl);
        });
    };
    scrollEl.addEventListener("scroll", syncHeaders, {passive: true});
    if (scrollEl.scrollLeft > 0) {
        syncHeaders();
    }
};

const addFixedRow = (item: HTMLElement, fixedClass: string, placeholderClass: string, height: number, width: number) => {
    item.classList.add(fixedClass);
    const placeholder = document.createElement("div");
    placeholder.className = placeholderClass;
    placeholder.style.height = height + "px";
    placeholder.style.width = width + "px";
    item.insertAdjacentElement("afterend", placeholder);
};

const removeFixedRow = (item: HTMLElement, fixedClass: string, placeholderClass: string) => {
    if (!item.classList.contains(fixedClass)) {
        return;
    }
    item.classList.remove(fixedClass);
    item.style.top = "";
    item.style.bottom = "";
    item.style.left = "";
    item.style.width = "";
    item.style.transform = "";
    item.style.clipPath = "";
    const next = item.nextElementSibling as HTMLElement;
    if (next?.classList.contains(placeholderClass)) {
        next.remove();
    }
};

const syncFixedRowPos = (item: HTMLElement, bodyRect: DOMRect, scrollLeft: number, scrollEl: HTMLElement) => {
    item.style.left = Math.round(bodyRect.left + scrollLeft) + "px";
    item.style.width = Math.round(bodyRect.width) + "px";
    item.style.transform = `translateX(${-scrollLeft}px)`;
    if (scrollEl) {
        applyFixedClip(item, scrollEl);
    }
};

export const stickyRow = (blockElement: HTMLElement, scrollElement: HTMLElement, status: "top" | "bottom" | "all") => {
    if (blockElement.dataset.avType !== "table") {
        return;
    }
    const skipFixed = hasTopClosestByAttribute(blockElement, "fold", "1");
    if (skipFixed) {
        blockElement.querySelectorAll(".av__row--header--fixed").forEach((item: HTMLElement) => {
            removeFixedRow(item, "av__row--header--fixed", "av__row--header-placeholder");
        });
        blockElement.querySelectorAll(".av__row--footer--fixed").forEach((item: HTMLElement) => {
            removeFixedRow(item, "av__row--footer--fixed", "av__row--footer-placeholder");
        });
        return;
    }
    const scrollEl = blockElement.querySelector(".av__scroll") as HTMLElement;
    if (scrollEl) {
        bindHeaderScrollSync(blockElement, scrollEl);
    }

    // 先批量读取所有几何信息，再统一写入 style，避免读-写交错触发强制重排
    const elementRect = scrollElement.getBoundingClientRect();
    const scrollTop = scrollElement.scrollTop;
    const scrollLeft = scrollEl ? scrollEl.scrollLeft : 0;
    const doTop = status === "top" || status === "all";
    const doBottom = status === "bottom" || status === "all";

    // 第一遍：纯读取，收集每个 header/footer 的几何与判定结果
    const headerTasks: Array<{
        item: HTMLElement;
        bodyRect: DOMRect;
        headerH: number;
        shouldFix: boolean;
        scrollLeft: number;
        scrollEl: HTMLElement;
    }> = [];
    const footerTasks: Array<{
        item: HTMLElement;
        bodyRect: DOMRect;
        footerH: number;
        shouldFix: boolean;
        scrollLeft: number;
        scrollEl: HTMLElement;
    }> = [];
    if (doTop) {
        blockElement.querySelectorAll(".av__row--header").forEach((item: HTMLElement) => {
            const body = item.parentElement as HTMLElement;
            const bodyRect = body.getBoundingClientRect();
            const offset = Math.round(bodyRect.top - elementRect.top + scrollTop);
            const headerH = item.offsetHeight;
            const bodyH = body.offsetHeight;
            headerTasks.push({
                item,
                bodyRect,
                headerH,
                shouldFix: scrollTop > offset && scrollTop < offset + bodyH,
                scrollLeft,
                scrollEl,
            });
        });
    }
    if (doBottom) {
        blockElement.querySelectorAll(".av__row--footer").forEach((item: HTMLElement) => {
            if (!item.querySelector(".av__calc--ashow")) {
                return;
            }
            const body = item.parentElement as HTMLElement;
            const bodyRect = body.getBoundingClientRect();
            const bottomInit = Math.round(bodyRect.bottom + scrollTop);
            const footerH = item.offsetHeight;
            const bodyH = body.offsetHeight;
            const bottomOffset = bottomInit - Math.round(elementRect.bottom);
            const footerDist = bottomInit - scrollTop - Math.round(elementRect.bottom);
            footerTasks.push({
                item,
                bodyRect,
                footerH,
                shouldFix: scrollTop < bottomOffset && footerDist < bodyH - footerH,
                scrollLeft,
                scrollEl,
            });
        });
    }

    // 第二遍：纯写入，此时不再读取布局，仅触发一次重排
    const stickyTop = Math.round(elementRect.top);
    const stickyBottom = Math.round(window.innerHeight - elementRect.bottom);
    headerTasks.forEach((task) => {
        const {item, bodyRect, headerH, shouldFix} = task;
        if (shouldFix) {
            if (!item.classList.contains("av__row--header--fixed")) {
                addFixedRow(item, "av__row--header--fixed", "av__row--header-placeholder", headerH, Math.round(bodyRect.width));
            }
            syncFixedRowPos(item, bodyRect, task.scrollLeft, task.scrollEl);
            item.style.top = bodyRect.bottom < stickyTop + headerH
                ? Math.round(bodyRect.bottom - headerH) + "px"
                : stickyTop + "px";
        } else {
            removeFixedRow(item, "av__row--header--fixed", "av__row--header-placeholder");
        }
    });
    footerTasks.forEach((task) => {
        const {item, bodyRect, footerH, shouldFix} = task;
        if (shouldFix) {
            if (!item.classList.contains("av__row--footer--fixed")) {
                addFixedRow(item, "av__row--footer--fixed", "av__row--footer--placeholder", footerH, Math.round(bodyRect.width));
            }
            syncFixedRowPos(item, bodyRect, task.scrollLeft, task.scrollEl);
            item.style.bottom = stickyBottom + "px";
        } else {
            removeFixedRow(item, "av__row--footer--fixed", "av__row--footer--placeholder");
        }
    });
};

const updatePageSize = (options: {
    currentPageSize: string,
    newPageSize: string,
    protyle: IProtyle,
    avID: string,
    nodeElement: Element
}) => {
    if (options.currentPageSize === options.newPageSize) {
        return;
    }
    options.nodeElement.querySelectorAll(".av__body").forEach((item: HTMLElement) => {
        item.dataset.pageSize = options.newPageSize;
    });
    const blockID = options.nodeElement.getAttribute("data-node-id");
    transaction(options.protyle, [{
        action: "setAttrViewPageSize",
        avID: options.avID,
        data: parseInt(options.newPageSize),
        blockID
    }], [{
        action: "setAttrViewPageSize",
        data: parseInt(options.currentPageSize),
        avID: options.avID,
        blockID
    }]);
    document.querySelector(".av__panel")?.remove();
};

export const setPageSize = (options: {
    target: HTMLElement,
    protyle: IProtyle,
    avID: string,
    nodeElement: Element
}) => {
    const menu = new Menu(Constants.MENU_AV_PAGE_SIZE);
    if (menu.isOpen) {
        return;
    }
    const currentPageSize = options.target.dataset.size;
    menu.addItem({
        iconHTML: "",
        label: "5",
        checked: currentPageSize === "5",
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: "5",
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    menu.addItem({
        iconHTML: "",
        label: "10",
        checked: currentPageSize === "10",
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: "10",
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    menu.addItem({
        iconHTML: "",
        checked: currentPageSize === "25",
        label: "25",
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: "25",
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    menu.addItem({
        iconHTML: "",
        checked: currentPageSize === "50",
        label: "50",
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: "50",
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    menu.addItem({
        iconHTML: "",
        checked: currentPageSize === "100",
        label: "100",
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: "100",
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    menu.addItem({
        iconHTML: "",
        checked: currentPageSize === Constants.SIZE_DATABASE_MAZ_SIZE.toString(),
        label: window.siyuan.languages.all,
        click() {
            updatePageSize({
                currentPageSize,
                newPageSize: Constants.SIZE_DATABASE_MAZ_SIZE.toString(),
                protyle: options.protyle,
                avID: options.avID,
                nodeElement: options.nodeElement
            });
        }
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom
    });
};

export const deleteRow = (blockElement: HTMLElement, protyle: IProtyle) => {
    const rowElements = blockElement.querySelectorAll(".av__row--select:not(.av__row--header), .av__gallery-item--select");
    if (rowElements.length === 0) {
        return;
    }
    const avID = blockElement.getAttribute("data-av-id");
    const undoOperations: IOperation[] = [];
    const blockIds: string[] = [];
    rowElements.forEach(item => {
        blockIds.push(item.getAttribute("data-id"));
    });
    rowElements.forEach(item => {
        const blockValue = genCellValueByElement("block", item.querySelector('.av__cell[data-dtype="block"]'));
        undoOperations.push({
            action: "insertAttrViewBlock",
            avID,
            previousID: item.previousElementSibling?.getAttribute("data-id") || "",
            srcs: [{
                itemID: Lute.NewNodeID(),
                id: item.getAttribute("data-id"),
                isDetached: blockValue.isDetached,
                content: blockValue.block.content
            }],
            blockID: blockElement.dataset.nodeId,
            groupID: item.parentElement.getAttribute("data-group-id")
        });
    });
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    undoOperations.push({
        action: "doUpdateUpdated",
        id: blockElement.dataset.nodeId,
        data: blockElement.getAttribute("updated")
    });
    transaction(protyle, [{
        action: "removeAttrViewBlock",
        srcIDs: blockIds,
        avID,
    }, {
        action: "doUpdateUpdated",
        id: blockElement.dataset.nodeId,
        data: newUpdated,
    }], undoOperations);
    rowElements.forEach(item => {
        item.remove();
    });
    stickyRow(blockElement, protyle.contentElement, "all");
    updateHeader(blockElement.querySelector(".av__row"));
    blockElement.setAttribute("updated", newUpdated);
};

export const insertRows = (options: {
    blockElement: HTMLElement,
    protyle: IProtyle,
    count: number,
    previousID: string,
    groupID?: string
}) => {
    const avID = options.blockElement.getAttribute("data-av-id");
    const srcIDs: string[] = [];
    const srcs: IOperationSrcs[] = [];
    new Array(options.count).fill(0).forEach(() => {
        const newNodeID = Lute.NewNodeID();
        srcIDs.push(newNodeID);
        srcs.push({
            itemID: Lute.NewNodeID(),
            id: newNodeID,
            isDetached: true,
            content: "",
        });
    });
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    transaction(options.protyle, [{
        action: "insertAttrViewBlock",
        avID,
        previousID: options.previousID,
        srcs,
        blockID: options.blockElement.dataset.nodeId,
        groupID: options.groupID
    }, {
        action: "doUpdateUpdated",
        id: options.blockElement.dataset.nodeId,
        data: newUpdated,
    }], [{
        action: "removeAttrViewBlock",
        srcIDs,
        avID,
    }, {
        action: "doUpdateUpdated",
        id: options.blockElement.dataset.nodeId,
        data: options.blockElement.getAttribute("updated")
    }]);
    if (["gallery", "kanban"].includes(options.blockElement.getAttribute("data-av-type"))) {
        insertGalleryItemAnimation({
            blockElement: options.blockElement,
            protyle: options.protyle,
            srcIDs,
            previousId: options.previousID,
            groupID: options.groupID
        });
    } else {
        insertAttrViewBlockAnimation({
            protyle: options.protyle,
            blockElement: options.blockElement,
            srcIDs,
            previousId: options.previousID,
            groupID: options.groupID
        });
    }
    options.blockElement.setAttribute("updated", newUpdated);
};

export const duplicateRows = (blockElement: HTMLElement, protyle: IProtyle, rowElements: NodeListOf<Element>) => {
    const avID = blockElement.getAttribute("data-av-id");
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const newRowIDs: string[] = [];
    // 副本统一插入到最后选中的条目之后，按源序排列
    const anchorID = rowElements[rowElements.length - 1].getAttribute("data-id");
    let previousID = anchorID;
    rowElements.forEach(rowElement => {
        const newRowID = Lute.NewNodeID();
        newRowIDs.push(newRowID);
        const srcRowID = rowElement.getAttribute("data-id");
        doOperations.push({
            action: "duplicateAttrViewRow",
            avID,
            id: newRowID,
            srcIDs: [srcRowID],
            previousID,
        });
        // 后续副本接在前一个副本之后，保证源序
        previousID = newRowID;
    });
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    doOperations.push({
        action: "doUpdateUpdated",
        id: blockElement.dataset.nodeId,
        data: newUpdated,
    });
    undoOperations.push({
        action: "removeAttrViewBlock",
        srcIDs: newRowIDs,
        avID,
    });
    undoOperations.push({
        action: "doUpdateUpdated",
        id: blockElement.dataset.nodeId,
        data: blockElement.getAttribute("updated")
    });
    transaction(protyle, doOperations, undoOperations);
    blockElement.setAttribute("updated", newUpdated);
};
