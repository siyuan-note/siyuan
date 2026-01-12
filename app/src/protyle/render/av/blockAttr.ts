import {fetchPost} from "../../../util/fetch";
import {addCol, getColIconByType} from "./col";
import {escapeAriaLabel, escapeAttr, escapeHtml} from "../../../util/escape";
import * as dayjs from "dayjs";
import {popTextCell, updateCellsValue} from "./cell";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {openEmojiPanel, unicode2Emoji} from "../../../emoji";
import {transaction} from "../../wysiwyg/transaction";
import {openMenuPanel} from "./openMenuPanel";
import {uploadFiles} from "../../upload";
import {openLink} from "../../../editor/openLink";
import {dragUpload, editAssetItem} from "./asset";
import {previewImages} from "../../preview/image";
/// #if !BROWSER
import {webUtils} from "electron";
/// #endif
import {isBrowser} from "../../../util/functions";
import {Constants} from "../../../constants";
import {getCompressURL} from "../../../util/image";

const genAVRollupHTML = (value: IAVCellValue) => {
    let html = "";
    const dataValue: IAVCellDateValue = value[value.type as "date"];
    switch (value.type) {
        case "block":
            if (value?.isDetached) {
                html = `<span>${value.block?.content || window.siyuan.languages.untitled}</span>`;
            } else {
                html = `<span data-type="block-ref" data-id="${value.block.id}" data-subtype="s" class="av__celltext--ref">${value.block?.content || window.siyuan.languages.untitled}</span>`;
            }
            break;
        case "text":
            html = value.text.content;
            break;
        case "number":
            html = value.number.formattedContent || value.number.content.toString();
            break;
        case "date":
        case "updated":
        case "created":
            if (dataValue.formattedContent) {
                html = dataValue.formattedContent;
            } else {
                if (dataValue && dataValue.isNotEmpty) {
                    html = dayjs(dataValue.content).format(dataValue.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
                }
                if (dataValue && dataValue.hasEndDate && dataValue.isNotEmpty && dataValue.isNotEmpty2) {
                    html = `<svg class="av__cellicon"><use xlink:href="#iconForward"></use></svg>${dayjs(dataValue.content2).format(dataValue.isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm")}`;
                }
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
            html = `<input data-id="${value.block.id}" value="${escapeAttr(value.block.content)}" type="text" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">`;
            break;
        case "text":
            html = `<textarea style="resize: vertical" rows="${(value.text?.content || "").split("\n").length}" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">${value.text?.content || ""}</textarea>`;
            break;
        case "number":
            html = `<input value="${value.number.isNotEmpty ? value.number.content : ""}" type="number" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">
<span class="fn__space"></span><span class="fn__flex-center ft__on-surface b3-tooltips__w b3-tooltips" aria-label="${window.siyuan.languages.format}">${value.number.formattedContent}</span><span class="fn__space"></span>`;
            break;
        case "mSelect":
        case "select":
            value.mSelect?.forEach((item, index) => {
                if (value.type === "select" && index > 0) {
                    return;
                }
                html += `<span class="b3-chip b3-chip--middle" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">${escapeHtml(item.content)}</span>`;
            });
            break;
        case "mAsset":
            value.mAsset?.forEach(item => {
                if (item.type === "image") {
                    html += `<img loading="lazy" class="av__cellassetimg ariaLabel" aria-label="${item.content}" src="${getCompressURL(item.content)}">`;
                } else {
                    html += `<span class="b3-chip b3-chip--middle av__celltext--url ariaLabel" aria-label="${escapeAttr(item.content)}" data-name="${escapeAttr(item.name)}" data-url="${escapeAttr(item.content)}">${item.name || item.content}</span>`;
                }
            });
            break;
        case "date":
            html = `<span class="av__celltext" data-value='${JSON.stringify(value[value.type])}' placeholder="${window.siyuan.languages.empty}">`;
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
            html = `<input value="${value.url.content}" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">
<span class="fn__space"></span>
<a ${value.url.content ? `href="${value.url.content}"` : ""} target="_blank" aria-label="${window.siyuan.languages.openBy}" class="block__icon block__icon--show fn__flex-center b3-tooltips__w b3-tooltips"><svg><use xlink:href="#iconLink"></use></svg></a>`;
            break;
        case "phone":
            html = `<input value="${value.phone.content}" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">
<span class="fn__space"></span>
<a ${value.phone.content ? `href="tel:${value.phone.content}"` : ""} target="_blank" aria-label="${window.siyuan.languages.openBy}" class="block__icon block__icon--show fn__flex-center b3-tooltips__w b3-tooltips"><svg><use xlink:href="#iconPhone"></use></svg></a>`;
            break;
        case "checkbox":
            html = `<svg class="av__checkbox"><use xlink:href="#icon${value.checkbox.checked ? "Check" : "Uncheck"}"></use></svg>`;
            break;
        case "template":
            html = `<div class="fn__flex-1" placeholder="${window.siyuan.languages.empty}">${value.template.content}</div>`;
            break;
        case "email":
            html = `<input value="${value.email.content}" class="b3-text-field b3-text-field--text fn__flex-1" placeholder="${window.siyuan.languages.empty}">
<span class="fn__space"></span>
<a ${value.email.content ? `href="mailto:${value.email.content}"` : ""} target="_blank" aria-label="${window.siyuan.languages.openBy}" class="block__icon block__icon--show fn__flex-center b3-tooltips__w b3-tooltips"><svg><use xlink:href="#iconEmail"></use></svg></a>`;
            break;
        case "relation":
            value?.relation?.contents?.forEach((item, index) => {
                if (item && item.block) {
                    const rowID = value.relation.blockIDs[index];
                    if (item?.isDetached) {
                        html += `<span data-row-id="${rowID}" class="av__cell--relation"><span>➖<span class="fn__space--5"></span></span><span class="av__celltext">${Lute.EscapeHTMLStr(item.block.content || window.siyuan.languages.untitled)}</span></span>`;
                    } else {
                        // data-block-id 用于更新 emoji
                        html += `<span data-row-id="${rowID}" class="av__cell--relation" data-block-id="${item.block.id}"><span class="b3-menu__avemoji" data-unicode="${item.block.icon || ""}">${unicode2Emoji(item.block.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].file)}</span><span data-type="block-ref" data-id="${item.block.id}" data-subtype="s" class="av__celltext av__celltext--ref">${Lute.EscapeHTMLStr(item.block.content || window.siyuan.languages.untitled)}</span></span>`;
                    }
                }
            });
            if (html && html.endsWith(", ")) {
                html = html.substring(0, html.length - 2);
            }
            break;
        case "rollup":
            value?.rollup?.contents?.forEach((item) => {
                const rollupText = ["template", "select", "mSelect", "mAsset", "checkbox", "relation"].includes(item.type) ? genAVValueHTML(item) : genAVRollupHTML(item);
                if (rollupText) {
                    html += rollupText.replace("fn__flex-1", "") + ",&nbsp;";
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
                    desc: string,
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
            let innerHTML = `<div class="custom-attr__avheader">
    <div class="block__logo popover__block" style="max-width:calc(100% - 40px)" data-id='${JSON.stringify(table.blockIDs)}'>
        <svg class="block__logoicon"><use xlink:href="#iconDatabase"></use></svg>
        <span class="fn__ellipsis">${table.avName || window.siyuan.languages.database}</span>
    </div>
    <div class="fn__flex-1"></div>
    <span data-type="remove" data-row-id="${table.keyValues && table.keyValues[0].values[0].blockID}" class="block__icon block__icon--warning block__icon--show b3-tooltips__w b3-tooltips" aria-label="${window.siyuan.languages.removeAV}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
</div>`;
            table.keyValues?.forEach(item => {
                innerHTML += `<div class="block__icons av__row" data-id="${id}" data-col-id="${item.key.id}">
    <div class="block__icon" draggable="true"><svg><use xlink:href="#iconDrag"></use></svg></div>
    <div class="block__logo ariaLabel fn__pointer" data-type="editCol" data-position="parentW" aria-label="${escapeAriaLabel(item.key.name)}<div class='ft__on-surface'>${escapeAriaLabel(item.key.desc)}</div>">
        ${item.key.icon ? unicode2Emoji(item.key.icon, "block__logoicon", true) : `<svg class="block__logoicon"><use xlink:href="#${getColIconByType(item.key.type)}"></use></svg>`}
        <span>${escapeHtml(item.key.name)}</span>
    </div>
    <div data-av-id="${table.avID}" data-col-id="${item.values[0].keyID}" data-row-id="${item.values[0].blockID}" data-id="${item.values[0].id}" data-type="${item.values[0].type}" 
data-options="${item.key?.options ? escapeAttr(JSON.stringify(item.key.options)) : "[]"}" 
${["text", "number", "date", "url", "phone", "template", "email"].includes(item.values[0].type) ? "" : `placeholder="${window.siyuan.languages.empty}"`}  
class="fn__flex-1 fn__flex${["url", "text", "number", "email", "phone", "block"].includes(item.values[0].type) ? "" : " custom-attr__avvalue"}${["created", "updated"].includes(item.values[0].type) ? " custom-attr__avvalue--readonly" : ""}">${genAVValueHTML(item.values[0])}</div>
</div>`;
            });
            innerHTML += `<div class="fn__hr"></div>
<button data-type="addColumn" class="b3-button b3-button--cancel"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.newCol}</button>
<div class="fn__hr--b"></div><div class="fn__hr--b"></div>`;
            html += `<div data-av-id="${table.avID}" data-av-type="table" data-node-id="${id}" data-type="NodeAttributeView">${innerHTML}</div>`;

            if (element.innerHTML) {
                // 防止 blockElement 找不到
                element.querySelector(`[data-node-id="${id}"][data-av-id="${table.avID}"]`).innerHTML = innerHTML;
            }
        });
        if (element.innerHTML === "") {
            let dragBlockElement: HTMLElement;
            element.addEventListener("dragstart", (event: DragEvent) => {
                const target = event.target as HTMLElement;
                window.siyuan.dragElement = target.parentElement;
                window.siyuan.dragElement.style.opacity = ".38";
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
            element.addEventListener("drop", (event) => {
                counter = 0;
                if (protyle.disabled) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
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
                } else if (!window.siyuan.dragElement && event.dataTransfer.types[0] === "Files") {
                    const cellElement = element.querySelector(".custom-attr__avvalue--active") as HTMLElement;
                    if (cellElement) {
                        if (event.dataTransfer.types[0] === "Files" && !isBrowser()) {
                            const files: ILocalFiles[] = [];
                            for (let i = 0; i < event.dataTransfer.files.length; i++) {
                                files.push({
                                    path: webUtils.getPathForFile(event.dataTransfer.files[i]),
                                    size: event.dataTransfer.files[i].size
                                });
                            }
                            dragUpload(files, protyle, cellElement);
                        }
                    }
                }
                if (window.siyuan.dragElement) {
                    window.siyuan.dragElement.style.opacity = "";
                    window.siyuan.dragElement = undefined;
                }
            });
            element.addEventListener("dragover", (event: DragEvent) => {
                const target = event.target as HTMLElement;
                let targetElement: HTMLElement | false;
                if (event.dataTransfer.types.includes("Files")) {
                    element.querySelectorAll(".custom-attr__avvalue--active").forEach((item: HTMLElement) => {
                        item.classList.remove("custom-attr__avvalue--active");
                    });
                    targetElement = hasClosestByClassName(target, "custom-attr__avvalue");
                    if (targetElement && targetElement.getAttribute("data-type") === "mAsset") {
                        targetElement.classList.add("custom-attr__avvalue--active");
                        event.preventDefault();
                    }
                    return;
                }
                targetElement = hasClosestByClassName(target, "av__row");
                if (!targetElement) {
                    targetElement = hasClosestByClassName(document.elementFromPoint(event.clientX, event.clientY - 1), "av__row");
                }
                if (!targetElement || targetElement === window.siyuan.dragElement || !dragBlockElement) {
                    return;
                }
                const targetBlockElement = hasClosestBlock(targetElement);
                if (!targetBlockElement || targetBlockElement !== dragBlockElement) {
                    return;
                }
                event.preventDefault();
                const nodeRect = targetElement.getBoundingClientRect();
                element.querySelectorAll(".dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                    item.classList.remove("dragover__bottom", "dragover__top");
                });
                if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                    targetElement.classList.add("dragover__bottom");
                } else {
                    targetElement.classList.add("dragover__top");
                }
            });
            let counter = 0;
            element.addEventListener("dragleave", () => {
                counter--;
                if (counter === 0) {
                    element.querySelectorAll(".dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                        item.classList.remove("dragover__bottom", "dragover__top");
                    });
                }
            });
            element.addEventListener("dragenter", (event) => {
                event.preventDefault();
                counter++;
            });
            element.addEventListener("dragend", () => {
                if (window.siyuan.dragElement) {
                    window.siyuan.dragElement.style.opacity = "";
                    window.siyuan.dragElement = undefined;
                }
            });
            element.addEventListener("paste", (event) => {
                const files = event.clipboardData.files;
                if (document.querySelector(".av__panel .b3-form__upload")) {
                    if (files && files.length > 0) {
                        uploadFiles(protyle, files);
                    } else {
                        const textPlain = event.clipboardData.getData("text/plain");
                        const target = event.target as HTMLElement;
                        const blockElement = hasClosestBlock(target);
                        const cellsElement = hasClosestByAttribute(target, "data-type", "mAsset");
                        if (blockElement && cellsElement && textPlain) {
                            updateCellsValue(protyle, blockElement as HTMLElement, textPlain, [cellsElement], undefined, protyle.lute.Md2BlockDOM(textPlain));
                            document.querySelector(".av__panel")?.remove();
                        }
                    }
                }
            });
            element.addEventListener("click", (event) => {
                const removeElement = hasClosestByAttribute(event.target as HTMLElement, "data-type", "remove");
                if (removeElement) {
                    const blockElement = hasClosestBlock(removeElement);
                    if (blockElement) {
                        transaction(protyle, [{
                            action: "removeAttrViewBlock",
                            srcIDs: [removeElement.dataset.rowId],
                            avID: blockElement.dataset.avId,
                        }, {
                            action: "doUpdateUpdated",
                            id: removeElement.dataset.rowId,
                            data: dayjs().format("YYYYMMDDHHmmss"),
                        }]);
                        blockElement.remove();
                        if (!element.innerHTML) {
                            window.siyuan.dialogs.find(item => {
                                if (item.element.getAttribute("data-key") === Constants.DIALOG_ATTR) {
                                    item.destroy();
                                    return true;
                                }
                            });
                        }
                    }
                    event.stopPropagation();
                    return;
                }
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
                const type = item.parentElement.dataset.type;
                if (["url", "text", "email", "phone"].includes(type)) {
                    value = {
                        [type]: {
                            content: item.value
                        }
                    };
                    if (type !== "text") {
                        const linkElement = item.parentElement.querySelector("a");
                        if (item.value) {
                            linkElement.setAttribute("href", (type === "url" ? "" : (type === "email" ? "mailto:" : "tel:")) + item.value);
                        } else {
                            linkElement.removeAttribute("href");
                        }
                    }
                } else if (type === "number") {
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
                } else if (type === "block") {
                    value = {
                        block: {
                            content: item.value,
                            id: item.dataset.id,
                        },
                        isDetached: false
                    };
                }
                fetchPost("/api/av/setAttributeViewBlockAttr", {
                    avID: item.parentElement.dataset.avId,
                    keyID: item.parentElement.dataset.colId,
                    itemID: item.parentElement.dataset.rowId,
                    value
                }, (setResponse) => {
                    if (type === "number") {
                        item.parentElement.querySelector(".fn__flex-center").textContent = setResponse.data.value.number.formattedContent;
                    } else if (type === "block" && !item.value) {
                        item.value = setResponse.data.value.block.content;
                    }
                });
            });
        });
        if (cb) {
            cb(element);
        }
    });
};

