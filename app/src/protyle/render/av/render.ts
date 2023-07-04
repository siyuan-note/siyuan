import {fetchPost} from "../../../util/fetch";
import {getColIconByType} from "./col";
import {showHeaderCellMenu} from "./cell";
import {Constants} from "../../../constants";

export const avRender = (element: Element, cb?: () => void) => {
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
            fetchPost("/api/av/renderAttributeView", {id: e.getAttribute("data-av-id")}, (response) => {
                const data = response.data.av as IAV;
                // header
                let tableHTML = '<div class="av__row av__row--header"><div class="av__firstcol"><svg style="height: 42px"><use xlink:href="#iconUncheck"></use></svg></div>';
                let index = 0;
                data.columns.forEach((column: IAVColumn) => {
                    if (column.hidden) {
                        return;
                    }
                    tableHTML += `<div class="av__cell" data-index="${index}" data-id="${column.id}" data-dtype="${column.type}"  
style="width: ${column.width || "200px"};
${column.wrap ? "" : "white-space: nowrap;"}">
    <div draggable="true" class="av__cellheader">
        <svg><use xlink:href="#${column.icon || getColIconByType(column.type)}"></use></svg>
        <span class="av__celltext">${column.name}</span>
    </div>
    <div class="av__widthdrag"></div>
</div>`;
                    index++;
                });
                tableHTML += `<div class="block__icons">
    <div class="block__icon block__icon--show" data-type="av-header-add"><svg><use xlink:href="#iconAdd"></use></svg></div>
    <div class="fn__space"></div>
    <div class="block__icon block__icon--show"  data-type="av-header-more"><svg><use xlink:href="#iconMore"></use></svg></div>
</div>
</div>`;

                // body
                data.rows.forEach((row: IAVRow) => {
                    tableHTML += `<div class="av__row" data-id="${row.id}">
<div class="av__gutters" draggable="true" data-position="right" aria-label="${window.siyuan.languages.rowTip}">
    <button><svg><use xlink:href="#iconLine"></use></svg></button>
</div>
<div class="av__firstcol"><svg><use xlink:href="#iconUncheck"></use></svg></div>`;
                    row.cells.forEach((cell, index) => {
                        if (data.columns[index].hidden) {
                            return;
                        }
                        let text: string;
                        if (cell.valueType === "text") {
                            text = cell.value?.text.content || "";
                        } else if (cell.valueType === "block") {
                            text = cell.value?.block.content || "";
                        } else if (cell.valueType === "number") {
                            text = cell.value?.number.content || "";
                        } else if (cell.valueType === "select") {
                            text = cell.value?.select.content || "";
                        } else if (cell.valueType === "mSelect") {
                            text = cell.value?.mSelect.content || "";
                        } else if (cell.valueType === "date") {
                            text = cell.value?.date.content || "";
                        }
                        tableHTML += `<div class="av__cell" data-id="${cell.id}" data-index="${index}" 
${cell.valueType === "block" ? 'data-block-id="' + (cell.value.block.id || "") + '"' : ""}  
style="width: ${data.columns[index].width || "200px"};
${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${data.columns[index].wrap ? "" : "white-space: nowrap;"}
${cell.color ? `color:${cell.color};` : ""}"><span class="av__celltext">${text}</span></div>`;
                    });
                    tableHTML += "<div></div></div>";
                });
                const paddingLeft = e.parentElement.style.paddingLeft;
                const paddingRight = e.parentElement.style.paddingRight;
                e.style.width = e.parentElement.clientWidth + "px";
                e.style.alignSelf = "center";
                e.firstElementChild.outerHTML = `<div>
    <div class="av__header" style="padding-left: ${paddingLeft};padding-right: ${paddingRight};">
        <div class="layout-tab-bar fn__flex">
            <div class="item item--focus">
                <svg class="item__graphic"><use xlink:href="#iconTable"></use></svg>
                <span class="item__text">${data.type}</span>
            </div>
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
        <div contenteditable="true" class="av__title" data-title="${data.name || ""}" data-tip="${window.siyuan.languages.title}">${data.name || ""}</div>
        <div class="av__counter fn__none"></div>
    </div>
    <div class="av__scroll">
        <div style="padding-left: ${paddingLeft};padding-right: ${paddingRight};float: left;">
            ${tableHTML}
            <div class="block__icon block__icon--show">
                <div class="fn__space"></div>
                <svg><use xlink:href="#iconAdd"></use></svg><span class="fn__space"></span>
                ${window.siyuan.languages.addAttr}
            </div>
            <div class="av__row--footer">Calculate</div>
        </div>
    </div>
</div>`;
                e.setAttribute("data-render", "true");
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
    const avId = operation.action === "setAttrView" ? operation.id : operation.parentID;
    if (operation.action === "addAttrViewCol") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
            item.removeAttribute("data-render");
            avRender(item, () => {
                showHeaderCellMenu(protyle, item, item.querySelector(".av__row--header").lastElementChild.previousElementSibling as HTMLElement);
            });
        });
    } else if (operation.action === "setAttrViewColWidth") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
            const cellElement = item.querySelector(`.av__cell[data-id="${operation.id}"]`) as HTMLElement;
            if (!cellElement || cellElement.style.width === operation.data) {
                return;
            }
            const index = cellElement.dataset.index;
            item.querySelectorAll(".av__row").forEach(rowItem => {
                (rowItem.querySelector(`[data-index="${index}"]`) as HTMLElement).style.width = operation.data;
            });
        });
    } else if (operation.action === "setAttrView" && typeof operation.data.name === "string") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
            const titleElement = item.querySelector(".av__title") as HTMLElement;
            if (!titleElement || titleElement.textContent.trim() === operation.data.name) {
                return;
            }
            titleElement.textContent =  operation.data.name;
            titleElement.dataset.title = operation.data.name;
        });
    } else {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
            item.removeAttribute("data-render");
            avRender(item);
        });
    }
    setTimeout(() => {
        lastParentID = null;
    }, Constants.TIMEOUT_TRANSITION);
};
