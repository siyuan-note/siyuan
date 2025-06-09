import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../../util/hasClosest";
import {Constants} from "../../../../constants";
import {fetchPost} from "../../../../util/fetch";
import {escapeAriaLabel, escapeHtml} from "../../../../util/escape";
import {unicode2Emoji} from "../../../../emoji";
import {renderCell} from "../cell";
import {focusBlock} from "../../../util/selection";
import {electronUndo} from "../../../undo";
import {addClearButton} from "../../../../util/addClearButton";
import {updateSearch} from "../render";

export const renderGallery = (options: {
    blockElement: HTMLElement,
    protyle: IProtyle,
    cb?: () => void,
    viewID?: string,
    renderAll: boolean
}) => {
    const alignSelf = options.blockElement.style.alignSelf;
    if (options.blockElement.firstElementChild.innerHTML === "") {
        options.blockElement.style.alignSelf = "";
        options.blockElement.firstElementChild.outerHTML = `<div class="av__gallery">
    <span style="width: 100%;height: 178px;" class="av__pulse"></span>
    <span style="width: 100%;height: 178px;" class="av__pulse"></span>
    <span style="width: 100%;height: 178px;" class="av__pulse"></span>
</div>`;
    }

    const selectItemIds: string[] = [];
    options.blockElement.querySelectorAll(".av__gallery-item--select").forEach(rowItem => {
        const rowId = rowItem.getAttribute("data-id");
        if (rowId) {
            selectItemIds.push(rowId);
        }
    });
    const created = options.protyle.options.history?.created;
    const snapshot = options.protyle.options.history?.snapshot;
    let newViewID = options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "";
    if (typeof options.viewID === "string") {
        const viewTabElement = options.blockElement.querySelector(`.av__views > .layout-tab-bar > .item[data-id="${options.viewID}"]`) as HTMLElement;
        if (viewTabElement) {
            options.blockElement.dataset.pageSize = viewTabElement.dataset.page;
        }
        newViewID = options.viewID;
        fetchPost("/api/av/setDatabaseBlockView", {
            id: options.blockElement.dataset.nodeId,
            avID: options.blockElement.dataset.avId,
            viewID: options.viewID
        });
        options.blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, newViewID);
    }
    let searchInputElement = options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement;
    const isSearching = searchInputElement && document.activeElement.isSameNode(searchInputElement);
    const query = searchInputElement?.value || "";
    fetchPost(created ? "/api/av/renderHistoryAttributeView" : (snapshot ? "/api/av/renderSnapshotAttributeView" : "/api/av/renderAttributeView"), {
        id: options.blockElement.getAttribute("data-av-id"),
        created,
        snapshot,
        pageSize: parseInt(options.blockElement.dataset.pageSize) || undefined,
        viewID: newViewID,
        query: query.trim()
    }, (response) => {
        const data = response.data.view as IAVTable;
        if (!options.blockElement.dataset.pageSize) {
            options.blockElement.dataset.pageSize = data.pageSize.toString();
        }
        let galleryHTML = "";
        // body
        debugger
        data.rows.forEach((row: IAVRow, rowIndex: number) => {
            row.cells.forEach((cell, index) => {
                if (data.columns[index].hidden) {
                    return;
                }
                // https://github.com/siyuan-note/siyuan/issues/10262
                let checkClass = "";
                if (cell.valueType === "checkbox") {
                    checkClass = cell.value?.checkbox?.checked ? " av__cell-check" : " av__cell-uncheck";
                }
                galleryHTML += `<div class="av__cell${checkClass}" data-id="${cell.id}" data-col-id="${data.columns[index].id}"
${cell.valueType === "block" ? 'data-block-id="' + (cell.value.block.id || "") + '"' : ""} data-wrap="${data.columns[index].wrap}" 
data-dtype="${data.columns[index].type}" 
${cell.value?.isDetached ? ' data-detached="true"' : ""} 
style="width: ${data.columns[index].width || "200px"};
${cell.valueType === "number" ? "text-align: right;" : ""}
${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${cell.color ? `color:${cell.color};` : ""}">${renderCell(cell.value, rowIndex)}</div>`;
            });
        });
        let tabHTML = "";
        let viewData: IAVView;
        response.data.views.forEach((item: IAVView) => {
            tabHTML += `<div data-position="north" data-av-type="${item.type}" data-id="${item.id}" data-page="${item.pageSize}" data-desc="${escapeAriaLabel(item.desc || "")}" class="ariaLabel item${item.id === response.data.viewID ? " item--focus" : ""}">
    ${item.icon ? unicode2Emoji(item.icon, "item__graphic", true) : '<svg class="item__graphic"><use xlink:href="#iconTable"></use></svg>'}
    <span class="item__text">${escapeHtml(item.name)}</span>
</div>`;
            if (item.id === response.data.viewID) {
                viewData = item;
            }
        });
        if (options.renderAll) {
            let hasFilter = false;
            data.columns.forEach((item) => {
                if (!hasFilter) {
                    data.filters.find(filterItem => {
                        if (filterItem.value.type === item.type && item.id === filterItem.column) {
                            hasFilter = true;
                            return true;
                        }
                    });
                }
            });
            options.blockElement.firstElementChild.outerHTML = `<div class="av__container">
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
            <button data-type="av-search-icon" class="block__icon">
                <svg><use xlink:href="#iconSearch"></use></svg>
            </button>
            <div style="position: relative" class="fn__flex">
                <input style="${isSearching || query ? "width:128px" : "width:0;padding-left: 0;padding-right: 0;"}" data-type="av-search" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.search}">
            </div>
            <div class="fn__space"></div>
            <span data-type="av-more" class="block__icon">
                <svg><use xlink:href="#iconMore"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-add-more" class="block__icon ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.newRow}">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__space"></div>
            ${response.data.isMirror ? ` <span data-av-id="${response.data.id}" data-popover-url="/api/av/getMirrorDatabaseBlocks" class="popover__block block__icon block__icon--show ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.mirrorTip}">
    <svg><use xlink:href="#iconSplitLR"></use></svg></span><div class="fn__space"></div>` : ""}
        </div>
        <div contenteditable="${options.protyle.disabled || hasClosestByAttribute(options.blockElement, "data-type", "NodeBlockQueryEmbed") ? "false" : "true"}" spellcheck="${window.siyuan.config.editor.spellcheck.toString()}" class="av__title${viewData.hideAttrViewName ? " fn__none" : ""}" data-title="${response.data.name || ""}" data-tip="${window.siyuan.languages.title}">${response.data.name || ""}</div>
        <div class="av__counter fn__none"></div>
    </div>
    <div class="av__gallery">
        ${galleryHTML}
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`;
        } else {
            options.blockElement.firstElementChild.querySelector(".av__gallery").innerHTML = galleryHTML;
        }
        options.blockElement.setAttribute("data-render", "true");
        if (alignSelf) {
            options.blockElement.style.alignSelf = alignSelf;
        }
        selectItemIds.forEach((selectRowId) => {
            const rowElement = options.blockElement.querySelector(`.av__gallery-cell[data-id="${selectRowId}"]`) as HTMLElement;
            if (rowElement) {
                rowElement.classList.add("av__gallery-cell--select");
            }
        });
        if (getSelection().rangeCount > 0) {
            // 修改表头后光标重新定位
            const range = getSelection().getRangeAt(0);
            if (!hasClosestByClassName(range.startContainer, "av__title")) {
                const blockElement = hasClosestBlock(range.startContainer);
                if (blockElement && options.blockElement.isSameNode(blockElement) && !isSearching) {
                    focusBlock(options.blockElement);
                }
            }
        }
        options.blockElement.querySelector(".layout-tab-bar").scrollLeft = (options.blockElement.querySelector(".layout-tab-bar .item--focus") as HTMLElement).offsetLeft;
        if (options.cb) {
            options.cb();
        }
        if (!options.renderAll) {
            return;
        }
        const viewsElement = options.blockElement.querySelector(".av__views") as HTMLElement;
        searchInputElement = options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement;
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
    });
};
