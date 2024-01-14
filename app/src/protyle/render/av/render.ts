import {fetchPost} from "../../../util/fetch";
import {getColIconByType} from "./col";
import {Constants} from "../../../constants";
import {renderCell} from "./cell";
import {unicode2Emoji} from "../../../emoji";
import {focusBlock} from "../../util/selection";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {stickyRow} from "./row";
import {getCalcValue} from "./calc";
import {openMenuPanel} from "./openMenuPanel";

export const avRender = (element: Element, protyle: IProtyle, cb?: () => void, viewID?: string) => {
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
            const left = e.querySelector(".av__scroll")?.scrollLeft || 0;
            const headerTransform = (e.querySelector(".av__row--header") as HTMLElement)?.style.transform;
            const footerTransform = (e.querySelector(".av__row--footer") as HTMLElement)?.style.transform;
            let selectCellId = "";
            const selectCellElement = e.querySelector(".av__cell--select") as HTMLElement;
            if (selectCellElement) {
                selectCellId = (hasClosestByClassName(selectCellElement, "av__row") as HTMLElement).dataset.id + Constants.ZWSP + selectCellElement.getAttribute("data-col-id");
            }
            const created = protyle.options.history?.created;
            const snapshot = protyle.options.history?.snapshot;
            let newViewID = "";
            if (typeof viewID === "string") {
                newViewID = viewID;
            } else if (typeof viewID === "undefined") {
                newViewID = e.querySelector(".av__header .item--focus")?.getAttribute("data-id");
            }
            fetchPost(created ? "/api/av/renderHistoryAttributeView" : (snapshot ? "/api/av/renderSnapshotAttributeView" : "/api/av/renderAttributeView"), {
                id: e.getAttribute("data-av-id"),
                created,
                snapshot,
                pageSize: parseInt(e.dataset.pageSize) || undefined,
                viewID: newViewID
            }, (response) => {
                const data = response.data.view as IAVTable;
                if (!e.dataset.pageSize) {
                    e.dataset.pageSize = data.pageSize.toString();
                }
                // header
                let tableHTML = '<div class="av__row av__row--header"><div class="av__firstcol av__colsticky"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
                let calcHTML = '<div style="width: 24px"></div>';
                let pinIndex = -1;
                let pinMaxIndex = -1;
                let indexWidth = 0;
                const eWidth = e.clientWidth;
                data.columns.forEach((item, index) => {
                    if (!item.hidden) {
                        if (item.pin) {
                            pinIndex = index;
                        }
                        if (indexWidth < eWidth - 200) {
                            indexWidth += parseInt(item.width) || 200;
                            pinMaxIndex = index;
                        }
                    }
                });
                pinIndex = Math.min(pinIndex, pinMaxIndex);
                if (pinIndex > -1) {
                    tableHTML = '<div class="av__row av__row--header"><div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
                    calcHTML = '<div class="av__colsticky"><div style="width: 24px"></div>';
                }
                data.columns.forEach((column: IAVColumn, index: number) => {
                    if (column.hidden) {
                        return;
                    }
                    tableHTML += `<div class="av__cell av__cell--header" data-col-id="${column.id}"  draggable="true" 
data-icon="${column.icon}" data-dtype="${column.type}" data-wrap="${column.wrap}" data-pin="${column.pin}" 
style="width: ${column.width || "200px"};">
    ${column.icon ? unicode2Emoji(column.icon, "av__cellheadericon", true) : `<svg class="av__cellheadericon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`}
    <span class="av__celltext fn__flex-1">${column.name}</span>
    ${column.pin ? '<svg class="av__cellheadericon av__cellheadericon--pin"><use xlink:href="#iconPin"></use></svg>' : ""}
    <div class="av__widthdrag"></div>
</div>`;
                    if (pinIndex === index) {
                        tableHTML += "</div>";
                    }
                    calcHTML += `<div class="av__calc${calcHTML ? "" : " av__calc--show"}${column.calc && column.calc.operator !== "" ? " av__calc--ashow" : ""}" data-col-id="${column.id}" data-dtype="${column.type}" data-operator="${column.calc?.operator || ""}"  
style="width: ${column.width || "200px"}">${getCalcValue(column) || '<svg><use xlink:href="#iconDown"></use></svg>' + window.siyuan.languages.calc}</div>`;
                    if (pinIndex === index) {
                        calcHTML += "</div>";
                    }
                });
                tableHTML += `<div class="block__icons" style="min-height: auto">
    <div class="block__icon block__icon--show" data-type="av-header-add"><svg><use xlink:href="#iconAdd"></use></svg></div>
    <div class="fn__space"></div>
    <div class="block__icon block__icon--show"  data-type="av-header-more"><svg><use xlink:href="#iconMore"></use></svg></div>
</div>
</div>`;
                // body
                data.rows.forEach((row: IAVRow) => {
                    tableHTML += `<div class="av__row" data-id="${row.id}">`;
                    if (pinIndex > -1) {
                        tableHTML += '<div class="av__colsticky"><div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
                    } else {
                        tableHTML += '<div class="av__firstcol av__colsticky"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
                    }

                    row.cells.forEach((cell, index) => {
                        if (data.columns[index].hidden) {
                            return;
                        }
                        tableHTML += `<div class="av__cell" data-id="${cell.id}" data-col-id="${data.columns[index].id}"
${cell.valueType === "block" ? 'data-block-id="' + (cell.value.block.id || "") + '"' : ""} data-wrap="${data.columns[index].wrap}" 
${cell.value?.isDetached ? ' data-detached="true"' : ""} 
style="width: ${data.columns[index].width || "200px"};
${cell.valueType === "number" ? "text-align: right;" : ""}
${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${cell.color ? `color:${cell.color};` : ""}">${renderCell(cell.value)}</div>`;

                        if (pinIndex === index) {
                            tableHTML += "</div>";
                        }
                    });
                    tableHTML += "<div></div></div>";
                });
                let tabHTML = "";
                response.data.views.forEach((item: IAVView) => {
                    tabHTML += `<div data-id="${item.id}" class="item${item.id === response.data.viewID ? " item--focus" : ""}">
    ${item.icon ? unicode2Emoji(item.icon, "item__graphic", true) : '<svg class="item__graphic"><use xlink:href="#iconTable"></use></svg>'}
    <span class="item__text">${item.name}</span>
</div>`;
                });
                e.firstElementChild.outerHTML = `<div class="av__container" style="--av-background:${e.style.backgroundColor || "var(--b3-theme-background)"}">
    <div class="av__header">
        <div class="fn__flex av__views">
            <div class="layout-tab-bar fn__flex">
                ${tabHTML}
            </div>
            <div class="fn__space"></div>
            <span data-type="av-add" class="block__icon">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__flex-1"></div>
            <div class="fn__space"></div>
            <span data-type="av-switcher" class="block__icon${response.data.views.length > 0 ? "" : " fn__none"}">
                <svg><use xlink:href="#iconDown"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-filter" class="block__icon${data.filters.length > 0 ? " block__icon--active" : ""}">
                <svg><use xlink:href="#iconFilter"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-sort" class="block__icon${data.sorts.length > 0 ? " block__icon--active" : ""}">
                <svg><use xlink:href="#iconSort"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-more" class="block__icon">
                <svg><use xlink:href="#iconMore"></use></svg>
            </span>
            <div class="fn__space"></div>
            <span data-type="av-add-more" class="block__icon">
                <svg><use xlink:href="#iconAdd"></use></svg>
            </span>
            <div class="fn__space"></div>
            ${response.data.isMirror ? ` <span class="block__icon block__icon--show ariaLabel" aria-label="${window.siyuan.languages.mirrorTip}">
    <svg><use xlink:href="#iconSplitLR"></use></svg></span><div class="fn__space"></div>` : ""}
        </div>
        <div contenteditable="${protyle.disabled ? "false" : "true"}" spellcheck="${window.siyuan.config.editor.spellcheck.toString()}" class="av__title" data-title="${response.data.name || ""}" data-tip="${window.siyuan.languages.title}">${response.data.name || ""}</div>
        <div class="av__counter fn__none"></div>
    </div>
    <div class="av__scroll">
        <div class="av__body">
            ${tableHTML}
            <div class="av__row--util">
                <div class="av__colsticky">
                    <button class="b3-button" data-type="av-add-bottom">
                        <svg><use xlink:href="#iconAdd"></use></svg>
                        ${window.siyuan.languages.addAttr}
                    </button>
                    <span class="fn__space"></span>
                    <button class="b3-button${data.rowCount > data.rows.length ? "" : " fn__none"}">
                        <svg data-type="av-load-more"><use xlink:href="#iconArrowDown"></use></svg>
                        <span data-type="av-load-more">
                            ${window.siyuan.languages.loadMore}
                        </span>
                        <svg data-type="set-page-size" data-size="${data.pageSize}"><use xlink:href="#iconMore"></use></svg>
                    </button>
                </div>
            </div>
            <div class="av__row--footer">${calcHTML}</div>
        </div>
    </div>
</div>`;
                e.setAttribute("data-render", "true");
                // 历史兼容
                e.style.margin = "";
                if (left) {
                    e.querySelector(".av__scroll").scrollLeft = left;
                }

                const editRect = protyle.contentElement.getBoundingClientRect();
                if (headerTransform) {
                    (e.querySelector(".av__row--header") as HTMLElement).style.transform = headerTransform;
                } else {
                    stickyRow(e, editRect, "top");
                }
                if (footerTransform) {
                    (e.querySelector(".av__row--footer") as HTMLElement).style.transform = footerTransform;
                } else {
                    stickyRow(e, editRect, "bottom");
                }
                if (selectCellId) {
                    const newCellElement = e.querySelector(`.av__row[data-id="${selectCellId.split(Constants.ZWSP)[0]}"] .av__cell[data-col-id="${selectCellId.split(Constants.ZWSP)[1]}"]`);
                    if (newCellElement) {
                        newCellElement.classList.add("av__cell--select");
                    }
                    const avMaskElement = document.querySelector(".av__mask");
                    if (avMaskElement) {
                        (avMaskElement.querySelector("textarea, input") as HTMLTextAreaElement)?.focus();
                    } else if (!document.querySelector(".av__panel")) {
                        focusBlock(e);
                    }
                }
                if (getSelection().rangeCount > 0) {
                    // 修改表头后光标重新定位
                    const range = getSelection().getRangeAt(0);
                    if (!hasClosestByClassName(range.startContainer, "av__title")) {
                        const blockElement = hasClosestBlock(range.startContainer);
                        if (blockElement && e.isSameNode(blockElement)) {
                            focusBlock(e);
                        }
                    }
                }
                e.querySelector(".layout-tab-bar").scrollLeft = (e.querySelector(".layout-tab-bar .item--focus") as HTMLElement).offsetLeft;
                if (cb) {
                    cb();
                }
            });
        });
    }
};

