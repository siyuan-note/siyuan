import {fetchPost} from "../../../util/fetch";
import {addCol, getColIconByType} from "./col";
import {escapeAttr} from "../../../util/escape";
import * as dayjs from "dayjs";
import {popTextCell} from "./cell";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {unicode2Emoji} from "../../../emoji";
import {transaction} from "../../wysiwyg/transaction";
import {openMenuPanel} from "./openMenuPanel";
import {uploadFiles} from "../../upload";

const genAVRollupHTML = (value: IAVCellValue) => {
    let html = "";
    switch (value.type) {
        case "block":
            if (value?.isDetached) {
                html = `<span data-id="${value.block?.id}">${value.block?.content || window.siyuan.languages.untitled}</span>`;
            } else {
                html = `<span data-type="block-ref" data-id="${value.block?.id}" data-subtype="s" class="av__celltext--ref">${value.block?.content || window.siyuan.languages.untitled}</span>`;
            }
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
            html = `<textarea style="resize: vertical" rows="${value.text.content.split("\n").length}" class="b3-text-field b3-text-field--text fn__flex-1">${value.text.content}</textarea>`;
            break;
        case "number":
            html = `<input value="${value.number.content || ""}" type="number" class="b3-text-field b3-text-field--text fn__flex-1">`;
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
            html = `<svg class="av__checkbox"><use xlink:href="#icon${value.checkbox.checked ? "Check" : "Uncheck"}"></use></svg>`;
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
            value?.relation?.contents?.forEach((item) => {
                if (item) {
                    const rollupText = genAVRollupHTML(item);
                    if (rollupText) {
                        html += rollupText + ",&nbsp;";
                    }
                }
            });
            if (html && html.endsWith(",&nbsp;")) {
                html = html.substring(0, html.length - 7);
            }
            break;
        case "rollup":
            value?.rollup?.contents?.forEach((item) => {
                const rollupText = ["select", "mSelect", "mAsset", "checkbox", "relation"].includes(item.type) ? genAVValueHTML(item) : genAVRollupHTML(item);
                if (rollupText) {
                    html += rollupText + ",&nbsp;";
                }
            });
            if (html && html.endsWith(",&nbsp;")) {
                html = html.substring(0, html.length - 7);
            }
            break;
    }
    return html;
};

