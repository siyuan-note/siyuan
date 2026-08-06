import {fetchSyncPost} from "../../../util/fetch";
import {getColIconByType} from "./col";
import {Constants} from "../../../constants";
import {addDragFill, cellScrollIntoView, popTextCell} from "./cell";
import {unicode2Emoji} from "../../../emoji";
import {focusBlock} from "../../util/selection";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {getRowHTML, stickyRow, updateAVSelectionStatus, updateHeader} from "./row";
import {getCalcValue} from "./calc";
import {renderAVAttribute} from "./blockAttr";
import {escapeAriaLabel, escapeAttr, escapeHtml} from "../../../util/escape";
import {isInMobileApp} from "../../util/compatibility";
import {isMobile} from "../../../util/functions";
import {renderGallery} from "./gallery/render";
import {getFieldsByData, getViewIcon} from "./view";
import {openMenuPanel} from "./openMenuPanel";
import {getPageSize} from "./groups";
import {clearSelect} from "../../util/clear";
import {showMessage} from "../../../dialog/message";
import {renderKanban} from "./kanban/render";
import {bindAvSearch} from "./search";
import {getAVSelectedItemPoints, getBodyVirtualData, initVirtualScroll, setAVData} from "./virtualScroll";
import {
    applyAVRenderContext,
    beginAVRender,
    failAVRender,
    finishAVLocate,
    getAVLocateParams,
    isCurrentAVRender,
    persistAVLocateView,
    prepareAVLocate,
    setAVLocateRequest
} from "./locate";
import {setGroupFoldedStates, updateGroupFoldedStates} from "./groupFold";
import {updateHotkeyTip} from "../../util/compatibility";
import {inspectAVInsertedItem} from "./filteredTip";
import {
    collapseAVCellSelectionToAnchor,
    refreshAVCellSelection,
    restoreAVCellSelection,
} from "./selectionState";
import {
    getAVViewPageSize,
    getAVVisibleViewIDs,
    serializeAVViewPageSizes,
    setAVVisibleViewIDs
} from "./viewVisibility";
import {removeAVPasteSkeleton} from "./paste";

interface IIds {
    groupId: string,
    rowId: string,
    colId?: string
}

interface ITableOptions {
    protyle: IProtyle,
    blockElement: HTMLElement,
    cb: (data: IAV) => void,
    data: IAV,
    renderAll: boolean,
    resetData: {
        left: number,
        alignSelf: string,
        headerTransform: { groupId: string, transform: string },
        footerTransform: { groupId: string, transform: string },
        isSearching: boolean,
        selectCellId: IIds,
        selectRowIds: IIds[],
        dragFillId: IIds,
        activeIds: IIds[],
        query: string,
        pageSizes: { [key: string]: string },
        virtualData: { [key: string]: IAVVirtualData },
    }
}

export const genTabHeaderHTML = (data: IAV, showSearch: boolean, editable: boolean, blockElement: Element) => {
    let tabHTML = "";
    let viewData = data.views.find((item) => item.id === data.viewID) || data.views[0];
    let hasFilter = false;
    const visibleViewIDs = getAVVisibleViewIDs(blockElement, data.views);
    // 递归在过滤树中查找是否存在引用了现有字段的叶子
    const findLeafFilter = (nodes: IAVFilter[], columnId: string, columnType: string): boolean => {
        for (const n of nodes) {
            if (n.filters) {
                if (findLeafFilter(n.filters, columnId, columnType)) {
                    return true;
                }
            } else if (n.value && n.value.type === columnType && n.column === columnId) {
                return true;
            }
        }
        return false;
    };
    getFieldsByData(data).forEach((item) => {
        if (!hasFilter && findLeafFilter(data.view.filters, item.id, item.type)) {
            hasFilter = true;
        }
    });
    data.views.forEach((item: IAVView) => {
        if (!visibleViewIDs.includes(item.id)) {
            if (item.id === data.viewID) {
                viewData = item;
            }
            return;
        }
        tabHTML += `<div draggable="true" data-position="north" data-av-type="${item.type}" data-id="${item.id}" data-page="${item.pageSize}" data-desc="${escapeAriaLabel(item.desc || "")}" class="ariaLabel item${item.id === data.viewID ? " item--focus" : ""}">
    ${item.icon ? unicode2Emoji(item.icon, "item__graphic", true) : `<svg class="item__graphic"><use xlink:href="#${getViewIcon(item.type)}"></use></svg>`}
    <span class="item__text">${escapeHtml(item.name)}</span>
</div>`;
        if (item.id === data.viewID) {
            viewData = item;
        }
    });
    const defaultTemplate = data.newItemTemplates?.find(item => item.id === data.defaultTemplateID);
    const defaultTemplateID = defaultTemplate && (defaultTemplate.targetType !== "detached" ||
        defaultTemplate.primaryKeyTemplate || Object.keys(defaultTemplate.fieldValues || {}).length) ? defaultTemplate.id : "";
    return `<div class="av__header" data-default-template-id="${defaultTemplateID}" data-current-view-id="${escapeAttr(data.viewID)}" data-view-count="${data.views.length}" data-view-ids="${data.views.map((view) => view.id).join(",")}" data-view-pages="${escapeAttr(serializeAVViewPageSizes(data.views))}">
        <div class="fn__flex av__views${showSearch ? " av__views--show" : ""}">
            <div class="av__selection-toolbar">
                <span class="av__selection-count"></span>
                ${editable ? `<button data-type="av-selection-edit" class="block__icon block__icon--show ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.editFields}">
                    <svg><use xlink:href="#iconAttr"></use></svg>
                </button>
                <button data-type="av-selection-delete" class="block__icon block__icon--show ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.delete}">
                    <svg><use xlink:href="#iconTrashcan"></use></svg>
                </button>` : ""}
                <button data-type="av-selection-more" class="block__icon block__icon--show ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.more}">
                    <svg><use xlink:href="#iconMore"></use></svg>
                </button>
            </div>
            <div class="layout-tab-bar fn__flex">
                ${tabHTML}
            </div>
            <div class="fn__space"></div>
            <span data-type="av-add" class="block__icon ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.newView}">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__flex-1"></div>
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
                <div contenteditable="plaintext-only" style="${showSearch ? "width:128px" : "width:0;padding-left: 0;padding-right: 0;"}" data-type="av-search" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.searchPlaceholder}"></div>
            </div>
            <div class="fn__space"></div>
            <span data-type="av-more" aria-label="${window.siyuan.languages.config}" data-position="8south" class="ariaLabel block__icon">
                <svg><use xlink:href="#iconSettings"></use></svg>
            </span>
            <div class="fn__space"></div>
            ${data.isMirror ? `<span data-av-id="${data.id}" data-popover-url="/api/av/getMirrorDatabaseBlocks" class="popover__block block__icon block__icon--show ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.mirrorTip}">
                <svg><use xlink:href="#iconSplitLR"></use></svg>
            </span><div class="fn__space"></div>` : ""}
            <span data-type="av-switcher" aria-label="${window.siyuan.languages.allViews}" data-position="8south" class="ariaLabel block__icon${visibleViewIDs.length < data.views.length ? " block__icon--show" : " av__views-switcher--all"}${data.views.length > 0 ? "" : " fn__none"}">
                <svg><use xlink:href="#iconEye"></use></svg>
                <span class="fn__space"></span>
                <small>${visibleViewIDs.length}/${data.views.length}</small>
            </span>
            <div class="fn__space"></div>
            ${editable ? `<div class="av__new fn__flex">
                <button data-type="av-add-more" class="b3-button">${window.siyuan.languages.new}</button>
                <button data-type="av-add-template" class="b3-button ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.template}"><svg><use xlink:href="#iconDown"></use></svg></button>
            </div>` : ""}
        </div>
        <div contenteditable="${editable}" spellcheck="${window.siyuan.config.editor.spellcheck.toString()}" class="av__title${viewData.hideAttrViewName ? " fn__none" : ""}" data-title="${Lute.EscapeHTMLStr(data.name || "")}" data-tip="${window.siyuan.languages._kernel[267]}">${Lute.EscapeHTMLStr(data.name || "")}</div>
    </div>`;
};

