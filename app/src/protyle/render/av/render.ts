import {fetchPost} from "../../../util/fetch";
import {getColIconByType, showColMenu} from "./col";
import {Constants} from "../../../constants";
import {getCalcValue} from "./cell";
import * as dayjs from "dayjs";
import {hasClosestByAttribute} from "../../util/hasClosest";
import {Menu} from "../../../plugin/Menu";

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
            fetchPost("/api/av/renderAttributeView", {
                id: e.getAttribute("data-av-id"),
                nodeID: e.getAttribute("data-node-id")
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
                        } else if (cell.valueType === "url") {
                            text = `<span class="av__celltext av__celltext--url">${cell.value?.url.content || ""}</span>`;
                            if (cell.value?.url.content) {
                                text += `<span class="b3-chip b3-chip--info b3-chip--small" data-type="a" data-href="${cell.value.url.content}">${window.siyuan.languages.openBy}</span>`;
                            }
                        } else if (cell.valueType === "block") {
                            text = `<span class="av__celltext">${cell.value?.block.content || ""}</span>`;
                            if (cell.value?.block.id) {
                                text += `<span class="b3-chip b3-chip--info b3-chip--small" data-type="block-ref" data-id="${cell.value.block.id}" data-subtype="s">${window.siyuan.languages.openBy}</span>`;
                            }
                        } else if (cell.valueType === "number") {
                            text = `<span class="av__celltext">${cell.value?.number.content || ""}</span>`;
                        } else if (cell.valueType === "mSelect" || cell.valueType === "select") {
                            cell.value?.mSelect?.forEach((item: { content: string, color: string }) => {
                                text += `<span class="b3-chip b3-chip--middle" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${item.content}</span>`;
                            });
                            if (!text) {
                                text = '<span class="av__celltext"></span>';
                            } else {
                                text = `<span class="av__celltext">${text}</span>`;
                            }
                        } else if (cell.valueType === "date") {
                            text = '<span class="av__celltext">';
                            if (cell.value?.date.content) {
                                text += dayjs(cell.value.date.content).format("YYYY-MM-DD HH:mm");
                            }
                            if (cell.value?.date.hasEndDate) {
                                text += `<svg style="margin-left: 5px"><use xlink:href="#iconForward"></use></svg>${dayjs(cell.value.date.content2).format("YYYY-MM-DD HH:mm")}</span>`;
                            }
                            text += "</span>";
                        }
                        tableHTML += `<div class="av__cell" data-id="${cell.id}" data-col-id="${data.columns[index].id}"
${cell.valueType === "block" ? 'data-block-id="' + (cell.value.block.id || "") + '"' : ""}  
style="width: ${data.columns[index].width || "200px"};
${cell.bgColor ? `background-color:${cell.bgColor};` : ""}
${data.columns[index].wrap ? "" : "white-space: nowrap;"}
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
        <div contenteditable="true" class="av__title" data-title="${data.name || ""}" data-tip="${window.siyuan.languages.title}">${response.data.name || ""}</div>
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
    if (operation.action === "addAttrViewCol") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
            item.removeAttribute("data-render");
            avRender(item, () => {
                showColMenu(protyle, item, item.querySelector(`.av__row--header .av__cell[data-col-id="${operation.id}"]`));
            });
        });
    } else if (operation.action === "setAttrViewColWidth") {
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
            avRender(item);
        });
    }
    setTimeout(() => {
        lastParentID = null;
    }, Constants.TIMEOUT_TRANSITION);
};

const genAVValueHTML = (value: IAVCellValue) => {
    let html = "";
    switch (value.type) {
        case "text":
            html = `<input value="${value.text.content}" class="b3-text-field b3-text-field--text fn__flex-1">`;
            break;
        case "number":
            html = `<input value="${value.number.content}" type="number" class="b3-text-field b3-text-field--text fn__flex-1">`;
            break;
        case "mSelect":
        case "select":
            value.mSelect?.forEach(item => {
                html += `<span class="b3-chip b3-chip--middle" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${item.content}</span>`;
            });
            break;
        case "date":
            html = `${dayjs(value.date.content).format("YYYY-MM-DD HH:mm")}`;
            if (value.date.hasEndDate) {
                html += `<svg class="custom-attr__avarrow"><use xlink:href="#iconForward"></use></svg>${dayjs(value.date.content2).format("YYYY-MM-DD HH:mm")}`;
            }
            break;
        case "url":
            html = `<input value="${value.url.content}" class="b3-text-field b3-text-field--text fn__flex-1">`;
            break;
    }
    return html;
};

export const renderAVAttribute = (element: HTMLElement, id: string) => {
    fetchPost("/api/av/getAttributeViewKeys", {id}, (response) => {
        let html = "";
        response.data.forEach((table: {
            keyValues: {
                key: {
                    type: TAVCol,
                    name: string
                },
                values: { keyID: string, id: string, blockID: string, type?: TAVCol & IAVCellValue }  []
            }[],
            avID: string
            avName: string
        }) => {
            html += `<div class="block__logo custom-attr__avheader">
    <svg><use xlink:href="#iconDatabase"></use></svg>
    <span>${table.avName || window.siyuan.languages.database}</span>
</div>`;
            table.keyValues?.forEach(item => {
                html += `<div class="block__icons">
    <div class="block__logo">
        <svg><use xlink:href="#${getColIconByType(item.key.type)}"></use></svg>
        <span>${item.key.name}</span>
    </div>
    <div data-av-id="${table.avID}" data-key-id="${item.values[0].keyID}" data-block-id="${item.values[0].blockID}" data-id="${item.values[0].id}" data-type="${item.values[0].type}"  
    class="fn__flex-1 fn__flex${["url", "text", "number"].includes(item.values[0].type) ? "" : " custom-attr__avvalue"}">
        ${genAVValueHTML(item.values[0])}
    </div>
</div>`;
            });
        });
        element.innerHTML = html;
        // TODO
        // element.addEventListener("click", (event) => {
        //     const target = event.target as HTMLElement
        //     const dateElement = hasClosestByAttribute(target, "data-type", "date")
        //     if (dateElement) {
        //         const dateMenu = new Menu("custom-attr-av-date", () => {
        //
        //         })
        //         if (dateMenu.isOpen) {
        //             return;
        //         }
        //         dateMenu.addItem({
        //             iconHTML:"",
        //             label:`<input>`
        //         })
        //         return;
        //     }
        //     const mSelectElement = hasClosestByAttribute(target, "data-type", "select")||hasClosestByAttribute(target, "data-type", "mSelect")
        //     if (mSelectElement) {
        //         return
        //     }
        // })
        element.querySelectorAll(".b3-text-field--text").forEach((item: HTMLInputElement) => {
            item.addEventListener("change", () => {
                let value;
                if (item.parentElement.dataset.type === "url") {
                    value = {
                        url: {
                            content: item.value
                        }
                    };
                } else if (item.parentElement.dataset.type === "text") {
                    value = {
                        text: {
                            content: item.value
                        }
                    };
                } else if (item.parentElement.dataset.type === "number") {
                    value = {
                        number: {
                            content: parseFloat(item.value)
                        }
                    };
                }
                fetchPost("/api/av/setAttributeViewBlockAttr", {
                    avID: item.parentElement.dataset.avId,
                    keyID: item.parentElement.dataset.keyId,
                    rowID: item.parentElement.dataset.blockId,
                    cellID: item.parentElement.dataset.id,
                    value
                });
            });
        });
    });
};
