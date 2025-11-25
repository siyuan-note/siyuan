import {hasClosestByAttribute, hasClosestByClassName} from "../../../util/hasClosest";
import {getPageSize} from "../groups";
import {fetchSyncPost} from "../../../../util/fetch";
import {Constants} from "../../../../constants";
import {avRender, genTabHeaderHTML} from "../render";
import {afterRenderGallery, renderGallery} from "../gallery/render";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {getCompressURL} from "../../../../util/image";
import {cellValueIsEmpty, renderCell} from "../cell";
import {getColIconByType, getColNameByType} from "../col";
import {unicode2Emoji} from "../../../../emoji";

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

const getKanbanHTML = (data: IAVKanban) => {
    let galleryHTML = "";
    // body
    data.cards.forEach((item: IAVGalleryItem, rowIndex: number) => {
        galleryHTML += `<div data-id="${item.id}" draggable="true" class="av__gallery-item">`;
        if (data.coverFrom !== 0) {
            const coverClass = "av__gallery-cover av__gallery-cover--" + data.cardAspectRatio;
            if (item.coverURL) {
                if (item.coverURL.startsWith("background")) {
                    galleryHTML += `<div class="${coverClass}"><img class="av__gallery-img" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" style="${item.coverURL}"></div>`;
                } else {
                    galleryHTML += `<div class="${coverClass}"><img loading="lazy" class="av__gallery-img${data.fitImage ? " av__gallery-img--fit" : ""}" src="${getCompressURL(item.coverURL)}"></div>`;
                }
            } else if (item.coverContent.trim()) {
                galleryHTML += `<div class="${coverClass}"><div class="av__gallery-content">${item.coverContent}</div><div></div></div>`;
            }
        }
        galleryHTML += '<div class="av__gallery-fields">';
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

            if (cell.valueType === "checkbox" && !data.displayFieldName) {
                cell.value.checkbox.content = data.fields[fieldsIndex].name || getColNameByType(data.fields[fieldsIndex].type);
            }
            const cellHTML = `<div class="av__cell${checkClass}${data.displayFieldName ? "" : " ariaLabel"}" 
data-wrap="${data.fields[fieldsIndex].wrap}" 
aria-label="${ariaLabel}" 
data-position="5west"
data-id="${cell.id}" 
data-field-id="${data.fields[fieldsIndex].id}" 
data-dtype="${cell.valueType}" 
${cell.value?.isDetached ? ' data-detached="true"' : ""} 
style="${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${cell.color ? `color:${cell.color};` : ""}">${renderCell(cell.value, rowIndex, data.showIcon, "kanban")}</div>`;
            if (data.displayFieldName) {
                galleryHTML += `<div class="av__gallery-field av__gallery-field--name" data-empty="${isEmpty}">
    <div class="av__gallery-name">
        ${data.fields[fieldsIndex].icon ? unicode2Emoji(data.fields[fieldsIndex].icon, undefined, true) : `<svg><use xlink:href="#${getColIconByType(data.fields[fieldsIndex].type)}"></use></svg>`}${Lute.EscapeHTMLStr(data.fields[fieldsIndex].name)}
        ${data.fields[fieldsIndex].desc ? `<svg aria-label="${data.fields[fieldsIndex].desc}" data-position="north" class="ariaLabel"><use xlink:href="#iconInfo"></use></svg>` : ""}
    </div>
    ${cellHTML}
</div>`;
            } else {
                galleryHTML += `<div class="av__gallery-field" data-empty="${isEmpty}">
    <div class="av__gallery-tip">
        ${data.fields[fieldsIndex].icon ? unicode2Emoji(data.fields[fieldsIndex].icon, undefined, true) : `<svg><use xlink:href="#${getColIconByType(data.fields[fieldsIndex].type)}"></use></svg>`}${window.siyuan.languages.edit} ${Lute.EscapeHTMLStr(data.fields[fieldsIndex].name)}
    </div>
    ${cellHTML}
</div>`;
            }
        });
        galleryHTML += `</div>
    <div class="av__gallery-actions">
        <span class="protyle-icon protyle-icon--first ariaLabel" data-position="4north" aria-label="${window.siyuan.languages.displayEmptyFields}" data-type="av-gallery-edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
        <span class="protyle-icon protyle-icon--last ariaLabel" data-position="4north" aria-label="${window.siyuan.languages.more}" data-type="av-gallery-more"><svg><use xlink:href="#iconMore"></use></svg></span>
    </div>
</div>`;
    });
    galleryHTML += `<div class="av__gallery-add" data-type="av-add-bottom"><svg class="svg"><use xlink:href="#iconAdd"></use></svg><span class="fn__space"></span>${window.siyuan.languages.newRow}</div>`;
    return `<div class="av__gallery av__gallery--small">
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

export const renderKanban = async (options: {
    blockElement: HTMLElement,
    protyle: IProtyle,
    cb?: (data: IAV) => void,
    renderAll: boolean,
    data?: IAV,
}) => {
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
        left: options.blockElement.querySelector(".av__kanban")?.scrollLeft,
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
    <div data-group-id="${group.id}" data-page-size="${group.pageSize}" data-dtype="${group.groupKey.type}" data-content="${Lute.EscapeHTMLStr(group.groupValue.text?.content || "")}" class="av__body">${getKanbanHTML(group)}</div>
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
