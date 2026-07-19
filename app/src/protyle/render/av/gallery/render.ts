import {hasClosestBlock, hasClosestByClassName} from "../../../util/hasClosest";
import {Constants} from "../../../../constants";
import {fetchSyncPost} from "../../../../util/fetch";
import {focusBlock} from "../../../util/selection";
import {avRender, genTabHeaderHTML, getGroupTitleHTML, updateSearch} from "../render";
import {bindAvSearch} from "../search";
import {processRender} from "../../../util/processCode";
import {getPageSize} from "../groups";
import {renderKanban} from "../kanban/render";
import {getBodyVirtualData, initVirtualScroll} from "../virtualScroll";
import {getRowHTML, updateHeader} from "../row";
import {beginAVRender, finishAVLocate, getAVLocateParams, isCurrentAVRender, prepareAVLocate} from "../locate";

interface IIds {
    groupId: string,
    fieldId: string,
}

interface ITableOptions {
    protyle: IProtyle,
    blockElement: HTMLElement,
    cb: (data: IAV) => void,
    data: IAV,
    renderAll: boolean,
    resetData: {
        alignSelf: string,
        selectItemIds: IIds[],
        editIds: IIds[],
        isSearching: boolean,
        pageSizes: { [key: string]: string },
        query: string,
        oldOffset: number,
        left?: number,
        virtualData: { [key: string]: IAVVirtualData },
    }
}

