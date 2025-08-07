import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../../util/hasClosest";
import {Constants} from "../../../../constants";
import {fetchSyncPost} from "../../../../util/fetch";
import {escapeAttr} from "../../../../util/escape";
import {unicode2Emoji} from "../../../../emoji";
import {cellValueIsEmpty, renderCell} from "../cell";
import {focusBlock} from "../../../util/selection";
import {electronUndo} from "../../../undo";
import {addClearButton} from "../../../../util/addClearButton";
import {avRender, genTabHeaderHTML, getGroupTitleHTML, updateSearch} from "../render";
import {processRender} from "../../../util/processCode";
import {getColIconByType, getColNameByType} from "../col";
import {getCompressURL} from "../../../../util/image";
import {getPageSize} from "../groups";

interface ITableOptions {
    protyle: IProtyle,
    blockElement: HTMLElement,
    cb: (data: IAV) => void,
    data: IAV,
    renderAll: boolean,
    resetData: {
        alignSelf: string,
        selectItemIds: string[],
        isSearching: boolean,
        editIds: string[],
        pageSizes: { [key: string]: string },
        query: string,
        oldOffset: number,
    }
}

const getGalleryHTML = (data: IAVGallery, selectItemIds: string[], editIds: string[]) => {
    let galleryHTML = "";
    // body
    data.cards.forEach((item: IAVGalleryItem, rowIndex: number) => {
        galleryHTML += `<div data-id="${item.id}" draggable="true" class="av__gallery-item${selectItemIds.includes(item.id) ? " av__gallery-item--select" : ""}">`;
        if (data.coverFrom !== 0) {
            const coverClass = "av__gallery-cover av__gallery-cover--" + data.cardAspectRatio;
            if (item.coverURL) {
                if (item.coverURL.startsWith("background")) {
                    galleryHTML += `<div class="${coverClass}"><img class="av__gallery-img" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" style="${item.coverURL}"></div>`;
                } else {
                    galleryHTML += `<div class="${coverClass}"><img loading="lazy" class="av__gallery-img${data.fitImage ? " av__gallery-img--fit" : ""}" src="${getCompressURL(item.coverURL)}"></div>`;
                }
            } else if (item.coverContent) {
                galleryHTML += `<div class="${coverClass}"><div class="av__gallery-content">${item.coverContent}</div><div></div></div>`;
            } else {
                galleryHTML += `<div class="${coverClass}"></div>`;
            }
        }
        galleryHTML += `<div class="av__gallery-fields${editIds.includes(item.id) ? " av__gallery-fields--edit" : ""}">`;
        item.values.forEach((cell, fieldsIndex) => {
            if (data.fields[fieldsIndex].hidden) {
                return;
            }
            let checkClass = "";
            if (cell.valueType === "checkbox") {
                checkClass = cell.value?.checkbox?.checked ? " av__cell-check" : " av__cell-uncheck";
            }
            const isEmpty = cellValueIsEmpty(cell.value);
            // NOTE: innerHTML 中不能换行否则 https://github.com/siyuan-note/siyuan/issues/15132
            let ariaLabel = escapeAttr(data.fields[fieldsIndex].name) || getColNameByType(data.fields[fieldsIndex].type);
            if (data.fields[fieldsIndex].desc) {
                ariaLabel += escapeAttr(`<div class="ft__on-surface">${data.fields[fieldsIndex].desc}</div>`);
            }
            if (cell.valueType === "checkbox") {
                cell.value["checkbox"].content = data.fields[fieldsIndex].name || getColNameByType(data.fields[fieldsIndex].type);
            }
            galleryHTML += `<div class="av__cell${checkClass} ariaLabel" data-wrap="${data.fields[fieldsIndex].wrap}" 
data-empty="${isEmpty}" 
aria-label="${ariaLabel}" 
data-position="5west"
data-id="${cell.id}" 
data-field-id="${data.fields[fieldsIndex].id}"
${cell.valueType === "block" ? 'data-block-id="' + (cell.value.block.id || "") + '"' : ""} 
data-dtype="${cell.valueType}" 
${cell.value?.isDetached ? ' data-detached="true"' : ""} 
style="${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${cell.color ? `color:${cell.color};` : ""}">${renderCell(cell.value, rowIndex, data.showIcon, "gallery")}<div class="av__gallery-tip">${data.fields[fieldsIndex].icon ? unicode2Emoji(data.fields[fieldsIndex].icon, undefined, true) : `<svg><use xlink:href="#${getColIconByType(data.fields[fieldsIndex].type)}"></use></svg>`}${window.siyuan.languages.edit} ${Lute.EscapeHTMLStr(data.fields[fieldsIndex].name)}</div></div>`;
        });
        galleryHTML += `</div>
    <div class="av__gallery-actions">
        <span class="protyle-icon protyle-icon--first b3-tooltips b3-tooltips__n" aria-label="${window.siyuan.languages.displayEmptyFields}" data-type="av-gallery-edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
        <span class="protyle-icon protyle-icon--last b3-tooltips b3-tooltips__n" aria-label="${window.siyuan.languages.more}" data-type="av-gallery-more"><svg><use xlink:href="#iconMore"></use></svg></span>
    </div>
</div>`;
    });
    galleryHTML += `<div class="av__gallery-add" data-type="av-add-bottom"><svg class="svg"><use xlink:href="#iconAdd"></use></svg><span class="fn__space"></span>${window.siyuan.languages.newRow}</div>`;
    return `<div class="av__gallery${data.cardSize === 0 ? " av__gallery--small" : (data.cardSize === 2 ? " av__gallery--big" : "")}">
    ${galleryHTML}
</div>
<div class="av__gallery-load${data.cardCount > data.cards.length ? "" : " fn__none"}">
    <button class="b3-button av__button" data-type="av-load-more">
        <svg><use xlink:href="#iconArrowDown"></use></svg>
        <span>${window.siyuan.languages.loadMore}</span>
        <svg data-type="set-page-size" data-size="${data.pageSize}"><use xlink:href="#iconMore"></use></svg>
    </button>
</div>`;
};

