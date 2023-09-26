import {fetchPost} from "../../../util/fetch";
import {getColIconByType} from "./col";
import {Constants} from "../../../constants";
import {getCalcValue} from "./cell";
import * as dayjs from "dayjs";

export const avRender = (element: Element, protyle: IProtyle, cb?: () => void) => {
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
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            const left = e.querySelector(".av__scroll")?.scrollLeft || 0;
            fetchPost("/api/av/renderAttributeView", {
                id: e.getAttribute("data-av-id"),
            }, (response) => {
                const data = response.data.view as IAVTable;
                // header
                let tableHTML = '<div class="av__row av__row--header"><div class="av__firstcol"><svg style="height: 32px"><use xlink:href="#iconUncheck"></use></svg></div>';
                let calcHTML = "";
                data.columns.forEach((column: IAVColumn) => {
                    if (column.hidden) {
                        return;
                    }
                    tableHTML += `<div class="av__cell" data-col-id="${column.id}" data-dtype="${column.type}"  
style="width: ${column.width || "200px"};
${column.wrap ? "" : "white-space: nowrap;"}">
    <div draggable="true" class="av__cellheader">
        <svg><use xlink:href="#${column.icon || getColIconByType(column.type)}"></use></svg>
        <span class="av__celltext">${column.name}</span>
    </div>
    <div class="av__widthdrag"></div>
</div>`;
                    calcHTML += `<div class="av__calc${calcHTML ? "" : " av__calc--show"}${column.calc && column.calc.operator !== "" ? " av__calc--ashow" : ""}" data-col-id="${column.id}" data-dtype="${column.type}" data-operator="${column.calc?.operator || ""}"  
style="width: ${column.width || "200px"}">${getCalcValue(column) || '<svg><use xlink:href="#iconDown"></use></svg>' + window.siyuan.languages.calc}</div>`;
                });
                tableHTML += `<div class="block__icons" style="min-height: auto">
    <div class="block__icon block__icon--show" data-type="av-header-add"><svg><use xlink:href="#iconAdd"></use></svg></div>
    <div class="fn__space"></div>
    <div class="block__icon block__icon--show"  data-type="av-header-more"><svg><use xlink:href="#iconMore"></use></svg></div>
</div>
</div>`;
                // body
                data.rows.forEach((row: IAVRow) => {
                    tableHTML += `<div class="av__row" data-id="${row.id}">
<div class="av__gutters ariaLabel" draggable="true" data-position="right" aria-label="${window.siyuan.languages.rowTip}">
    <button><svg><use xlink:href="#iconLine"></use></svg></button>
</div>
<div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>`;
                    row.cells.forEach((cell, index) => {
                        if (data.columns[index].hidden) {
                            return;
                        }
                        let text = "";
                        if (cell.valueType === "text") {
                            text = `<span class="av__celltext">${cell.value?.text.content || ""}</span>`;
                        } else if (["url", "email", "phone"].includes(cell.valueType)) {
                            text = `<span class="av__celltext av__celltext--url" data-type="${cell.valueType}">${cell.value ? cell.value[cell.valueType as "url"].content : ""}</span>`;
                            if (cell.value && cell.value[cell.valueType as "url"].content) {
                                text += `<span data-type="copy" class="b3-tooltips b3-tooltips__n block__icon" aria-label="${window.siyuan.languages.copy}"><svg><use xlink:href="#iconCopy"></use></svg></span>`;
                            }
                        } else if (cell.valueType === "block") {
                            text = `<span class="av__celltext">${cell.value?.block.content || ""}</span>`;
                            if (cell.value?.block.id) {
                                text += `<span class="b3-chip b3-chip--info b3-chip--small" data-type="block-ref" data-id="${cell.value.block.id}" data-subtype="s">${window.siyuan.languages.openBy}</span>`;
                            }
                        } else if (cell.valueType === "number") {
                            text = `<span class="av__celltext" data-content="${cell.value?.number.content || ""}">${cell.value?.number.formattedContent || ""}</span>`;
                        } else if (cell.valueType === "mSelect" || cell.valueType === "select") {
                            cell.value?.mSelect?.forEach((item) => {
                                text += `<span class="b3-chip b3-chip--middle" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${item.content}</span>`;
                            });
                            if (!text) {
                                text = '<span class="av__celltext"></span>';
                            } else {
                                text = `<span class="av__celltext">${text}</span>`;
                            }
                        } else if (cell.valueType === "date") {
                            text = '<span class="av__celltext av__celltext--date">';
                            if (cell.value?.date.isNotEmpty) {
                                text += dayjs(cell.value.date.content).format("YYYY-MM-DD HH:mm");
                            }
                            if (cell.value?.date.hasEndDate && cell.value?.date.isNotEmpty && cell.value?.date.isNotEmpty2) {
                                text += `<svg><use xlink:href="#iconForward"></use></svg>${dayjs(cell.value.date.content2).format("YYYY-MM-DD HH:mm")}`;
                            }
                            text += "</span>";
                        } else if (cell.valueType === "mAsset") {
                            cell.value?.mAsset?.forEach((item) => {
                                if (item.type === "image") {
                                    text += `<img class="av__cellassetimg" src="${item.content}">`;
                                } else {
                                    text += `<span class="b3-chip b3-chip--middle av__celltext--url" data-url="${item.content}">${item.name}</span>`;
                                }
                            });
                            if (!text) {
                                text = '<span class="av__celltext"></span>';
                            } else {
                                text = `<span class="av__celltext">${text}</span>`;
                            }
                        }
                        tableHTML += `<div class="av__cell" data-id="${cell.id}" data-col-id="${data.columns[index].id}"
${cell.valueType === "block" ? 'data-block-id="' + (cell.value.block.id || "") + '"' : ""}  
style="width: ${data.columns[index].width || "200px"};
${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${data.columns[index].wrap ? "" : "white-space: nowrap;"}
${cell.valueType !== "number" ? "" : "flex-direction: row-reverse;"}
${cell.color ? `color:${cell.color};` : ""}">${text}</div>`;
                    });
                    tableHTML += "<div></div></div>";
                });
                let tabHTML = "";
                response.data.views.forEach((item: IAVView) => {
                    tabHTML += `<div data-id="${response.data.viewID}" class="item${item.id === response.data.viewID ? " item--focus" : ""}">
    <svg class="item__graphic"><use xlink:href="#iconTable"></use></svg>
    <span class="item__text">${item.name}</span>
</div>`;
                });
                const paddingLeft = e.parentElement.style.paddingLeft;
                const paddingRight = e.parentElement.style.paddingRight;
                e.style.width = e.parentElement.clientWidth + "px";
                e.style.alignSelf = "center";
                e.firstElementChild.outerHTML = `<div>
    <div class="av__header" style="padding-left: ${paddingLeft};padding-right: ${paddingRight};">
        <div class="layout-tab-bar fn__flex">
            ${tabHTML}
            <div class="fn__flex-1"></div>
            <span data-type="av-filter" class="block__icon block__icon--show b3-tooltips b3-tooltips__w${data.filters.length > 0 ? " block__icon--active" : ""}" aria-label="${window.siyuan.languages.filter}">
                <svg><use xlink:href="#iconFilter"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-sort" class="block__icon block__icon--show b3-tooltips b3-tooltips__w${data.sorts.length > 0 ? " block__icon--active" : ""}" aria-label="${window.siyuan.languages.sort}">
                <svg><use xlink:href="#iconSort"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-more" class="block__icon block__icon--show b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.more}">
                <svg><use xlink:href="#iconMore"></use></svg>
            </span>
            <div class="fn__space"></div>
        </div>
        <div contenteditable="${protyle.disabled ? "false" : "true"}" spellcheck="${window.siyuan.config.editor.spellcheck.toString()}" class="av__title" data-title="${data.name || ""}" data-tip="${window.siyuan.languages.title}">${response.data.name || ""}</div>
        <div class="av__counter fn__none"></div>
    </div>
    <div class="av__scroll">
        <div style="padding-left: ${paddingLeft};padding-right: ${paddingRight};float: left;">
            ${tableHTML}
            <div class="av__row--add">
                <svg><use xlink:href="#iconAdd"></use></svg>
                ${window.siyuan.languages.addAttr}
            </div>
            <div class="av__row--footer"><div style="width: 24px"></div>${calcHTML}</div>
        </div>
    </div>
</div>`;
                e.setAttribute("data-render", "true");
                e.querySelector(".av__scroll").scrollLeft = left;
                if (cb) {
                    cb();
                }
            });
        });
    }
};

