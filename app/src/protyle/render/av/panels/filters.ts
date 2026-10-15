import { getFiltersHTML, bindInlineFilterEvents, addFilter, addFilterGroup, getEditableFilters, getFilterByPath, getDefaultOperatorByType, duplicateFilterByPath, convertFilterToGroup, convertGroupToFilter, removeFilterByPath } from "../filter";
import { setPosition } from "../../../../util/setPosition";
import { Menu } from "../../../../plugin/Menu";
import { getFieldsByData } from "../view";
import { hasAVCapability } from "../capabilities";
import { genCellValue } from "../cell";
import { fetchPost } from "../../../../util/fetch";
import { updateRelation } from "../relation";
import type { IAVPanelDescriptor } from "./types";
export const filtersPanel: IAVPanelDescriptor = {
    render: context => {
        context.html = getFiltersHTML(context.data);
        return true;
    },
    bind: context => {
        bindInlineFilterEvents(context.avPanelElement as HTMLElement, context.data, context.options.protyle, context.blockID, context.avID, context.options.filterOperation);
    },
    actions: {
        "goFilters": (context, action) => {
            context.menuElement.innerHTML = getFiltersHTML(context.data);
            context.menuElement.classList.add("av__filter-panel");
            bindInlineFilterEvents(context.avPanelElement as HTMLElement, context.data, context.options.protyle, context.blockID, context.avID, context.options.filterOperation);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            window.siyuan.menus.menu.remove();
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "removeFilters": (context, action) => {
            context.saveFilters([], JSON.parse(JSON.stringify(context.data.view.filters)));
            // 本地状态保持“顶层单个空根组”不变量（后端会同样归一化），避免后续 addFilterGroup 误把新分组当成根组
            context.data.view.filters = [{ combination: "and", filters: [] }];
            context.menuElement.innerHTML = getFiltersHTML(context.data);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            window.siyuan.menus.menu.remove();
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "addFilter": (context, action) => {
            const path = action.target.closest("[data-path]")?.getAttribute("data-path") || "";
            addFilter({
                data: context.data,
                rect: action.target.getBoundingClientRect(),
                menuElement: context.menuElement,
                tabRect: context.tabRect,
                avId: context.avID,
                protyle: context.options.protyle,
                blockElement: context.options.blockElement,
                parentPath: path,
                filterOperation: context.options.filterOperation,
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "addFilterCondition": (context, action) => {
            const path = action.target.dataset.path || action.target.closest("[data-path]")?.getAttribute("data-path") || "";
            const depth = parseInt(action.target.dataset.depth || action.target.closest("[data-depth]")?.getAttribute("data-depth") || "0", 10);
            const menu = new Menu("addFilterCondition");
            menu.addItem({
                icon: "iconAdd",
                label: window.siyuan.languages.addFilter,
                click: () => {
                    addFilter({
                        data: context.data,
                        rect: { left: action.event.clientX, bottom: action.event.clientY, height: 28 } as DOMRect,
                        menuElement: context.menuElement,
                        tabRect: context.tabRect,
                        avId: context.avID,
                        protyle: context.options.protyle,
                        blockElement: context.options.blockElement,
                        parentPath: path,
                        filterOperation: context.options.filterOperation,
                    });
                }
            });
            if (depth < 3) {
                menu.addItem({
                    icon: "iconListFilterPlus",
                    label: window.siyuan.languages.addFilterGroup,
                    click: () => {
                        const oldFilters = JSON.parse(JSON.stringify(context.data.view.filters));
                        addFilterGroup(context.data, path);
                        const fields = getFieldsByData(context.data);
                        const blockField = fields.find(f => f.type === "block") || fields.find(f => hasAVCapability(f.type, "filterable"));
                        if (blockField) {
                            let target: IAVFilter[];
                            if ("" === path) {
                                target = getEditableFilters(context.data);
                            }
                            else {
                                const n = getFilterByPath(getEditableFilters(context.data), path);
                                target = n?.filters || getEditableFilters(context.data);
                                if (!target) {
                                    target = getEditableFilters(context.data);
                                }
                            }
                            const newGroup = target[target.length - 1];
                            if (newGroup?.filters) {
                                newGroup.filters.push({
                                    column: blockField.id,
                                    operator: getDefaultOperatorByType(blockField.type),
                                    value: genCellValue(blockField.type, ""),
                                });
                            }
                        }
                        context.saveFilters(JSON.parse(JSON.stringify(context.data.view.filters)), oldFilters);
                        context.menuElement.innerHTML = getFiltersHTML(context.data);
                        setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
                    }
                });
            }
            const rect = action.target.getBoundingClientRect();
            menu.open({ x: rect.left, y: rect.bottom, h: rect.height });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "moreFilter": (context, action) => {
            const path = action.target.getAttribute("data-path") || action.target.closest("[data-path]")?.getAttribute("data-path") || "";
            const node = getFilterByPath(getEditableFilters(context.data), path);
            const isGroup = node && node.filters;
            const menu = new Menu("moreFilter");
            menu.addItem({
                icon: "iconAdd",
                label: window.siyuan.languages.duplicateCopy,
                click: () => {
                    const oldFilters = JSON.parse(JSON.stringify(context.data.view.filters));
                    duplicateFilterByPath(getEditableFilters(context.data), path);
                    context.saveFilters(JSON.parse(JSON.stringify(context.data.view.filters)), oldFilters);
                    context.menuElement.innerHTML = getFiltersHTML(context.data);
                    setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
                }
            });
            if (!isGroup) {
                menu.addItem({
                    icon: "iconListFilterPlus",
                    label: window.siyuan.languages.convertToFilterGroup,
                    click: () => {
                        const oldFilters = JSON.parse(JSON.stringify(context.data.view.filters));
                        convertFilterToGroup(getEditableFilters(context.data), path);
                        context.saveFilters(JSON.parse(JSON.stringify(context.data.view.filters)), oldFilters);
                        context.menuElement.innerHTML = getFiltersHTML(context.data);
                        setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
                    }
                });
            }
            else if (node && node.filters && 1 === node.filters.length) {
                menu.addItem({
                    icon: "iconListFilterPlus",
                    label: window.siyuan.languages.convertGroupToFilter,
                    click: () => {
                        const oldFilters = JSON.parse(JSON.stringify(context.data.view.filters));
                        convertGroupToFilter(getEditableFilters(context.data), path);
                        context.saveFilters(JSON.parse(JSON.stringify(context.data.view.filters)), oldFilters);
                        context.menuElement.innerHTML = getFiltersHTML(context.data);
                        setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
                    }
                });
            }
            menu.addItem({
                icon: "iconTrashcan",
                label: window.siyuan.languages.delete,
                click: () => {
                    const cloneBefore = JSON.parse(JSON.stringify(context.data.view.filters));
                    removeFilterByPath(getEditableFilters(context.data), path);
                    const cloneAfter = JSON.parse(JSON.stringify(context.data.view.filters));
                    context.saveFilters(cloneAfter, cloneBefore);
                    context.menuElement.innerHTML = getFiltersHTML(context.data);
                    setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
                }
            });
            const rect = action.target.getBoundingClientRect();
            menu.open({ x: rect.left, y: rect.bottom, h: rect.height });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "goAttrViewColFilters": (context, action) => {
            if (action.target.classList.contains("b3-menu__item--disabled")) {
                return "handled";
            }
            const colId = context.options.colId ||
                context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
            const colData = context.fields.find((item) => item.id === colId);
            const isRelationFilter = action.target.dataset.filterType === "relation";
            const relationKey = isRelationFilter ? colData :
                context.fields.find((item) => item.id === colData?.rollup?.relationKeyID);
            const selectedTargetAvID = isRelationFilter ?
                (context.menuElement.querySelector('[data-type="goSearchAV"]') as HTMLElement)?.dataset.avId : "";
            const targetAvID = selectedTargetAvID || relationKey?.relation?.avID;
            if (!colData || !targetAvID) {
                return "handled";
            }
            const targetChanged = isRelationFilter && targetAvID !== colData.relation?.avID;
            const filters = targetChanged ? [] :
                (isRelationFilter ? colData.relation?.candidateFilters : colData.rollup?.filters);
            const openFilters = (sourcePanelElement?: Element) => {
                fetchPost("/api/av/getAttributeView", { id: targetAvID }, (response) => {
                    if (sourcePanelElement && !sourcePanelElement.isConnected) {
                        return;
                    }
                    const targetAttrView = response.data?.av;
                    if (!targetAttrView) {
                        return;
                    }
                    const targetFields = (targetAttrView.keyValues || []).
                        map((item: {
                        key: IAVColumn;
                    }) => item.key);
                    const filterData = {
                        id: targetAttrView.id,
                        name: targetAttrView.name,
                        viewID: "",
                        viewType: "table",
                        views: [],
                        view: {
                            id: "",
                            type: "table",
                            filters: JSON.parse(JSON.stringify(filters?.length ? filters :
                                [{ combination: "and", filters: [] }])),
                            sorts: [],
                            columns: targetFields,
                            rows: [],
                        },
                    } as IAV;
                    sourcePanelElement?.remove();
                    context.openPanel({
                        protyle: context.options.protyle,
                        blockElement: context.options.blockElement,
                        type: "filters",
                        colId,
                        data: filterData,
                        filterOperation: {
                            action: isRelationFilter ? "setAttrViewColRelationFilters" :
                                "setAttrViewColRollupFilters",
                            keyID: colId,
                        },
                    });
                });
            };
            const updateRelationButton = context.menuElement.querySelector('[data-type="updateRelation"]');
            const updateRelationItem = updateRelationButton?.closest(".b3-menu__item");
            const hasPendingRelation = isRelationFilter && !!updateRelationItem &&
                !updateRelationItem.classList.contains("fn__none");
            if (hasPendingRelation) {
                updateRelation({
                    protyle: context.options.protyle,
                    avElement: context.avPanelElement,
                    avID: context.avID,
                    colsData: context.fields,
                    blockElement: context.options.blockElement,
                    callback: openFilters,
                });
            }
            else {
                openFilters(context.avPanelElement);
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
