import type {IAVCardRenderOptions, IAVCardRenderState, IAVRenderItemID} from "./renderState";
import {Constants} from "../../../constants";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {focusBlock} from "../../util/selection";
import {getPendingBlockFocusMode} from "../../util/focusRestore";
import {getRowHTML, stickyRow, updateAVSelectionStatus, updateHeader} from "./row";
import {getCardStyle} from "./gallery/style";
import {getAVSelectedItemPoints, getBodyVirtualData, initVirtualScroll, setAVData} from "./virtualScroll";
import {processRender} from "../../util/processCode";
import {renderAVRichTextElements} from "./richText";
import {bindAvSearch} from "./search";
import {updateSearch} from "./render";
import {finishAVLocate} from "./locate";

export const getAVCardHTML = (type: "gallery" | "kanban", data: IAVGallery | IAVKanban, e: HTMLElement, virtualData: IAVVirtualData) => {
    let galleryHTML = "";
    // 两种卡片布局共用行生成、虚拟窗口和加载更多控件。
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
        galleryHTML += getRowHTML({data, row: item, rowIndex: rowIndex + (virtualData?.rowOffset || 0), type});
        return false;
    });
    galleryHTML += `<div class="av__gallery-add" data-type="av-add-bottom"><svg class="svg"><use xlink:href="#iconAdd"></use></svg><span class="fn__space"></span>${window.siyuan.languages.newRow}</div>`;
    return `<div class="av__gallery${type === "kanban" || data.cardSize === 0 ? " av__gallery--small" : (data.cardSize === 2 ? " av__gallery--big" : "")}"${type === "gallery" ? ` style="${getCardStyle(data)}"` : ""}>
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

export const captureAVCardRenderState = (options: {blockElement: HTMLElement, protyle: IProtyle},
                                         type: "gallery" | "kanban"): IAVCardRenderState => {
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]');
    const editIds: IAVRenderItemID[] = [];
    options.blockElement.querySelectorAll(".av__gallery-fields--edit").forEach(item => {
        editIds.push({
            groupId: (hasClosestByClassName(item, "av__body") as HTMLElement).dataset.groupId || "",
            fieldId: item.parentElement.getAttribute("data-id"),
        });
    });
    const selectItemIds: IAVRenderItemID[] = getAVSelectedItemPoints(options.blockElement).map(item => ({
        groupId: item.groupID,
        fieldId: item.itemID,
    }));
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
        const groupID = item.getAttribute("data-group-id");
        virtualData[type === "gallery" ? (groupID || "all") : groupID] =
            getBodyVirtualData(item, ".av__gallery-add", firstItemIndex);
    });
    return {
        isSearching: searchInputElement && document.activeElement === searchInputElement,
        query: searchInputElement?.textContent || "",
        alignSelf: options.blockElement.style.alignSelf,
        oldOffset: options.protyle.contentElement.scrollTop,
        editIds,
        selectItemIds,
        pageSizes,
        ...(type === "kanban" ? {left: options.blockElement.querySelector(".av__kanban")?.scrollLeft} : {}),
        virtualData
    };
};

export const afterRenderCards = (options: IAVCardRenderOptions) => {
    setAVData(options.blockElement, options.data);
    const view = options.data.view as IAVGallery;
    options.blockElement.classList.toggle("av--display-empty-fields", view.displayEmptyFields);
    if (view.coverFrom === 1 || view.coverFrom === 3) {
        processRender(options.blockElement);
    }
    renderAVRichTextElements(options.blockElement);
    if (typeof options.resetData.oldOffset === "number") {
        options.protyle.contentElement.scrollTop = options.resetData.oldOffset;
    }
    const pendingFocusMode = getPendingBlockFocusMode(options.blockElement.getAttribute("data-need-focus"));
    if (pendingFocusMode) {
        focusBlock(options.blockElement, undefined, true, pendingFocusMode === "zoom");
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
    if (!view.displayEmptyFields) {
        options.resetData.editIds.find(selectId => {
            let itemElement = options.blockElement.querySelector(`.av__body[data-group-id="${selectId.groupId}"] .av__gallery-item[data-id="${selectId.fieldId}"]`) as HTMLElement;
            if (!itemElement) {
                itemElement = options.blockElement.querySelector(`.av__gallery-item[data-id="${selectId.fieldId}"]`) as HTMLElement;
            }
            if (itemElement) {
                itemElement.querySelector(".av__gallery-fields").classList.add("av__gallery-fields--edit");
                itemElement.querySelector('.protyle-icon[data-type="av-gallery-edit"]')?.setAttribute("aria-label", window.siyuan.languages.hideEmptyFields);
            }
        });
    }
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
    if (options.cb) {
        options.cb(options.data);
    }
    initVirtualScroll({
        ...options,
        selectedItemPoints: options.resetData.selectItemIds.map(item => ({
            groupID: item.groupId,
            itemID: item.fieldId,
        })),
    });
    updateAVSelectionStatus(options.blockElement);
    if (!options.renderAll) {
        finishAVLocate(options.blockElement, options.protyle, options.data);
        return;
    }
    setTimeout(() => {
        stickyRow(options.blockElement, options.protyle.contentElement, "top");
    }, Constants.TIMEOUT_LOAD);
    bindAvSearch({
        blockElement: options.blockElement,
        query: options.resetData.query,
        isSearching: options.resetData.isSearching,
        onChange: () => updateSearch(options.blockElement, options.protyle),
    });
    finishAVLocate(options.blockElement, options.protyle, options.data);
};
