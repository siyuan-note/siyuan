import {fetchPost} from "../../../util/fetch";
import {getColIconByType} from "./col";
import {Constants} from "../../../constants";
import {addDragFill, renderCell} from "./cell";
import {unicode2Emoji} from "../../../emoji";
import {focusBlock} from "../../util/selection";
import {hasClosestBlock, hasClosestByClassName, isInEmbedBlock} from "../../util/hasClosest";
import {stickyRow, updateHeader} from "./row";
import {getCalcValue} from "./calc";
import {renderAVAttribute} from "./blockAttr";
import {showMessage} from "../../../dialog/message";
import {addClearButton} from "../../../util/addClearButton";

export const avRender = (element: Element, protyle: IProtyle, cb?: () => void, viewID?: string) => {
    let avElements: Element[] = [];
    if (element.getAttribute("data-type") === "NodeAttributeView") {
        // 编辑器内代码块编辑渲染
        avElements = [element];
    } else {
        avElements = Array.from(element.querySelectorAll('[data-type="NodeAttributeView"]'));
    }
    if (avElements.length === 0) {
        return;
    }
    if (avElements.length > 0) {
        avElements.forEach((e: HTMLElement) => {
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            const alignSelf = e.style.alignSelf;
            if (e.firstElementChild.innerHTML === "") {
                e.style.alignSelf = "";
                let html = "";
                [1, 2, 3].forEach(() => {
                    html += `<div class="av__row">
    <div style="width: 24px;flex-shrink: 0"></div>
    <div class="av__cell" style="width: 200px"><span class="av__pulse"></span></div>
    <div class="av__cell" style="width: 200px"><span class="av__pulse"></span></div>
    <div class="av__cell" style="width: 200px"><span class="av__pulse"></span></div>
    <div class="av__cell" style="width: 200px"><span class="av__pulse"></span></div>
</div>`;
                });
                e.firstElementChild.innerHTML = html;
            }
            const left = e.querySelector(".av__scroll")?.scrollLeft || 0;
            const headerTransform = (e.querySelector(".av__row--header") as HTMLElement)?.style.transform;
            const footerTransform = (e.querySelector(".av__row--footer") as HTMLElement)?.style.transform;
            const selectRowIds: string[] = [];
            e.querySelectorAll(".av__row--select").forEach(rowItem => {
                const rowId = rowItem.getAttribute("data-id");
                if (rowId) {
                    selectRowIds.push(rowId);
                }
            });
            let selectCellId = "";
            const selectCellElement = e.querySelector(".av__cell--select") as HTMLElement;
            if (selectCellElement) {
                selectCellId = (hasClosestByClassName(selectCellElement, "av__row") as HTMLElement).dataset.id + Constants.ZWSP + selectCellElement.getAttribute("data-col-id");
            }
            let dragFillId = "";
            const dragFillElement = e.querySelector(".av__drag-fill") as HTMLElement;
            if (dragFillElement) {
                dragFillId = (hasClosestByClassName(dragFillElement, "av__row") as HTMLElement).dataset.id + Constants.ZWSP + dragFillElement.parentElement.getAttribute("data-col-id");
            }
            const activeIds: string[] = [];
            e.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                activeIds.push((hasClosestByClassName(item, "av__row") as HTMLElement).dataset.id + Constants.ZWSP + item.getAttribute("data-col-id"));
            });
            const created = protyle.options.history?.created;
            const snapshot = protyle.options.history?.snapshot;
            let newViewID = e.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "";
            if (typeof viewID === "string") {
                newViewID = viewID;
                fetchPost("/api/av/setDatabaseBlockView", {id: e.dataset.nodeId, viewID});
                e.setAttribute(Constants.CUSTOM_SY_AV_VIEW, newViewID);
            }
            let searchInputElement = e.querySelector('[data-type="av-search"]') as HTMLInputElement;
            const isSearching = searchInputElement && document.activeElement.isSameNode(searchInputElement);
            const query = searchInputElement?.value || "";
            fetchPost(created ? "/api/av/renderHistoryAttributeView" : (snapshot ? "/api/av/renderSnapshotAttributeView" : "/api/av/renderAttributeView"), {
                id: e.getAttribute("data-av-id"),
                created,
                snapshot,
                pageSize: parseInt(e.dataset.pageSize) || undefined,
                viewID: newViewID,
                query
            }, (response) => {
                const data = response.data.view as IAVTable;
                if (!e.dataset.pageSize) {
                    e.dataset.pageSize = data.pageSize.toString();
                }
                // header
                let tableHTML = '<div class="av__row av__row--header"><div class="av__firstcol av__colsticky"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
                let calcHTML = "";
                let pinIndex = -1;
                let pinMaxIndex = -1;
                let indexWidth = 0;
                const eWidth = e.clientWidth;
                let hasFilter = false;
                data.columns.forEach((item, index) => {
                    if (!hasFilter) {
                        data.filters.find(filterItem => {
                            if (filterItem.value.type === item.type && item.id === filterItem.column) {
                                hasFilter = true;
                                return true;
                            }
                        });
                    }
                    if (!item.hidden) {
                        if (item.pin) {
                            pinIndex = index;
                        }
                        if (indexWidth < eWidth - 200) {
                            indexWidth += parseInt(item.width) || 200;
                            pinMaxIndex = index;
                        }
                    }
                });
                pinIndex = Math.min(pinIndex, pinMaxIndex);
                if (pinIndex > -1) {
                    tableHTML = '<div class="av__row av__row--header"><div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
                    calcHTML = '<div class="av__colsticky">';
                }
                let hasCalc = false;
                data.columns.forEach((column: IAVColumn, index: number) => {
                    if (column.hidden) {
                        return;
                    }
                    tableHTML += `<div class="av__cell av__cell--header" data-col-id="${column.id}"  draggable="true" 
data-icon="${column.icon}" data-dtype="${column.type}" data-wrap="${column.wrap}" data-pin="${column.pin}" 
style="width: ${column.width || "200px"};">
    ${column.icon ? unicode2Emoji(column.icon, "av__cellheadericon", true) : `<svg class="av__cellheadericon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`}
    <span class="av__celltext fn__flex-1">${column.name}</span>
    ${column.pin ? '<svg class="av__cellheadericon av__cellheadericon--pin"><use xlink:href="#iconPin"></use></svg>' : ""}
    <div class="av__widthdrag"></div>
</div>`;
                    if (pinIndex === index) {
                        tableHTML += "</div>";
                    }

                    if (column.type === "lineNumber") {
                        // lineNumber type 不参与计算操作
                        calcHTML += `<div data-col-id="${column.id}" data-dtype="${column.type}" class="av__calc" style="width: ${column.width || "200px"}">&nbsp;</div>`;
                    } else {
                        calcHTML += `<div class="av__calc${column.calc && column.calc.operator !== "" ? " av__calc--ashow" : ""}" data-col-id="${column.id}" data-dtype="${column.type}" data-operator="${column.calc?.operator || ""}" 
style="width: ${column.width || "200px"}">${getCalcValue(column) || '<svg><use xlink:href="#iconDown"></use></svg>' + window.siyuan.languages.calc}</div>`;
                    }
                    if (column.calc && column.calc.operator !== "") {
                        hasCalc = true;
                    }

                    if (pinIndex === index) {
                        calcHTML += "</div>";
                    }
                });
                tableHTML += `<div class="block__icons" style="min-height: auto">
    <div class="block__icon block__icon--show" data-type="av-header-more"><svg><use xlink:href="#iconMore"></use></svg></div>
    <div class="fn__space"></div>
    <div class="block__icon block__icon--show ariaLabel" aria-label="${window.siyuan.languages.newCol}" data-type="av-header-add" data-position="4bottom"><svg><use xlink:href="#iconAdd"></use></svg></div>
</div>
</div>`;
                // body
                data.rows.forEach((row: IAVRow, rowIndex: number) => {
                    tableHTML += `<div class="av__row" data-id="${row.id}">`;
                    if (pinIndex > -1) {
                        tableHTML += '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
                    } else {
                        tableHTML += '<div class="av__firstcol av__colsticky"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
                    }

                    row.cells.forEach((cell, index) => {
                        if (data.columns[index].hidden) {
                            return;
                        }
                        // https://github.com/siyuan-note/siyuan/issues/10262
                        let checkClass = "";
                        if (cell.valueType === "checkbox") {
                            checkClass = cell.value?.checkbox?.checked ? " av__cell-check" : " av__cell-uncheck";
                        }
                        tableHTML += `<div class="av__cell${checkClass}" data-id="${cell.id}" data-col-id="${data.columns[index].id}"
${cell.valueType === "block" ? 'data-block-id="' + (cell.value.block.id || "") + '"' : ""} data-wrap="${data.columns[index].wrap}" 
data-dtype="${data.columns[index].type}" 
${cell.value?.isDetached ? ' data-detached="true"' : ""} 
style="width: ${data.columns[index].width || "200px"};
${cell.valueType === "number" ? "text-align: right;" : ""}
${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${cell.color ? `color:${cell.color};` : ""}">${renderCell(cell.value, rowIndex)}</div>`;

                        if (pinIndex === index) {
                            tableHTML += "</div>";
                        }
                    });
                    tableHTML += "<div></div></div>";
                });
                let tabHTML = "";
                let viewData: IAVView;
                response.data.views.forEach((item: IAVView) => {
                    tabHTML += `<div data-id="${item.id}" class="item${item.id === response.data.viewID ? " item--focus" : ""}">
    ${item.icon ? unicode2Emoji(item.icon, "item__graphic", true) : '<svg class="item__graphic"><use xlink:href="#iconTable"></use></svg>'}
    <span class="item__text">${item.name}</span>
</div>`;
                    if (item.id === response.data.viewID) {
                        viewData = item;
                    }
                });
                let avBackground = "--av-background:var(--b3-theme-background)";
                if (e.style.backgroundColor) {
                    avBackground = "--av-background:" + e.style.backgroundColor;
                } else if (isInEmbedBlock(e)) {
                    avBackground = "--av-background:var(--b3-theme-surface)";
                }
                e.firstElementChild.outerHTML = `<div class="av__container" style="${avBackground}">
    <div class="av__header">
        <div class="fn__flex av__views${isSearching || query ? " av__views--show" : ""}">
            <div class="layout-tab-bar fn__flex">
                ${tabHTML}
            </div>
            <div class="fn__space"></div>
            <span data-type="av-add" class="block__icon ariaLabel" data-position="8bottom" aria-label="${window.siyuan.languages.newView}">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__flex-1"></div>
            <div class="fn__space"></div>
            <span data-type="av-switcher" class="block__icon${response.data.views.length > 0 ? "" : " fn__none"}">
                <svg><use xlink:href="#iconDown"></use></svg>
                <span class="fn__space"></span>
                <small>${response.data.views.length}</small>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-filter" class="block__icon${hasFilter ? " block__icon--active" : ""}">
                <svg><use xlink:href="#iconFilter"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-sort" class="block__icon${data.sorts.length > 0 ? " block__icon--active" : ""}">
                <svg><use xlink:href="#iconSort"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-search-icon" class="block__icon">
                <svg><use xlink:href="#iconSearch"></use></svg>
            </span>
            <div style="position: relative" class="fn__flex">
                <input style="${isSearching || query ? "width:128px" : "width:0;padding-left: 0;padding-right: 0;"}" data-type="av-search" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.search}">
            </div>
            <div class="fn__space"></div>
            <span data-type="av-more" class="block__icon">
                <svg><use xlink:href="#iconMore"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-add-more" class="block__icon ariaLabel" data-position="8bottom" aria-label="${window.siyuan.languages.newRow}">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__space"></div>
            ${response.data.isMirror ? ` <span data-av-id="${response.data.id}" data-popover-url="/api/av/getMirrorDatabaseBlocks" class="popover__block block__icon block__icon--show ariaLabel" data-position="8bottom" aria-label="${window.siyuan.languages.mirrorTip}">
    <svg><use xlink:href="#iconSplitLR"></use></svg></span><div class="fn__space"></div>` : ""}
        </div>
        <div contenteditable="${protyle.disabled ? "false" : "true"}" spellcheck="${window.siyuan.config.editor.spellcheck.toString()}" class="av__title${viewData.hideAttrViewName ? " fn__none" : ""}" data-title="${response.data.name || ""}" data-tip="${window.siyuan.languages.title}">${response.data.name || ""}</div>
        <div class="av__counter fn__none"></div>
    </div>
    <div class="av__scroll">
        <div class="av__body">
            ${tableHTML}
            <div class="av__row--util${data.rowCount > data.rows.length ? " av__readonly--show" : ""}">
                <div class="av__colsticky">
                    <button class="b3-button" data-type="av-add-bottom">
                        <svg><use xlink:href="#iconAdd"></use></svg>
                        ${window.siyuan.languages.addAttr}
                    </button>
                    <span class="fn__space"></span>
                    <button class="b3-button${data.rowCount > data.rows.length ? "" : " fn__none"}">
                        <svg data-type="av-load-more"><use xlink:href="#iconArrowDown"></use></svg>
                        <span data-type="av-load-more">
                            ${window.siyuan.languages.loadMore}
                        </span>
                        <svg data-type="set-page-size" data-size="${data.pageSize}"><use xlink:href="#iconMore"></use></svg>
                    </button>
                </div>
            </div>
            <div class="av__row--footer${hasCalc ? " av__readonly--show" : ""}">${calcHTML}</div>
        </div>
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`;
                e.setAttribute("data-render", "true");
                // 历史兼容
                e.style.margin = "";
                if (left) {
                    e.querySelector(".av__scroll").scrollLeft = left;
                }
                if (alignSelf) {
                    e.style.alignSelf = alignSelf;
                }
                const editRect = protyle.contentElement.getBoundingClientRect();
                if (headerTransform) {
                    (e.querySelector(".av__row--header") as HTMLElement).style.transform = headerTransform;
                } else {
                    stickyRow(e, editRect, "top");
                }
                if (footerTransform) {
                    (e.querySelector(".av__row--footer") as HTMLElement).style.transform = footerTransform;
                } else {
                    stickyRow(e, editRect, "bottom");
                }
                if (selectCellId) {
                    const newCellElement = e.querySelector(`.av__row[data-id="${selectCellId.split(Constants.ZWSP)[0]}"] .av__cell[data-col-id="${selectCellId.split(Constants.ZWSP)[1]}"]`);
                    if (newCellElement) {
                        newCellElement.classList.add("av__cell--select");
                    }
                    const avMaskElement = document.querySelector(".av__mask");
                    if (avMaskElement) {
                        (avMaskElement.querySelector("textarea, input") as HTMLTextAreaElement)?.focus();
                    } else if (!document.querySelector(".av__panel") && !isSearching) {
                        focusBlock(e);
                    }
                }
                selectRowIds.forEach((selectRowId, index) => {
                    const rowElement = e.querySelector(`.av__row[data-id="${selectRowId}"]`) as HTMLElement;
                    if (rowElement) {
                        rowElement.classList.add("av__row--select");
                        rowElement.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconCheck");

                    }

                    if (index === selectRowIds.length - 1 && rowElement) {
                        updateHeader(rowElement);
                    }
                });

                if (dragFillId) {
                    addDragFill(e.querySelector(`.av__row[data-id="${dragFillId.split(Constants.ZWSP)[0]}"] .av__cell[data-col-id="${dragFillId.split(Constants.ZWSP)[1]}"]`));
                }
                activeIds.forEach(activeId => {
                    e.querySelector(`.av__row[data-id="${activeId.split(Constants.ZWSP)[0]}"] .av__cell[data-col-id="${activeId.split(Constants.ZWSP)[1]}"]`)?.classList.add("av__cell--active");
                });
                if (getSelection().rangeCount > 0) {
                    // 修改表头后光标重新定位
                    const range = getSelection().getRangeAt(0);
                    if (!hasClosestByClassName(range.startContainer, "av__title")) {
                        const blockElement = hasClosestBlock(range.startContainer);
                        if (blockElement && e.isSameNode(blockElement) && !isSearching) {
                            focusBlock(e);
                        }
                    }
                }
                e.querySelector(".layout-tab-bar").scrollLeft = (e.querySelector(".layout-tab-bar .item--focus") as HTMLElement).offsetLeft;
                if (cb) {
                    cb();
                }
                const viewsElement = e.querySelector(".av__views") as HTMLElement;
                searchInputElement = e.querySelector('[data-type="av-search"]') as HTMLInputElement;
                searchInputElement.value = query;
                if (isSearching) {
                    searchInputElement.focus();
                }
                searchInputElement.addEventListener("input", (event: KeyboardEvent) => {
                    if (event.isComposing) {
                        return;
                    }
                    if (searchInputElement.value) {
                        viewsElement.classList.add("av__views--show");
                    } else {
                        viewsElement.classList.remove("av__views--show");
                    }
                    updateSearch(e, protyle);
                });
                searchInputElement.addEventListener("compositionend", () => {
                    updateSearch(e, protyle);
                });
                searchInputElement.addEventListener("blur", (event: KeyboardEvent) => {
                    if (event.isComposing) {
                        return;
                    }
                    if (!searchInputElement.value) {
                        viewsElement.classList.remove("av__views--show");
                        searchInputElement.style.width = "0";
                        searchInputElement.style.paddingLeft = "0";
                        searchInputElement.style.paddingRight = "0";
                    }
                });
                addClearButton({
                    inputElement: searchInputElement,
                    right: 0,
                    width: "1em",
                    height: searchInputElement.clientHeight,
                    clearCB() {
                        viewsElement.classList.remove("av__views--show");
                        searchInputElement.style.width = "0";
                        searchInputElement.style.paddingLeft = "0";
                        searchInputElement.style.paddingRight = "0";
                        focusBlock(e);
                        updateSearch(e, protyle);
                    }
                });
            });
        });
    }
};

