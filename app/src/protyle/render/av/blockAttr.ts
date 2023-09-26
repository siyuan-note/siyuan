import {fetchPost} from "../../../util/fetch";
import {getColIconByType} from "./col";
import {escapeAttr} from "../../../util/escape";
import {hasClosestByAttribute} from "../../util/hasClosest";
import * as dayjs from "dayjs";
import {popTextCell} from "./cell";

export const genAVValueHTML = (value: IAVCellValue) => {
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

export const renderAVAttribute = (element: HTMLElement, id: string, protyle?: IProtyle) => {
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
                html += `<div class="block__icons" data-id="${id}">
    <div class="block__logo">
        <svg><use xlink:href="#${getColIconByType(item.key.type)}"></use></svg>
        <span>${item.key.name}</span>
    </div>
    <div data-av-id="${table.avID}" data-col-id="${item.values[0].keyID}" data-block-id="${item.values[0].blockID}" data-id="${item.values[0].id}" data-type="${item.values[0].type}" 
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
                popTextCell(protyle, [dateElement], "date");
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            const mSelectElement = hasClosestByAttribute(target, "data-type", "select") || hasClosestByAttribute(target, "data-type", "mSelect");
            if (mSelectElement) {
                popTextCell(protyle, [mSelectElement], mSelectElement.getAttribute("data-type") as TAVCol);
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            const mAssetElement = hasClosestByAttribute(target, "data-type", "mAsset");
            if (mAssetElement) {
                popTextCell(protyle, [mAssetElement], "mAsset");
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
                    keyID: item.parentElement.dataset.colId,
                    rowID: item.parentElement.dataset.blockId,
                    cellID: item.parentElement.dataset.id,
                    value
                });
            });
        });
    });
};
