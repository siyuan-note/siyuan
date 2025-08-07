import {fetchPost} from "../../../util/fetch";
import {getColIconByType} from "./col";
import {Constants} from "../../../constants";
import {addDragFill, cellScrollIntoView, popTextCell, renderCell} from "./cell";
import {unicode2Emoji} from "../../../emoji";
import {focusBlock} from "../../util/selection";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {stickyRow, updateHeader} from "./row";
import {getCalcValue} from "./calc";
import {renderAVAttribute} from "./blockAttr";
import {addClearButton} from "../../../util/addClearButton";
import {escapeAriaLabel, escapeAttr, escapeHtml} from "../../../util/escape";
import {electronUndo} from "../../undo";
import {isInAndroid, isInHarmony, isInIOS} from "../../util/compatibility";
import {isMobile} from "../../../util/functions";
import {renderGallery} from "./gallery/render";
import {getFieldsByData, getViewIcon} from "./view";
import {openMenuPanel} from "./openMenuPanel";
import {getPageSize} from "./groups";

interface ITableOptions {
    protyle: IProtyle,
    blockElement: HTMLElement,
    cb: (data: IAV) => void,
    data: IAV,
    renderAll: boolean,
    resetData: {
        left: number,
        alignSelf: string,
        headerTransform: string,
        footerTransform: string,
        selectCellId: string,
        isSearching: boolean,
        selectRowIds: string[],
        dragFillId: string,
        activeIds: string[],
        query: string,
        pageSizes: { [key: string]: string },
    }
}

export const genTabHeaderHTML = (data: IAV, showSearch: boolean, editable: boolean) => {
    let tabHTML = "";
    let viewData: IAVView;
    let hasFilter = false;
    getFieldsByData(data).forEach((item) => {
        if (!hasFilter) {
            data.view.filters.find(filterItem => {
                if (filterItem.value.type === item.type && item.id === filterItem.column) {
                    hasFilter = true;
                    return true;
                }
            });
        }
    });
    data.views.forEach((item: IAVView) => {
        tabHTML += `<div draggable="true" data-position="north" data-av-type="${item.type}" data-id="${item.id}" data-page="${item.pageSize}" data-desc="${escapeAriaLabel(item.desc || "")}" class="ariaLabel item${item.id === data.viewID ? " item--focus" : ""}">
    ${item.icon ? unicode2Emoji(item.icon, "item__graphic", true) : `<svg class="item__graphic"><use xlink:href="#${getViewIcon(item.type)}"></use></svg>`}
    <span class="item__text">${escapeHtml(item.name)}</span>
</div>`;
        if (item.id === data.viewID) {
            viewData = item;
        }
    });
    return `<div class="av__header">
        <div class="fn__flex av__views${showSearch ? " av__views--show" : ""}">
            <div class="layout-tab-bar fn__flex">
                ${tabHTML}
            </div>
            <div class="fn__space"></div>
            <span data-type="av-add" class="block__icon ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.newView}">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__flex-1"></div>
            <div class="fn__space"></div>
            <span data-type="av-switcher" aria-label="${window.siyuan.languages.allViews}" data-position="8south" class="ariaLabel block__icon${data.views.length > 0 ? "" : " fn__none"}">
                <svg><use xlink:href="#iconDown"></use></svg>
                <span class="fn__space"></span>
                <small>${data.views.length}</small>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-filter" aria-label="${window.siyuan.languages.filter}" data-position="8south" class="ariaLabel block__icon${hasFilter ? " block__icon--active" : ""}">
                <svg><use xlink:href="#iconFilter"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-sort" aria-label="${window.siyuan.languages.sort}" data-position="8south" class="ariaLabel block__icon${data.view.sorts.length > 0 ? " block__icon--active" : ""}">
                <svg><use xlink:href="#iconSort"></use></svg>
            </span>
            <div class="fn__space"></div>
            <button data-type="av-search-icon" aria-label="${window.siyuan.languages.search}" data-position="8south" class="ariaLabel block__icon">
                <svg><use xlink:href="#iconSearch"></use></svg>
            </button>
            <div style="position: relative" class="fn__flex">
                <input style="${showSearch ? "width:128px" : "width:0;padding-left: 0;padding-right: 0;"}" data-type="av-search" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.search}">
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
            ${data.isMirror ? ` <span data-av-id="${data.id}" data-popover-url="/api/av/getMirrorDatabaseBlocks" class="popover__block block__icon block__icon--show ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.mirrorTip}">
    <svg><use xlink:href="#iconSplitLR"></use></svg></span><div class="fn__space"></div>` : ""}
        </div>
        <div contenteditable="${editable}" spellcheck="${window.siyuan.config.editor.spellcheck.toString()}" class="av__title${viewData.hideAttrViewName ? " fn__none" : ""}" data-title="${data.name || ""}" data-tip="${window.siyuan.languages.title}">${data.name || ""}</div>
        <div class="av__counter fn__none"></div>
    </div>`;
};

