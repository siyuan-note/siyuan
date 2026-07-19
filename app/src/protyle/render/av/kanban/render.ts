import {hasClosestByAttribute, hasClosestByClassName} from "../../../util/hasClosest";
import {getPageSize} from "../groups";
import {fetchSyncPost} from "../../../../util/fetch";
import {Constants} from "../../../../constants";
import {avRender, genTabHeaderHTML} from "../render";
import {afterRenderGallery, renderGallery} from "../gallery/render";
import {escapeHtml} from "../../../../util/escape";
import {getRowHTML} from "../row";
import {getBodyVirtualData} from "../virtualScroll";
import {beginAVRender, getAVLocateParams, isCurrentAVRender, prepareAVLocate} from "../locate";

interface IIds {
    groupId: string,
    fieldId: string,
}

const getKanbanTitleHTML = (group: IAVView, counter: number) => {
    let nameHTML = "";
    if (["mSelect", "select"].includes(group.groupValue.type)) {
        group.groupValue.mSelect.forEach((item) => {
            nameHTML += `<span class="b3-chip" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${escapeHtml(item.content)}</span>`;
        });
    } else if (group.groupValue.type === "checkbox") {
        nameHTML = `<svg style="width:calc(1.625em - 12px);height:calc(1.625em - 12px);margin: 4px 0;float: left;"><use xlink:href="#icon${group.groupValue.checkbox.checked ? "Check" : "Uncheck"}"></use></svg>`;
    } else {
        nameHTML = group.name;
    }
    // av__group-name 为第三方需求，本应用内没有使用，但不能移除 https://github.com/siyuan-note/siyuan/issues/15736
    return `<div class="av__group-title">
    <span class="av__group-name fn__ellipsis" style="white-space: nowrap;">${nameHTML}</span>
    ${(!counter || counter === 0) ? '<span class="fn__space"></span>' : `<span aria-label="${window.siyuan.languages.entryNum}" data-position="north" class="av__group-counter ariaLabel">${counter}</span>`}
    <span class="fn__flex-1"></span>
    <span class="av__group-icon av__group-icon--hover ariaLabel" data-type="av-add-top" data-position="north" aria-label="${window.siyuan.languages.newRow}"><svg><use xlink:href="#iconAdd"></use></svg></span>
</div>`;
};

const getKanbanHTML = (data: IAVKanban, e: HTMLElement, virtualData: IAVVirtualData) => {
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
        galleryHTML += getRowHTML({data, row: item, rowIndex: rowIndex + (virtualData?.rowOffset || 0), type: "kanban"});
        return false;
    });
    galleryHTML += `<div class="av__gallery-add" data-type="av-add-bottom"><svg class="svg"><use xlink:href="#iconAdd"></use></svg><span class="fn__space"></span>${window.siyuan.languages.newRow}</div>`;
    return `<div class="av__gallery av__gallery--small">
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

export const renderKanban = async (options: {
    blockElement: HTMLElement,
    protyle: IProtyle,
    cb?: (data: IAV) => void,
    renderAll: boolean,
    data?: IAV,
}) => {
    const renderToken = beginAVRender(options.blockElement);
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement;
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
        virtualData[item.getAttribute("data-group-id")] = getBodyVirtualData(item, ".av__gallery-add", firstItemIndex);
    });
    const resetData = {
        isSearching: searchInputElement && document.activeElement === searchInputElement,
        query: searchInputElement?.value || "",
        alignSelf: options.blockElement.style.alignSelf,
        oldOffset: options.protyle.contentElement.scrollTop,
        editIds,
        selectItemIds,
        pageSizes,
        left: options.blockElement.querySelector(".av__kanban")?.scrollLeft,
        virtualData
    };
    if (options.blockElement.firstElementChild.innerHTML === "") {
        options.blockElement.style.alignSelf = "";
        options.blockElement.firstElementChild.outerHTML = `<div class="av__kanban fn__flex">
    <span style="width: 260px;height: 178px;" class="av__pulse"></span>
    <span style="width: 260px;height: 178px;" class="av__pulse"></span>
    <span style="width: 260px;height: 178px;" class="av__pulse"></span>
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
        options.blockElement.setAttribute("data-av-type", "table");
        avRender(options.blockElement, options.protyle, options.cb, options.renderAll, data);
        return;
    }
    if (data.viewType === "gallery") {
        options.blockElement.setAttribute("data-av-type", data.viewType);
        renderGallery({
            blockElement: options.blockElement,
            protyle: options.protyle,
            cb: options.cb,
            renderAll: options.renderAll,
            data
        });
        return;
    }
    const view = data.view as IAVKanban;
    let bodyHTML = "";
    let isSelectGroup = false;
    view.groups.forEach((group: IAVKanban) => {
        if (group.groupHidden === 0) {
            let selectBg = "";
            if (group.fillColBackgroundColor) {
                if (["mSelect", "select"].includes(group.groupValue.type)) {
                    isSelectGroup = true;
                }
                if (isSelectGroup) {
                    if (group.groupValue.mSelect && group.groupValue.mSelect.length > 0) {
                        selectBg = `style="--b3-av-kanban-background: var(--b3-font-background${group.groupValue.mSelect[0].color});"`;
                    } else {
                        selectBg = 'style="--b3-av-kanban-background: var(--b3-border-color);"';
                    }
                }
            }
            bodyHTML += `<div class="av__kanban-group${group.cardSize === 0 ? " av__kanban-group--small" : (group.cardSize === 2 ? " av__kanban-group--big" : "")}"${selectBg}>
    ${getKanbanTitleHTML(group, group.cardCount)}
    <div data-group-id="${group.id}" data-page-size="${group.pageSize}" data-dtype="${group.groupKey.type}" data-content="${Lute.EscapeHTMLStr(group.groupValue.text?.content || "")}"${virtualData[group.id]?.locate ? ' data-av-locate-window="true"' : ""} class="av__body">${getKanbanHTML(group, options.blockElement, virtualData[group.id])}</div>
</div>`;
        }
    });
    if (options.renderAll) {
        options.blockElement.firstElementChild.outerHTML = `<div class="av__container fn__block">
    ${genTabHeaderHTML(data, resetData.isSearching || !!resetData.query, !options.protyle.disabled && !hasClosestByAttribute(options.blockElement, "data-type", "NodeBlockQueryEmbed"))}
    <div class="av__kanban${isSelectGroup ? " av__kanban--bg" : ""}">
        ${bodyHTML}
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`;
    } else {
        const kanbanElement = options.blockElement.querySelector(".av__kanban");
        kanbanElement.innerHTML = bodyHTML;
        if (isSelectGroup) {
            kanbanElement.classList.add("av__kanban--bg");
        } else {
            kanbanElement.classList.remove("av__kanban--bg");
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
