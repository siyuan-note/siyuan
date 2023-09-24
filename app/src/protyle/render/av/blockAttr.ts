import {fetchPost} from "../../../util/fetch";
import {getColIconByType} from "./col";
import {escapeAttr} from "../../../util/escape";
import {hasClosestByAttribute} from "../../util/hasClosest";
import {Menu} from "../../../plugin/Menu";
import {Constants} from "../../../constants";
import * as dayjs from "dayjs";

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
        case "mAsset":
            value.mAsset?.forEach(item => {
                if (item.type === "image") {
                    html += `<img class="av__cellassetimg" src="${item.content}">`;
                } else {
                    html += `<span class="b3-chip b3-chip--middle av__celltext--url" data-url="${item.content}">${item.name}</span>`;
                }
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