const getTableHTMLs = (data: IAVTable, e: HTMLElement) => {
    let calcHTML = "";
    let contentHTML = '<div class="av__row av__row--header"><div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div></div>';
    let pinIndex = -1;
    let pinMaxIndex = -1;
    let indexWidth = 0;
    const eWidth = e.clientWidth;
    data.columns.forEach((item, index) => {
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
        contentHTML = '<div class="av__row av__row--header"><div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
        calcHTML = '<div class="av__colsticky">';
    }
    let hasCalc = false;
    data.columns.forEach((column: IAVColumn, index: number) => {
        if (column.hidden) {
            return;
        }
        contentHTML += `<div class="av__cell av__cell--header" data-col-id="${column.id}"  draggable="true" 
data-icon="${column.icon}" data-dtype="${column.type}" data-wrap="${column.wrap}" data-pin="${column.pin}" 
data-desc="${escapeAttr(column.desc)}" data-position="north" 
style="width: ${column.width || "200px"};">
    ${column.icon ? unicode2Emoji(column.icon, "av__cellheadericon", true) : `<svg class="av__cellheadericon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`}
    <span class="av__celltext fn__flex-1">${escapeHtml(column.name)}</span>
    ${column.pin ? '<svg class="av__cellheadericon av__cellheadericon--pin"><use xlink:href="#iconPin"></use></svg>' : ""}
    <div class="av__widthdrag"></div>
</div>`;
        if (pinIndex === index) {
            contentHTML += "</div>";
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
    contentHTML += `<div class="block__icons" style="min-height: auto">
    <div class="block__icon block__icon--show" data-type="av-header-more"><svg><use xlink:href="#iconMore"></use></svg></div>
    <div class="fn__space"></div>
    <div class="block__icon block__icon--show ariaLabel" aria-label="${window.siyuan.languages.newCol}" data-type="av-header-add" data-position="4south"><svg><use xlink:href="#iconAdd"></use></svg></div>
</div>
</div>`;
    // body
    data.rows.forEach((row: IAVRow, rowIndex: number) => {
        contentHTML += `<div class="av__row" data-id="${row.id}">`;
        if (pinIndex > -1) {
            contentHTML += '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
        } else {
            contentHTML += '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div></div>';
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
            contentHTML += `<div class="av__cell${checkClass}" data-id="${cell.id}" data-col-id="${data.columns[index].id}"
${cell.valueType === "block" ? 'data-block-id="' + (cell.value.block.id || "") + '"' : ""} data-wrap="${data.columns[index].wrap}" 
data-dtype="${data.columns[index].type}" 
${cell.value?.isDetached ? ' data-detached="true"' : ""} 
style="width: ${data.columns[index].width || "200px"};
${cell.valueType === "number" ? "text-align: right;" : ""}
${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${cell.color ? `color:${cell.color};` : ""}">${renderCell(cell.value, rowIndex, data.showIcon)}</div>`;

            if (pinIndex === index) {
                contentHTML += "</div>";
            }
        });
        contentHTML += "<div></div></div>";
    });
    return `${contentHTML}<div class="av__row--util${data.rowCount > data.rows.length ? " av__readonly--show" : ""}">
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
<div class="av__row--footer${hasCalc ? " av__readonly--show" : ""}">${calcHTML}</div>`;
};

export const getGroupTitleHTML = (group: IAVView, counter: number) => {
    let nameHTML = "";
    if (["mSelect", "select"].includes(group.groupValue.type)) {
        group.groupValue.mSelect.forEach((item) => {
            nameHTML += `<span class="b3-chip" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${escapeHtml(item.content)}</span>`;
        });
    } else {
        nameHTML = group.name;
    }
    return `<div class="av__group-title">
    <div class="av__group-icon" data-type="av-group-fold" data-id="${group.id}">
        <svg class="${group.groupFolded ? "" : "av__group-arrow--open"}"><use xlink:href="#iconRight"></use></svg>
    </div>
    <span class="fn__space"></span>
    ${nameHTML}
    <span class="${counter === 0 ? "fn__none" : "av__group-counter"}">${counter}</span>
    <span class="av__group-icon av__group-icon--hover ariaLabel" data-type="av-add-top" data-position="north" aria-label="${window.siyuan.languages.newRow}"><svg><use xlink:href="#iconAdd"></use></svg></span>
</div>`;
};

