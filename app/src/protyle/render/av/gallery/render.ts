import {afterRenderCards, captureAVCardRenderState, getAVCardHTML} from "../cardLayout";
import type {IAVCardRenderOptions} from "../renderState";
import {escapeHtmlTextAndAttr} from "../../../../util/escape";
import {isTableLikeView} from "../viewType";
import {isAVRenderData} from "../renderData";

import {Constants} from "../../../../constants";
import {fetchSyncPost} from "../../../../util/fetch";

import {avRender, genTabHeaderHTML, getGroupTitleHTML} from "../render";

import {getPageSize} from "../groups";
import {renderKanban} from "../kanban/render";

import {applyAVRenderContext, beginAVRender, failAVRender, getAVLocateParams, isCurrentAVRender, persistAVLocateView, prepareAVLocate} from "../locate";

import {setGroupFoldedStates} from "../groupFold";
import {getPublishAVView} from "../publishState";
import {getReadonlyAVView} from "../readonlyState";

import {replaceAVContainer} from "../container";

const renderGroupGallery = (options: IAVCardRenderOptions) => {
    setGroupFoldedStates(options.blockElement, options.data.view.groups);
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]');
    const isSearching = searchInputElement && document.activeElement === searchInputElement;
    const query = searchInputElement?.textContent || "";

    let avBodyHTML = "";
    options.data.view.groups.forEach((group: IAVGallery) => {
        if (group.groupHidden === 0) {
            avBodyHTML += `${getGroupTitleHTML(group, group.cardCount)}
<div data-group-id="${group.id}" data-page-size="${group.pageSize}" data-dtype="${group.groupKey.type}" data-content="${escapeHtmlTextAndAttr(group.groupValue.text?.content || "")}"${options.resetData.virtualData[group.id]?.locate ? ' data-av-locate-window="true"' : ""} class="av__body${group.groupFolded ? " fn__none" : ""}">${getAVCardHTML("gallery", group, options.blockElement, options.resetData.virtualData[group.id])}</div>`;
        }
    });
    if (options.renderAll) {
        replaceAVContainer(options.blockElement, `<div class="av__container fn__block">
    ${genTabHeaderHTML(options.data, isSearching || !!query, !options.protyle.disabled, options.blockElement)}
    <div>
        ${avBodyHTML}
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`);
    } else {
        options.blockElement.querySelector(".av__header").nextElementSibling.innerHTML = avBodyHTML;
    }
    afterRenderCards(options);
};

export const renderGallery = async (options: {
    blockElement: HTMLElement,
    protyle: IProtyle,
    cb?: (data: IAV) => void,
    renderAll: boolean,
    data?: IAV,
}) => {
    const renderToken = beginAVRender(options.blockElement);
    const resetData = captureAVCardRenderState(options, "gallery");
    const virtualData = resetData.virtualData;
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
        const standalone = options.protyle.block.action?.includes(Constants.CB_GET_AV_NO_CREATE);
        const avPageSize = getPageSize(options.blockElement);
        const locateParams = getAVLocateParams(options.blockElement, !created && !snapshot);
        const common = {
            id: options.blockElement.getAttribute("data-av-id"),
            blockID: standalone ? "" : options.blockElement.getAttribute("data-node-id"),
            viewID: locateParams?.viewID || (window.siyuan.isPublish ? getPublishAVView(options.blockElement) :
                options.protyle.disabled ? getReadonlyAVView(options.blockElement) : ""),
        };
        const paging = {
            pageSize: avPageSize.unGroupPageSize,
            groupPaging: avPageSize.groupPageSize,
            query: resetData.query.trim(),
        };
        const carrierViewID = options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "";
        const response = await (created ? fetchSyncPost("/api/av/renderHistoryAttributeView", {
            ...common, ...paging, created, carrierViewID,
        }, undefined, false) : snapshot ? fetchSyncPost("/api/av/renderSnapshotAttributeView", {
            ...common, snapshot, carrierViewID,
        }, undefined, false) : fetchSyncPost("/api/av/renderAttributeView", {
            ...common, ...paging,
            initialLayout: options.blockElement.getAttribute("data-av-type"),
            createIfNotExist: !window.siyuan.isPublish && !standalone,
            targetItemID: locateParams?.targetItemID || "",
            targetGroupID: locateParams?.targetGroupID || "",
        }, undefined, false));
        if (!isCurrentAVRender(options.blockElement, renderToken)) {
            return;
        }
        if (response.code !== 0 || !isAVRenderData(response.data)) {
            if (failAVRender(options.blockElement, response)) {
                await renderGallery(options);
            }
            return;
        }
        data = response.data;
    }
    if (!isCurrentAVRender(options.blockElement, renderToken)) {
        return;
    }
    if (persistAVLocateView(options.blockElement, options.protyle, data)) {
        return;
    }
    applyAVRenderContext(options.blockElement, data);
    prepareAVLocate(options.blockElement, data, resetData);
    if (isTableLikeView(data.viewType) || data.viewType === "calendar") {
        avRender(options.blockElement, options.protyle, options.cb, options.renderAll, data);
        return;
    }
    if (data.viewType === "kanban") {
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
    const bodyHTML = getAVCardHTML("gallery", view, options.blockElement, virtualData.all);
    if (options.renderAll) {
        replaceAVContainer(options.blockElement, `<div class="av__container fn__block">
    ${genTabHeaderHTML(data, resetData.isSearching || !!resetData.query, !options.protyle.disabled, options.blockElement)}
    <div>
        <div class="av__body" data-group-id="" data-page-size="${view.pageSize}"${virtualData.all?.locate ? ' data-av-locate-window="true"' : ""}>
            ${bodyHTML}
        </div>
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`);
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
    afterRenderCards({
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
