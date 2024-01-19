import {fetchPost} from "../../../util/fetch";
import {addCol, getColIconByType} from "./col";
import {escapeAttr} from "../../../util/escape";
import * as dayjs from "dayjs";
import {popTextCell} from "./cell";
import {hasClosestBlock} from "../../util/hasClosest";
import {unicode2Emoji} from "../../../emoji";

const genAVRollupHTML = (value: IAVCellValue) => {
    let html = "";
    switch (value.type) {
        case "block":
            html = value.block.content;
            break;
        case "text":
            html = value.text.content;
            break;
        case "number":
            html = value.number.formattedContent || value.number.content.toString();
            break;
        case "date":
            if (value[value.type] && value[value.type].isNotEmpty) {
                html = dayjs(value[value.type].content).format(value[value.type].isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
            }
            if (value[value.type] && value[value.type].hasEndDate && value[value.type].isNotEmpty && value[value.type].isNotEmpty2) {
                html += `<svg class="av__cellicon"><use xlink:href="#iconForward"></use></svg>${dayjs(value[value.type].content2).format(value[value.type].isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm")}`;
            }
            if (html) {
                html = `<span class="av__celltext">${html}</span>`;
            }
            break;
        case "url":
            html = value.url.content ? `<a class="fn__a" href="${value.url.content}" target="_blank">${value.url.content}</a>` : "";
            break;
        case "phone":
            html = value.phone.content ? `<a class="fn__a" href="tel:${value.phone.content}" target="_blank">${value.phone.content}</a>` : "";
            break;
        case "email":
            html = value.email.content ? `<a class="fn__a" href="mailto:${value.email.content}" target="_blank">${value.email.content}</a>` : "";
            break;
    }
    return html;
};

export const genAVValueHTML = (value: IAVCellValue) => {
    let html = "";
    switch (value.type) {
        case "block":
            html = `<div class="fn__flex-1">${value.block.content}</div>`;
            break;
        case "text":
            html = `<textarea rows="${value.text.content.split("\n").length}" class="b3-text-field b3-text-field--text fn__flex-1">${value.text.content}</textarea>`;
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
            html = `<span class="av__celltext" data-value='${JSON.stringify(value[value.type])}'>`;
            if (value[value.type] && value[value.type].isNotEmpty) {
                html += dayjs(value[value.type].content).format(value[value.type].isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
            }
            if (value[value.type] && value[value.type].hasEndDate && value[value.type].isNotEmpty && value[value.type].isNotEmpty2) {
                html += `<svg class="av__cellicon"><use xlink:href="#iconForward"></use></svg>${dayjs(value[value.type].content2).format(value[value.type].isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm")}`;
            }
            html += "</span>";
            break;
        case "created":
        case "updated":
            if (value[value.type].isNotEmpty) {
                html = `<span data-content="${value[value.type].content}">${dayjs(value[value.type].content).format("YYYY-MM-DD HH:mm")}</span>`;
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
        case "checkbox":
            html = `<svg class="av__checkbox" style="height: 17px;"><use xlink:href="#icon${value.checkbox.checked ? "Check" : "Uncheck"}"></use></svg>`;
            break;
        case "template":
            html = `<div class="fn__flex-1">${value.template.content}</div>`;
            break;
        case "email":
            html = `<input value="${value.email.content}" class="b3-text-field b3-text-field--text fn__flex-1">
<span class="fn__space"></span>
<a href="mailto:${value.email.content}" target="_blank" aria-label="${window.siyuan.languages.openBy}" class="block__icon block__icon--show fn__flex-center b3-tooltips__w b3-tooltips"><svg><use xlink:href="#iconEmail"></use></svg></a>`;
            break;
        case "relation":
            value.relation?.blockIDs?.forEach((item, index) => {
                html += `<span class="av__celltext--url" style="margin-right: 8px" data-id="${item}">${value.relation?.contents[index] || "Untitled"}</span>`;
            });
            break;
        case "rollup":
            value?.rollup?.contents?.forEach((item) => {
                const rollupText = ["select", "mSelect", "mAsset", "checkbox", "relation"].includes(item.type) ? genAVValueHTML(item) : genAVRollupHTML(item);
                if (rollupText) {
                    html += rollupText + ", ";
                }
            });
            if (html && html.endsWith(", ")) {
                html = html.substring(0, html.length - 2);
            }
            break;
    }
    return html;
};

export const renderAVAttribute = (element: HTMLElement, id: string, protyle: IProtyle) => {
    fetchPost("/api/av/getAttributeViewKeys", {id}, (response) => {
        let html = "";
        response.data.forEach((table: {
            keyValues: {
                key: {
                    type: TAVCol,
                    name: string,
                    icon: string,
                    options?: {
                        name: string,
                        color: string
                    }[]
                },
                values: {
                    keyID: string,
                    id: string,
                    blockID: string,
                    type: TAVCol & IAVCellValue
                }  []
            }[],
            blockIDs: string[],
            avID: string
            avName: string
        }) => {
            html += `<div data-av-id="${table.avID}" data-node-id="${id}" data-type="NodeAttributeView">
<div class="fn__flex custom-attr__avheader">
    <div class="block__logo popover__block" data-id='${JSON.stringify(table.blockIDs)}'>
        <svg class="block__logoicon"><use xlink:href="#iconDatabase"></use></svg><span>${table.avName || window.siyuan.languages.database}</span>
    </div>
    <div class="fn__flex-1"></div>
    <button data-type="addColumn" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.addAttr}</button>
</div>`;
            table.keyValues?.forEach(item => {
                html += `<div class="block__icons av__row" data-id="${id}">
    <div class="block__icon"><svg><use xlink:href="#iconDrag"></use></svg></div>
    <div class="block__logo ariaLabel" aria-label="${escapeAttr(item.key.name)}"">
        ${item.key.icon ? unicode2Emoji(item.key.icon, "block__logoicon", true) : `<svg class="block__logoicon"><use xlink:href="#${getColIconByType(item.key.type)}"></use></svg>`}
        <span>${item.key.name}</span>
    </div>
    <div data-av-id="${table.avID}" data-col-id="${item.values[0].keyID}" data-block-id="${item.values[0].blockID}" data-id="${item.values[0].id}" data-type="${item.values[0].type}" 
data-options="${item.key?.options ? escapeAttr(JSON.stringify(item.key.options)) : "[]"}"
class="fn__flex-1 fn__flex${["url", "text", "number", "email", "phone"].includes(item.values[0].type) ? "" : " custom-attr__avvalue"}">
        ${genAVValueHTML(item.values[0])}
    </div>
</div>`;
            });
            html += "</div>";
        });
        if (element.innerHTML === "") {
            element.addEventListener("click", (event) => {
                let target = event.target as HTMLElement;
                while (target && !element.isSameNode(target)) {
                    const type = target.getAttribute("data-type");
                    if (type === "date") {
                        popTextCell(protyle, [target], "date");
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (type === "select" || type === "mSelect") {
                        popTextCell(protyle, [target], target.getAttribute("data-type") as TAVCol);
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (type === "mAsset") {
                        popTextCell(protyle, [target], "mAsset");
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (type === "checkbox") {
                        popTextCell(protyle, [target], "checkbox");
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (type === "relation") {
                        popTextCell(protyle, [target], "relation");
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (type === "template") {
                        popTextCell(protyle, [target], "template");
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (type === "rollup") {
                        popTextCell(protyle, [target], "rollup");
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    } else if (type === "addColumn") {
                        const addMenu = addCol(protyle, hasClosestBlock(target) as HTMLElement, "");
                        const addRect = target.getBoundingClientRect();
                        addMenu.open({
                            x: addRect.left,
                            y: addRect.bottom,
                            h: addRect.height
                        });
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    }
                    target = target.parentElement;
                }
            });
        }
        element.innerHTML = html;
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