const openEdit = (protyle: IProtyle, element: HTMLElement, event: MouseEvent) => {
    let target = event.target as HTMLElement;
    const blockElement = hasClosestBlock(target);
    if (!blockElement) {
        return;
    }
    while (target && element !== target) {
        const type = target.getAttribute("data-type");
        if (target.classList.contains("b3-menu__avemoji")) {
            const rect = target.getBoundingClientRect();
            openEmojiPanel(target.nextElementSibling.getAttribute("data-id"), "doc", {
                x: rect.left,
                y: rect.bottom,
                h: rect.height,
                w: rect.width,
            }, (unicode) => {
                target.innerHTML = unicode2Emoji(unicode || window.siyuan.storage[Constants.LOCAL_IMAGES].file);
            }, target.querySelector("img"));
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (target.classList.contains("av__celltext--url") || target.classList.contains("av__cellassetimg")) {
            if (event.type === "contextmenu" || (!target.dataset.url && target.tagName !== "IMG")) {
                let index = 0;
                Array.from(target.parentElement.children).find((item, i) => {
                    if (item === target) {
                        index = i;
                        return true;
                    }
                });
                editAssetItem({
                    protyle,
                    cellElements: [target.parentElement],
                    blockElement: hasClosestBlock(target) as HTMLElement,
                    content: target.tagName === "IMG" ? target.getAttribute("src") : target.getAttribute("data-url"),
                    type: target.tagName === "IMG" ? "image" : "file",
                    name: target.tagName === "IMG" ? "" : target.getAttribute("data-name"),
                    index,
                    rect: target.getBoundingClientRect()
                });
            } else {
                if (target.tagName === "IMG") {
                    previewImages([target.getAttribute("src")]);
                } else {
                    openLink(protyle, target.dataset.url, event, event.ctrlKey || event.metaKey);
                }
            }
            event.stopPropagation();
            event.preventDefault();
            break;
        } else if (type === "date") {
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
};

export const isCustomAttr = (cellElement: Element) => {
    return !!cellElement.getAttribute("data-av-id");
};