let searchTimeout: number;

const updateSearch = (e: HTMLElement, protyle: IProtyle) => {
    clearTimeout(searchTimeout);
    searchTimeout = window.setTimeout(() => {
        e.removeAttribute("data-render");
        avRender(e, protyle);
    }, Constants.TIMEOUT_INPUT);
};

const refreshTimeouts: {
    [key: string]: number;
} = {};
export const refreshAV = (protyle: IProtyle, operation: IOperation) => {
    if (operation.action === "setAttrViewName") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.id}"]`)).forEach((item: HTMLElement) => {
            const titleElement = item.querySelector(".av__title") as HTMLElement;
            if (!titleElement) {
                return;
            }
            titleElement.textContent = operation.data;
            titleElement.dataset.title = operation.data;
        });
    }
    // 只能 setTimeout，以前方案快速输入后最后一次修改会被忽略；必须为每一个 protyle 单独设置，否则有多个 protyle 时，其余无法被执行
    clearTimeout(refreshTimeouts[protyle.id]);
    refreshTimeouts[protyle.id] = window.setTimeout(() => {
        if (operation.action === "setAttrViewColWidth") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
                const cellElement = item.querySelector(`.av__cell[data-col-id="${operation.id}"]`) as HTMLElement;
                if (!cellElement || cellElement.style.width === operation.data || item.getAttribute("custom-sy-av-view") !== operation.keyID) {
                    return;
                }
                item.querySelectorAll(".av__row").forEach(rowItem => {
                    (rowItem.querySelector(`[data-col-id="${operation.id}"]`) as HTMLElement).style.width = operation.data;
                });
            });
        } else {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
                item.removeAttribute("data-render");
                const updateRow = item.querySelector('.av__row[data-need-update="true"]');
                if (operation.action === "sortAttrViewCol" || operation.action === "sortAttrViewRow") {
                    item.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                        item.classList.remove("av__cell--active");
                        item.querySelector(".av__drag-fill")?.remove();
                    });
                    addDragFill(item.querySelector(".av__cell--select"));
                }
                avRender(item, protyle, () => {
                    const attrElement = document.querySelector(`.b3-dialog--open[data-key="${Constants.DIALOG_ATTR}"] div[data-av-id="${operation.avID}"]`) as HTMLElement;
                    if (attrElement) {
                        // 更新属性面板
                        renderAVAttribute(attrElement.parentElement, attrElement.dataset.nodeId, protyle);
                    } else {
                        if (operation.action === "insertAttrViewBlock" && updateRow && !item.querySelector(`.av__row[data-id="${updateRow.getAttribute("data-id")}"]`)) {
                            showMessage(window.siyuan.languages.insertRowTip);
                            document.querySelector(".av__mask")?.remove();
                        }
                    }
                    item.removeAttribute("data-loading");
                });
            });
        }
    }, ["insertAttrViewBlock"].includes(operation.action) ? 2 : 100);
};
