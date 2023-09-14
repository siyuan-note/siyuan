import {fetchPost} from "../../../util/fetch";
import {getColIconByType, showColMenu} from "./col";
import {Constants} from "../../../constants";
import {getCalcValue} from "./cell";
import * as dayjs from "dayjs";
import {hasClosestByAttribute} from "../../util/hasClosest";
import {Menu} from "../../../plugin/Menu";
import {escapeAttr} from "../../../util/escape";

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
                            cell.value?.mSelect?.forEach((item: { content: string, color: string }) => {
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
    if (operation.action === "addAttrViewCol") {
        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${avId}"]`)).forEach((item: HTMLElement) => {
            item.removeAttribute("data-render");
            avRender(item, protyle, () => {
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
            avRender(item, protyle);
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
            if (value.date.isNotEmpty) {
                html = `<span data-content="${value.date.content}">${dayjs(value.date.content).format("YYYY-MM-DD HH:mm")}</span>`;
            }
            if (value.date.hasEndDate && value.date.isNotEmpty2 && value.date.isNotEmpty) {
                html += `<svg class="custom-attr__avarrow"><use xlink:href="#iconForward"></use></svg><span data-content="${value.date.content2}">${dayjs(value.date.content2).format("YYYY-MM-DD HH:mm")}</span>`;
            }
            break;
        case "url":
            html = `<input value="${value.url.content}" class="b3-text-field b3-text-field--text fn__flex-1">
<span class="fn__space"></span>
<a href="${value.url.content}" target="_blank" aria-label="${window.siyuan.languages.openBy}" class="block__icon block__icon--show fn__flex-center b3-tooltips__w b3-tooltips"><svg><use xlink:href="#iconLink"></use></svg></a>`;
            break;
        case "phone":
            html = `<input value="${value.phone.content}" class="b3-text-field b3-text-field--text fn__flex-1">
<span class="fn__space"></span>
<a href="tel:${value.phone.content}" target="_blank" aria-label="${window.siyuan.languages.openBy}" class="block__icon block__icon--show fn__flex-center b3-tooltips__w b3-tooltips"><svg><use xlink:href="#iconPhone"></use></svg></a>`;
            break;
        case "email":
            html = `<input value="${value.email.content}" class="b3-text-field b3-text-field--text fn__flex-1">
<span class="fn__space"></span>
<a href="mailto:${value.email.content}" target="_blank" aria-label="${window.siyuan.languages.openBy}" class="block__icon block__icon--show fn__flex-center b3-tooltips__w b3-tooltips"><svg><use xlink:href="#iconEmail"></use></svg></a>`;
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
                    name: string,
                    options?: { name: string, color: string }[]
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
data-options="${item.key?.options ? escapeAttr(JSON.stringify(item.key.options)) : "[]"}"
class="fn__flex-1 fn__flex${["url", "text", "number", "email", "phone"].includes(item.values[0].type) ? "" : " custom-attr__avvalue"}">
        ${genAVValueHTML(item.values[0])}
    </div>
</div>`;
            });
        });
        element.innerHTML = html;
        element.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            const dateElement = hasClosestByAttribute(target, "data-type", "date");
            if (dateElement) {
                const dateMenu = new Menu("custom-attr-av-date", () => {
                    const textElements = window.siyuan.menus.menu.element.querySelectorAll(".b3-text-field") as NodeListOf<HTMLInputElement>;
                    const hasEndDate = (window.siyuan.menus.menu.element.querySelector(".b3-switch") as HTMLInputElement).checked;
                    fetchPost("/api/av/setAttributeViewBlockAttr", {
                        avID: dateElement.dataset.avId,
                        keyID: dateElement.dataset.keyId,
                        rowID: dateElement.dataset.blockId,
                        cellID: dateElement.dataset.id,
                        value: {
                            date: {
                                isNotEmpty: textElements[0].value !== "",
                                isNotEmpty2: textElements[1].value !== "",
                                content: new Date(textElements[0].value).getTime(),
                                content2: new Date(textElements[1].value).getTime(),
                                hasEndDate
                            }
                        }
                    });
                    let dataHTML = "";
                    if (textElements[0].value !== "") {
                        dataHTML = `<span data-content="${new Date(textElements[0].value).getTime()}">${dayjs(textElements[0].value).format("YYYY-MM-DD HH:mm")}</span>`;
                    }
                    if (hasEndDate && textElements[0].value !== "" && textElements[1].value !== "") {
                        dataHTML += `<svg class="custom-attr__avarrow"><use xlink:href="#iconForward"></use></svg><span data-content="${new Date(textElements[1].value).getTime()}">${dayjs(textElements[1].value).format("YYYY-MM-DD HH:mm")}</span>`;
                    }
                    dateElement.innerHTML = dataHTML;
                });
                if (dateMenu.isOpen) {
                    return;
                }
                const hasEndDate = dateElement.querySelector("svg");
                const timeElements = dateElement.querySelectorAll("span");
                dateMenu.addItem({
                    iconHTML: "",
                    label: `<input value="${timeElements[0] ? dayjs(parseInt(timeElements[0].dataset.content)).format("YYYY-MM-DDTHH:mm") : ""}" type="datetime-local" class="b3-text-field fn__size200" style="margin: 4px 0">`
                });
                dateMenu.addItem({
                    iconHTML: "",
                    label: `<input value="${timeElements[1] ? dayjs(parseInt(timeElements[1].dataset.content)).format("YYYY-MM-DDTHH:mm") : ""}" type="datetime-local" class="b3-text-field fn__size200${hasEndDate ? "" : " fn__none"}" style="margin: 4px 0">`
                });
                dateMenu.addSeparator();
                dateMenu.addItem({
                    iconHTML: "",
                    label: `<label class="fn__flex">
    <span>${window.siyuan.languages.endDate}</span>
    <span class="fn__space fn__flex-1"></span>
    <input type="checkbox" class="b3-switch fn__flex-center"${hasEndDate ? " checked" : ""}>
</label>`,
                    click(element, event) {
                        const switchElement = element.querySelector(".b3-switch") as HTMLInputElement;
                        if ((event.target as HTMLElement).tagName !== "INPUT") {
                            switchElement.checked = !switchElement.checked;
                        } else {
                            switchElement.outerHTML = `<input type="checkbox" class="b3-switch fn__flex-center"${switchElement.checked ? " checked" : ""}>`;
                        }
                        window.siyuan.menus.menu.element.querySelectorAll('[type="datetime-local"]')[1].classList.toggle("fn__none");
                        return true;
                    }
                });
                dateMenu.addSeparator();
                dateMenu.addItem({
                    icon: "iconTrashcan",
                    label: window.siyuan.languages.clear,
                    click() {
                        const textElements = window.siyuan.menus.menu.element.querySelectorAll(".b3-text-field") as NodeListOf<HTMLInputElement>;
                        textElements[0].value = "";
                        textElements[1].value = "";
                        (window.siyuan.menus.menu.element.querySelector(".b3-switch") as HTMLInputElement).checked = false;
                    }
                });
                const datetRect = dateElement.getBoundingClientRect();
                dateMenu.open({
                    x: datetRect.left,
                    y: datetRect.bottom
                });
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            const mSelectElement = hasClosestByAttribute(target, "data-type", "select") || hasClosestByAttribute(target, "data-type", "mSelect");
            if (mSelectElement) {
                const mSelectMenu = new Menu("custom-attr-av-select", () => {
                    const mSelect: { content: string, color: string }[] = [];
                    let mSelectHTML = "";
                    window.siyuan.menus.menu.element.querySelectorAll(".svg").forEach(item => {
                        const chipElement = item.parentElement.previousElementSibling.firstElementChild as HTMLElement;
                        const content = chipElement.textContent.trim();
                        const color = chipElement.dataset.color;
                        mSelect.push({
                            content,
                            color
                        });
                        mSelectHTML += `<span class="b3-chip b3-chip--middle" style="background-color:var(--b3-font-background${color});color:var(--b3-font-color${color})">${content}</span>`;
                    });
                    fetchPost("/api/av/setAttributeViewBlockAttr", {
                        avID: mSelectElement.dataset.avId,
                        keyID: mSelectElement.dataset.keyId,
                        rowID: mSelectElement.dataset.blockId,
                        cellID: mSelectElement.dataset.id,
                        value: {
                            mSelect
                        }
                    });
                    mSelectElement.innerHTML = mSelectHTML;
                });
                if (mSelectMenu.isOpen) {
                    return;
                }
                const names: string[] = [];
                mSelectElement.querySelectorAll(".b3-chip").forEach(item => {
                    names.push(item.textContent.trim());
                });
                JSON.parse(mSelectElement.dataset.options || "").forEach((item: { name: string, color: string }) => {
                    mSelectMenu.addItem({
                        iconHTML: "",
                        label: `<span class="b3-chip" data-color="${item.color}" style="height:24px;background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">
    <span class="fn__ellipsis">${item.name}</span>
</span>`,
                        accelerator: names.includes(item.name) ? '<svg class="svg" style="height: 30px; float: left;"><use xlink:href="#iconSelect"></use></svg>' : Constants.ZWSP,
                        click(element) {
                            const acceleratorElement = element.querySelector(".b3-menu__accelerator");
                            if (mSelectElement.dataset.type === "select") {
                                window.siyuan.menus.menu.element.querySelectorAll(".b3-menu__accelerator").forEach(itemElement => {
                                    if (itemElement.isSameNode(acceleratorElement)) {
                                        if (acceleratorElement.querySelector("svg")) {
                                            acceleratorElement.innerHTML = "";
                                        } else {
                                            acceleratorElement.innerHTML = '<svg class="svg" style="height: 30px; float: left;"><use xlink:href="#iconSelect"></use></svg>';
                                        }
                                    } else {
                                        itemElement.innerHTML = "";
                                    }
                                });
                                return false;
                            }
                            if (acceleratorElement.querySelector("svg")) {
                                acceleratorElement.innerHTML = "";
                            } else {
                                acceleratorElement.innerHTML = '<svg class="svg" style="height: 30px; float: left;"><use xlink:href="#iconSelect"></use></svg>';
                            }
                            return true;
                        }
                    });
                });
                const mSelecttRect = mSelectElement.getBoundingClientRect();
                mSelectMenu.open({
                    x: mSelecttRect.left,
                    y: mSelecttRect.bottom
                });
                event.stopPropagation();
                event.preventDefault();
                return;
            }
        });
        element.querySelectorAll(".b3-text-field--text").forEach((item: HTMLInputElement) => {
            item.addEventListener("change", () => {
                let value;
                if (["url", "text", "email", "phone"].includes(item.parentElement.dataset.type)) {
                    value = {
                        [item.parentElement.dataset.type]: {
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
