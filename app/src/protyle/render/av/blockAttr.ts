import {fetchPost} from "../../../util/fetch";
import {addCol, getColIconByType} from "./col";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {cellValueIsEmpty, popTextCell, updateCellsValue} from "./cell";
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
import {removeCompressURL} from "../../../util/image";
import {openDatabaseRowByData} from "./openDatabaseRow";
import {confirmDialog} from "../../../dialog/confirmDialog";
import {createEmptyAVValue, genAVAttributeRowHTML} from "./attributeValue";

interface IAVAttributeTableData {
    avID: string;
    blockIDs: string[];
    itemPositions?: {
        viewID: string;
        previousID: string;
        groups?: {
            groupID: string;
            previousID: string;
        }[];
    }[];
    keyValues: {
        key: {
            id: string;
            type: TAVCol;
        };
        values: IAVCellValue[];
    }[];
}

const attributeTableData = new WeakMap<HTMLElement, IAVAttributeTableData>();

let attributeViewRenderID = 0;

export const renderAVAttribute = (element: HTMLElement, id: string, protyle: IProtyle, cb?: (element: HTMLElement) => void,
                                  row?: { avID: string, itemID: string, valueID: string }) => {
    const renderID = (++attributeViewRenderID).toString();
    element.dataset.avAttributeRenderId = renderID;
    fetchPost("/api/av/getAttributeViewKeys", row ? {id, avID: row.avID, itemID: row.itemID, valueID: row.valueID} : {id}, (response) => {
        if (element.dataset.avAttributeRenderId !== renderID) {
            return;
        }
        let html = "";
        const tables = Array.isArray(response.data) ? response.data : [];
        tables.forEach((table: {
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
                    isDetached?: boolean,
                    type: TAVCol & IAVCellValue
                }[]
            }[],
            blockIDs: string[],
            avID: string
            avName: string
        }) => {
            const primaryValue = table.keyValues.find(item => item.key.type === "block")?.values[0] || table.keyValues[0]?.values[0];
            let innerHTML = `<div class="custom-attr__avheader">
    <div class="block__logo block__logo--icon popover__block" style="max-width:calc(100% - 40px)" data-id='${JSON.stringify(table.blockIDs)}'>
        <svg class="block__logoicon"><use xlink:href="#iconDatabase"></use></svg>
        <span class="fn__ellipsis">${table.avName || window.siyuan.languages.database}</span>
    </div>
    <div class="fn__flex-1"></div>
    <span data-type="remove" data-row-id="${primaryValue?.blockID || ""}" class="block__icon block__icon--warning block__icon--show b3-tooltips__w b3-tooltips" aria-label="${window.siyuan.languages.removeAV}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
</div>`;
            table.keyValues?.forEach(item => {
                const value = item.values[0] || createEmptyAVValue(item.key.id, item.key.type, primaryValue?.blockID);
                innerHTML += genAVAttributeRowHTML({
                    nodeID: id,
                    avID: table.avID,
                    keyID: item.key.id,
                    type: item.key.type,
                    name: item.key.name,
                    desc: item.key.desc,
                    icon: item.key.icon,
                    typeIcon: getColIconByType(item.key.type),
                    selectOptions: item.key.options,
                    value,
                    empty: cellValueIsEmpty(value),
                });
            });
            innerHTML += `<div class="fn__hr"></div>
<button data-type="addColumn" class="b3-button b3-button--cancel"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.newCol}</button>
<div class="fn__hr--b"></div><div class="fn__hr--b"></div>`;
            html += `<div data-av-id="${table.avID}" data-av-type="table" data-node-id="${id}" data-type="NodeAttributeView">${innerHTML}</div>`;

            if (element.innerHTML) {
                // 防止 blockElement 找不到
                const blockElement = element.querySelector(`[data-node-id="${id}"][data-av-id="${table.avID}"]`);
                if (blockElement) {
                    blockElement.innerHTML = innerHTML;
                } else {
                    element.insertAdjacentHTML("beforeend", `<div data-av-id="${table.avID}" data-av-type="table" data-node-id="${id}" data-type="NodeAttributeView">${innerHTML}</div>`);
                }
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
                const assetCellElement = element.querySelector<HTMLElement>('.custom-attr__avvalue[data-type="mAsset"][data-active="true"]');
                if (assetCellElement && document.querySelector(".av__panel .b3-form__upload")) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (files && files.length > 0) {
                        uploadFiles(protyle, files);
                    } else {
                        const textPlain = event.clipboardData.getData("text/plain");
                        const blockElement = hasClosestBlock(assetCellElement);
                        if (blockElement && textPlain) {
                            updateCellsValue(protyle, blockElement as HTMLElement, textPlain, [assetCellElement],
                                undefined, protyle.lute.Md2BlockDOM(textPlain));
                            document.querySelector(".av__panel")?.remove();
                        }
                    }
                }
            });
            element.addEventListener("click", (event) => {
                const backlinkToggleElement = hasClosestByAttribute(event.target as HTMLElement, "data-type", "av-backlinks-toggle");
                if (backlinkToggleElement) {
                    const backlinksElement = hasClosestByClassName(backlinkToggleElement, "custom-attr__avbacklinks");
                    if (backlinksElement) {
                        const expanded = backlinksElement.dataset.expanded !== "true";
                        backlinksElement.dataset.expanded = expanded.toString();
                        backlinkToggleElement.setAttribute("aria-expanded", expanded.toString());
                        backlinkToggleElement.querySelector("use").setAttribute("xlink:href", expanded ? "#iconDown" : "#iconRight");
                        event.stopPropagation();
                        return;
                    }
                }
                const backlinkOpenElement = hasClosestByAttribute(event.target as HTMLElement, "data-type", "av-backlink-open");
                if (backlinkOpenElement) {
                    openDatabaseRowByData(protyle, {
                        avID: backlinkOpenElement.dataset.avId,
                        databaseBlockID: backlinkOpenElement.dataset.databaseBlockId,
                        notebookID: backlinkOpenElement.dataset.boxId,
                        itemID: backlinkOpenElement.dataset.itemId,
                        valueID: backlinkOpenElement.dataset.valueId,
                        title: backlinkOpenElement.dataset.title,
                        boundBlockID: backlinkOpenElement.dataset.boundBlockId,
                        isDetached: backlinkOpenElement.dataset.detached === "true",
                    });
                    event.stopPropagation();
                    return;
                }
                const removeElement = hasClosestByAttribute(event.target as HTMLElement, "data-type", "remove");
                if (removeElement) {
                    const blockElement = hasClosestBlock(removeElement);
                    if (blockElement) {
                        const table = attributeTableData.get(blockElement as HTMLElement);
                        const rowID = removeElement.dataset.rowId;
                        const avID = blockElement.dataset.avId;
                        const primaryKeyValues = table?.keyValues.find(item => item.key.type === "block");
                        const primaryValue = primaryKeyValues?.values.find(item => item.blockID === rowID) || primaryKeyValues?.values[0];
                        if (!table || !rowID || !avID || !primaryValue || !table.blockIDs[0]) {
                            event.stopPropagation();
                            return;
                        }
                        const isDetached = primaryValue?.isDetached === true || !primaryValue?.block?.id;
                        const restoreBlockID = primaryValue?.block?.id || Lute.NewNodeID();
                        const undoOperations: IOperation[] = [];
                        undoOperations.push({
                            action: "insertAttrViewBlock",
                            avID,
                            blockID: table.blockIDs[0],
                            ignoreDefaultFill: true,
                            srcs: [{
                                itemID: rowID,
                                id: restoreBlockID,
                                isDetached,
                                content: primaryValue.block?.content || "",
                            }],
                        });
                        table.keyValues.forEach(item => {
                            const value = item.values.find(itemValue => itemValue.blockID === rowID) || item.values[0];
                            if (!value || item.key.type === "rollup") {
                                return;
                            }
                            const valueData = JSON.parse(JSON.stringify(value)) as IAVCellValue;
                            undoOperations.push({
                                action: "updateAttrViewCell",
                                avID,
                                keyID: item.key.id,
                                rowID,
                                data: valueData,
                            });
                        });
                        table.itemPositions?.forEach(position => {
                            undoOperations.push({
                                action: "sortAttrViewRow",
                                avID,
                                viewID: position.viewID,
                                id: rowID,
                                previousID: position.previousID,
                            });
                            position.groups?.forEach(group => {
                                undoOperations.push({
                                    action: "sortAttrViewRow",
                                    avID,
                                    viewID: position.viewID,
                                    id: rowID,
                                    previousID: group.previousID,
                                    groupID: group.groupID,
                                    targetGroupID: group.groupID,
                                });
                            });
                        });
                        const doOperations: IOperation[] = [{
                            action: "removeAttrViewBlock",
                            srcIDs: [rowID],
                            avID,
                        }];
                        confirmDialog(window.siyuan.languages.removeAV, window.siyuan.languages.confirmDelete + "?", () => {
                            removeElement.setAttribute("disabled", "true");
                            transaction(protyle, doOperations, undoOperations.length > 0 ? undoOperations : undefined, {
                                callback: () => {
                                    blockElement.remove();
                                    protyle.databaseAttributePanel?.refresh();
                                    if (!element.querySelector("[data-av-id]")) {
                                        window.siyuan.dialogs.find(item => {
                                            if (item.element.getAttribute("data-key") === Constants.DIALOG_ATTR) {
                                                item.destroy();
                                                return true;
                                            }
                                        });
                                    }
                                }
                            });
                        }, undefined, true);
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
        tables.forEach((table: IAVAttributeTableData) => {
            const blockElement = element.querySelector<HTMLElement>(`[data-node-id="${id}"][data-av-id="${table.avID}"]`);
            if (blockElement) {
                attributeTableData.set(blockElement, table);
            }
        });
        if (element.dataset.avInputBound !== "true") {
            element.dataset.avInputBound = "true";
            element.addEventListener("change", (event) => {
                const item = event.target as HTMLInputElement | HTMLTextAreaElement;
                if (!item.classList.contains("b3-text-field--text") || !item.parentElement.dataset.avId) {
                    return;
                }
                const blockElement = hasClosestBlock(item);
                if (blockElement) {
                    updateCellsValue(protyle, blockElement as HTMLElement, item.value, [item.parentElement]);
                }
            });
        }
        renderAttributeViewBacklinks(element, id, renderID, row, cb);
    });
};

const renderAttributeViewBacklinks = (element: HTMLElement, id: string, renderID: string,
                                      row?: { avID: string, itemID: string, valueID: string },
                                      cb?: (element: HTMLElement) => void) => {
    const oldBacklinksElement = element.querySelector<HTMLElement>(".custom-attr__avbacklinks");
    const expanded = oldBacklinksElement?.dataset.expanded === "true";
    fetchPost("/api/av/getAttributeViewBacklinks", row ? {
        id,
        avID: row.avID,
        itemID: row.itemID,
        valueID: row.valueID,
    } : {id}, (response) => {
        if (element.dataset.avAttributeRenderId !== renderID) {
            return;
        }
        const currentBacklinksElement = element.querySelector<HTMLElement>(".custom-attr__avbacklinks");
        const currentExpanded = currentBacklinksElement ? currentBacklinksElement.dataset.expanded === "true" : expanded;
        currentBacklinksElement?.remove();
        const data = response.data as {
            total: number,
            items: {
                avID: string,
                avName: string,
                databaseBlockID: string,
                boxID: string,
                databasePath: string,
                itemID: string,
                valueID: string,
                title: string,
                icon: string,
                boundBlockID: string,
                isDetached: boolean,
            }[]
        };
        if (data?.total > 0) {
            const countLabel = window.siyuan.languages.avBacklinks.replace("${count}", data.total.toString());
            let itemsHTML = "";
            data.items.forEach((item) => {
                const title = item.title || window.siyuan.languages.untitled;
                const databasePath = item.databasePath ? `${item.databasePath} / ${item.avName}` : item.avName;
                itemsHTML += `<button type="button" class="custom-attr__avbacklink" data-type="av-backlink-open" data-av-id="${escapeAttr(item.avID)}" data-database-block-id="${escapeAttr(item.databaseBlockID)}" data-box-id="${escapeAttr(item.boxID)}" data-item-id="${escapeAttr(item.itemID)}" data-value-id="${escapeAttr(item.valueID)}" data-title="${escapeAttr(title)}" data-bound-block-id="${escapeAttr(item.boundBlockID)}" data-detached="${item.isDetached}">
    ${item.icon ? `<span class="custom-attr__avbacklinkicon">${unicode2Emoji(item.icon, "", true)}</span>` : ""}
    <span class="fn__flex-1 fn__ellipsis">
        <span class="custom-attr__avbacklinktitle fn__ellipsis">${escapeHtml(title)}</span>
        <span class="custom-attr__avbacklinkpath fn__ellipsis">${escapeHtml(databasePath || window.siyuan.languages.database)}</span>
    </span>
    <span class="custom-attr__avbacklinkopen b3-tooltips b3-tooltips__w" aria-label="${escapeAttr(window.siyuan.languages.openBy)}"><svg><use xlink:href="#iconOpen"></use></svg></span>
</button>`;
            });
            element.insertAdjacentHTML("afterbegin", `<div class="custom-attr__avbacklinks" data-expanded="${currentExpanded}">
    <button type="button" class="custom-attr__avbacklinks-toggle" data-type="av-backlinks-toggle" aria-expanded="${currentExpanded}">
        <svg><use xlink:href="${currentExpanded ? "#iconDown" : "#iconRight"}"></use></svg>
        <svg><use xlink:href="#iconLink"></use></svg>
        <span class="fn__flex-1">${escapeHtml(countLabel)}</span>
    </button>
    <div class="custom-attr__avbacklinks-body">
        ${itemsHTML}
    </div>
</div>`);
        }
        cb?.(element);
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
                    previewImages([removeCompressURL(target.getAttribute("src"))]);
                } else {
                    openLink(protyle.app, target.dataset.url, event, event.ctrlKey || event.metaKey);
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
            document.querySelectorAll('.custom-attr__avvalue[data-type="mAsset"][data-active="true"]').forEach(item => {
                item.removeAttribute("data-active");
            });
            target.setAttribute("data-active", "true");
            target.tabIndex = -1;
            target.focus({preventScroll: true});
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
