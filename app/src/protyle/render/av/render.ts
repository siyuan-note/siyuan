import {fetchPost} from "../../../util/fetch";
import {getColIconByType} from "./col";
import {Constants} from "../../../constants";
import {addDragFill, cellScrollIntoView, renderCell} from "./cell";
import {unicode2Emoji} from "../../../emoji";
import {focusBlock} from "../../util/selection";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {stickyRow, updateHeader} from "./row";
import {getCalcValue} from "./calc";
import {renderAVAttribute} from "./blockAttr";
import {showMessage} from "../../../dialog/message";
import {addClearButton} from "../../../util/addClearButton";
import {escapeAriaLabel, escapeAttr, escapeHtml} from "../../../util/escape";
import {electronUndo} from "../../undo";
import {isInAndroid, isInHarmony, isInIOS} from "../../util/compatibility";
import {isMobile} from "../../../util/functions";
import {renderGallery} from "./gallery/render";
import {getViewIcon} from "./view";

export const avRender = (element: Element, protyle: IProtyle, cb?: (data: IAV) => void, renderAll = true) => {
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
            if (e.getAttribute("data-render") === "true" || hasClosestByClassName(e, "av__gallery-content")) {
                return;
            }
            if (isMobile() || isInIOS() || isInAndroid() || isInHarmony()) {
                e.classList.add("av--touch");
            }

            if (e.getAttribute("data-av-type") === "gallery") {
                renderGallery({blockElement: e, protyle, cb, renderAll});
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
            let searchInputElement = e.querySelector('[data-type="av-search"]') as HTMLInputElement;
            const isSearching = searchInputElement && document.activeElement.isSameNode(searchInputElement);
            const query = searchInputElement?.value || "";
            fetchPost(created ? "/api/av/renderHistoryAttributeView" : (snapshot ? "/api/av/renderSnapshotAttributeView" : "/api/av/renderAttributeView"), {
                id: e.getAttribute("data-av-id"),
                created,
                snapshot,
                pageSize: parseInt(e.dataset.pageSize) || undefined,
                viewID: e.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
                query: query.trim()
            }, (response) => {
                const data = response.data.view as IAVTable;
                if (response.data.viewType === "gallery") {
                    e.setAttribute("data-av-type", "table");
                    renderGallery({blockElement: e, protyle, cb, renderAll});
                    return;
                }
                if (!e.dataset.pageSize) {
                    e.dataset.pageSize = data.pageSize.toString();
                }
                // header
                let tableHTML = '<div class="av__row av__row--header"><div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div></div>';
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
                if (eWidth === 0) {
                    pinMaxIndex = pinIndex;
                }
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
data-desc="${escapeAttr(column.desc)}" data-position="north" 
style="width: ${column.width || "200px"};">
    ${column.icon ? unicode2Emoji(column.icon, "av__cellheadericon", true) : `<svg class="av__cellheadericon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`}
    <span class="av__celltext fn__flex-1">${escapeHtml(column.name)}</span>
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
style="width: ${column.width || "200px"}">${getCalcValue(column) || `<svg><use xlink:href="#iconDown"></use></svg><small>${window.siyuan.languages.calc}</small>`}</div>`;
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
    <div class="block__icon block__icon--show ariaLabel" aria-label="${window.siyuan.languages.newCol}" data-type="av-header-add" data-position="4south"><svg><use xlink:href="#iconAdd"></use></svg></div>
</div>
</div>`;
                // body
                data.rows.forEach((row: IAVRow, rowIndex: number) => {
                    tableHTML += `<div class="av__row" data-id="${row.id}">`;
                    if (pinIndex > -1) {
                        tableHTML += '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
                    } else {
                        tableHTML += '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div></div>';
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
${cell.color ? `color:${cell.color};` : ""}">${renderCell(cell.value, rowIndex, data.showIcon)}</div>`;

                        if (pinIndex === index) {
                            tableHTML += "</div>";
                        }
                    });
                    tableHTML += "<div></div></div>";
                });
                let tabHTML = "";
                let viewData: IAVView;
                response.data.views.forEach((item: IAVView) => {
                    tabHTML += `<div data-position="north" data-av-type="${item.type}" data-id="${item.id}" data-page="${item.pageSize}" data-desc="${escapeAriaLabel(item.desc || "")}" class="ariaLabel item${item.id === response.data.viewID ? " item--focus" : ""}">
    ${item.icon ? unicode2Emoji(item.icon, "item__graphic", true) : `<svg class="item__graphic"><use xlink:href="#${getViewIcon(item.type)}"></use></svg>`}
    <span class="item__text">${escapeHtml(item.name)}</span>
</div>`;
                    if (item.id === response.data.viewID) {
                        viewData = item;
                    }
                });
                const avBodyHTML = `<div class="av__body">
    ${tableHTML}
    <div class="av__row--util${data.rowCount > data.rows.length ? " av__readonly--show" : ""}">
        <div class="av__colsticky">
            <button class="b3-button av__button" data-type="av-add-bottom">
                <svg><use xlink:href="#iconAdd"></use></svg>
                <span>${window.siyuan.languages.newRow}</span>
            </button>
            <span class="fn__space"></span>
            <button class="b3-button av__button${data.rowCount > data.rows.length ? "" : " fn__none"}" data-type="av-load-more">
                <svg><use xlink:href="#iconArrowDown"></use></svg>
                <span>${window.siyuan.languages.loadMore}</span>
                <svg data-type="set-page-size" data-size="${data.pageSize}"><use xlink:href="#iconMore"></use></svg>
            </button>
        </div>
    </div>
    <div class="av__row--footer${hasCalc ? " av__readonly--show" : ""}">${calcHTML}</div>
</div>`;
                if (renderAll) {
                    e.firstElementChild.outerHTML = `<div class="av__container">
    <div class="av__header">
        <div class="fn__flex av__views${isSearching || query ? " av__views--show" : ""}">
            <div class="layout-tab-bar fn__flex">
                ${tabHTML}
            </div>
            <div class="fn__space"></div>
            <span data-type="av-add" class="block__icon ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.newView}">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__flex-1"></div>
            <div class="fn__space"></div>
            <span data-type="av-switcher" aria-label="${window.siyuan.languages.allViews}" data-position="8south" class="ariaLabel block__icon${response.data.views.length > 0 ? "" : " fn__none"}">
                <svg><use xlink:href="#iconDown"></use></svg>
                <span class="fn__space"></span>
                <small>${response.data.views.length}</small>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-filter" aria-label="${window.siyuan.languages.filter}" data-position="8south" class="ariaLabel block__icon${hasFilter ? " block__icon--active" : ""}">
                <svg><use xlink:href="#iconFilter"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-sort" aria-label="${window.siyuan.languages.sort}" data-position="8south" class="ariaLabel block__icon${data.sorts.length > 0 ? " block__icon--active" : ""}">
                <svg><use xlink:href="#iconSort"></use></svg>
            </span>
            <div class="fn__space"></div>
            <button data-type="av-search-icon" aria-label="${window.siyuan.languages.search}" data-position="8south" class="ariaLabel block__icon">
                <svg><use xlink:href="#iconSearch"></use></svg>
            </button>
            <div style="position: relative" class="fn__flex">
                <input style="${isSearching || query ? "width:128px" : "width:0;padding-left: 0;padding-right: 0;"}" data-type="av-search" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.search}">
            </div>
            <div class="fn__space"></div>
            <span data-type="av-more" aria-label="${window.siyuan.languages.config}" data-position="8south" class="ariaLabel block__icon">
                <svg><use xlink:href="#iconSettings"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-add-more" class="block__icon ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.newRow}">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__space"></div>
            ${response.data.isMirror ? ` <span data-av-id="${response.data.id}" data-popover-url="/api/av/getMirrorDatabaseBlocks" class="popover__block block__icon block__icon--show ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.mirrorTip}">
    <svg><use xlink:href="#iconSplitLR"></use></svg></span><div class="fn__space"></div>` : ""}
        </div>
        <div contenteditable="${protyle.disabled || hasClosestByAttribute(e, "data-type", "NodeBlockQueryEmbed") ? "false" : "true"}" spellcheck="${window.siyuan.config.editor.spellcheck.toString()}" class="av__title${viewData.hideAttrViewName ? " fn__none" : ""}" data-title="${response.data.name || ""}" data-tip="${window.siyuan.languages.title}">${response.data.name || ""}</div>
        <div class="av__counter fn__none"></div>
    </div>
    <div class="av__scroll">
        ${avBodyHTML}
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`;
                } else {
                    e.firstElementChild.querySelector(".av__scroll").innerHTML = avBodyHTML;
                }
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
                    // 需等待渲染完，否则 getBoundingClientRect 错误 https://github.com/siyuan-note/siyuan/issues/13787
                    setTimeout(() => {
                        stickyRow(e, editRect, "top");
                    }, Constants.TIMEOUT_LOAD);
                }
                if (footerTransform) {
                    (e.querySelector(".av__row--footer") as HTMLElement).style.transform = footerTransform;
                } else {
                    // 需等待渲染完，否则 getBoundingClientRect 错误 https://github.com/siyuan-note/siyuan/issues/13787
                    setTimeout(() => {
                        stickyRow(e, editRect, "bottom");
                    }, Constants.TIMEOUT_LOAD);
                }
                if (selectCellId) {
                    const newCellElement = e.querySelector(`.av__row[data-id="${selectCellId.split(Constants.ZWSP)[0]}"] .av__cell[data-col-id="${selectCellId.split(Constants.ZWSP)[1]}"]`);
                    if (newCellElement) {
                        newCellElement.classList.add("av__cell--select");
                        cellScrollIntoView(e, newCellElement);
                    }
                    const avMaskElement = document.querySelector(".av__mask");
                    const avPanelElement = document.querySelector(".av__panel");
                    if (avMaskElement) {
                        (avMaskElement.querySelector("textarea, input") as HTMLTextAreaElement)?.focus();
                    } else if (!avPanelElement && !isSearching && getSelection().rangeCount > 0) {
                        const range = getSelection().getRangeAt(0);
                        const blockElement = hasClosestBlock(range.startContainer);
                        if (blockElement && e.isSameNode(blockElement)) {
                            focusBlock(e);
                        }
                    } else if (avPanelElement && !newCellElement) {
                        avPanelElement.remove();
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
                    cb(response.data);
                }
                if (!renderAll) {
                    return;
                }
                const viewsElement = e.querySelector(".av__views") as HTMLElement;
                searchInputElement = e.querySelector('[data-type="av-search"]') as HTMLInputElement;
                searchInputElement.value = query || "";
                if (isSearching) {
                    searchInputElement.focus();
                }
                searchInputElement.addEventListener("compositionstart", (event: KeyboardEvent) => {
                    event.stopPropagation();
                });
                searchInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                    if (event.isComposing) {
                        return;
                    }
                    electronUndo(event);
                });
                searchInputElement.addEventListener("input", (event: KeyboardEvent) => {
                    event.stopPropagation();
                    if (event.isComposing) {
                        return;
                    }
                    if (searchInputElement.value || document.activeElement.isSameNode(searchInputElement)) {
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

export const updateSearch = (e: HTMLElement, protyle: IProtyle) => {
    clearTimeout(searchTimeout);
    searchTimeout = window.setTimeout(() => {
        e.removeAttribute("data-render");
        avRender(e, protyle, undefined, false);
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
                if (!cellElement || cellElement.style.width === operation.data || item.getAttribute(Constants.CUSTOM_SY_AV_VIEW) !== operation.keyID) {
                    return;
                }
                item.querySelectorAll(".av__row").forEach(rowItem => {
                    (rowItem.querySelector(`[data-col-id="${operation.id}"]`) as HTMLElement).style.width = operation.data;
                });
            });
        } else if (operation.action === "setAttrViewCardSize") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
                const galleryElement = item.querySelector(".av__gallery") as HTMLElement;
                if (galleryElement) {
                    galleryElement.classList.remove("av__gallery--small", "av__gallery--big");
                    if (operation.data === 0) {
                        galleryElement.classList.add("av__gallery--small");
                    } else if (operation.data === 2) {
                        galleryElement.classList.add("av__gallery--big");
                    }
                }
            });
        } else if (operation.action === "setAttrViewCardAspectRatio") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
                item.querySelectorAll(".av__gallery-cover").forEach(coverItem => {
                    coverItem.className = "av__gallery-cover av__gallery-cover--" + operation.data;
                });
            });
        } else if (operation.action === "hideAttrViewName") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
                const titleElement = item.querySelector(".av__title");
                if (titleElement) {
                    if (!operation.data) {
                        titleElement.classList.remove("fn__none");
                    } else {
                        // hide
                        titleElement.classList.add("fn__none");
                    }
                    if (item.getAttribute("data-av-type") === "gallery") {
                        const galleryElement = item.querySelector(".av__gallery");
                        if (!operation.data) {
                            galleryElement.classList.remove("av__gallery--top");
                        } else {
                            // hide
                            galleryElement.classList.add("av__gallery--top");
                        }
                    }
                }
            });
        } else if (operation.action === "setAttrViewWrapField") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
                item.querySelectorAll(".av__cell").forEach(fieldItem => {
                    fieldItem.setAttribute("data-wrap", operation.data.toString());
                });
            });
        } else if (operation.action === "setAttrViewShowIcon") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
                item.querySelectorAll('.av__cell[data-dtype="block"] .b3-menu__avemoji, .av__cell[data-dtype="relation"] .b3-menu__avemoji').forEach(cellItem => {
                    if (operation.data) {
                        cellItem.classList.remove("fn__none");
                    } else {
                        cellItem.classList.add("fn__none");
                    }
                });
            });
        } else if (operation.action === "setAttrViewColWrap") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
                item.querySelectorAll(`.av__cell[data-col-id="${operation.id}"],.av__cell[data-field-id="${operation.id}"]`).forEach(cellItem => {
                    cellItem.setAttribute("data-wrap", operation.data.toString());
                });
            });
        } else {
            // 修改表格名 avID 传入到 id 上了 https://github.com/siyuan-note/siyuan/issues/12724
            const avID = operation.action === "setAttrViewName" ? operation.id : operation.avID;
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avID}"]`)).forEach((item: HTMLElement) => {
                item.removeAttribute("data-render");
                const updateRow = item.querySelector('[data-need-update="true"]');
                if (operation.action === "sortAttrViewCol" || operation.action === "sortAttrViewRow") {
                    item.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                        item.classList.remove("av__cell--active");
                        item.querySelector(".av__drag-fill")?.remove();
                    });
                    addDragFill(item.querySelector(".av__cell--select"));
                }
                if (operation.action === "setAttrViewBlockView") {
                    const viewTabElement = item.querySelector(`.av__views > .layout-tab-bar > .item[data-id="${operation.id}"]`) as HTMLElement;
                    if (viewTabElement) {
                        item.dataset.pageSize = viewTabElement.dataset.page;
                    }
                }
                avRender(item, protyle, () => {
                    const attrElement = document.querySelector(`.b3-dialog--open[data-key="${Constants.DIALOG_ATTR}"] div[data-av-id="${avID}"]`) as HTMLElement;
                    if (attrElement) {
                        // 更新属性面板
                        renderAVAttribute(attrElement.parentElement, attrElement.dataset.nodeId, protyle);
                    } else {
                        if (operation.action === "insertAttrViewBlock") {
                            if (updateRow && !item.querySelector(`[data-id="${updateRow.getAttribute("data-id")}"]`)) {
                                showMessage(window.siyuan.languages.insertRowTip);
                                document.querySelector(".av__mask")?.remove();
                            }
                            if (item.getAttribute("data-av-type") === "gallery") {
                                const filesElement = item.querySelector(`.av__gallery-item[data-id="${operation.srcs[0].id}"]`)?.querySelector(".av__gallery-fields");
                                if (filesElement && filesElement.querySelector('[data-dtype="block"]')?.getAttribute("data-empty") === "true") {
                                    filesElement.classList.add("av__gallery-fields--edit");
                                }
                            }
                        }
                    }
                    item.removeAttribute("data-loading");
                });
            });
        }
    }, ["insertAttrViewBlock"].includes(operation.action) ? 2 : 100);
};