const renderGroupTable = (options: ITableOptions) => {
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement;
    const isSearching = searchInputElement && document.activeElement === searchInputElement;
    const query = searchInputElement?.value || "";

    let avBodyHTML = "";
    options.data.view.groups.forEach((group: IAVTable) => {
        if (group.groupHidden === 0) {
            group.columns = (options.data.view as IAVTable).columns;
            avBodyHTML += `${getGroupTitleHTML(group, group.rows.length)}
<div data-group-id="${group.id}" data-page-size="${group.pageSize}" style="float: left" class="av__body${group.groupFolded ? " fn__none" : ""}">${getTableHTMLs(group, options.blockElement)}</div>`;
        }
    });
    if (options.renderAll) {
        options.blockElement.firstElementChild.outerHTML = `<div class="av__container">
    ${genTabHeaderHTML(options.data, isSearching || !!query, !options.protyle.disabled && !hasClosestByAttribute(options.blockElement, "data-type", "NodeBlockQueryEmbed"))}
    <div class="av__scroll">
        ${avBodyHTML}
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`;
    } else {
        options.blockElement.firstElementChild.querySelector(".av__scroll").innerHTML = avBodyHTML;
    }
    afterRenderTable(options);
};

const afterRenderTable = (options: ITableOptions) => {
    options.blockElement.setAttribute("data-render", "true");
    options.blockElement.querySelector(".av__scroll").scrollLeft = options.resetData.left;
    options.blockElement.style.alignSelf = options.resetData.alignSelf;
    const editRect = options.protyle.contentElement.getBoundingClientRect();
    if (options.resetData.headerTransform) {
        const headerTransformElement = options.blockElement.querySelector('.av__row--header[style^="transform"]') as HTMLElement;
        if (headerTransformElement) {
            headerTransformElement.style.transform = options.resetData.headerTransform;
        }
    } else {
        // 需等待渲染完，否则 getBoundingClientRect 错误 https://github.com/siyuan-note/siyuan/issues/13787
        setTimeout(() => {
            stickyRow(options.blockElement, editRect, "top");
        }, Constants.TIMEOUT_LOAD);
    }
    if (options.resetData.footerTransform) {
        const footerTransformElement = options.blockElement.querySelector('.av__row--footer[style^="transform"]') as HTMLElement;
        if (footerTransformElement) {
            footerTransformElement.style.transform = options.resetData.footerTransform;
        }
    } else {
        // 需等待渲染完，否则 getBoundingClientRect 错误 https://github.com/siyuan-note/siyuan/issues/13787
        setTimeout(() => {
            stickyRow(options.blockElement, editRect, "bottom");
        }, Constants.TIMEOUT_LOAD);
    }
    if (options.resetData.selectCellId) {
        const newCellElement = options.blockElement.querySelector(`.av__row[data-id="${options.resetData.selectCellId.split(Constants.ZWSP)[0]}"] .av__cell[data-col-id="${options.resetData.selectCellId.split(Constants.ZWSP)[1]}"]`);
        if (newCellElement) {
            newCellElement.classList.add("av__cell--select");
            cellScrollIntoView(options.blockElement, newCellElement);
        }
        const avMaskElement = document.querySelector(".av__mask");
        const avPanelElement = document.querySelector(".av__panel");
        if (avMaskElement) {
            (avMaskElement.querySelector("textarea, input") as HTMLTextAreaElement)?.focus();
        } else if (!avPanelElement && !options.resetData.isSearching && getSelection().rangeCount > 0) {
            const range = getSelection().getRangeAt(0);
            const blockElement = hasClosestBlock(range.startContainer);
            if (blockElement && options.blockElement === blockElement) {
                focusBlock(options.blockElement);
            }
        } else if (avPanelElement && !newCellElement) {
            avPanelElement.remove();
        }
    }
    options.resetData.selectRowIds.forEach((selectRowId, index) => {
        const rowElement = options.blockElement.querySelector(`.av__row[data-id="${selectRowId}"]`) as HTMLElement;
        if (rowElement) {
            rowElement.classList.add("av__row--select");
            rowElement.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconCheck");
        }
        if (index === options.resetData.selectRowIds.length - 1 && rowElement) {
            updateHeader(rowElement);
        }
    });
    Object.keys(options.resetData.pageSizes).forEach((groupId) => {
        if (groupId === "unGroup") {
            (options.blockElement.querySelector(".av__body") as HTMLElement).dataset.pageSize = options.resetData.pageSizes[groupId];
            return;
        }
        const bodyElement = options.blockElement.querySelector(`.av__body[data-group-id="${groupId}"]`) as HTMLElement;
        if (bodyElement) {
            bodyElement.dataset.pageSize = options.resetData.pageSizes[groupId];
        }
    });
    if (options.resetData.dragFillId) {
        addDragFill(options.blockElement.querySelector(`.av__row[data-id="${options.resetData.dragFillId.split(Constants.ZWSP)[0]}"] .av__cell[data-col-id="${options.resetData.dragFillId.split(Constants.ZWSP)[1]}"]`));
    }
    options.resetData.activeIds.forEach(activeId => {
        options.blockElement.querySelector(`.av__row[data-id="${activeId.split(Constants.ZWSP)[0]}"] .av__cell[data-col-id="${activeId.split(Constants.ZWSP)[1]}"]`)?.classList.add("av__cell--active");
    });
    if (getSelection().rangeCount > 0) {
        // 修改表头后光标重新定位
        const range = getSelection().getRangeAt(0);
        if (!hasClosestByClassName(range.startContainer, "av__title")) {
            const blockElement = hasClosestBlock(range.startContainer);
            if (blockElement && options.blockElement === blockElement && !options.resetData.isSearching) {
                focusBlock(options.blockElement);
            }
        }
    }
    options.blockElement.querySelector(".layout-tab-bar").scrollLeft = (options.blockElement.querySelector(".layout-tab-bar .item--focus") as HTMLElement).offsetLeft - 30;
    if (options.cb) {
        options.cb(options.data);
    }
    if (!options.renderAll) {
        return;
    }
    const viewsElement = options.blockElement.querySelector(".av__views") as HTMLElement;
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement;
    searchInputElement.value = options.resetData.query || "";
    if (options.resetData.isSearching) {
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
        if (searchInputElement.value || document.activeElement === searchInputElement) {
            viewsElement.classList.add("av__views--show");
        } else {
            viewsElement.classList.remove("av__views--show");
        }
        updateSearch(options.blockElement, options.protyle);
    });
    searchInputElement.addEventListener("compositionend", () => {
        updateSearch(options.blockElement, options.protyle);
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
            focusBlock(options.blockElement);
            updateSearch(options.blockElement, options.protyle);
        }
    });
};

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

            let selectCellId = "";
            const selectCellElement = e.querySelector(".av__cell--select") as HTMLElement;
            if (selectCellElement) {
                selectCellId = (hasClosestByClassName(selectCellElement, "av__row") as HTMLElement).dataset.id + Constants.ZWSP + selectCellElement.getAttribute("data-col-id");
            }
            const selectRowIds: string[] = [];
            e.querySelectorAll(".av__row--select").forEach(rowItem => {
                const rowId = rowItem.getAttribute("data-id");
                if (rowId) {
                    selectRowIds.push(rowId);
                }
            });
            let dragFillId = "";
            const dragFillElement = e.querySelector(".av__drag-fill") as HTMLElement;
            if (dragFillElement) {
                dragFillId = (hasClosestByClassName(dragFillElement, "av__row") as HTMLElement).dataset.id + Constants.ZWSP + dragFillElement.parentElement.getAttribute("data-col-id");
            }
            const activeIds: string[] = [];
            e.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                activeIds.push((hasClosestByClassName(item, "av__row") as HTMLElement).dataset.id + Constants.ZWSP + item.getAttribute("data-col-id"));
            });
            const searchInputElement = e.querySelector('[data-type="av-search"]') as HTMLInputElement;
            const pageSizes: { [key: string]: string } = {};
            e.querySelectorAll(".av__body").forEach((item: HTMLElement) => {
                pageSizes[item.dataset.groupId || "unGroup"] = item.dataset.pageSize;
            });
            const resetData = {
                selectCellId,
                alignSelf: e.style.alignSelf,
                left: e.querySelector(".av__scroll")?.scrollLeft || 0,
                headerTransform: (e.querySelector('.av__row--header[style^="transform"]') as HTMLElement)?.style.transform,
                footerTransform: (e.querySelector(".av__row--footer") as HTMLElement)?.style.transform,
                isSearching: searchInputElement && document.activeElement === searchInputElement,
                selectRowIds,
                dragFillId,
                activeIds,
                query: searchInputElement?.value || "",
                pageSizes
            };
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
            const created = protyle.options.history?.created;
            const snapshot = protyle.options.history?.snapshot;
            const avPageSize = getPageSize(e);
            fetchPost(created ? "/api/av/renderHistoryAttributeView" : (snapshot ? "/api/av/renderSnapshotAttributeView" : "/api/av/renderAttributeView"), {
                id: e.getAttribute("data-av-id"),
                created,
                snapshot,
                pageSize: avPageSize.unGroupPageSize,
                groupPaging: avPageSize.groupPageSize,
                viewID: e.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
                query: resetData.query.trim(),
                blockID: e.getAttribute("data-node-id"),
            }, (response) => {
                const data = response.data.view as IAVTable;
                if (response.data.viewType === "gallery") {
                    e.setAttribute("data-av-type", "table");
                    renderGallery({blockElement: e, protyle, cb, renderAll, data: response.data});
                    return;
                }
                if (data.groups?.length > 0) {
                    renderGroupTable({blockElement: e, protyle, cb, renderAll, data: response.data, resetData});
                    return;
                }
                const avBodyHTML = `<div class="av__body" data-page-size="${data.pageSize}" style="float: left">
    ${getTableHTMLs(data, e)}
</div>`;
                if (renderAll) {
                    e.firstElementChild.outerHTML = `<div class="av__container">
    ${genTabHeaderHTML(response.data, resetData.isSearching || !!resetData.query, !protyle.disabled && !hasClosestByAttribute(e, "data-type", "NodeBlockQueryEmbed"))}
    <div class="av__scroll">
        ${avBodyHTML}
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`;
                } else {
                    e.firstElementChild.querySelector(".av__scroll").innerHTML = avBodyHTML;
                }
                afterRenderTable({
                    renderAll,
                    data: response.data,
                    cb,
                    protyle,
                    blockElement: e,
                    resetData
                });
                // 历史兼容
                e.style.margin = "";
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
        return;
    }
    if (operation.action === "setAttrViewCardSize") {
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
        return;
    }
    if (operation.action === "setAttrViewCardAspectRatio") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
            item.querySelectorAll(".av__gallery-cover").forEach(coverItem => {
                coverItem.className = "av__gallery-cover av__gallery-cover--" + operation.data;
            });
        });
        return;
    }
    if (operation.action === "hideAttrViewName") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
            const titleElement = item.querySelector(".av__title");
            if (titleElement) {
                if (!operation.data) {
                    titleElement.classList.remove("fn__none");
                } else {
                    // hide
                    titleElement.classList.add("fn__none");
                }
                if (item.getAttribute("data-av-type") === "gallery" && !item.querySelector(".av__group-title")) {
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
        return;
    }
    if (operation.action === "setAttrViewWrapField") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
            item.querySelectorAll(".av__cell").forEach(fieldItem => {
                fieldItem.setAttribute("data-wrap", operation.data.toString());
            });
        });
        return;
    }
    if (operation.action === "setAttrViewShowIcon") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
            item.querySelectorAll('.av__cell[data-dtype="block"] .b3-menu__avemoji, .av__cell[data-dtype="relation"] .b3-menu__avemoji').forEach(cellItem => {
                if (operation.data) {
                    cellItem.classList.remove("fn__none");
                } else {
                    cellItem.classList.add("fn__none");
                }
            });
        });
        return;
    }
    if (operation.action === "setAttrViewColWrap") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
            item.querySelectorAll(`.av__cell[data-col-id="${operation.id}"],.av__cell[data-field-id="${operation.id}"]`).forEach(cellItem => {
                cellItem.setAttribute("data-wrap", operation.data.toString());
            });
        });
        return;
    }
    if (operation.action === "foldAttrViewGroup") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
            const foldElement = item.querySelector(`[data-type="av-group-fold"][data-id="${operation.id}"]`);
            if (operation.data) {
                foldElement.firstElementChild.classList.remove("av__group-arrow--open");
                foldElement.parentElement.nextElementSibling.classList.add("fn__none");
            } else {
                foldElement.firstElementChild.classList.add("av__group-arrow--open");
                foldElement.parentElement.nextElementSibling.classList.remove("fn__none");
            }
            foldElement.removeAttribute("data-folding");
        });
        return;
    }
    // 只能 setTimeout，以前方案快速输入后最后一次修改会被忽略；必须为每一个 protyle 单独设置，否则有多个 protyle 时，其余无法被执行
    clearTimeout(refreshTimeouts[protyle.id]);
    refreshTimeouts[protyle.id] = window.setTimeout(() => {
        // 修改表格名 avID 传入到 id 上了 https://github.com/siyuan-note/siyuan/issues/12724
        const avID = operation.action === "setAttrViewName" ? operation.id : operation.avID;
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avID}"]`)).forEach((item: HTMLElement) => {
            item.removeAttribute("data-render");
            if (operation.action === "sortAttrViewCol" || operation.action === "sortAttrViewRow") {
                item.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                    item.classList.remove("av__cell--active");
                    item.querySelector(".av__drag-fill")?.remove();
                });
                addDragFill(item.querySelector(".av__cell--select"));
            } else if (operation.action === "setAttrViewBlockView") {
                const viewTabElement = item.querySelector(`.av__views > .layout-tab-bar > .item[data-id="${operation.id}"]`) as HTMLElement;
                if (viewTabElement) {
                    item.querySelectorAll(".av__body").forEach((bodyItem: HTMLElement) => {
                        bodyItem.dataset.pageSize = viewTabElement.dataset.page;
                    });
                }
            } else if (operation.action === "addAttrViewView") {
                item.querySelectorAll(".av__body").forEach((bodyItem: HTMLElement) => {
                    bodyItem.dataset.pageSize = "50";
                });
            } else if (operation.action === "removeAttrViewView") {
                item.querySelectorAll(".av__body").forEach((bodyItem: HTMLElement) => {
                    bodyItem.dataset.pageSize = item.querySelector(`.av__views > .layout-tab-bar .item[data-id="${item.getAttribute(Constants.CUSTOM_SY_AV_VIEW)}"]`)?.getAttribute("data-page");
                });
            } else if (operation.action === "sortAttrViewView" && operation.data === "unRefresh") {
                const viewTabElement = item.querySelector(`.av__views > .layout-tab-bar > .item[data-id="${operation.id}"]`) as HTMLElement;
                if (viewTabElement && !operation.previousID && !viewTabElement.previousElementSibling) {
                    return;
                } else if (viewTabElement && operation.previousID && viewTabElement.previousElementSibling?.getAttribute("data-id") === operation.previousID) {
                    return;
                }
            }
            avRender(item, protyle, () => {
                const attrElement = document.querySelector(`.b3-dialog--open[data-key="${Constants.DIALOG_ATTR}"] div[data-av-id="${avID}"]`) as HTMLElement;
                if (attrElement) {
                    // 更新属性面板
                    renderAVAttribute(attrElement.parentElement, attrElement.dataset.nodeId, protyle);
                } else {
                    if (operation.action === "insertAttrViewBlock") {
                        const groupQuery = operation.groupID ? `[data-group-id="${operation.groupID}"]` : "";
                        if (item.getAttribute("data-av-type") === "gallery") {
                            operation.srcs.forEach(srcItem => {
                                const filesElement = item.querySelector(`.av__body${groupQuery} .av__gallery-item[data-id="${srcItem.id}"]`)?.querySelector(".av__gallery-fields");
                                if (filesElement && filesElement.querySelector('[data-dtype="block"]')?.getAttribute("data-empty") === "true") {
                                    filesElement.classList.add("av__gallery-fields--edit");
                                }
                            });
                        }
                        if (operation.srcs.length === 1) {
                            const popCellElement = item.querySelector(`.av__body${groupQuery} .av__cell[data-block-id="${operation.srcs[0].id}"]`) as HTMLElement;
                            if (popCellElement) {
                                popTextCell(protyle, [popCellElement], "block");
                            }
                        }
                    } else if (operation.action === "addAttrViewView") {
                        if (item.getAttribute("data-node-id") === operation.blockID) {
                            openMenuPanel({protyle, blockElement: item, type: "config"});
                        }
                    }
                }
                item.removeAttribute("data-loading");
            });
        });
    }, ["insertAttrViewBlock"].includes(operation.action) ? 2 : 100);
};
