import {afterRenderCards, captureAVCardRenderState, getAVCardHTML} from "../cardLayout";
import {isAVDateType, isAVSelectType} from "../capabilities";
import {isTableLikeView} from "../viewType";
import {isAVRenderData} from "../renderData";
import {getPublishAVView} from "../publishState";
import {getReadonlyAVView} from "../readonlyState";
import {hasClosestByAttribute} from "../../../util/hasClosest";
import {getPageSize} from "../groups";
import {fetchSyncPost} from "../../../../util/fetch";
import {Constants} from "../../../../constants";
import {avRender, genTabHeaderHTML} from "../render";
import {replaceAVContainer} from "../container";
import {renderGallery} from "../gallery/render";
import {escapeAttr, escapeHtml, escapeHtmlTextAndAttr} from "../../../../util/escape";

import {
    applyAVRenderContext,
    beginAVRender,
    failAVRender,
    getAVLocateParams,
    isCurrentAVRender,
    persistAVLocateView,
    prepareAVLocate
} from "../locate";
import {getCardStyle} from "../gallery/style";
import {getAVBackgroundColor, getAVColorStyle} from "../color";

const getKanbanTitleHTML = (group: IAVView, counter: number, draggable: boolean) => {
    let nameHTML = "";
    let optionMenuHTML = "";
    if (isAVSelectType(group.groupValue.type)) {
        group.groupValue.mSelect.forEach((item) => {
            nameHTML += `<span class="b3-chip" style="${getAVColorStyle(item)}">${escapeHtml(item.content)}</span>`;
        });
        if (draggable && group.groupValue.mSelect.length === 1) {
            const value = group.groupValue.mSelect[0];
            optionMenuHTML = `<span class="av__group-icon av__group-icon--hover ariaLabel" data-type="av-kanban-group-more" data-position="north" aria-label="${window.siyuan.languages.more}" data-group-id="${group.id}" data-col-id="${group.groupKey.id}" data-name="${escapeAttr(value.content)}"><svg><use xlink:href="#iconMore"></use></svg></span><span class="fn__space"></span>`;
        }
    } else if (group.groupValue.type === "checkbox") {
        nameHTML = `<svg style="width:calc(1.625em - 12px);height:calc(1.625em - 12px);margin: 4px 0;float: left;"><use xlink:href="#icon${group.groupValue.checkbox.checked ? "Check" : "Uncheck"}"></use></svg>`;
    } else {
        nameHTML = escapeHtml(group.name);
    }
    // av__group-name 为第三方需求，本应用内没有使用，但不能移除 https://github.com/siyuan-note/siyuan/issues/15736
    return `<div class="av__group-title"${draggable ? ' draggable="true"' : ""}>
    <span class="av__group-name fn__ellipsis" style="white-space: nowrap;">${nameHTML}</span>
    ${(!counter || counter === 0) ? '<span class="fn__space"></span>' : `<span aria-label="${window.siyuan.languages.entryNum}" data-position="north" class="av__group-counter ariaLabel">${counter}</span>`}
    <span class="fn__flex-1"></span>
    ${optionMenuHTML}
    <span class="av__group-icon av__group-icon--hover ariaLabel" data-type="av-add-top" data-position="north" aria-label="${window.siyuan.languages.newRow}"><svg><use xlink:href="#iconAdd"></use></svg></span>
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
    const resetData = captureAVCardRenderState(options, "kanban");
    const virtualData = resetData.virtualData;
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
                await renderKanban(options);
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
    if (data.viewType === "gallery") {
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
    const groupKey = view.fields.find(item => item.id === view.group?.field);
    const groupOptions = groupKey?.options || [];
    const queryEmbedElement = hasClosestByAttribute(options.blockElement, "data-type", "NodeBlockQueryEmbed");
    const groupDraggable = !options.protyle.disabled && !created && !snapshot && !queryEmbedElement &&
        (view.group?.valueSource === "rendered" || !isAVDateType(groupKey?.type));
    const groupConfig = escapeAttr(JSON.stringify(view.group));
    let bodyHTML = "";
    let isSelectGroup = false;
    view.groups.forEach((group: IAVKanban, groupIndex: number) => {
        if (group.groupHidden === 0) {
            let selectBg = "";
            if (group.fillColBackgroundColor) {
                if (isAVSelectType(group.groupValue.type)) {
                    isSelectGroup = true;
                }
                if (isSelectGroup) {
                    if (group.groupValue.mSelect && group.groupValue.mSelect.length > 0) {
                        selectBg = `style="--b3-av-kanban-background: ${getAVBackgroundColor(group.groupValue.mSelect[0])};"`;
                    } else {
                        selectBg = 'style="--b3-av-kanban-background: var(--b3-border-color);"';
                    }
                }
            }
            bodyHTML += `<div class="av__kanban-group${group.cardSize === 0 ? " av__kanban-group--small" : (group.cardSize === 2 ? " av__kanban-group--big" : "")}" data-group-id="${group.id}" data-previous-group-id="${view.groups[groupIndex - 1]?.id || ""}" data-group-config="${groupConfig}"${selectBg}>
    ${getKanbanTitleHTML(group, group.cardCount, groupDraggable)}
    <div data-group-id="${group.id}" data-page-size="${group.pageSize}" data-dtype="${group.groupKey.type}" data-content="${escapeHtmlTextAndAttr(group.groupValue.text?.content || "")}"${virtualData[group.id]?.locate ? ' data-av-locate-window="true"' : ""} class="av__body">${getAVCardHTML("kanban", group, options.blockElement, virtualData[group.id])}</div>
</div>`;
        }
    });
    if (options.renderAll) {
        replaceAVContainer(options.blockElement, `<div class="av__container fn__block">
    ${genTabHeaderHTML(data, resetData.isSearching || !!resetData.query,
        !options.protyle.disabled && !queryEmbedElement, options.blockElement, !queryEmbedElement)}
    <div class="av__kanban${isSelectGroup ? " av__kanban--bg" : ""}" data-group-options="${escapeAttr(JSON.stringify(groupOptions))}" style="${getCardStyle(view)}">
        ${bodyHTML}
    </div>
    <div class="av__cursor" contenteditable="true">${Constants.ZWSP}</div>
</div>`);
    } else {
        const kanbanElement = options.blockElement.querySelector(".av__kanban");
        kanbanElement.innerHTML = bodyHTML;
        (kanbanElement as HTMLElement).dataset.groupOptions = JSON.stringify(groupOptions);
        if (isSelectGroup) {
            kanbanElement.classList.add("av__kanban--bg");
        } else {
            kanbanElement.classList.remove("av__kanban--bg");
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