const refreshTimeouts: {
    [key: string]: number;
} = {};
export const refreshAV = (protyle: IProtyle, operation: IOperation) => {
    if (operation.action === "setAttrViewName") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.id}"]`)).forEach((item: HTMLElement) => {
            const titleElement = item.querySelector(".av__title") as HTMLElement;
            if (!titleElement) {
                return;
            }
            titleElement.textContent = operation.data;
            titleElement.dataset.title = operation.data;
        });
    }
    // 只能 setTimeout，以前方案快速输入后最后一次修改会被忽略；必须为每一个 protyle 单独设置，否则有多个 protyle 时，其余无法被执行
    clearTimeout(refreshTimeouts[protyle.id]);
    refreshTimeouts[protyle.id] = window.setTimeout(() => {
        if (operation.action === "setAttrViewColWidth") {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
                const cellElement = item.querySelector(`.av__cell[data-col-id="${operation.id}"]`) as HTMLElement;
                if (!cellElement || cellElement.style.width === operation.data) {
                    return;
                }
                item.querySelectorAll(".av__row").forEach(rowItem => {
                    (rowItem.querySelector(`[data-col-id="${operation.id}"]`) as HTMLElement).style.width = operation.data;
                });
            });
        } else {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${operation.avID}"]`)).forEach((item: HTMLElement) => {
                item.removeAttribute("data-render");
                avRender(item, protyle, () => {
                    if (operation.action === "addAttrViewCol" && item.querySelector(".av__pulse")) {
                        openMenuPanel({protyle, blockElement: item, type: "edit", colId: operation.id});
                    }
                }, ["addAttrViewView", "duplicateAttrViewView"].includes(operation.action) ? operation.id :
                    (operation.action === "removeAttrViewView" ? null : undefined));
            });
        }
    }, ["insertAttrViewBlock", "addAttrViewCol"].includes(operation.action) ? 2 : 100);
};