const renderGroupGallery = (options: ITableOptions) => {
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement;
    const isSearching = searchInputElement && document.activeElement === searchInputElement;
    const query = searchInputElement?.value || "";

    let avBodyHTML = "";
    options.data.view.groups.forEach((group: IAVGallery) => {
        if (group.groupHidden === 0) {
            group.fields = (options.data.view as IAVGallery).fields;
            avBodyHTML += `${getGroupTitleHTML(group, group.fields.length)}
<div data-group-id="${group.id}" data-page-size="${group.pageSize}" class="av__body${group.groupFolded ? " fn__none" : ""}">${getGalleryHTML(group, options.resetData.selectItemIds, options.resetData.editIds)}</div>`;
        }
    });
    if (options.renderAll) {
        options.blockElement.firstElementChild.outerHTML = `<div class="av__container fn__block">
    ${genTabHeaderHTML(options.data, isSearching || !!query, !options.protyle.disabled && !hasClosestByAttribute(options.blockElement, "data-type", "NodeBlockQueryEmbed"))}
    <div>
        ${avBodyHTML}
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`;
    } else {
        options.blockElement.querySelector(".av__header").nextElementSibling.innerHTML = avBodyHTML;
    }
    afterRenderGallery(options);
};

const afterRenderGallery = (options: ITableOptions) => {
    const view = options.data.view as IAVGallery;
    if (view.coverFrom === 1 || view.coverFrom === 3) {
        processRender(options.blockElement);
    }
    if (typeof options.resetData.oldOffset === "number") {
        options.protyle.contentElement.scrollTop = options.resetData.oldOffset;
    }
    options.blockElement.setAttribute("data-render", "true");
    if (options.resetData.alignSelf) {
        options.blockElement.style.alignSelf = options.resetData.alignSelf;
    }
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

export const renderGallery = async (options: {
    blockElement: HTMLElement,
    protyle: IProtyle,
    cb?: (data: IAV) => void,
    renderAll: boolean,
    data?: IAV,
}) => {
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement;
    const editIds: string[] = [];
    options.blockElement.querySelectorAll(".av__gallery-fields--edit").forEach(item => {
        editIds.push(item.parentElement.getAttribute("data-id"));
    });
    const selectItemIds: string[] = [];
    options.blockElement.querySelectorAll(".av__gallery-item--select").forEach(rowItem => {
        const rowId = rowItem.getAttribute("data-id");
        if (rowId) {
            selectItemIds.push(rowId);
        }
    });
    const pageSizes: { [key: string]: string } = {};
    options.blockElement.querySelectorAll(".av__body").forEach((item: HTMLElement) => {
        pageSizes[item.dataset.groupId || "unGroup"] = item.dataset.pageSize;
    });
    const resetData = {
        isSearching: searchInputElement && document.activeElement === searchInputElement,
        query: searchInputElement?.value || "",
        alignSelf: options.blockElement.style.alignSelf,
        oldOffset: options.protyle.contentElement.scrollTop,
        editIds,
        selectItemIds,
        pageSizes,
    };
    if (options.blockElement.firstElementChild.innerHTML === "") {
        options.blockElement.style.alignSelf = "";
        options.blockElement.firstElementChild.outerHTML = `<div class="av__gallery">
    <span style="width: 100%;height: 178px;" class="av__pulse"></span>
    <span style="width: 100%;height: 178px;" class="av__pulse"></span>
    <span style="width: 100%;height: 178px;" class="av__pulse"></span>
</div>`;
    }
    const created = options.protyle.options.history?.created;
    const snapshot = options.protyle.options.history?.snapshot;

    let data: IAV = options.data;
    if (!data) {
        const avPageSize = getPageSize(options.blockElement);
        const response = await fetchSyncPost(created ? "/api/av/renderHistoryAttributeView" : (snapshot ? "/api/av/renderSnapshotAttributeView" : "/api/av/renderAttributeView"), {
            id: options.blockElement.getAttribute("data-av-id"),
            created,
            snapshot,
            pageSize: avPageSize.unGroupPageSize,
            groupPaging: avPageSize.groupPageSize,
            viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
            query: resetData.query.trim()
        });
        data = response.data;
    }
    if (data.viewType === "table") {
        options.blockElement.setAttribute("data-av-type", "table");
        avRender(options.blockElement, options.protyle, options.cb, options.renderAll);
        return;
    }
    const view: IAVGallery = data.view as IAVGallery;
    if (view.groups?.length > 0) {
        renderGroupGallery({
            blockElement: options.blockElement,
            protyle: options.protyle,
            cb: options.cb,
            renderAll: options.renderAll,
            data,
            resetData
        });
        return;
    }
    const bodyHTML = getGalleryHTML(view, selectItemIds, editIds);
    if (options.renderAll) {
        options.blockElement.firstElementChild.outerHTML = `<div class="av__container fn__block">
    ${genTabHeaderHTML(data, resetData.isSearching || !!resetData.query, !options.protyle.disabled && !hasClosestByAttribute(options.blockElement, "data-type", "NodeBlockQueryEmbed"))}
    <div>
        <div class="av__body" data-page-size="${view.pageSize}">
            ${bodyHTML}
        </div>
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`;
    } else {
        const bodyElement = options.blockElement.querySelector(".av__body") as HTMLElement;
        bodyElement.innerHTML = bodyHTML;
        bodyElement.dataset.pageSize = view.pageSize.toString();
    }
    afterRenderGallery({
        resetData,
        renderAll: options.renderAll,
        data,
        cb: options.cb,
        protyle: options.protyle,
        blockElement: options.blockElement,
    });
    if (view.hideAttrViewName) {
        options.blockElement.querySelector(".av__gallery").classList.add("av__gallery--top");
    }
};