const getGalleryHTML = (data: IAVGallery, e: HTMLElement, virtualData: IAVVirtualData) => {
    let galleryHTML = "";
    // body
    data.cards.find((item: IAVGalleryItem, rowIndex: number) => {
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
        galleryHTML += getRowHTML({data, row: item, rowIndex: rowIndex + (virtualData?.rowOffset || 0), type: "gallery"});
        return false;
    });
    galleryHTML += `<div class="av__gallery-add" data-type="av-add-bottom"><svg class="svg"><use xlink:href="#iconAdd"></use></svg><span class="fn__space"></span>${window.siyuan.languages.newRow}</div>`;
    return `<div class="av__gallery${data.cardSize === 0 ? " av__gallery--small" : (data.cardSize === 2 ? " av__gallery--big" : "")}">
    ${virtualData?.topSpacerHeight ? `<div class="av__spacer" style="height: ${virtualData.topSpacerHeight}px;"></div>` : ""}${galleryHTML}
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
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]');
    const isSearching = searchInputElement && document.activeElement === searchInputElement;
    const query = searchInputElement?.textContent || "";

    let avBodyHTML = "";
    options.data.view.groups.forEach((group: IAVGallery) => {
        if (group.groupHidden === 0) {
            avBodyHTML += `${getGroupTitleHTML(group, group.cardCount)}
<div data-group-id="${group.id}" data-page-size="${group.pageSize}" data-dtype="${group.groupKey.type}" data-content="${Lute.EscapeHTMLStr(group.groupValue.text?.content || "")}"${options.resetData.virtualData[group.id]?.locate ? ' data-av-locate-window="true"' : ""} class="av__body${group.groupFolded ? " fn__none" : ""}">${getGalleryHTML(group, options.blockElement, options.resetData.virtualData[group.id])}</div>`;
        }
    });
    if (options.renderAll) {
        options.blockElement.firstElementChild.outerHTML = `<div class="av__container fn__block">
    ${genTabHeaderHTML(options.data, isSearching || !!query, !options.protyle.disabled)}
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

export const afterRenderGallery = (options: ITableOptions) => {
    const view = options.data.view as IAVGallery;
    if (view.coverFrom === 1 || view.coverFrom === 3) {
        processRender(options.blockElement);
    }
    if (typeof options.resetData.oldOffset === "number") {
        options.protyle.contentElement.scrollTop = options.resetData.oldOffset;
    }
    if (options.blockElement.getAttribute("data-need-focus") === "true") {
        focusBlock(options.blockElement);
        options.blockElement.removeAttribute("data-need-focus");
    }
    options.blockElement.setAttribute("data-render", "true");
    if (options.resetData.alignSelf) {
        options.blockElement.style.alignSelf = options.resetData.alignSelf;
    }
    if (options.resetData.left) {
        options.blockElement.querySelector(".av__kanban").scrollLeft = options.resetData.left;
    }
    options.resetData.selectItemIds.find(selectId => {
        let itemElement = options.blockElement.querySelector(`.av__body[data-group-id="${selectId.groupId}"] .av__gallery-item[data-id="${selectId.fieldId}"]`) as HTMLElement;
        if (!itemElement) {
            itemElement = options.blockElement.querySelector(`.av__gallery-item[data-id="${selectId.fieldId}"]`) as HTMLElement;
        }
        if (itemElement) {
            itemElement.classList.add("av__gallery-item--select");
        }
    });
    // 重渲后恢复的选中态需刷新计数器显示
    const restoredItem = options.blockElement.querySelector(".av__gallery-item--select") as HTMLElement;
    if (restoredItem) {
        updateHeader(restoredItem);
    }
    options.resetData.editIds.find(selectId => {
        let itemElement = options.blockElement.querySelector(`.av__body[data-group-id="${selectId.groupId}"] .av__gallery-item[data-id="${selectId.fieldId}"]`) as HTMLElement;
        if (!itemElement) {
            itemElement = options.blockElement.querySelector(`.av__gallery-item[data-id="${selectId.fieldId}"]`) as HTMLElement;
        }
        if (itemElement) {
            itemElement.querySelector(".av__gallery-fields").classList.add("av__gallery-fields--edit");
            itemElement.querySelector('.protyle-icon[data-type="av-gallery-edit"]').setAttribute("aria-label", window.siyuan.languages.hideEmptyFields);
        }
    });
    Object.keys(options.resetData.pageSizes).forEach((groupId) => {
        const bodyElement = options.blockElement.querySelector(`.av__body[data-group-id="${groupId === "unGroup" ? "" : groupId}"]`) as HTMLElement;
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
        finishAVLocate(options.blockElement, options.protyle, options.data);
        return;
    }
    bindAvSearch({
        blockElement: options.blockElement,
        query: options.resetData.query,
        isSearching: options.resetData.isSearching,
        onChange: () => updateSearch(options.blockElement, options.protyle),
    });
    initVirtualScroll(options);
    finishAVLocate(options.blockElement, options.protyle, options.data);
};

export const renderGallery = async (options: {
    blockElement: HTMLElement,
    protyle: IProtyle,
    cb?: (data: IAV) => void,
    renderAll: boolean,
    data?: IAV,
}) => {
    const renderToken = beginAVRender(options.blockElement);
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]');
    const editIds: IIds[] = [];
    options.blockElement.querySelectorAll(".av__gallery-fields--edit").forEach(item => {
        editIds.push({
            groupId: (hasClosestByClassName(item, "av__body") as HTMLElement).dataset.groupId || "",
            fieldId: item.parentElement.getAttribute("data-id"),
        });
    });
    const selectItemIds: IIds[] = [];
    options.blockElement.querySelectorAll(".av__gallery-item--select").forEach(galleryItem => {
        const fieldId = galleryItem.getAttribute("data-id");
        if (fieldId) {
            selectItemIds.push({
                groupId: (hasClosestByClassName(galleryItem, "av__body") as HTMLElement).dataset.groupId || "",
                fieldId
            });
        }
    });
    const pageSizes: { [key: string]: string } = {};
    const virtualData: { [key: string]: IAVVirtualData } = {};
    options.blockElement.querySelectorAll(".av__body").forEach((item: HTMLElement) => {
        pageSizes[item.dataset.groupId || "unGroup"] = item.dataset.pageSize;
        if (item.dataset.avLocateWindow === "true") {
            return;
        }
        if (!item.querySelector(".av__gallery-item") || options.blockElement.getAttribute(Constants.ATTRIBUTE_V_SCROLL) !== "true") {
            return;
        }
        // 守卫只保证至少 1 个 .av__gallery-item，但首行索引用 :not([data-type=ghost]) 过滤。
        // body 内全是 ghost 占位行（插入动画进行中）时查询返回 null，需跳过避免解引用 null.getAttribute
        const firstItem = item.querySelector(".av__gallery-item:not([data-type=ghost])") as HTMLElement;
        if (!firstItem) {
            return;
        }
        const firstItemIndex = parseInt(firstItem.getAttribute("data-index"));
        virtualData[item.getAttribute("data-group-id") || "all"] = getBodyVirtualData(item, ".av__gallery-add", firstItemIndex);
    });
    const resetData = {
        isSearching: searchInputElement && document.activeElement === searchInputElement,
        query: searchInputElement?.textContent || "",
        alignSelf: options.blockElement.style.alignSelf,
        oldOffset: options.protyle.contentElement.scrollTop,
        editIds,
        selectItemIds,
        pageSizes,
        virtualData
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
        const locateParams = getAVLocateParams(options.blockElement, !created && !snapshot);
        const response = await fetchSyncPost(created ? "/api/av/renderHistoryAttributeView" : (snapshot ? "/api/av/renderSnapshotAttributeView" : "/api/av/renderAttributeView"), {
            id: options.blockElement.getAttribute("data-av-id"),
            created,
            snapshot,
            pageSize: avPageSize.unGroupPageSize,
            groupPaging: avPageSize.groupPageSize,
            viewID: locateParams?.viewID || options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
            query: resetData.query.trim(),
            blockID: options.blockElement.getAttribute("data-node-id"),
            targetItemID: locateParams?.targetItemID || "",
            targetGroupID: locateParams?.targetGroupID || "",
        });
        data = response.data;
    }
    if (!isCurrentAVRender(options.blockElement, renderToken)) {
        return;
    }
    prepareAVLocate(options.blockElement, data, resetData);
    if (data.viewType === "table") {
        options.blockElement.setAttribute("data-av-type", data.viewType);
        avRender(options.blockElement, options.protyle, options.cb, options.renderAll, data);
        return;
    }
    if (data.viewType === "kanban") {
        options.blockElement.setAttribute("data-av-type", data.viewType);
        renderKanban({
            blockElement: options.blockElement,
            protyle: options.protyle,
            cb: options.cb,
            renderAll: options.renderAll,
            data
        });
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
    const bodyHTML = getGalleryHTML(view, options.blockElement, virtualData.all);
    if (options.renderAll) {
        options.blockElement.firstElementChild.outerHTML = `<div class="av__container fn__block">
    ${genTabHeaderHTML(data, resetData.isSearching || !!resetData.query, !options.protyle.disabled)}
    <div>
        <div class="av__body" data-group-id="" data-page-size="${view.pageSize}"${virtualData.all?.locate ? ' data-av-locate-window="true"' : ""}>
            ${bodyHTML}
        </div>
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`;
    } else {
        const bodyElement = options.blockElement.querySelector(".av__body") as HTMLElement;
        bodyElement.innerHTML = bodyHTML;
        bodyElement.dataset.pageSize = view.pageSize.toString();
        if (virtualData.all?.locate) {
            bodyElement.dataset.avLocateWindow = "true";
        } else {
            bodyElement.removeAttribute("data-av-locate-window");
        }
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