const getTableHTMLs = (data: IAVTable, e: HTMLElement, virtualData: IAVVirtualData) => {
    const freezeDragHTML = `<div class="av__freeze-drag ariaLabel" data-position="east" aria-label="${escapeAttr(window.siyuan.languages.freezeDrag)}"></div>`;
    let calcHTML = "";
    let contentHTML = `<div class="av__row av__row--header"><div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>${freezeDragHTML}</div>`;
    let freezeIndex = -1;
    data.columns.forEach((item, index) => {
        if (!item.hidden && item.pin) {
            freezeIndex = index;
        }
    });
    const pinIndex = freezeIndex;
    if (pinIndex > -1) {
        contentHTML = '<div class="av__row av__row--header"><div class="av__colsticky av__colsticky--freeze"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
        calcHTML = '<div class="av__colsticky av__colsticky--freeze">';
    }
    let hasCalc = false;
    data.columns.forEach((column: IAVColumn, index: number) => {
        if (column.hidden) {
            return;
        }
        contentHTML += `<div class="av__cell av__cell--header" data-col-id="${column.id}"  draggable="true" 
data-icon="${escapeAttr(column.icon)}" data-dtype="${column.type}" data-wrap="${column.wrap}" data-pin="${column.pin}" 
data-date-format="${column.dateFormat || ""}"
data-freeze="${freezeIndex === index}"
data-desc="${escapeAttr(column.desc)}" data-align="${column.align || ""}" data-position="north"
style="width: ${escapeAttr(column.width) || "200px"};">
    ${column.icon ? unicode2Emoji(column.icon, "av__cellheadericon", true) : `<svg class="av__cellheadericon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`}
    <span class="av__celltext fn__flex-1">${escapeHtml(column.name)}</span>
    <div class="av__widthdrag"></div>
</div>`;
        if (pinIndex === index) {
            contentHTML += `${freezeDragHTML}</div>`;
        }
        if (column.type === "lineNumber") {
            // lineNumber type 不参与计算操作
            calcHTML += `<div data-col-id="${column.id}" data-dtype="${column.type}" class="av__calc" style="width: ${escapeAttr(column.width) || "200px"}">&nbsp;</div>`;
        } else {
            calcHTML += `<div class="av__calc${column.calc && column.calc.operator !== "" ? " av__calc--ashow" : ""}" data-col-id="${column.id}" data-dtype="${column.type}" data-operator="${column.calc?.operator || ""}" 
style="width: ${escapeAttr(column.width) || "200px"}">${getCalcValue(column) || `<svg><use xlink:href="#iconDown"></use></svg><small>${window.siyuan.languages.calc}</small>`}</div>`;
        }
        if (column.calc && column.calc.operator !== "") {
            hasCalc = true;
        }

        if (pinIndex === index) {
            calcHTML += "</div>";
        }
    });
    contentHTML += `<div class="block__icons" style="min-height: auto" data-pinindex="${pinIndex}">
    <div class="block__icon block__icon--show" data-type="av-header-more"><svg><use xlink:href="#iconMore"></use></svg></div>
    <div class="fn__space"></div>
    <div class="block__icon block__icon--show ariaLabel" aria-label="${window.siyuan.languages.newCol}" data-type="av-header-add" data-position="4south"><svg><use xlink:href="#iconAdd"></use></svg></div>
</div>
</div>`;
    if (virtualData?.topSpacerHeight) {
        contentHTML += `<div class="av__spacer" style="height: ${virtualData.topSpacerHeight}px;"></div>`;
    }
    // body
    data.rows.find((row: IAVRow, rowIndex: number) => {
        if (virtualData && typeof virtualData.renderedEnd === "number") {
            if (rowIndex === 0) {
                e.setAttribute(Constants.ATTRIBUTE_V_SCROLL, "true");
            }
            if (rowIndex > virtualData.renderedEnd) {
                return true;
            }
            if (rowIndex < virtualData.renderedStart) {
                return;
            }
        } else if (data.pageSize > 100 && rowIndex > 99) {
            e.setAttribute(Constants.ATTRIBUTE_V_SCROLL, "true");
            return true;
        }
        contentHTML += getRowHTML({data, row, rowIndex: rowIndex + (virtualData?.rowOffset || 0), pinIndex, type: "table"});
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
            nameHTML += `<span class="b3-chip" style="background-color:var(--b3-font-background${escapeAttr(item.color)});color:var(--b3-font-color${escapeAttr(item.color)})">${escapeHtml(item.content)}</span>`;
        });
    } else if (group.groupValue.type === "checkbox") {
        nameHTML = `<svg style="width:calc(1.625em - 12px);height:calc(1.625em - 12px)"><use xlink:href="#icon${group.groupValue.checkbox.checked ? "Check" : "Uncheck"}"></use></svg>`;
    } else {
        nameHTML = escapeHtml(group.name);
    }
    // av__group-name 为第三方需求，本应用内没有使用，但不能移除 https://github.com/siyuan-note/siyuan/issues/15736
    return `<div class="av__group-title">
    <div class="av__group-icon ariaLabel" data-type="av-group-fold" data-id="${group.id}" data-position="north" aria-label="${getGroupFoldTip(!!group.groupFolded)}">
        <svg class="${group.groupFolded ? "" : "av__group-arrow--open"}"><use xlink:href="#iconRight"></use></svg>
    </div>
    <span class="fn__space"></span>
    <span class="av__group-name">${nameHTML}</span>
    ${(!counter || counter === 0) ? '<span class="fn__space"></span>' : `<span aria-label="${window.siyuan.languages.entryNum}" data-position="north" class="av__group-counter ariaLabel">${counter}</span>`}
    <span class="av__group-icon av__group-icon--hover ariaLabel" data-type="av-add-top" data-position="north" aria-label="${window.siyuan.languages.newRow}"><svg><use xlink:href="#iconAdd"></use></svg></span>
</div>`;
};

export const getGroupFoldTip = (folded: boolean) => {
    const action = folded ? window.siyuan.languages.expand : window.siyuan.languages.collapse;
    const actionAll = folded ? window.siyuan.languages.expandAll : window.siyuan.languages.foldAll;
    return `${action}<div class='ft__on-surface'>${updateHotkeyTip("⌥" + window.siyuan.languages.click)} ${actionAll}</div>`;
};

const renderGroupTable = (options: ITableOptions) => {
    setGroupFoldedStates(options.blockElement, options.data.view.groups);
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]');
    const isSearching = searchInputElement && document.activeElement === searchInputElement;
    const query = searchInputElement?.textContent || "";

    let avBodyHTML = "";
    options.data.view.groups.forEach((group: IAVTable) => {
        if (group.groupHidden === 0) {
            avBodyHTML += `${getGroupTitleHTML(group, group.rowCount)}
<div data-group-id="${group.id}" data-page-size="${group.pageSize}" data-dtype="${group.groupKey.type}" data-content="${Lute.EscapeHTMLStr(group.groupValue.text?.content || "")}"${options.resetData.virtualData[group.id]?.locate ? ' data-av-locate-window="true"' : ""} style="float: left" class="av__body${group.groupFolded ? " fn__none" : ""}">${getTableHTMLs(group, options.blockElement, options.resetData.virtualData[group.id])}</div>`;
        }
    });
    if (options.renderAll) {
        options.blockElement.firstElementChild.outerHTML = `<div class="av__container">
    ${genTabHeaderHTML(options.data, isSearching || !!query, !options.protyle.disabled, options.blockElement)}
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
    setAVData(options.blockElement, options.data);
    if (!refreshAVCellSelection(options.blockElement, options.data)) {
        options.resetData.selectCellId = undefined;
        options.resetData.dragFillId = undefined;
        options.resetData.activeIds = [];
    }
    if (options.blockElement.getAttribute("data-need-focus") === "true") {
        focusBlock(options.blockElement);
        options.blockElement.removeAttribute("data-need-focus");
    }
    options.blockElement.setAttribute("data-render", "true");
    options.blockElement.querySelector(".av__scroll").scrollLeft = options.resetData.left;
    options.blockElement.style.alignSelf = options.resetData.alignSelf;
    const editRect = options.protyle.contentElement.getBoundingClientRect();
    if (options.resetData.headerTransform) {
        const headerTransformElement = options.blockElement.querySelector(`.av__body[data-group-id="${options.resetData.headerTransform.groupId}"] .av__row--header`) as HTMLElement;
        if (headerTransformElement) {
            headerTransformElement.style.transform = options.resetData.headerTransform.transform;
        }
    }
    if (editRect && !options.protyle.options.action.includes(Constants.CB_GET_HISTORY)) {
        // 需等待渲染完，否则 getBoundingClientRect 错误 https://github.com/siyuan-note/siyuan/issues/13787
        setTimeout(() => {
            stickyRow(options.blockElement, options.protyle.contentElement, "top");
        }, Constants.TIMEOUT_LOAD);
    }
    if (options.resetData.footerTransform) {
        const footerTransformElement = options.blockElement.querySelector(`.av__body[data-group-id="${options.resetData.footerTransform.groupId}"] .av__row--footer`) as HTMLElement;
        if (footerTransformElement) {
            footerTransformElement.style.transform = options.resetData.footerTransform.transform;
        }
    } else if (editRect && !options.protyle.options.action.includes(Constants.CB_GET_HISTORY)) {
        // 需等待渲染完，否则 getBoundingClientRect 错误 https://github.com/siyuan-note/siyuan/issues/13787
        setTimeout(() => {
            stickyRow(options.blockElement, options.protyle.contentElement, "bottom");
        }, Constants.TIMEOUT_LOAD);
    }
    if (options.resetData.selectCellId) {
        let newCellElement = options.blockElement.querySelector(`.av__body[data-group-id="${options.resetData.selectCellId.groupId}"] .av__row[data-id="${options.resetData.selectCellId.rowId}"] .av__cell[data-col-id="${options.resetData.selectCellId.colId}"]`);
        if (!newCellElement) {
            newCellElement = options.blockElement.querySelector(`.av__row[data-id="${options.resetData.selectCellId.rowId}"] .av__cell[data-col-id="${options.resetData.selectCellId.colId}"]`);
        }
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
        let rowElement = options.blockElement.querySelector(`.av__body[data-group-id="${selectRowId.groupId}"] .av__row[data-id="${selectRowId.rowId}"]`) as HTMLElement;
        if (!rowElement) {
            rowElement = options.blockElement.querySelector(`.av__row[data-id="${selectRowId.rowId}"]`) as HTMLElement;
        }
        if (rowElement) {
            rowElement.classList.add("av__row--select");
            rowElement.querySelector(".av__firstcol use").setAttribute("xlink:href", "#iconCheck");
        }
        if (index === options.resetData.selectRowIds.length - 1 && rowElement) {
            updateHeader(rowElement);
        }
    });
    Object.keys(options.resetData.pageSizes).forEach((groupId) => {
        const bodyElement = options.blockElement.querySelector(`.av__body[data-group-id="${groupId === "unGroup" ? "" : groupId}"]`) as HTMLElement;
        if (bodyElement) {
            bodyElement.dataset.pageSize = options.resetData.pageSizes[groupId];
        }
    });
    if (options.resetData.dragFillId) {
        let dragCellElement = options.blockElement.querySelector(`.av__body[data-group-id="${options.resetData.dragFillId.groupId}"] .av__row[data-id="${options.resetData.dragFillId.rowId}"] .av__cell[data-col-id="${options.resetData.dragFillId.colId}"]`);
        if (!dragCellElement) {
            dragCellElement = options.blockElement.querySelector(`.av__row[data-id="${options.resetData.dragFillId.rowId}"] .av__cell[data-col-id="${options.resetData.dragFillId.colId}"]`);
        }
        addDragFill(dragCellElement);
    }
    options.resetData.activeIds.forEach(activeId => {
        let activeCellElement = options.blockElement.querySelector(`.av__body[data-group-id="${activeId.groupId}"] .av__row[data-id="${activeId.rowId}"] .av__cell[data-col-id="${activeId.colId}"]`);
        if (!activeCellElement) {
            activeCellElement = options.blockElement.querySelector(`.av__row[data-id="${activeId.rowId}"] .av__cell[data-col-id="${activeId.colId}"]`);
        }
        activeCellElement?.classList.add("av__cell--active");
    });
    restoreAVCellSelection(options.blockElement);
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
    const focusViewElement = options.blockElement.querySelector(".layout-tab-bar .item--focus") as HTMLElement;
    if (focusViewElement) {
        options.blockElement.querySelector(".layout-tab-bar").scrollLeft = focusViewElement.offsetLeft - 30;
    }
    if (options.cb) {
        options.cb(options.data);
    }
    initVirtualScroll({
        ...options,
        selectedItemPoints: options.resetData.selectRowIds.map(item => ({
            groupID: item.groupId,
            itemID: item.rowId,
        })),
    });
    updateAVSelectionStatus(options.blockElement);
    if (!options.renderAll) {
        finishAVLocate(options.blockElement, options.protyle, options.data);
        return;
    }
    bindAvSearch({
        blockElement: options.blockElement,
        query: options.resetData.query,
        isSearching: options.resetData.isSearching,
        onChange: () => updateSearch(options.blockElement, options.protyle),
    });
    finishAVLocate(options.blockElement, options.protyle, options.data);
};

export const avRender = async (element: Element, protyle: IProtyle, cb?: (data: IAV) => void, renderAll = true, avData?: IAV) => {
    let avElements: Element[] = [];
    if (element.getAttribute("data-type") === "NodeAttributeView") {
        avElements = [element];
    } else {
        avElements = Array.from(element.querySelectorAll('[data-type="NodeAttributeView"]'));
    }
    if (avElements.length === 0) {
        return;
    }
    for (let i = 0; i < avElements.length; i++) {
        const e = avElements[i] as HTMLElement;
        e.removeAttribute("data-rendering");
        if (e.getAttribute("data-render") === "true" || hasClosestByClassName(e, "av__gallery-content")) {
            continue;
        }
        if (isMobile() || isInMobileApp()) {
            e.classList.add("av--touch");
        }
        const renderToken = beginAVRender(e);

        if (e.getAttribute("data-av-type") === "gallery") {
            await renderGallery({blockElement: e, protyle, cb, renderAll});
            continue;
        }
        if (e.getAttribute("data-av-type") === "kanban") {
            await renderKanban({blockElement: e, protyle, cb, renderAll});
            continue;
        }

        let selectCellId;
        const selectCellElement = e.querySelector(".av__cell--select") as HTMLElement;
        if (selectCellElement) {
            selectCellId = {
                groupId: (hasClosestByClassName(selectCellElement, "av__body") as HTMLElement).dataset.groupId || "",
                rowId: (hasClosestByClassName(selectCellElement, "av__row") as HTMLElement).dataset.id,
                colId: selectCellElement.getAttribute("data-col-id"),
            };
        }
        const selectRowIds: IIds[] = getAVSelectedItemPoints(e).map(item => ({
            groupId: item.groupID,
            rowId: item.itemID,
        }));
        let dragFillId;
        const dragFillElement = e.querySelector(".av__drag-fill") as HTMLElement;
        if (dragFillElement) {
            dragFillId = {
                groupId: (hasClosestByClassName(dragFillElement, "av__body") as HTMLElement).dataset.groupId || "",
                rowId: (hasClosestByClassName(dragFillElement, "av__row") as HTMLElement).dataset.id,
                colId: dragFillElement.parentElement.getAttribute("data-col-id"),
            };
        }
        const activeIds: IIds[] = [];
        e.querySelectorAll(".av__cell--active").forEach((item) => {
            activeIds.push({
                groupId: (hasClosestByClassName(item, "av__body") as HTMLElement).dataset.groupId || "",
                rowId: (hasClosestByClassName(item, "av__row") as HTMLElement).dataset.id,
                colId: item.getAttribute("data-col-id"),
            });
        });
        const searchInputElement = e.querySelector('[data-type="av-search"]') as HTMLInputElement;
        const pageSizes: { [key: string]: string } = {};
        const virtualData: { [key: string]: IAVVirtualData } = {};
        e.querySelectorAll(".av__body").forEach((item: HTMLElement) => {
            pageSizes[item.dataset.groupId || "unGroup"] = item.dataset.pageSize;
            if (item.dataset.avLocateWindow === "true") {
                return;
            }
            // 守卫只保证至少 1 个 .av__row，但首行索引取的是 [1]（首个数据行，[0] 为表头）。
            // 虚拟滚动 trim 后某分组可能只剩表头，[1] 不存在时需跳过，避免解引用 undefined.getAttribute
            const secondRow = item.querySelectorAll(".av__row")[1] as HTMLElement;
            if (!secondRow || e.getAttribute(Constants.ATTRIBUTE_V_SCROLL) !== "true") {
                return;
            }
            virtualData[item.getAttribute("data-group-id") || "all"] = getBodyVirtualData(
                item, ".av__row--util", parseInt(secondRow.getAttribute("data-index")));
        });
        const headerTransformElement = e.querySelector('.av__row--header[style^="transform"]') as HTMLElement;
        const footerTransformElement = e.querySelector('.av__row--footer[style^="transform"]') as HTMLElement;
        const resetData = {
            selectCellId,
            alignSelf: e.style.alignSelf,
            left: e.querySelector(".av__scroll")?.scrollLeft || 0,
            headerTransform: headerTransformElement ? {
                groupId: headerTransformElement.parentElement.getAttribute("data-group-id"),
                transform: headerTransformElement.style.transform
            } : null,
            footerTransform: footerTransformElement ? {
                groupId: footerTransformElement.parentElement.getAttribute("data-group-id"),
                transform: footerTransformElement.style.transform
            } : null,
            isSearching: searchInputElement && document.activeElement === searchInputElement,
            selectRowIds,
            dragFillId,
            activeIds,
            query: searchInputElement?.textContent || "",
            pageSizes,
            virtualData
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
        const avPageSize = getPageSize(e);
        const created = protyle.options.history?.created;
        const snapshot = protyle.options.history?.snapshot;
        const locateParams = getAVLocateParams(e, !created && !snapshot);
        const historical = !!created || !!snapshot;
        let data: IAV;
        if (!avData) {
            const response = await fetchSyncPost(created ? "/api/av/renderHistoryAttributeView" : (snapshot ? "/api/av/renderSnapshotAttributeView" : "/api/av/renderAttributeView"), {
                id: e.getAttribute("data-av-id"),
                created,
                snapshot,
                pageSize: avPageSize.unGroupPageSize,
                groupPaging: avPageSize.groupPageSize,
                viewID: locateParams?.viewID || "",
                ...(historical ? {carrierViewID: e.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || ""} : {}),
                query: resetData.query.trim(),
                blockID: e.getAttribute("data-node-id"),
                initialLayout: e.getAttribute("data-av-type"),
                createIfNotExist: !protyle.block.action?.includes(Constants.CB_GET_AV_NO_CREATE),
                targetItemID: locateParams?.targetItemID || "",
                targetGroupID: locateParams?.targetGroupID || "",
            }, undefined, false);
            if (!isCurrentAVRender(e, renderToken)) {
                continue;
            }
            if (response.code !== 0) {
                failAVRender(e, response);
                continue;
            }
            data = response.data;
        } else {
            data = avData;
        }
        if (!isCurrentAVRender(e, renderToken)) {
            continue;
        }
        if (persistAVLocateView(e, protyle, data)) {
            continue;
        }
        applyAVRenderContext(e, data);
        if (e.hasAttribute(Constants.CUSTOM_SY_AV_VISIBLE_VIEWS)) {
            setAVVisibleViewIDs(e, getAVVisibleViewIDs(e, data.views));
        }
        prepareAVLocate(e, data, resetData);
        if (data.viewType === "gallery") {
            await renderGallery({blockElement: e, protyle, cb, renderAll, data});
            continue;
        }
        if (data.viewType === "kanban") {
            await renderKanban({blockElement: e, protyle, cb, renderAll, data});
            continue;
        }
        const view = data.view as IAVTable;
        if (view.groups?.length > 0) {
            renderGroupTable({blockElement: e, protyle, cb, renderAll, data, resetData});
            continue;
        }
        const avBodyHTML = `<div class="av__body" data-group-id="" data-page-size="${view.pageSize}"${resetData.virtualData.all?.locate ? ' data-av-locate-window="true"' : ""} style="float: left">
    ${getTableHTMLs(view, e, resetData.virtualData.all)}
</div>`;
        if (renderAll) {
            e.firstElementChild.outerHTML = `<div class="av__container">
    ${genTabHeaderHTML(data, resetData.isSearching || !!resetData.query, !protyle.disabled, e)}
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
            data,
            cb,
            protyle,
            blockElement: e,
            resetData
        });
        // 历史兼容
        e.style.margin = "";
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

const getAVElements = (protyle: IProtyle, avID: string, viewID?: string): HTMLElement[] => {
    const elements = Array.from(protyle.wysiwyg.element.querySelectorAll(`.av[data-av-id="${avID}"]`)) as HTMLElement[];
    if (viewID) {
        return elements.filter((item) => getViewIDByAVElement(item) === viewID);
    }
    return elements;
};

const getViewIDByAVElement = (avElement: HTMLElement): string | null => {
    return avElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW)
        || avElement.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-id") // 旧版本的数据库块没有 CUSTOM_SY_AV_VIEW 属性，所以在视图元素上获取 viewID
        || null;
};

const addingFocusTokens = new Map<string, symbol>();

const scrollAddingCellIntoView = (protyle: IProtyle, blockElement: HTMLElement, cellElement: HTMLElement) => {
    const rowElement = hasClosestByClassName(cellElement, "av__row");
    const bodyElement = hasClosestByClassName(cellElement, "av__body");
    if (rowElement && rowElement.dataset.index === "0" && bodyElement && !bodyElement.dataset.groupId) {
        const contentRect = protyle.contentElement.getBoundingClientRect();
        const blockRect = blockElement.getBoundingClientRect();
        protyle.contentElement.scrollTop += blockRect.top - contentRect.top;
        return;
    }
    cellScrollIntoView(blockElement, cellElement, false);
};

const getAddingCellElement = (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    itemID: string;
    groupID?: string;
}) => {
    const blockElement = Array.from(options.protyle.wysiwyg.element.querySelectorAll(`.av[data-av-id="${options.avID}"]`)).find((item: HTMLElement) => {
        return item.dataset.nodeId === options.blockID;
    }) as HTMLElement;
    if (!blockElement) {
        return;
    }
    const groupQuery = options.groupID ? `[data-group-id="${options.groupID}"]` : "";
    let cellElement = blockElement.querySelector(`.av__body${groupQuery} [data-id="${options.itemID}"] .av__cell[data-dtype="block"]`) as HTMLElement;
    if (!cellElement) {
        const cellElements = blockElement.querySelectorAll(`.av__body [data-id="${options.itemID}"] .av__cell[data-dtype="block"]`);
        if (cellElements.length === 1) {
            cellElement = cellElements[0] as HTMLElement;
        }
    }
    if (!cellElement) {
        return;
    }
    return {blockElement, cellElement};
};

const waitForAddingCellPosition = async (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    itemID: string;
    groupID?: string;
}) => {
    let previousRect: DOMRect;
    let previousScrollTop: number;
    let stableFrames = 0;
    for (let i = 0; i < 120; i++) {
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
        });
        const result = getAddingCellElement(options);
        if (!result || result.cellElement.getBoundingClientRect().height === 0) {
            stableFrames = 0;
            continue;
        }
        const rect = result.cellElement.getBoundingClientRect();
        const scrollTop = options.protyle.contentElement.scrollTop;
        if (!options.protyle.wysiwyg.element.hasAttribute("data-top") && previousRect &&
            Math.abs(previousRect.top - rect.top) < 0.5 && Math.abs(previousRect.left - rect.left) < 0.5 &&
            Math.abs(previousRect.width - rect.width) < 0.5 && Math.abs(previousRect.height - rect.height) < 0.5 &&
            previousScrollTop === scrollTop) {
            stableFrames++;
            if (stableFrames === 2) {
                return result;
            }
        } else {
            stableFrames = 0;
        }
        previousRect = rect;
        previousScrollTop = scrollTop;
    }
};

export const refreshAV = (protyle: IProtyle, operation: IOperation) => {
    if (operation.action === "insertAttrViewBlock") {
        inspectAVInsertedItem(protyle, operation);
    }
    if (operation.action === "addAttrViewView" || operation.action === "duplicateAttrViewView") {
        getAVElements(protyle, operation.avID).forEach((item) => {
            const oldViewIDs = (item.querySelector(".av__header")?.getAttribute("data-view-ids") || "")
                .split(",").filter(Boolean);
            if (item.dataset.nodeId === operation.blockID) {
                setAVVisibleViewIDs(item, getAVVisibleViewIDs(item, oldViewIDs).concat(operation.id));
            } else if (!item.hasAttribute(Constants.CUSTOM_SY_AV_VISIBLE_VIEWS)) {
                setAVVisibleViewIDs(item, oldViewIDs);
            }
        });
    }
    if (operation.action === "setAttrViewBlockVisibleViews") {
        getAVElements(protyle, operation.avID).forEach((item) => {
            if (item.dataset.nodeId !== operation.blockID) {
                return;
            }
            setAVVisibleViewIDs(item, operation.viewIDs);
            item.removeAttribute("data-render");
            avRender(item, protyle);
        });
        return;
    }
    if (operation.action === "setAttrViewName") {
        getAVElements(protyle, operation.id).forEach((item) => {
            const titleElement = item.querySelector(".av__title") as HTMLElement;
            if (!titleElement) {
                return;
            }
            titleElement.textContent = operation.data;
            titleElement.dataset.title = operation.data;
        });
        return;
    }
    if (operation.action === "setAttrViewColWidth") {
        getAVElements(protyle, operation.avID, operation.viewID).forEach((item) => {
            const cellElement = item.querySelector(`.av__cell[data-col-id="${operation.id}"]`) as HTMLElement;
            if (!cellElement || cellElement.style.width === operation.data) {
                return;
            }
            item.querySelectorAll(".av__row, .av__row--footer").forEach(rowItem => {
                const columnElement = rowItem.querySelector(`[data-col-id="${operation.id}"]`) as HTMLElement;
                if (columnElement) {
                    columnElement.style.width = operation.data;
                }
            });
        });
        return;
    }
    if (operation.action === "setAttrViewColsWidth") {
        getAVElements(protyle, operation.avID, operation.viewID).forEach((item) => {
            item.querySelectorAll(".av__row, .av__row--footer").forEach(rowItem => {
                Object.entries(operation.data as Record<string, string>).forEach(([columnID, width]) => {
                    const columnElement = rowItem.querySelector(`[data-col-id="${columnID}"]`) as HTMLElement;
                    if (columnElement) {
                        columnElement.style.width = width;
                    }
                });
            });
        });
        return;
    }
    if (operation.action === "setAttrViewColAlign") {
        getAVElements(protyle, operation.avID, operation.viewID).forEach((item) => {
            item.querySelectorAll(`.av__cell[data-col-id="${operation.id}"]`).forEach((cellElement: HTMLElement) => {
                cellElement.dataset.align = operation.data;
            });
        });
        return;
    }
    if (operation.action === "hideAttrViewName") {
        getAVElements(protyle, operation.avID, operation.viewID).forEach((item) => {
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
        getAVElements(protyle, operation.avID, operation.viewID).forEach((item) => {
            item.querySelectorAll(".av__cell").forEach(fieldItem => {
                fieldItem.setAttribute("data-wrap", operation.data.toString());
            });
        });
        return;
    }
    if (operation.action === "setAttrViewFillColBackgroundColor") {
        getAVElements(protyle, operation.avID, operation.viewID).forEach((avItem: HTMLElement) => {
            const hasSelect = avItem.querySelector(".av__group-title .b3-chip");
            const kanbanElement = avItem.querySelector(".av__kanban");
            if (operation.data && hasSelect) {
                kanbanElement.classList.add("av__kanban--bg");
            } else {
                kanbanElement.classList.remove("av__kanban--bg");
            }
            avItem.querySelectorAll(".av__kanban-group").forEach(item => {
                if (operation.data && hasSelect) {
                    const nameElement = item.querySelector(".av__group-title .b3-chip") as HTMLElement;
                    if (nameElement) {
                        item.setAttribute("style", `--b3-av-kanban-background:var(--b3-font-background${nameElement.style.backgroundColor.slice(-2, -1)})`);
                    } else {
                        item.setAttribute("style", "--b3-av-kanban-background: var(--b3-border-color)");
                    }
                } else {
                    item.removeAttribute("style");
                }
            });
        });
        return;
    }
    if (operation.action === "setAttrViewFitImage") {
        getAVElements(protyle, operation.avID, operation.viewID).forEach((item) => {
            item.querySelectorAll(".av__gallery-img").forEach((imgElement) => {
                if (operation.data) {
                    imgElement.classList.add("av__gallery-img--fit");
                } else {
                    imgElement.classList.remove("av__gallery-img--fit");
                }
            });
            item.querySelectorAll(".av__gallery-item").forEach((galleryItem) => {
                const positionElement = galleryItem.querySelector<HTMLElement>('[data-type="av-cover-position"]');
                if (!positionElement) {
                    return;
                }
                positionElement.classList.toggle("fn__none", Boolean(operation.data));
                const actionElements =
                    Array.from(galleryItem.querySelectorAll<HTMLElement>(".av__gallery-actions .protyle-icon"));
                actionElements.forEach(actionElement => actionElement.classList.remove("protyle-icon--first"));
                actionElements.find(actionElement => !actionElement.classList.contains("fn__none"))
                    ?.classList.add("protyle-icon--first");
            });
        });
        return;
    }
    if (operation.action === "setAttrViewShowIcon") {
        getAVElements(protyle, operation.avID, operation.viewID).forEach((item) => {
            item.querySelectorAll('.av__cell[data-dtype="block"] .b3-menu__avemoji').forEach(cellItem => {
                cellItem.classList.toggle("fn__none", !operation.data);
            });
            item.querySelectorAll('.av__cell[data-dtype="relation"] .av__cell--relation').forEach(cellItem => {
                cellItem.firstElementChild.classList.toggle("fn__none", !operation.data);
            });
        });
        return;
    }
    if (operation.action === "setAttrViewColWrap") {
        getAVElements(protyle, operation.avID, operation.viewID).forEach((item) => {
            item.querySelectorAll(`.av__cell[data-col-id="${operation.id}"],.av__cell[data-field-id="${operation.id}"]`).forEach(cellItem => {
                cellItem.setAttribute("data-wrap", operation.data.toString());
            });
        });
        return;
    }
    if (operation.action === "foldAttrViewGroup" || operation.action === "foldAttrViewGroups") {
        const folded = operation.action === "foldAttrViewGroup"
            ? {[operation.id]: operation.data}
            : operation.data as Record<string, boolean>;
        getAVElements(protyle, operation.avID, operation.viewID).forEach((item) => {
            updateGroupFoldedStates(item, folded);
            Object.entries(folded).forEach(([groupID, groupFolded]) => {
                const foldElement = item.querySelector(`[data-type="av-group-fold"][data-id="${groupID}"]`);
                if (!foldElement) {
                    return;
                }
                if (foldElement.getAttribute("data-processed") === "true") {
                    foldElement.removeAttribute("data-processed");
                    return;
                }
                foldElement.firstElementChild.classList.toggle("av__group-arrow--open", !groupFolded);
                foldElement.parentElement.nextElementSibling.classList.toggle("fn__none", groupFolded);
                foldElement.setAttribute("aria-label", getGroupFoldTip(groupFolded));
                foldElement.removeAttribute("data-folding");
            });
        });
        return;
    }
    const addingFocusKey = `${protyle.id}-${operation.avID}`;
    const addingFocusToken = Symbol();
    if (operation.action === "insertAttrViewBlock") {
        addingFocusTokens.set(addingFocusKey, addingFocusToken);
    } else {
        addingFocusTokens.delete(addingFocusKey);
    }
    // 只能 setTimeout，以前方案快速输入后最后一次修改会被忽略；必须为每一个 protyle 单独设置，否则有多个 protyle 时，其余无法被执行
    clearTimeout(refreshTimeouts[protyle.id]);
    refreshTimeouts[protyle.id] = window.setTimeout(() => {
        // 修改表格名 avID 传入到 id 上了 https://github.com/siyuan-note/siyuan/issues/12724
        const avID = operation.action === "setAttrViewName" ? operation.id : operation.avID;
        const attrElement = document.querySelector(`.b3-dialog--open[data-key="${Constants.DIALOG_ATTR}"] .custom-attr > [data-av-id="${avID}"]`) as HTMLElement;
        if (attrElement) {
            // 更新属性面板
            attrElement.removeAttribute("data-rendering");
            renderAVAttribute(attrElement.parentElement, attrElement.dataset.nodeId, protyle);
        }
        getAVElements(protyle, avID).forEach((item) => {
            item.removeAttribute("data-render");
            if (["setAttrViewCardSize", "setAttrViewCardWidth", "setAttrViewCardAspectRatio",
                "setAttrViewCardAspectRatioValue", "setAttrViewCardLayout", "setAttrViewColFullRow",
                "setAttrViewDisplayFieldName"].includes(operation.action) &&
                (!operation.viewID || getViewIDByAVElement(item) === operation.viewID)) {
                // 卡片尺寸或字段布局变化后原虚拟滚动占位高度已失效，重渲时从首项重新初始化。
                item.removeAttribute(Constants.ATTRIBUTE_V_SCROLL);
            }
            if (operation.action === "replaceAttrViewBlock" && operation.retData?.duplicate &&
                (!operation.blockID || operation.blockID === item.dataset.nodeId) &&
                (!operation.context?.protyleID || operation.context.protyleID === protyle.id)) {
                setAVLocateRequest(item, {
                    itemID: operation.retData.targetItemID,
                    select: true,
                });
            }
            if (operation.action === "sortAttrViewRow") {
                clearSelect(["cell"], item);
            } else if (operation.action === "sortAttrViewCol") {
                collapseAVCellSelectionToAnchor(item);
                item.querySelectorAll(".av__cell--active").forEach((item) => {
                    item.classList.remove("av__cell--active");
                    item.querySelector(".av__drag-fill")?.remove();
                });
                addDragFill(item.querySelector(".av__cell--select"));
            } else if (operation.action === "setAttrViewBlockView") {
                const pageSize = getAVViewPageSize(
                    item.querySelector(".av__header")?.getAttribute("data-view-pages"),
                    operation.id
                );
                item.querySelectorAll(".av__body").forEach((bodyItem: HTMLElement) => {
                    if (pageSize) {
                        bodyItem.dataset.pageSize = pageSize;
                    } else {
                        bodyItem.removeAttribute("data-page-size");
                    }
                });
            } else if (operation.action === "addAttrViewView") {
                item.querySelectorAll(".av__body").forEach((bodyItem: HTMLElement) => {
                    bodyItem.dataset.pageSize = "50";
                });
            } else if (operation.action === "removeAttrViewView") {
                item.querySelectorAll(".av__body").forEach((bodyItem: HTMLElement) => {
                    bodyItem.removeAttribute("data-page-size");
                });
            } else if (operation.action === "sortAttrViewView" && operation.data === "unRefresh") {
                const viewTabElement = item.querySelector(`.av__views > .layout-tab-bar > .item[data-id="${operation.id}"]`) as HTMLElement;
                if (viewTabElement && !operation.previousID && !viewTabElement.previousElementSibling) {
                    return;
                } else if (viewTabElement && operation.previousID && viewTabElement.previousElementSibling?.getAttribute("data-id") === operation.previousID) {
                    return;
                }
            }
            const hasGhost = item.querySelector('[data-type="ghost"]');
            avRender(item, protyle, () => {
                if (operation.action === "insertAttrViewBlock" && operation.context?.ignoreTip !== "true") {
                    if (operation.context?.message) {
                        showMessage(operation.context.message);
                    } else {
                        const groupQuery = operation.groupID ? `[data-group-id="${operation.groupID}"]` : "";
                        if (["gallery", "kanban"].includes(item.getAttribute("data-av-type"))) {
                            operation.srcs.forEach(srcItem => {
                                const filesElement = item.querySelector(`.av__body${groupQuery} .av__gallery-item[data-id="${srcItem.itemID}"]`)?.querySelector(".av__gallery-fields");
                                if (filesElement && filesElement.querySelector('[data-dtype="block"]')?.parentElement.getAttribute("data-empty") === "true") {
                                    filesElement.classList.add("av__gallery-fields--edit");
                                }
                            });
                        }
                        let isAddingFocusPending = false;
                        if (operation.srcs.length === 1) {
                            let popCellElement = item.querySelector(`.av__body${groupQuery} [data-id="${operation.srcs[0].itemID}"] .av__cell[data-dtype="block"]`) as HTMLElement;
                            if (!popCellElement) {
                                const popCellElements = item.querySelectorAll(`.av__body [data-id="${operation.srcs[0].itemID}"] .av__cell[data-dtype="block"]`);
                                if (popCellElements.length === 1) {
                                    popCellElement = popCellElements[0] as HTMLElement;
                                }
                            }
                            if (popCellElement && popCellElement.getAttribute("data-detached") === "true" &&
                                popCellElement.querySelector(".av__celltext").textContent === "" &&
                                popCellElement.getBoundingClientRect().height !== 0 && hasGhost) {
                                if (item.getAttribute("data-av-type") !== "table") {
                                    if (addingFocusTokens.get(addingFocusKey) === addingFocusToken) {
                                        addingFocusTokens.delete(addingFocusKey);
                                        popTextCell(protyle, [popCellElement], "block");
                                    }
                                } else {
                                    isAddingFocusPending = true;
                                    const addingCellOptions = {
                                        protyle,
                                        avID,
                                        blockID: item.dataset.nodeId,
                                        itemID: operation.srcs[0].itemID,
                                        groupID: operation.groupID,
                                    };
                                    scrollAddingCellIntoView(protyle, item, popCellElement);
                                    waitForAddingCellPosition(addingCellOptions).then((result) => {
                                        if (addingFocusTokens.get(addingFocusKey) !== addingFocusToken) {
                                            return;
                                        }
                                        addingFocusTokens.delete(addingFocusKey);
                                        if (!result || result.cellElement.getAttribute("data-detached") !== "true" ||
                                            result.cellElement.querySelector(".av__celltext").textContent !== "") {
                                            return;
                                        }
                                        popTextCell(protyle, [result.cellElement], "block", {scrollIntoView: false});
                                    });
                                }
                            }
                        }
                        if (hasGhost && !isAddingFocusPending &&
                            addingFocusTokens.get(addingFocusKey) === addingFocusToken) {
                            addingFocusTokens.delete(addingFocusKey);
                        }
                    }
                } else if (operation.action === "addAttrViewView") {
                    if (item.getAttribute("data-node-id") === operation.blockID) {
                        openMenuPanel({protyle, blockElement: item, type: "config"});
                    }
                }
                removeAVPasteSkeleton(item);
                item.removeAttribute("data-loading");
            });
        });
    }, ["insertAttrViewBlock", "addAttrViewCol", "removeAttrViewCol", "duplicateAttrViewKey"].includes(operation.action) ? 2 : 100);
};