let lastParentID: string;
let lastElement: HTMLElement;
export const refreshAV = (protyle: IProtyle, operation: IOperation) => {
    if (lastParentID === operation.parentID && protyle.contentElement.isSameNode(lastElement)) {
        return;
    }
    lastElement = protyle.contentElement;
    lastParentID = operation.parentID;
    const avId = operation.avID;
    if (operation.action === "setAttrViewColWidth") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
            const cellElement = item.querySelector(`.av__cell[data-col-id="${operation.id}"]`) as HTMLElement;
            if (!cellElement || cellElement.style.width === operation.data) {
                return;
            }
            item.querySelectorAll(".av__row").forEach(rowItem => {
                (rowItem.querySelector(`[data-col-id="${operation.id}"]`) as HTMLElement).style.width = operation.data;
            });
        });
    } else if (operation.action === "setAttrViewName") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
            const titleElement = item.querySelector(".av__title") as HTMLElement;
            if (!titleElement || titleElement.textContent.trim() === operation.data) {
                return;
            }
            titleElement.textContent = operation.data;
            titleElement.dataset.title = operation.data;
        });
    } else {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
            item.removeAttribute("data-render");
            avRender(item, protyle);
        });
    }
    setTimeout(() => {
        lastParentID = null;
    }, Constants.TIMEOUT_TRANSITION);
};
