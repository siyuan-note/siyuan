import { transaction } from "../../../wysiwyg/transaction";
import { getSortsHTML, bindSortsEvent } from "../sort";
import { updateAssetCell } from "../asset";
import { getColId, getEditHTML, bindEditEvent } from "../col";
import { getSelectHTML, bindSelectEvent } from "../select";
import { updateCellsValue } from "../cell";
import { getLanguageByIndex } from "../groups";
import { hasClosestByAttribute } from "../../../util/hasClosest";
import { getPropertiesHTML } from "./properties";
import type { IAVPanelContext } from "./types";
export const bindAVPanelDrag = (context: IAVPanelContext) => {
    let counter = 0;
    context.avPanelElement.addEventListener("dragstart", (event: DragEvent) => {
        const sourceElement = event.target as HTMLElement;
        counter = 0;
        const conditionalRule = sourceElement.closest("[data-conditional-drag]")?.closest<HTMLElement>("[data-rule-id]");
        window.siyuan.dragElement = conditionalRule || sourceElement.closest<HTMLElement>('[data-option-row="true"]') || sourceElement;
        if (conditionalRule) {
            event.dataTransfer.setDragImage(conditionalRule, 16, 14);
        }
        if (window.siyuan.dragElement.dataset.relationType === "selected") {
            const primaryElement = window.siyuan.dragElement.querySelector(".av__relation-table-primary");
            if (primaryElement) {
                const ghostElement = primaryElement.cloneNode(true) as HTMLElement;
                ghostElement.className = "av__relation-drag-ghost";
                ghostElement.removeAttribute("style");
                ghostElement.querySelector(".av__relation-row-open")?.remove();
                document.body.append(ghostElement);
                event.dataTransfer.setDragImage(ghostElement, 16, 17);
                setTimeout(() => {
                    ghostElement.remove();
                });
            }
        }
        window.siyuan.dragElement.style.opacity = ".38";
        return;
    });
    context.avPanelElement.addEventListener("drop", (event) => {
        counter = 0;
        if (!window.siyuan.dragElement) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        window.siyuan.dragElement.style.opacity = "";
        const sourceElement = window.siyuan.dragElement;
        window.siyuan.dragElement = undefined;
        if (context.options.protyle && context.options.protyle.disabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!context.options.protyle && window.siyuan.config.readonly) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const targetElement = context.avPanelElement.querySelector(".dragover__bottom, .dragover__top") as HTMLElement;
        if (!targetElement) {
            return;
        }
        const isTop = targetElement.classList.contains("dragover__top");
        const sourceId = sourceElement.dataset.id;
        const targetId = targetElement.dataset.id;
        // 排序条件拖拽排序
        if (targetElement.querySelector('[data-type="removeSort"]')) {
            const changeData = context.data.view.sorts;
            const oldData = Object.assign([], changeData);
            let sortFilter: IAVSort;
            changeData.find((sort, index: number) => {
                if (sort.column === sourceId) {
                    sortFilter = changeData.splice(index, 1)[0];
                    return true;
                }
            });
            changeData.find((sort, index: number) => {
                if (sort.column === targetId) {
                    if (isTop) {
                        changeData.splice(index, 0, sortFilter);
                    }
                    else {
                        changeData.splice(index + 1, 0, sortFilter);
                    }
                    return true;
                }
            });
            transaction(context.options.protyle, [{
                    action: "setAttrViewSorts",
                    avID: context.avID,
                    data: changeData,
                    blockID: context.blockID
                }], [{
                    action: "setAttrViewSorts",
                    avID: context.avID,
                    data: oldData,
                    blockID: context.blockID
                }]);
            context.menuElement.innerHTML = getSortsHTML(context.fields, context.data.view.sorts);
            bindSortsEvent(context.options.protyle, context.menuElement, context.data, context.blockID);
            return;
        }
        // 视图切换拖拽排序
        if (targetElement.querySelector('[data-type="av-view-edit"]')) {
            transaction(context.options.protyle, [{
                    action: "sortAttrViewView",
                    avID: context.avID,
                    blockID: context.blockID,
                    id: sourceId,
                    previousID: isTop ? targetElement.previousElementSibling?.getAttribute("data-id") : targetElement.getAttribute("data-id")
                }], [{
                    action: "sortAttrViewView",
                    avID: context.avID,
                    blockID: context.blockID,
                    id: sourceId,
                    previousID: sourceElement.previousElementSibling?.getAttribute("data-id")
                }]);
            if (isTop) {
                targetElement.before(sourceElement);
                targetElement.classList.remove("dragover__top");
            }
            else {
                targetElement.after(sourceElement);
                targetElement.classList.remove("dragover__bottom");
            }
            return;
        }
        // 资源拖拽排序
        if (targetElement.querySelector('[data-type="editAssetItem"]')) {
            if (isTop) {
                targetElement.before(sourceElement);
            }
            else {
                targetElement.after(sourceElement);
            }
            const replaceValue: IAVCellAssetValue[] = [];
            Array.from(targetElement.parentElement.children).forEach((item: HTMLElement) => {
                if (["image", "file"].includes(item.dataset.type)) {
                    replaceValue.push({
                        content: item.dataset.content,
                        name: item.dataset.name,
                        type: item.dataset.type as "image" | "file",
                    });
                }
            });
            updateAssetCell({
                protyle: context.options.protyle,
                cellElements: context.options.cellElements,
                replaceValue,
                blockElement: context.options.blockElement
            });
            return;
        }
        // 选项拖拽排序
        if (targetElement.querySelector('[data-type="setColOption"]')) {
            const colId = context.options.cellElements ? getColId(context.options.cellElements[0], context.data.viewType) : context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
            const changeData = context.fields.find((column) => column.id === colId).options;
            const oldData = Object.assign([], changeData);
            let targetOption: {
                name: string;
                color: string;
            };
            changeData.find((option, index: number) => {
                if (option.name === sourceElement.dataset.name) {
                    targetOption = changeData.splice(index, 1)[0];
                    return true;
                }
            });
            changeData.find((option, index: number) => {
                if (option.name === targetElement.dataset.name) {
                    if (isTop) {
                        changeData.splice(index, 0, targetOption);
                    }
                    else {
                        changeData.splice(index + 1, 0, targetOption);
                    }
                    return true;
                }
            });
            transaction(context.options.protyle, [{
                    action: "updateAttrViewColOptions",
                    id: colId,
                    avID: context.avID,
                    data: changeData,
                }], [{
                    action: "updateAttrViewColOptions",
                    id: colId,
                    avID: context.avID,
                    data: oldData,
                }]);
            const oldScroll = context.menuElement.querySelector(".b3-menu__items").scrollTop;
            if (context.options.cellElements) {
                context.menuElement.innerHTML = getSelectHTML(context.fields, context.options.cellElements, false, context.options.blockElement);
                bindSelectEvent(context.options.protyle, context.data, context.menuElement, context.options.cellElements, context.options.blockElement);
            }
            else {
                context.menuElement.innerHTML = getEditHTML({
                    protyle: context.options.protyle,
                    data: context.data,
                    colId,
                    isCustomAttr: context.isCustomAttr
                });
                bindEditEvent({ protyle: context.options.protyle, data: context.data, menuElement: context.menuElement, isCustomAttr: context.isCustomAttr, blockID: context.blockID });
            }
            context.menuElement.querySelector(".b3-menu__items").scrollTop = oldScroll;
            return;
        }
        // 关联列拖拽排序
        if (targetElement.getAttribute("data-type") === "setRelationCell") {
            if (targetElement.dataset.relationType !== "selected") {
                targetElement.classList.remove("dragover__bottom", "dragover__top");
                return;
            }
            if (isTop) {
                targetElement.before(sourceElement);
            }
            else {
                targetElement.after(sourceElement);
            }
            targetElement.classList.remove("dragover__bottom", "dragover__top");
            const blockIDs: string[] = [];
            const contents: IAVCellValue[] = [];
            targetElement.parentElement.querySelectorAll(".fn__grab").forEach(item => {
                const dateElement = item.nextElementSibling as HTMLElement;
                blockIDs.push(dateElement.parentElement.dataset.rowId);
                contents.push({
                    isDetached: !dateElement.style.color,
                    type: "block",
                    block: {
                        content: dateElement.textContent,
                        id: dateElement.dataset.id
                    }
                });
            });
            updateCellsValue(context.options.protyle, context.options.blockElement as HTMLElement, {
                blockIDs,
                contents,
            }, context.options.cellElements);
            return;
        }
        // 字段列表拖拽排序
        if (targetElement.getAttribute("data-type") === "editCol") {
            const previousID = (isTop ? targetElement.previousElementSibling?.getAttribute("data-id") : targetElement.getAttribute("data-id")) || "";
            const undoPreviousID = sourceElement.previousElementSibling?.getAttribute("data-id") || "";
            if (previousID !== undoPreviousID && previousID !== sourceId) {
                transaction(context.options.protyle, [{
                        action: "sortAttrViewCol",
                        avID: context.avID,
                        previousID,
                        id: sourceId,
                        blockID: context.blockID,
                    }], [{
                        action: "sortAttrViewCol",
                        avID: context.avID,
                        previousID: undoPreviousID,
                        id: sourceId,
                        blockID: context.blockID
                    }]);
                let column: IAVColumn;
                context.fields.find((item, index: number) => {
                    if (item.id === sourceId) {
                        column = context.fields.splice(index, 1)[0];
                        return true;
                    }
                });
                context.fields.find((item, index: number) => {
                    if (item.id === targetId) {
                        if (isTop) {
                            context.fields.splice(index, 0, column);
                        }
                        else {
                            context.fields.splice(index + 1, 0, column);
                        }
                        return true;
                    }
                });
            }
            context.menuElement.innerHTML = getPropertiesHTML(context.fields, context.data.viewType);
            return;
        }
        // 分组项拖拽排序
        if (targetElement.querySelector('[data-type="hideGroup"]')) {
            const previousID = (isTop ? targetElement.previousElementSibling?.getAttribute("data-id") : targetElement.getAttribute("data-id")) || "";
            const undoPreviousID = sourceElement.previousElementSibling?.getAttribute("data-id") || "";
            if (previousID !== undoPreviousID && previousID !== sourceId) {
                const oldGroup: IAVGroup = {
                    ...context.data.view.group,
                    range: context.data.view.group.range ? { ...context.data.view.group.range } : undefined,
                };
                const undoOperations: IOperation[] = oldGroup.order === 2 ? [{
                        action: "sortAttrViewGroup",
                        avID: context.avID,
                        blockID: context.blockID,
                        previousID: undoPreviousID,
                        id: sourceId,
                    }] : [{
                        action: "setAttrViewGroup",
                        avID: context.avID,
                        blockID: context.blockID,
                        data: oldGroup,
                    }];
                transaction(context.options.protyle, [{
                        action: "sortAttrViewGroup",
                        avID: context.avID,
                        blockID: context.blockID,
                        previousID,
                        id: sourceId,
                    }], undoOperations);
                context.menuElement.querySelector('[data-type="goGroupsSort"] .b3-menu__accelerator').textContent = getLanguageByIndex(2, "sort");
                context.data.view.group.order = 2;
                context.data.view.groups.find((group, index) => {
                    if (group.id === sourceId) {
                        const groupData = context.data.view.groups.splice(index, 1)[0];
                        context.data.view.groups.find((item, index: number) => {
                            if (item.id === targetId) {
                                if (isTop) {
                                    context.data.view.groups.splice(index, 0, groupData);
                                }
                                else {
                                    context.data.view.groups.splice(index + 1, 0, groupData);
                                }
                                return true;
                            }
                        });
                        return true;
                    }
                });
                if (isTop) {
                    targetElement.before(sourceElement);
                }
                else {
                    targetElement.after(sourceElement);
                }
            }
            targetElement.classList.remove("dragover__top", "dragover__bottom");
            return;
        }
    });
    let dragoverElement: HTMLElement;
    context.avPanelElement.addEventListener("dragover", (event: DragEvent) => {
        if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            return;
        }
        const target = event.target as HTMLElement;
        let targetElement = target.closest<HTMLElement>(".av__conditional-rule") || target.closest<HTMLElement>('[data-option-row="true"]') ||
            hasClosestByAttribute(target, "draggable", "true");
        if (!targetElement) {
            const nearbyElement = document.elementFromPoint(event.clientX, event.clientY - 1);
            targetElement = nearbyElement?.closest<HTMLElement>(".av__conditional-rule") || nearbyElement?.closest<HTMLElement>('[data-option-row="true"]') ||
                hasClosestByAttribute(nearbyElement, "draggable", "true");
        }
        if (!targetElement || targetElement === window.siyuan.dragElement) {
            return;
        }
        event.preventDefault();
        if (dragoverElement && targetElement === dragoverElement) {
            const nodeRect = targetElement.getBoundingClientRect();
            context.avPanelElement.querySelectorAll(".dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                item.classList.remove("dragover__bottom", "dragover__top");
            });
            if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                targetElement.classList.add("dragover__bottom");
            }
            else {
                targetElement.classList.add("dragover__top");
            }
            return;
        }
        dragoverElement = targetElement;
    });
    context.avPanelElement.addEventListener("dragleave", () => {
        counter--;
        if (counter === 0) {
            context.avPanelElement.querySelectorAll(".dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                item.classList.remove("dragover__bottom", "dragover__top");
            });
        }
    });
    context.avPanelElement.addEventListener("dragenter", (event) => {
        event.preventDefault();
        counter++;
    });
    context.avPanelElement.addEventListener("dragend", () => {
        counter = 0;
        dragoverElement = undefined;
        context.avPanelElement.querySelectorAll(".dragover__bottom, .dragover__top").forEach(element => {
            element.classList.remove("dragover__bottom", "dragover__top");
        });
        if (window.siyuan.dragElement) {
            window.siyuan.dragElement.style.opacity = "";
            window.siyuan.dragElement = undefined;
        }
    });
};
