import {transaction} from "../../wysiwyg/transaction";
import {fetchPost} from "../../../util/fetch";
import {
    addCol,
    bindEditEvent,
    duplicateCol,
    getColIconByType,
    getColId,
    getColNameByType,
    getEditHTML,
    removeCol
} from "./col";
import {setPosition} from "../../../util/setPosition";
import {hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {addColOptionOrCell, bindSelectEvent, getSelectHTML, removeCellOption, setColOption} from "./select";
import {addFilter, getFiltersHTML, setFilter} from "./filter";
import {addSort, bindSortsEvent, getSortsHTML} from "./sort";
import {bindDateEvent, getDateHTML} from "./date";
import {formatNumber} from "./number";
import {updateAttrViewCellAnimation} from "./action";
import {addAssetLink, bindAssetEvent, editAssetItem, getAssetHTML, updateAssetCell} from "./asset";
import {Constants} from "../../../constants";
import {hideElements} from "../../ui/hideElements";
import {isLocalPath, pathPosix} from "../../../util/pathName";
import {openEmojiPanel, unicode2Emoji} from "../../../emoji";
import {getSearch, isMobile} from "../../../util/functions";
/// #if !MOBILE
import {openAsset} from "../../../editor/util";
/// #endif
import {previewAttrViewImages} from "../../preview/image";
import {assetMenu} from "../../../menus/protyle";
import {
    addView,
    bindSwitcherEvent,
    bindViewEvent,
    getFieldsByData,
    getSwitcherHTML,
    getViewHTML,
    openViewMenu
} from "./view";
import {focusBlock} from "../../util/selection";
import {getFieldIdByCellElement, setPageSize} from "./row";
import {bindRelationEvent, getRelationHTML, openSearchAV, setRelationCell, updateRelation} from "./relation";
import {bindRollupData, getRollupHTML, goSearchRollupCol} from "./rollup";
import {updateCellsValue} from "./cell";
import {openCalcMenu} from "./calc";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {Dialog} from "../../../dialog";
import {bindLayoutEvent, getLayoutHTML, updateLayout} from "./layout";
import {setGalleryCover, setGalleryRatio, setGallerySize} from "./gallery/util";
import {
    bindGroupsEvent, bindGroupsNumber,
    getGroupsHTML,
    getGroupsMethodHTML, getGroupsNumberHTML, getLanguageByIndex, getPageSize,
    goGroupsDate,
    goGroupsSort,
    setGroupMethod
} from "./groups";

export const openMenuPanel = (options: {
    protyle: IProtyle,
    blockElement: Element,
    type: "select" | "properties" | "config" | "sorts" | "filters" | "edit" | "date" | "asset" | "switcher" | "relation" | "rollup",
    colId?: string, // for edit, rollup
    // 使用前端构造的数据
    editData?: {
        previousID: string,
        colData: IAVColumn,
    },
    cellElements?: HTMLElement[],   // for select & date & relation & asset
    cb?: (avPanelElement: Element) => void
}) => {
    let avPanelElement = document.querySelector(".av__panel");
    if (avPanelElement) {
        avPanelElement.remove();
        return;
    }
    const avID = options.blockElement.getAttribute("data-av-id");
    const avPageSize = getPageSize(options.blockElement);
    fetchPost("/api/av/renderAttributeView", {
        id: avID,
        query: (options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement)?.value.trim() || "",
        pageSize: avPageSize.unGroupPageSize,
        groupPaging: avPageSize.groupPageSize,
        viewID: options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW)
    }, (response) => {
        avPanelElement = document.querySelector(".av__panel");
        if (avPanelElement) {
            avPanelElement.remove();
            return;
        }
        window.siyuan.menus.menu.remove();
        const blockID = options.blockElement.getAttribute("data-node-id");

        const isCustomAttr = !options.blockElement.classList.contains("av");
        let data = response.data as IAV;
        let html;
        let fields = getFieldsByData(data);
        if (options.type === "config") {
            html = getViewHTML(data);
        } else if (options.type === "properties") {
            html = getPropertiesHTML(fields);
        } else if (options.type === "sorts") {
            html = getSortsHTML(fields, data.view.sorts);
        } else if (options.type === "switcher") {
            html = getSwitcherHTML(data.views, data.viewID);
        } else if (options.type === "filters") {
            html = getFiltersHTML(data);
        } else if (options.type === "select") {
            html = getSelectHTML(fields, options.cellElements, true, options.blockElement);
        } else if (options.type === "asset") {
            html = getAssetHTML(options.cellElements);
        } else if (options.type === "edit") {
            if (options.editData) {
                if (typeof options.editData.colData.wrap === "undefined") {
                    options.editData.colData.wrap = data.view.wrapField;
                }
                if (options.editData.previousID) {
                    fields.find((item, index) => {
                        if (item.id === options.editData.previousID) {
                            fields.splice(index + 1, 0, options.editData.colData);
                            return true;
                        }
                    });
                } else {
                    if (data.viewType === "table") {
                        fields.splice(0, 0, options.editData.colData);
                    } else {
                        fields.push(options.editData.colData);
                    }
                }
            }
            html = getEditHTML({protyle: options.protyle, data, colId: options.colId, isCustomAttr});
        } else if (options.type === "date") {
            html = getDateHTML(options.cellElements);
        } else if (options.type === "rollup") {
            html = `<div class="b3-menu__items">${getRollupHTML({data, cellElements: options.cellElements})}</div>`;
        } else if (options.type === "relation") {
            html = getRelationHTML(data, options.cellElements);
            if (!html) {
                openMenuPanel({
                    protyle: options.protyle,
                    blockElement: options.blockElement,
                    type: "edit",
                    colId: getColId(options.cellElements[0], data.viewType)
                });
                return;
            }
        }

        document.body.insertAdjacentHTML("beforeend", `<div class="av__panel" style="z-index: ${++window.siyuan.zIndex};">
    <div class="b3-dialog__scrim" data-type="close"></div>
    <div class="b3-menu" ${["select", "date", "asset", "relation", "rollup"].includes(options.type) ? `style="min-width: 200px;${isMobile() ? "max-width: 90vw;" : "max-width: 50vw;"}"` : ""}>${html}</div>
</div>`);
        avPanelElement = document.querySelector(".av__panel");
        let closeCB: () => void;
        const menuElement = avPanelElement.lastElementChild as HTMLElement;
        let tabRect = options.blockElement.querySelector(`.av__views, .av__row[data-col-id="${options.colId}"] > .block__logo`)?.getBoundingClientRect();
        if (["select", "date", "asset", "relation", "rollup"].includes(options.type)) {
            let lastElement = options.cellElements[options.cellElements.length - 1];
            if (!options.blockElement.contains(lastElement)) {
                // https://github.com/siyuan-note/siyuan/issues/15839
                const rowID = getFieldIdByCellElement(lastElement, data.viewType);
                if (data.viewType === "table") {
                    lastElement = options.blockElement.querySelector(`.av__row[data-id="${rowID}"] .av__cell[data-col-id="${lastElement.dataset.colId}"]`);
                } else {
                    lastElement = options.blockElement.querySelector(`.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${lastElement.dataset.fieldId}"]`);
                }
            }
            const cellRect = (lastElement || options.cellElements[options.cellElements.length - 1]).getBoundingClientRect();

            if (options.type === "select") {
                bindSelectEvent(options.protyle, data, menuElement, options.cellElements, options.blockElement);
            } else if (options.type === "date") {
                closeCB = bindDateEvent({
                    protyle: options.protyle,
                    data,
                    menuElement,
                    cellElements: options.cellElements,
                    blockElement: options.blockElement
                });
            } else if (options.type === "asset") {
                bindAssetEvent({
                    protyle: options.protyle,
                    menuElement,
                    cellElements: options.cellElements,
                    blockElement: options.blockElement
                });
                setTimeout(() => {
                    setPosition(menuElement, cellRect.left, cellRect.bottom, cellRect.height);
                }, Constants.TIMEOUT_LOAD);  // 等待加载
            } else if (options.type === "relation") {
                bindRelationEvent({
                    menuElement,
                    cellElements: options.cellElements,
                    protyle: options.protyle,
                    blockElement: options.blockElement
                });
            } else if (options.type === "rollup") {
                bindRollupData({protyle: options.protyle, data, menuElement});
            }
            if (["select", "date", "relation", "rollup"].includes(options.type)) {
                const inputElement = menuElement.querySelector("input");
                if (inputElement) {
                    inputElement.select();
                    inputElement.focus();
                }
                setPosition(menuElement, cellRect.left, cellRect.bottom, cellRect.height);
            }
        } else {
            setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
            if (options.type === "sorts") {
                bindSortsEvent(options.protyle, menuElement, data, blockID);
            } else if (options.type === "edit") {
                bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
            } else if (options.type === "config") {
                bindViewEvent({protyle: options.protyle, data, menuElement, blockElement: options.blockElement});
            } else if (options.type === "switcher") {
                bindSwitcherEvent({protyle: options.protyle, menuElement, blockElement: options.blockElement});
            }
        }
        if (options.cb) {
            options.cb(avPanelElement);
        }
        avPanelElement.addEventListener("dragstart", (event: DragEvent) => {
            window.siyuan.dragElement = event.target as HTMLElement;
            window.siyuan.dragElement.style.opacity = ".38";
            return;
        });
        avPanelElement.addEventListener("drop", (event) => {
            counter = 0;
            if (!window.siyuan.dragElement) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            window.siyuan.dragElement.style.opacity = "";
            const sourceElement = window.siyuan.dragElement;
            window.siyuan.dragElement = undefined;
            if (options.protyle && options.protyle.disabled) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (!options.protyle && window.siyuan.config.readonly) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const targetElement = avPanelElement.querySelector(".dragover__bottom, .dragover__top") as HTMLElement;
            if (!targetElement) {
                return;
            }
            const isTop = targetElement.classList.contains("dragover__top");
            const sourceId = sourceElement.dataset.id;
            const targetId = targetElement.dataset.id;
            if (targetElement.querySelector('[data-type="removeSort"]')) {
                const changeData = data.view.sorts;
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
                        } else {
                            changeData.splice(index + 1, 0, sortFilter);
                        }
                        return true;
                    }
                });

                transaction(options.protyle, [{
                    action: "setAttrViewSorts",
                    avID,
                    data: changeData,
                    blockID
                }], [{
                    action: "setAttrViewSorts",
                    avID,
                    data: oldData,
                    blockID
                }]);
                menuElement.innerHTML = getSortsHTML(fields, data.view.sorts);
                bindSortsEvent(options.protyle, menuElement, data, blockID);
                return;
            }
            if (targetElement.querySelector('[data-type="removeFilter"]')) {
                const changeData = data.view.filters;
                const oldData = Object.assign([], changeData);
                let targetFilter: IAVFilter;
                changeData.find((filter, index: number) => {
                    if (filter.column === sourceId) {
                        targetFilter = changeData.splice(index, 1)[0];
                        return true;
                    }
                });
                changeData.find((filter, index: number) => {
                    if (filter.column === targetId) {
                        if (isTop) {
                            changeData.splice(index, 0, targetFilter);
                        } else {
                            changeData.splice(index + 1, 0, targetFilter);
                        }
                        return true;
                    }
                });

                transaction(options.protyle, [{
                    action: "setAttrViewFilters",
                    avID,
                    data: changeData,
                    blockID
                }], [{
                    action: "setAttrViewFilters",
                    avID,
                    data: oldData,
                    blockID
                }]);
                menuElement.innerHTML = getFiltersHTML(data);
                return;
            }
            if (targetElement.querySelector('[data-type="av-view-edit"]')) {
                transaction(options.protyle, [{
                    action: "sortAttrViewView",
                    avID,
                    blockID,
                    id: sourceId,
                    previousID: isTop ? targetElement.previousElementSibling?.getAttribute("data-id") : targetElement.getAttribute("data-id")
                }], [{
                    action: "sortAttrViewView",
                    avID,
                    blockID,
                    id: sourceId,
                    previousID: sourceElement.previousElementSibling?.getAttribute("data-id")
                }]);
                if (isTop) {
                    targetElement.before(sourceElement);
                    targetElement.classList.remove("dragover__top");
                } else {
                    targetElement.after(sourceElement);
                    targetElement.classList.remove("dragover__bottom");
                }
                return;
            }
            if (targetElement.querySelector('[data-type="editAssetItem"]')) {
                if (isTop) {
                    targetElement.before(sourceElement);
                } else {
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
                    protyle: options.protyle,
                    cellElements: options.cellElements,
                    replaceValue,
                    blockElement: options.blockElement
                });
                return;
            }
            if (targetElement.querySelector('[data-type="setColOption"]')) {
                const colId = options.cellElements ? getColId(options.cellElements[0], data.viewType) : menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
                const changeData = fields.find((column) => column.id === colId).options;
                const oldData = Object.assign([], changeData);
                let targetOption: { name: string, color: string };
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
                        } else {
                            changeData.splice(index + 1, 0, targetOption);
                        }
                        return true;
                    }
                });
                transaction(options.protyle, [{
                    action: "updateAttrViewColOptions",
                    id: colId,
                    avID,
                    data: changeData,
                }], [{
                    action: "updateAttrViewColOptions",
                    id: colId,
                    avID,
                    data: oldData,
                }]);
                const oldScroll = menuElement.querySelector(".b3-menu__items").scrollTop;
                if (options.cellElements) {
                    menuElement.innerHTML = getSelectHTML(fields, options.cellElements, false, options.blockElement);
                    bindSelectEvent(options.protyle, data, menuElement, options.cellElements, options.blockElement);
                } else {
                    menuElement.innerHTML = getEditHTML({
                        protyle: options.protyle,
                        data,
                        colId,
                        isCustomAttr
                    });
                    bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
                }
                menuElement.querySelector(".b3-menu__items").scrollTop = oldScroll;
                return;
            }
            if (targetElement.getAttribute("data-type") === "setRelationCell") {
                if (isTop) {
                    targetElement.before(sourceElement);
                } else {
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
                updateCellsValue(options.protyle, options.blockElement as HTMLElement, {
                    blockIDs,
                    contents,
                }, options.cellElements);
                return;
            }
            if (targetElement.getAttribute("data-type") === "editCol") {
                const previousID = (isTop ? targetElement.previousElementSibling?.getAttribute("data-id") : targetElement.getAttribute("data-id")) || "";
                const undoPreviousID = sourceElement.previousElementSibling?.getAttribute("data-id") || "";
                if (previousID !== undoPreviousID && previousID !== sourceId) {
                    transaction(options.protyle, [{
                        action: "sortAttrViewCol",
                        avID,
                        previousID,
                        id: sourceId,
                        blockID,
                    }], [{
                        action: "sortAttrViewCol",
                        avID,
                        previousID: undoPreviousID,
                        id: sourceId,
                        blockID
                    }]);
                    let column: IAVColumn;
                    fields.find((item, index: number) => {
                        if (item.id === sourceId) {
                            column = fields.splice(index, 1)[0];
                            return true;
                        }
                    });
                    fields.find((item, index: number) => {
                        if (item.id === targetId) {
                            if (isTop) {
                                fields.splice(index, 0, column);
                            } else {
                                fields.splice(index + 1, 0, column);
                            }
                            return true;
                        }
                    });
                }
                menuElement.innerHTML = getPropertiesHTML(fields);
                return;
            }
            if (targetElement.querySelector('[data-type="hideGroup"]')) {
                const previousID = (isTop ? targetElement.previousElementSibling?.getAttribute("data-id") : targetElement.getAttribute("data-id")) || "";
                const undoPreviousID = sourceElement.previousElementSibling?.getAttribute("data-id") || "";
                if (previousID !== undoPreviousID && previousID !== sourceId) {
                    transaction(options.protyle, [{
                        action: "sortAttrViewGroup",
                        avID,
                        blockID,
                        previousID,
                        id: sourceId,
                    }], [{
                        action: "sortAttrViewGroup",
                        avID,
                        blockID,
                        previousID: undoPreviousID,
                        id: sourceId,
                    }]);
                    menuElement.querySelector('[data-type="goGroupsSort"] .b3-menu__accelerator').textContent = getLanguageByIndex(2, "sort");
                    data.view.group.order = 2;
                    data.view.groups.find((group, index) => {
                        if (group.id === sourceId) {
                            const groupData = data.view.groups.splice(index, 1)[0];
                            data.view.groups.find((item, index: number) => {
                                if (item.id === targetId) {
                                    if (isTop) {
                                        data.view.groups.splice(index, 0, groupData);
                                    } else {
                                        data.view.groups.splice(index + 1, 0, groupData);
                                    }
                                    return true;
                                }
                            });
                            return true;
                        }
                    });
                    if (isTop) {
                        targetElement.before(sourceElement);
                    } else {
                        targetElement.after(sourceElement);
                    }
                }
                targetElement.classList.remove("dragover__top", "dragover__bottom");
                return;
            }
        });
        let dragoverElement: HTMLElement;
        avPanelElement.addEventListener("dragover", (event: DragEvent) => {
            if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
                return;
            }
            const target = event.target as HTMLElement;
            let targetElement = hasClosestByAttribute(target, "draggable", "true");
            if (!targetElement) {
                targetElement = hasClosestByAttribute(document.elementFromPoint(event.clientX, event.clientY - 1), "draggable", "true");
            }
            if (!targetElement || targetElement === window.siyuan.dragElement) {
                return;
            }
            event.preventDefault();
            if (dragoverElement && targetElement === dragoverElement) {
                const nodeRect = targetElement.getBoundingClientRect();
                avPanelElement.querySelectorAll(".dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                    item.classList.remove("dragover__bottom", "dragover__top");
                });
                if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                    targetElement.classList.add("dragover__bottom");
                } else {
                    targetElement.classList.add("dragover__top");
                }
                return;
            }
            dragoverElement = targetElement;
        });
        let counter = 0;
        avPanelElement.addEventListener("dragleave", () => {
            counter--;
            if (counter === 0) {
                avPanelElement.querySelectorAll(".dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                    item.classList.remove("dragover__bottom", "dragover__top");
                });
            }
        });
        avPanelElement.addEventListener("dragenter", (event) => {
            event.preventDefault();
            counter++;
        });
        avPanelElement.addEventListener("dragend", () => {
            if (window.siyuan.dragElement) {
                window.siyuan.dragElement.style.opacity = "";
                window.siyuan.dragElement = undefined;
            }
        });
        avPanelElement.addEventListener("mousedown", (event: MouseEvent & { target: HTMLElement }) => {
            if (event.button === 1 && !hasClosestByClassName(event.target, "b3-menu")) {
                document.querySelector(".av__panel").dispatchEvent(new CustomEvent("click", {detail: "close"}));
            }
        });
        avPanelElement.addEventListener("click", async (event: MouseEvent) => {
            let type: string;
            let target = event.target as HTMLElement;
            if (typeof event.detail === "string") {
                type = event.detail;
            } else if (typeof event.detail === "object") {
                type = (event.detail as { type: string }).type;
                target = (event.detail as { target: HTMLElement }).target;
            }
            while (target && target !== avPanelElement || type) {
                type = target?.dataset.type || type;
                if (type === "close") {
                    if (!options.protyle.toolbar.subElement.classList.contains("fn__none")) {
                        // 优先关闭资源文件搜索
                        hideElements(["util"], options.protyle);
                    } else if (!window.siyuan.menus.menu.element.classList.contains("fn__none")) {
                        // 过滤面板先关闭过滤条件
                    } else {
                        closeCB?.();
                        avPanelElement.remove();
                        setTimeout(() => {
                            focusBlock(options.blockElement);
                        }, Constants.TIMEOUT_TRANSITION);  // 单选使用 enter 修改选项后会滚动
                    }
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "go-config") {
                    menuElement.innerHTML = getViewHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    bindViewEvent({protyle: options.protyle, data, menuElement, blockElement: options.blockElement});
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "go-properties") {
                    // 复制列后点击返回到属性面板，宽度不一致，需重新计算
                    tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
                    menuElement.innerHTML = getPropertiesHTML(fields);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "go-layout") {
                    menuElement.innerHTML = getLayoutHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    bindLayoutEvent({protyle: options.protyle, data, menuElement, blockElement: options.blockElement});
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSorts") {
                    menuElement.innerHTML = getSortsHTML(fields, data.view.sorts);
                    bindSortsEvent(options.protyle, menuElement, data, blockID);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeSorts") {
                    transaction(options.protyle, [{
                        action: "setAttrViewSorts",
                        avID,
                        data: [],
                        blockID
                    }], [{
                        action: "setAttrViewSorts",
                        avID,
                        data: data.view.sorts,
                        blockID
                    }]);
                    data.view.sorts = [];
                    menuElement.innerHTML = getSortsHTML(fields, data.view.sorts);
                    bindSortsEvent(options.protyle, menuElement, data, blockID);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addSort") {
                    addSort({
                        data,
                        rect: target.getBoundingClientRect(),
                        menuElement,
                        tabRect,
                        avId: avID,
                        protyle: options.protyle,
                        blockID,
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeSort") {
                    const oldSorts = Object.assign([], data.view.sorts);
                    data.view.sorts.find((item: IAVSort, index: number) => {
                        if (item.column === target.parentElement.dataset.id) {
                            data.view.sorts.splice(index, 1);
                            return true;
                        }
                    });
                    transaction(options.protyle, [{
                        action: "setAttrViewSorts",
                        avID,
                        data: data.view.sorts,
                        blockID
                    }], [{
                        action: "setAttrViewSorts",
                        avID,
                        data: oldSorts,
                        blockID
                    }]);
                    menuElement.innerHTML = getSortsHTML(fields, data.view.sorts);
                    bindSortsEvent(options.protyle, menuElement, data, blockID);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goFilters") {
                    menuElement.innerHTML = getFiltersHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeFilters") {
                    transaction(options.protyle, [{
                        action: "setAttrViewFilters",
                        avID,
                        data: [],
                        blockID
                    }], [{
                        action: "setAttrViewFilters",
                        avID,
                        data: data.view.filters,
                        blockID
                    }]);
                    data.view.filters = [];
                    menuElement.innerHTML = getFiltersHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addFilter") {
                    addFilter({
                        data,
                        rect: target.getBoundingClientRect(),
                        menuElement,
                        tabRect,
                        avId: avID,
                        protyle: options.protyle,
                        blockElement: options.blockElement
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeFilter") {
                    window.siyuan.menus.menu.remove();
                    const oldFilters = Object.assign([], data.view.filters);
                    data.view.filters.find((item: IAVFilter, index: number) => {
                        if (item.column === target.parentElement.dataset.id && item.value.type === target.parentElement.dataset.filterType) {
                            data.view.filters.splice(index, 1);
                            return true;
                        }
                    });
                    transaction(options.protyle, [{
                        action: "setAttrViewFilters",
                        avID,
                        data: data.view.filters,
                        blockID
                    }], [{
                        action: "setAttrViewFilters",
                        avID,
                        data: oldFilters,
                        blockID
                    }]);
                    menuElement.innerHTML = getFiltersHTML(data);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "setFilter") {
                    data.view.filters.find((item: IAVFilter) => {
                        if (item.column === target.parentElement.parentElement.dataset.id && item.value.type === target.parentElement.parentElement.dataset.filterType) {
                            setFilter({
                                empty: false,
                                filter: item,
                                protyle: options.protyle,
                                data,
                                target,
                                blockElement: options.blockElement
                            });
                            return true;
                        }
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "numberFormat") {
                    formatNumber({
                        avPanelElement,
                        element: target,
                        protyle: options.protyle,
                        oldFormat: target.dataset.format,
                        colId: menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id"),
                        avID
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "newCol") {
                    avPanelElement.remove();
                    const addMenu = addCol(options.protyle, options.blockElement);
                    addMenu.open({
                        x: tabRect.right,
                        y: tabRect.bottom,
                        h: tabRect.height,
                        isLeft: true
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "update-view-icon") {
                    const rect = target.getBoundingClientRect();
                    openEmojiPanel("", "av", {
                        x: rect.left,
                        y: rect.bottom + 4,
                        h: rect.height,
                        w: rect.width
                    }, (unicode) => {
                        transaction(options.protyle, [{
                            action: "setAttrViewViewIcon",
                            avID,
                            id: data.viewID,
                            data: unicode,
                        }], [{
                            action: "setAttrViewViewIcon",
                            id: data.viewID,
                            avID,
                            data: target.dataset.icon,
                        }]);
                        target.innerHTML = unicode ? unicode2Emoji(unicode) : '<svg style="width: 14px;height: 14px;"><use xlink:href="#iconTable"></use></svg>';
                        target.dataset.icon = unicode;
                    }, target.querySelector("img"));
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "set-page-size") {
                    setPageSize({
                        target,
                        protyle: options.protyle,
                        avID,
                        nodeElement: options.blockElement
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "duplicate-view") {
                    const id = Lute.NewNodeID();
                    transaction(options.protyle, [{
                        action: "duplicateAttrViewView",
                        avID,
                        previousID: data.viewID,
                        id,
                        blockID
                    }], [{
                        action: "removeAttrViewView",
                        avID,
                        id,
                        blockID
                    }]);
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "delete-view") {
                    transaction(options.protyle, [{
                        action: "removeAttrViewView",
                        avID,
                        id: data.viewID,
                        blockID
                    }]);
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "update-icon") {
                    const rect = target.getBoundingClientRect();
                    openEmojiPanel("", "av", {
                        x: rect.left,
                        y: rect.bottom + 4,
                        h: rect.height,
                        w: rect.width
                    }, (unicode) => {
                        const colId = menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
                        transaction(options.protyle, [{
                            action: "setAttrViewColIcon",
                            id: colId,
                            avID,
                            data: unicode,
                        }], [{
                            action: "setAttrViewColIcon",
                            id: colId,
                            avID,
                            data: target.dataset.icon,
                        }]);
                        target.innerHTML = unicode ? unicode2Emoji(unicode) : `<svg style="height: 14px;width: 14px"><use xlink:href="#${getColIconByType(target.dataset.colType as TAVCol)}"></use></svg>`;
                        if (isCustomAttr) {
                            const iconElement = options.blockElement.querySelector(`.av__row[data-col-id="${colId}"] .block__logoicon`);
                            iconElement.outerHTML = unicode ? unicode2Emoji(unicode, "block__logoicon", true) : `<svg class="block__logoicon"><use xlink:href="#${getColIconByType(iconElement.nextElementSibling.getAttribute("data-type") as TAVCol)}"></use></svg>`;
                        } else {
                            updateAttrViewCellAnimation(options.blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`), undefined, {icon: unicode});
                        }
                        target.dataset.icon = unicode;
                    }, target.querySelector("img"));
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "showAllCol") {
                    const doOperations: IOperation[] = [];
                    const undoOperations: IOperation[] = [];
                    fields.forEach((item: IAVColumn) => {
                        if (item.hidden) {
                            doOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                avID,
                                data: false,
                                blockID,
                            });
                            undoOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                avID,
                                data: true,
                                blockID
                            });
                            item.hidden = false;
                        }
                    });
                    if (doOperations.length > 0) {
                        transaction(options.protyle, doOperations, undoOperations);
                        menuElement.innerHTML = getPropertiesHTML(fields);
                        setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "hideAllCol") {
                    const doOperations: IOperation[] = [];
                    const undoOperations: IOperation[] = [];
                    fields.forEach((item: IAVColumn) => {
                        if (!item.hidden && item.type !== "block") {
                            doOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                avID,
                                data: true,
                                blockID
                            });
                            undoOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                avID,
                                data: false,
                                blockID
                            });
                            item.hidden = true;
                        }
                    });
                    if (doOperations.length > 0) {
                        transaction(options.protyle, doOperations, undoOperations);
                        menuElement.innerHTML = getPropertiesHTML(fields);
                        setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "editCol") {
                    menuElement.innerHTML = getEditHTML({
                        protyle: options.protyle,
                        data,
                        colId: target.dataset.id,
                        isCustomAttr
                    });
                    bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "updateColType") {
                    const colId = options.colId || menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
                    if (target.dataset.newType !== target.dataset.oldType) {
                        const nameElement = avPanelElement.querySelector('.b3-text-field[data-type="name"]') as HTMLInputElement;
                        const name = nameElement.value;
                        let newName = name;
                        fields.find((item: IAVColumn) => {
                            if (item.id === colId) {
                                item.type = target.dataset.newType as TAVCol;
                                if (getColNameByType(target.dataset.oldType as TAVCol) === name) {
                                    newName = getColNameByType(target.dataset.newType as TAVCol);
                                    item.name = newName;
                                }
                                return true;
                            }
                        });

                        transaction(options.protyle, [{
                            action: "updateAttrViewCol",
                            id: colId,
                            avID,
                            name: newName,
                            type: target.dataset.newType as TAVCol,
                        }], [{
                            action: "updateAttrViewCol",
                            id: colId,
                            avID,
                            name,
                            type: target.dataset.oldType as TAVCol,
                        }]);

                        // 需要取消行号列的筛选和排序
                        if (target.dataset.newType === "lineNumber") {
                            const sortExist = data.view.sorts.find((sort) => sort.column === colId);
                            if (sortExist) {
                                const oldSorts = Object.assign([], data.view.sorts);
                                const newSorts = data.view.sorts.filter((sort) => sort.column !== colId);

                                transaction(options.protyle, [{
                                    action: "setAttrViewSorts",
                                    avID: data.id,
                                    data: newSorts,
                                    blockID,
                                }], [{
                                    action: "setAttrViewSorts",
                                    avID: data.id,
                                    data: oldSorts,
                                    blockID,
                                }]);
                            }

                            const filterExist = data.view.filters.find((filter) => filter.column === colId);
                            if (filterExist) {
                                const oldFilters = JSON.parse(JSON.stringify(data.view.filters));
                                const newFilters = data.view.filters.filter((filter) => filter.column !== colId);

                                transaction(options.protyle, [{
                                    action: "setAttrViewFilters",
                                    avID: data.id,
                                    data: newFilters,
                                    blockID
                                }], [{
                                    action: "setAttrViewFilters",
                                    avID: data.id,
                                    data: oldFilters,
                                    blockID
                                }]);
                            }
                        }
                    }
                    menuElement.innerHTML = getEditHTML({
                        protyle: options.protyle,
                        data,
                        colId,
                        isCustomAttr
                    });
                    bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goUpdateColType") {
                    const editMenuElement = hasClosestByClassName(target, "b3-menu");
                    if (editMenuElement) {
                        editMenuElement.firstElementChild.classList.add("fn__none");
                        editMenuElement.lastElementChild.classList.remove("fn__none");
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSearchAV") {
                    openSearchAV(avID, target, undefined, false);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSearchRollupCol") {
                    goSearchRollupCol({
                        target,
                        data,
                        isRelation: true,
                        protyle: options.protyle,
                        colId: options.colId || menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id")
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSearchRollupTarget") {
                    goSearchRollupCol({
                        target,
                        data,
                        isRelation: false,
                        protyle: options.protyle,
                        colId: options.colId || menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id")
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goSearchRollupCalc") {
                    openCalcMenu(options.protyle, target, {
                        data,
                        colId: options.colId || menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id"),
                        blockID
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "updateRelation") {
                    updateRelation({
                        protyle: options.protyle,
                        avElement: avPanelElement,
                        avID,
                        colsData: fields,
                        blockElement: options.blockElement,
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goEditCol") {
                    const editMenuElement = hasClosestByClassName(target, "b3-menu");
                    if (editMenuElement) {
                        editMenuElement.firstElementChild.classList.remove("fn__none");
                        editMenuElement.lastElementChild.classList.add("fn__none");
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "hideCol") {
                    const isEdit = menuElement.querySelector('[data-type="go-properties"]');
                    const colId = isEdit ? menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id") : target.parentElement.getAttribute("data-id");
                    transaction(options.protyle, [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: true,
                        blockID
                    }], [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: false,
                        blockID
                    }]);
                    fields.find((item: IAVColumn) => item.id === colId).hidden = true;
                    if (isEdit) {
                        menuElement.innerHTML = getEditHTML({
                            protyle: options.protyle,
                            data,
                            colId,
                            isCustomAttr
                        });
                        bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
                    } else {
                        menuElement.innerHTML = getPropertiesHTML(fields);
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "showCol") {
                    const isEdit = menuElement.querySelector('[data-type="go-properties"]');
                    const colId = isEdit ? menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id") : target.parentElement.getAttribute("data-id");
                    transaction(options.protyle, [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: false,
                        blockID
                    }], [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        avID,
                        data: true,
                        blockID
                    }]);
                    fields.find((item: IAVColumn) => item.id === colId).hidden = false;
                    if (isEdit) {
                        menuElement.innerHTML = getEditHTML({
                            protyle: options.protyle,
                            data,
                            colId,
                            isCustomAttr
                        });
                        bindEditEvent({protyle: options.protyle, data, menuElement, isCustomAttr, blockID});
                    } else {
                        menuElement.innerHTML = getPropertiesHTML(fields);
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "duplicateCol") {
                    duplicateCol({
                        blockElement: options.blockElement,
                        protyle: options.protyle,
                        colId: menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id"),
                        data,
                        viewID: data.viewID,
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeCol") {
                    if (!isCustomAttr) {
                        tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
                    }
                    const colId = menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
                    const colData = fields.find((item: IAVColumn) => {
                        if (item.id === colId) {
                            return true;
                        }
                    });
                    const isTwoWay = colData.type === "relation" && colData.relation?.isTwoWay;
                    if (isCustomAttr || isTwoWay) {
                        const dialog = new Dialog({
                            title: isTwoWay ? window.siyuan.languages.removeColConfirm : window.siyuan.languages.deleteOpConfirm,
                            content: `<div class="b3-dialog__content">
    ${isTwoWay ? window.siyuan.languages.confirmRemoveRelationField
                                    .replace("${x}", menuElement.querySelector("input").value || window.siyuan.languages._kernel[272])
                                    .replace("${y}", menuElement.querySelector('.b3-menu__item[data-type="goSearchAV"] .b3-menu__accelerator').textContent)
                                    .replace("${z}", (menuElement.querySelector('input[data-type="colName"]') as HTMLInputElement).value || window.siyuan.languages._kernel[272])
                                : window.siyuan.languages.removeCol.replace("${x}", menuElement.querySelector("input").value || window.siyuan.languages._kernel[272])}
    <div class="fn__hr--b"></div>
    <button class="fn__block b3-button b3-button--remove" data-action="delete">${isTwoWay ? window.siyuan.languages.removeBothRelationField : window.siyuan.languages.delete}</button>
    <div class="fn__hr"></div>
    <button class="fn__block b3-button b3-button--remove${isTwoWay ? "" : " fn__none"}" data-action="keep-relation">${window.siyuan.languages.removeButKeepRelationField}</button>
    <div class="fn__hr"></div>
    <button class="fn__block b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
</div>`,
                            width: "520px",
                        });
                        dialog.element.addEventListener("click", (dialogEvent) => {
                            let target = dialogEvent.target as HTMLElement;
                            const isDispatch = typeof dialogEvent.detail === "string";
                            while (target && target !== dialog.element || isDispatch) {
                                const action = target.getAttribute("data-action");
                                if (action === "delete" || (isDispatch && dialogEvent.detail === "Enter")) {
                                    removeCol({
                                        protyle: options.protyle,
                                        fields,
                                        avID,
                                        blockID,
                                        menuElement,
                                        isCustomAttr,
                                        blockElement: options.blockElement,
                                        avPanelElement,
                                        tabRect,
                                        isTwoWay: true
                                    });
                                    dialog.destroy();
                                    break;
                                } else if (action === "keep-relation") {
                                    removeCol({
                                        protyle: options.protyle,
                                        fields,
                                        avID,
                                        blockID,
                                        menuElement,
                                        isCustomAttr,
                                        blockElement: options.blockElement,
                                        avPanelElement,
                                        tabRect,
                                        isTwoWay: false
                                    });
                                    dialog.destroy();
                                    break;
                                } else if (target.classList.contains("b3-button--cancel") || (isDispatch && dialogEvent.detail === "Escape")) {
                                    dialog.destroy();
                                    break;
                                }
                                target = target.parentElement;
                            }
                        });
                        dialog.element.setAttribute("data-key", Constants.DIALOG_CONFIRM);
                    } else {
                        removeCol({
                            protyle: options.protyle,
                            fields,
                            avID,
                            blockID,
                            menuElement,
                            isCustomAttr,
                            blockElement: options.blockElement,
                            avPanelElement,
                            tabRect,
                            isTwoWay: false
                        });
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "setColOption") {
                    setColOption(options.protyle, data, target, options.blockElement, isCustomAttr, options.cellElements);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "setRelationCell") {
                    menuElement.querySelector(".b3-menu__item--current")?.classList.remove("b3-menu__item--current");
                    target.classList.add("b3-menu__item--current");
                    setRelationCell(options.protyle, options.blockElement as HTMLElement, target, options.cellElements);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addColOptionOrCell") {
                    menuElement.querySelector(".b3-menu__item--current")?.classList.remove("b3-menu__item--current");
                    target.classList.add("b3-menu__item--current");
                    if (target.querySelector(".b3-menu__checked")) {
                        removeCellOption(options.protyle, options.cellElements, menuElement.querySelector(`.b3-chips .b3-chip[data-content="${escapeAttr(target.dataset.name)}"]`), options.blockElement);
                    } else {
                        addColOptionOrCell(options.protyle, data, options.cellElements, target, menuElement, options.blockElement);
                    }
                    window.siyuan.menus.menu.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeCellOption") {
                    removeCellOption(options.protyle, options.cellElements, target.parentElement, options.blockElement);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addAssetLink") {
                    addAssetLink(options.protyle, options.cellElements, target, options.blockElement);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "addAssetExist") {
                    const rect = target.getBoundingClientRect();
                    assetMenu(options.protyle, {
                        x: rect.right,
                        y: rect.bottom,
                        w: target.parentElement.clientWidth + 8,
                        h: rect.height
                    }, (url, name) => {
                        let value: IAVCellAssetValue;
                        if (Constants.SIYUAN_ASSETS_IMAGE.includes(pathPosix().extname(url).toLowerCase())) {
                            value = {
                                type: "image",
                                content: url,
                                name: ""
                            };
                        } else {
                            value = {
                                type: "file",
                                content: url,
                                name
                            };
                        }
                        updateAssetCell({
                            protyle: options.protyle,
                            cellElements: options.cellElements,
                            addValue: [value],
                            blockElement: options.blockElement
                        });
                        window.siyuan.menus.menu.remove();
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "openAssetItem") {
                    const assetType = target.parentElement.dataset.type;
                    const assetLink = target.parentElement.dataset.content;
                    /// #if !MOBILE
                    const suffix = pathPosix().extname(assetLink);
                    if (assetType === "image") {
                        previewAttrViewImages(assetLink, avID, options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW),
                            (options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement)?.value.trim() || "");
                    } else if (isLocalPath(assetLink) && assetType === "file" && (
                        (suffix === ".pdf" && !assetLink.startsWith("file://")) ||
                        Constants.SIYUAN_ASSETS_AUDIO.concat(Constants.SIYUAN_ASSETS_VIDEO, Constants.SIYUAN_ASSETS_IMAGE).includes(suffix)
                    )) {
                        openAsset(options.protyle.app, assetLink.trim(), parseInt(getSearch("page", assetLink)), "right");
                    } else {
                        window.open(assetLink);
                    }
                    /// #else
                    if (assetType === "image") {
                        previewAttrViewImages(assetLink, avID, options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW),
                            (options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement)?.value.trim() || "");
                    } else {
                        window.open(assetLink);
                    }
                    /// #endif
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "editAssetItem") {
                    editAssetItem({
                        protyle: options.protyle,
                        cellElements: options.cellElements,
                        blockElement: options.blockElement,
                        content: target.parentElement.dataset.content,
                        type: target.parentElement.dataset.type as "image" | "file",
                        name: target.parentElement.dataset.name,
                        index: parseInt(target.parentElement.dataset.index),
                        rect: target.parentElement.getBoundingClientRect()
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "clearDate") {
                    const colData = fields.find((item: IAVColumn) => {
                        if (item.id === getColId(options.cellElements[0], data.viewType)) {
                            return true;
                        }
                    });
                    updateCellsValue(options.protyle, options.blockElement as HTMLElement, {
                        isNotEmpty2: false,
                        isNotEmpty: false,
                        content: null,
                        content2: null,
                        hasEndDate: false,
                        isNotTime: colData.date ? !colData.date.fillSpecificTime : true,
                    }, options.cellElements);
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "av-add") {
                    window.siyuan.menus.menu.remove();
                    addView(options.protyle, options.blockElement);
                    avPanelElement.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "av-view-switch") {
                    if (!target.parentElement.classList.contains("b3-menu__item--current")) {
                        avPanelElement.querySelector(".b3-menu__item--current")?.classList.remove("b3-menu__item--current");
                        target.parentElement.classList.add("b3-menu__item--current");
                        transaction(options.protyle, [{
                            action: "setAttrViewBlockView",
                            blockID,
                            id: target.parentElement.dataset.id,
                            avID
                        }], [{
                            action: "setAttrViewBlockView",
                            blockID,
                            id: options.blockElement.querySelector(".av__views .item--focus").getAttribute("data-id"),
                            avID
                        }]);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "av-view-edit") {
                    if (target.parentElement.classList.contains("b3-menu__item--current")) {
                        openViewMenu({
                            protyle: options.protyle,
                            blockElement: options.blockElement as HTMLElement,
                            element: target.parentElement
                        });
                    } else {
                        avPanelElement.querySelector(".b3-menu__item--current")?.classList.remove("b3-menu__item--current");
                        target.parentElement.classList.add("b3-menu__item--current");
                        transaction(options.protyle, [{
                            action: "setAttrViewBlockView",
                            blockID,
                            id: target.parentElement.dataset.id,
                            avID,
                        }], [{
                            action: "setAttrViewBlockView",
                            blockID,
                            id: options.blockElement.querySelector(".av__views .item--focus").getAttribute("data-id"),
                            avID,
                        }]);
                        window.siyuan.menus.menu.remove();
                        openViewMenu({
                            protyle: options.protyle,
                            blockElement: options.blockElement as HTMLElement,
                            element: target.parentElement
                        });
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "set-gallery-cover") {
                    setGalleryCover({
                        target,
                        protyle: options.protyle,
                        nodeElement: options.blockElement,
                        view: data.view as IAVGallery
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "set-gallery-size") {
                    setGallerySize({
                        target,
                        protyle: options.protyle,
                        nodeElement: options.blockElement,
                        view: data.view as IAVGallery
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "set-gallery-ratio") {
                    setGalleryRatio({
                        target,
                        protyle: options.protyle,
                        nodeElement: options.blockElement,
                        view: data.view as IAVGallery
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "set-layout") {
                    data = await updateLayout({
                        target,
                        protyle: options.protyle,
                        nodeElement: options.blockElement,
                        data
                    });
                    fields = getFieldsByData(data);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goGroupsDate") {
                    goGroupsDate({
                        target,
                        menuElement,
                        protyle: options.protyle,
                        blockElement: options.blockElement,
                        data
                    });
                    fields = getFieldsByData(data);
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "goGroupsSort") {
                    goGroupsSort({
                        target,
                        menuElement,
                        protyle: options.protyle,
                        blockElement: options.blockElement,
                        data
                    });
                    fields = getFieldsByData(data);
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "setGroupMethod") {
                    setGroupMethod({
                        protyle: options.protyle,
                        fieldId: target.getAttribute("data-id"),
                        data,
                        menuElement,
                        blockElement: options.blockElement,
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goGroups") {
                    if (menuElement.querySelector('[data-type="avGroupRange"]') && closeCB) {
                        await closeCB();
                    }
                    closeCB = undefined;
                    if ((data.view.group && data.view.group.field) || target.classList.contains("block__icon")) {
                        menuElement.innerHTML = getGroupsHTML(fields, data.view);
                        bindGroupsEvent({
                            protyle: options.protyle,
                            menuElement: menuElement,
                            blockElement: options.blockElement,
                            data
                        });
                    } else {
                        menuElement.innerHTML = getGroupsMethodHTML(fields, data.view.group, data.viewType);
                    }
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goGroupsMethod") {
                    window.siyuan.menus.menu.remove();
                    menuElement.innerHTML = getGroupsMethodHTML(fields, data.view.group, data.viewType);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "getGroupsNumber") {
                    window.siyuan.menus.menu.remove();
                    menuElement.innerHTML = getGroupsNumberHTML(data.view.group);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    closeCB = bindGroupsNumber({
                        protyle: options.protyle,
                        data,
                        menuElement,
                        blockElement: options.blockElement
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "hideGroup") {
                    window.siyuan.menus.menu.remove();
                    const useElement = target.firstElementChild;
                    const isHide = useElement.getAttribute("xlink:href") !== "#iconEye";
                    useElement.setAttribute("xlink:href", isHide ? "#iconEye" : "#iconEyeoff");
                    let oldGroupHidden;
                    let showCount = 0;
                    data.view.groups.forEach((item) => {
                        if (item.id === target.dataset.id) {
                            oldGroupHidden = item.groupHidden;
                            item.groupHidden = isHide ? 0 : 2;
                        }
                        if (item.groupHidden === 0) {
                            showCount++;
                        }
                    });
                    target.parentElement.classList[isHide ? "remove" : "add"]("b3-menu__item--hidden");
                    menuElement.querySelector('[data-type="hideGroups"]').innerHTML = `${window.siyuan.languages[showCount === 0 ? "showAll" : "hideAll"]}
<span class="fn__space"></span>
<svg><use xlink:href="#iconEye${showCount === 0 ? "" : "off"}"></use></svg>`;
                    transaction(options.protyle, [{
                        action: "hideAttrViewGroup",
                        avID: data.id,
                        blockID,
                        id: target.dataset.id,
                        data: isHide ? 0 : 2,
                    }], [{
                        action: "hideAttrViewGroup",
                        avID: data.id,
                        blockID,
                        id: target.dataset.id,
                        data: oldGroupHidden
                    }]);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "hideGroups") {
                    window.siyuan.menus.menu.remove();
                    const isShow = target.querySelector("use").getAttribute("xlink:href") === "#iconEyeoff";
                    target.innerHTML = `${window.siyuan.languages[isShow ? "showAll" : "hideAll"]}
<span class="fn__space"></span>
<svg><use xlink:href="#iconEye${isShow ? "" : "off"}"></use></svg>`;
                    data.view.groups.forEach((item) => {
                        item.groupHidden = isShow ? 2 : 0;
                        const itemElement = target.parentElement.parentElement.querySelector(`.b3-menu__item[data-id="${item.id}"]`);
                        itemElement.classList[isShow ? "add" : "remove"]("b3-menu__item--hidden");
                        itemElement.querySelector(".b3-menu__action use")?.setAttribute("xlink:href", `#iconEye${isShow ? "off" : ""}`);
                    });
                    transaction(options.protyle, [{
                        action: "hideAttrViewAllGroups",
                        avID: data.id,
                        blockID,
                        data: isShow,
                    }], [{
                        action: "hideAttrViewAllGroups",
                        avID: data.id,
                        blockID,
                        data: !isShow
                    }]);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "removeGroups") {
                    window.siyuan.menus.menu.remove();
                    transaction(options.protyle, [{
                        action: "removeAttrViewGroup",
                        avID: data.id,
                        blockID,
                    }], [{
                        action: "setAttrViewGroup",
                        avID: data.id,
                        blockID,
                        data: data.view.group
                    }]);
                    data.view.group = null;
                    delete data.view.groups;
                    menuElement.innerHTML = getGroupsHTML(fields, data.view);
                    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                // 有错误日志，没找到重现步骤，需先判断一下
                if (!target || !target.parentElement) {
                    break;
                }
                target = target.parentElement;
            }
        });
    });
};

export const getPropertiesHTML = (fields: IAVColumn[]) => {
    let showHTML = "";
    let hideHTML = "";
    fields.forEach((item: IAVColumn) => {
        if (item.hidden) {
            hideHTML += `<button class="b3-menu__item" data-type="editCol" draggable="true" data-id="${item.id}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="b3-menu__label fn__flex">
        ${item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}
        ${escapeHtml(item.name) || "&nbsp;"}
    </div>
    <svg class="b3-menu__action" data-type="showCol"><use xlink:href="#iconEye"></use></svg>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
        } else {
            showHTML += `<button class="b3-menu__item" data-type="editCol" draggable="true" data-id="${item.id}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="b3-menu__label fn__flex">
        ${item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}
        ${escapeHtml(item.name) || "&nbsp;"}
    </div>
    <svg class="b3-menu__action${item.type === "block" ? " fn__none" : ""}" data-type="hideCol"><use xlink:href="#iconEyeoff"></use></svg>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
        }
    });
    if (hideHTML) {
        hideHTML = `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">
        ${window.siyuan.languages.hideCol} 
    </span>
    <span class="block__icon" data-type="showAllCol">
        ${window.siyuan.languages.showAll}
        <span class="fn__space"></span>
        <svg><use xlink:href="#iconEye"></use></svg>
    </span>
</button>
${hideHTML}`;
    }
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="go-config">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.fields}</span>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">
        ${window.siyuan.languages.showCol} 
    </span>
    <span class="block__icon" data-type="hideAllCol">
        ${window.siyuan.languages.hideAll}
        <span class="fn__space"></span>
        <svg><use xlink:href="#iconEyeoff"></use></svg>
    </span>
</button>
${showHTML}
${hideHTML}
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="newCol">
    <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.new}</span>
</button>
</div>`;
};