export const renderAVAttribute = (element: HTMLElement, id: string, protyle: IProtyle, cb?: (element: HTMLElement) => void) => {
    fetchPost("/api/av/getAttributeViewKeys", {id}, (response) => {
        let html = "";
        response.data.forEach((table: {
            keyValues: {
                key: {
                    type: TAVCol,
                    name: string,
                    icon: string,
                    id: string,
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
            let innerHTML = `<div class="custom-attr__avheader block__logo popover__block" data-id='${JSON.stringify(table.blockIDs)}'>
    <div class="fn__flex-1"></div>
    <svg class="block__logoicon"><use xlink:href="#iconDatabase"></use></svg><span>${table.avName || window.siyuan.languages.database}</span>
    <div class="fn__flex-1"></div>
</div>`;
            table.keyValues?.forEach(item => {
                innerHTML += `<div class="block__icons av__row" data-id="${id}" data-col-id="${item.key.id}">
    <div class="block__icon" draggable="true"><svg><use xlink:href="#iconDrag"></use></svg></div>
    <div class="block__logo ariaLabel fn__pointer" data-type="editCol" data-position="parentW" aria-label="${escapeAttr(item.key.name)}">
        ${item.key.icon ? unicode2Emoji(item.key.icon, "block__logoicon", true) : `<svg class="block__logoicon"><use xlink:href="#${getColIconByType(item.key.type)}"></use></svg>`}
        <span>${item.key.name}</span>
    </div>
    <div data-av-id="${table.avID}" data-col-id="${item.values[0].keyID}" data-block-id="${item.values[0].blockID}" data-id="${item.values[0].id}" data-type="${item.values[0].type}" 
data-options="${item.key?.options ? escapeAttr(JSON.stringify(item.key.options)) : "[]"}"
class="fn__flex-1 fn__flex${["url", "text", "number", "email", "phone", "block"].includes(item.values[0].type) ? "" : " custom-attr__avvalue"}">
        ${genAVValueHTML(item.values[0])}
    </div>
</div>`;
            });
            innerHTML += `<div class="fn__hr"></div>
<div class="fn__flex">
    <div class="fn__space"></div><div class="fn__space"></div>
    <button data-type="addColumn" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.addAttr}</button>
</div><div class="fn__hr--b"></div>`;
            html += `<div data-av-id="${table.avID}" data-node-id="${id}" data-type="NodeAttributeView">${innerHTML}</div>`;

            if (element.innerHTML) {
                // 防止 blockElement 找不到
                element.querySelector(`div[data-node-id="${id}"][data-av-id="${table.avID}"]`).innerHTML = innerHTML;
            }
        });
        if (element.innerHTML === "") {
            let dragBlockElement: HTMLElement;
            element.addEventListener("dragstart", (event: DragEvent) => {
                const target = event.target as HTMLElement;
                window.siyuan.dragElement = target.parentElement;
                window.siyuan.dragElement.style.opacity = ".1";
                dragBlockElement = hasClosestBlock(window.siyuan.dragElement) as HTMLElement;

                const ghostElement = document.createElement("div");
                ghostElement.className = "block__icons";
                ghostElement.innerHTML = target.nextElementSibling.outerHTML;
                ghostElement.setAttribute("style", "width: 160px;position:fixed;opacity:.1;");
                document.body.append(ghostElement);
                event.dataTransfer.setDragImage(ghostElement, 0, 0);
                setTimeout(() => {
                    ghostElement.remove();
                });
            });
            element.addEventListener("drop", () => {
                window.siyuan.dragElement.style.opacity = "";
                const targetElement = element.querySelector(".dragover__bottom, .dragover__top") as HTMLElement;
                if (targetElement && dragBlockElement) {
                    const isBottom = targetElement.classList.contains("dragover__bottom");
                    const previousID = isBottom ? targetElement.dataset.colId : targetElement.previousElementSibling?.getAttribute("data-col-id");
                    const undoPreviousID = window.siyuan.dragElement.previousElementSibling?.getAttribute("data-col-id");
                    if (previousID !== undoPreviousID && previousID !== window.siyuan.dragElement.dataset.colId) {
                        transaction(protyle, [{
                            action: "sortAttrViewKey",
                            avID: dragBlockElement.dataset.avId,
                            previousID,
                            id: window.siyuan.dragElement.dataset.colId,
                        }], [{
                            action: "sortAttrViewKey",
                            avID: dragBlockElement.dataset.avId,
                            previousID: undoPreviousID,
                            id,
                        }]);
                        if (isBottom) {
                            targetElement.after(window.siyuan.dragElement);
                        } else {
                            targetElement.before(window.siyuan.dragElement);
                        }
                    }
                    targetElement.classList.remove("dragover__bottom", "dragover__top");
                }
                window.siyuan.dragElement = null;
            });
            element.addEventListener("dragover", (event: DragEvent) => {
                const target = event.target as HTMLElement;
                let targetElement = hasClosestByClassName(target, "av__row");
                if (!targetElement) {
                    targetElement = hasClosestByClassName(document.elementFromPoint(event.clientX, event.clientY - 1), "av__row");
                }
                if (!targetElement || targetElement.isSameNode(window.siyuan.dragElement) || !dragBlockElement) {
                    return;
                }
                const targetBlockElement = hasClosestBlock(targetElement);
                if (!targetBlockElement || !targetBlockElement.isSameNode(dragBlockElement)) {
                    return;
                }
                event.preventDefault();
                const nodeRect = targetElement.getBoundingClientRect();
                targetElement.classList.remove("dragover__bottom", "dragover__top");
                if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                    targetElement.classList.add("dragover__bottom");
                } else {
                    targetElement.classList.add("dragover__top");
                }
            });
            element.addEventListener("dragleave", () => {
                element.querySelectorAll(".dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                    item.classList.remove("dragover__bottom", "dragover__top");
                });
            });
            element.addEventListener("dragend", () => {
                if (window.siyuan.dragElement) {
                    window.siyuan.dragElement.style.opacity = "";
                    window.siyuan.dragElement = undefined;
                }
            });
            element.addEventListener("paste", (event) => {
                const files = event.clipboardData.files;
                if (document.querySelector(".av__panel .b3-form__upload") && files && files.length > 0) {
                    uploadFiles(protyle, files);
                }
            });
            element.addEventListener("click", (event) => {
                openEdit(protyle, element, event);
            });
            element.addEventListener("contextmenu", (event) => {
                openEdit(protyle, element, event);
            });
            element.innerHTML = html;
        }
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
                    if ("undefined" === item.value || !item.value) {
                        value = {
                            number: {
                                content: null,
                                isNotEmpty: false
                            }
                        };
                    } else {
                        value = {
                            number: {
                                content: parseFloat(item.value) || 0,
                                isNotEmpty: true
                            }
                        };
                    }
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
        if (cb) {
            cb(element);
        }
    });
};

const openEdit = (protyle: IProtyle, element:HTMLElement, event: MouseEvent) => {
    let target = event.target as HTMLElement;
    const blockElement = hasClosestBlock(target);
    if (!blockElement) {
        return;
    }
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
            element.querySelectorAll('.custom-attr__avvalue[data-type="mAsset"]').forEach(item => {
                item.removeAttribute("data-active");
            });
            target.setAttribute("data-active", "true");
            target.focus();
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
            const rowElements = blockElement.querySelectorAll(".av__row");
            const addMenu = addCol(protyle, blockElement, rowElements[rowElements.length - 1].getAttribute("data-col-id"));
            const addRect = target.getBoundingClientRect();
            addMenu.open({
                x: addRect.left,
                y: addRect.bottom,
                h: addRect.height
            });
            event.stopPropagation();
            event.preventDefault();
            break;
        } else if (type === "editCol") {
            openMenuPanel({
                protyle,
                blockElement,
                type: "edit",
                colId: target.parentElement.dataset.colId
            });
            event.stopPropagation();
            event.preventDefault();
            break;
        }
        target = target.parentElement;
    }
}
