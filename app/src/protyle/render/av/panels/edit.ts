import { getEditHTML, bindEditEvent, addCol, getColIconByType, getColNameByType, duplicateCol, removeCol } from "../col";
import { formatNumber } from "../number";
import { openEmojiPanel, unicode2Emoji } from "../../../../emoji";
import { transaction } from "../../../wysiwyg/transaction";
import { updateAttrViewCellAnimation } from "../action";
import { setPosition } from "../../../../util/setPosition";
import { hasFilterForColumn, removeFiltersByColumn } from "../filter";
import { hasClosestByClassName } from "../../../util/hasClosest";
import { Dialog } from "../../../../dialog";
import { Constants } from "../../../../constants";
import type { IAVPanelDescriptor } from "./types";
export const editPanel: IAVPanelDescriptor = {
    render: context => {
        if (context.options.editData) {
            if (typeof context.options.editData.colData.wrap === "undefined") {
                context.options.editData.colData.wrap = context.data.view.wrapField;
            }
            if (context.options.editData.previousID) {
                context.fields.find((item, index) => {
                    if (item.id === context.options.editData.previousID) {
                        context.fields.splice(index + 1, 0, context.options.editData.colData);
                        return true;
                    }
                });
            }
            else {
                if (context.data.viewType === "table") {
                    context.fields.splice(0, 0, context.options.editData.colData);
                }
                else {
                    context.fields.push(context.options.editData.colData);
                }
            }
        }
        context.html = getEditHTML({ protyle: context.options.protyle, data: context.data, colId: context.options.colId, isCustomAttr: context.isCustomAttr });
        return true;
    },
    bind: context => {
        bindEditEvent({ protyle: context.options.protyle, data: context.data, menuElement: context.menuElement, isCustomAttr: context.isCustomAttr, blockID: context.blockID });
    },
    actions: {
        "numberFormat": (context, action) => {
            formatNumber({
                avPanelElement: context.avPanelElement,
                element: action.target,
                protyle: context.options.protyle,
                oldFormat: action.target.dataset.format,
                colId: context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id"),
                avID: context.avID
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "newCol": (context, action) => {
            context.avPanelElement.remove();
            const addMenu = addCol(context.options.protyle, context.options.blockElement);
            addMenu.open({
                x: context.tabRect.right,
                y: context.tabRect.bottom,
                h: context.tabRect.height,
                isLeft: true
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "update-icon": (context, action) => {
            const rect = action.target.getBoundingClientRect();
            openEmojiPanel("", "av", {
                x: rect.left,
                y: rect.bottom + 4,
                h: rect.height,
                w: rect.width
            }, (unicode) => {
                const colId = context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
                transaction(context.options.protyle, [{
                        action: "setAttrViewColIcon",
                        id: colId,
                        avID: context.avID,
                        data: unicode,
                    }], [{
                        action: "setAttrViewColIcon",
                        id: colId,
                        avID: context.avID,
                        data: action.target.dataset.icon,
                    }]);
                action.target.innerHTML = unicode ? unicode2Emoji(unicode) : `<svg style="height: 14px;width: 14px"><use xlink:href="#${getColIconByType(action.target.dataset.colType as TAVCol)}"></use></svg>`;
                if (context.isCustomAttr) {
                    const iconElement = context.options.blockElement.querySelector(`.av__row[data-col-id="${colId}"] .block__logoicon`);
                    iconElement.outerHTML = unicode ? unicode2Emoji(unicode, "block__logoicon", true) : `<svg class="block__logoicon"><use xlink:href="#${getColIconByType(iconElement.nextElementSibling.getAttribute("data-type") as TAVCol)}"></use></svg>`;
                }
                else {
                    updateAttrViewCellAnimation(context.options.blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`), undefined, { icon: unicode });
                }
                action.target.dataset.icon = unicode;
            }, action.target.querySelector("img"), {
                ownerElement: context.options.protyle.element,
                targetID: context.options.protyle.block.rootID,
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "editCol": (context, action) => {
            context.menuElement.innerHTML = getEditHTML({
                protyle: context.options.protyle,
                data: context.data,
                colId: action.target.dataset.id,
                isCustomAttr: context.isCustomAttr
            });
            bindEditEvent({ protyle: context.options.protyle, data: context.data, menuElement: context.menuElement, isCustomAttr: context.isCustomAttr, blockID: context.blockID });
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "updateColType": (context, action) => {
            const colId = context.options.colId || context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
            if (action.target.dataset.newType !== action.target.dataset.oldType) {
                const nameElement = context.avPanelElement.querySelector('.b3-text-field[data-type="name"]') as HTMLInputElement;
                const name = nameElement.value;
                let newName = name;
                context.fields.find((item: IAVColumn) => {
                    if (item.id === colId) {
                        item.type = action.target.dataset.newType as TAVCol;
                        if (getColNameByType(action.target.dataset.oldType as TAVCol) === name) {
                            newName = getColNameByType(action.target.dataset.newType as TAVCol);
                            item.name = newName;
                        }
                        return true;
                    }
                });
                transaction(context.options.protyle, [{
                        action: "updateAttrViewCol",
                        id: colId,
                        avID: context.avID,
                        name: newName,
                        type: action.target.dataset.newType as TAVCol,
                    }], [{
                        action: "updateAttrViewCol",
                        id: colId,
                        avID: context.avID,
                        name,
                        type: action.target.dataset.oldType as TAVCol,
                    }]);
                // 需要取消行号列的筛选和排序
                if (action.target.dataset.newType === "lineNumber") {
                    const sortExist = context.data.view.sorts.find((sort) => sort.column === colId);
                    if (sortExist) {
                        const oldSorts = Object.assign([], context.data.view.sorts);
                        const newSorts = context.data.view.sorts.filter((sort) => sort.column !== colId);
                        transaction(context.options.protyle, [{
                                action: "setAttrViewSorts",
                                avID: context.data.id,
                                data: newSorts,
                                blockID: context.blockID,
                            }], [{
                                action: "setAttrViewSorts",
                                avID: context.data.id,
                                data: oldSorts,
                                blockID: context.blockID,
                            }]);
                    }
                    const filterExist = hasFilterForColumn(context.data.view.filters, colId);
                    if (filterExist) {
                        const oldFilters = JSON.parse(JSON.stringify(context.data.view.filters));
                        // 递归移除引用该列的叶子并裁剪空分组。spec 5 下顶层为根组，操作其子节点；
                        // 兜底旧扁平数据（无根组）时直接处理顶层。
                        const root = context.data.view.filters[0] && context.data.view.filters[0].filters ? context.data.view.filters[0] : null;
                        if (root) {
                            root.filters = removeFiltersByColumn(root.filters, colId);
                        }
                        else {
                            context.data.view.filters = removeFiltersByColumn(context.data.view.filters, colId);
                        }
                        transaction(context.options.protyle, [{
                                action: "setAttrViewFilters",
                                avID: context.data.id,
                                data: JSON.parse(JSON.stringify(context.data.view.filters)),
                                blockID: context.blockID
                            }], [{
                                action: "setAttrViewFilters",
                                avID: context.data.id,
                                data: oldFilters,
                                blockID: context.blockID
                            }]);
                    }
                }
            }
            context.menuElement.innerHTML = getEditHTML({
                protyle: context.options.protyle,
                data: context.data,
                colId,
                isCustomAttr: context.isCustomAttr
            });
            bindEditEvent({ protyle: context.options.protyle, data: context.data, menuElement: context.menuElement, isCustomAttr: context.isCustomAttr, blockID: context.blockID });
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "goUpdateColType": (context, action) => {
            window.siyuan.menus.menu.remove();
            const editMenuElement = hasClosestByClassName(action.target, "b3-menu");
            if (editMenuElement) {
                // 移动端菜单顶部会插入抓手标题，属性列表和类型列表按 items 容器定位
                const itemsElements = editMenuElement.querySelectorAll(":scope > .b3-menu__items");
                itemsElements[0]?.classList.add("fn__none");
                itemsElements[1]?.classList.remove("fn__none");
            }
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "goEditCol": (context, action) => {
            const editMenuElement = hasClosestByClassName(action.target, "b3-menu");
            if (editMenuElement) {
                // 移动端菜单顶部会插入抓手标题，属性列表和类型列表按 items 容器定位
                const itemsElements = editMenuElement.querySelectorAll(":scope > .b3-menu__items");
                itemsElements[0]?.classList.remove("fn__none");
                itemsElements[1]?.classList.add("fn__none");
            }
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "duplicateCol": (context, action) => {
            duplicateCol({
                blockElement: context.options.blockElement,
                protyle: context.options.protyle,
                colId: context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id"),
                data: context.data,
                viewID: context.data.viewID,
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "removeCol": (context, action) => {
            if (!context.isCustomAttr) {
                context.tabRect = context.options.blockElement.querySelector(".av__views").getBoundingClientRect();
            }
            const colId = context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
            const colData = context.fields.find((item: IAVColumn) => {
                if (item.id === colId) {
                    return true;
                }
            });
            const isTwoWay = colData.type === "relation" && colData.relation?.isTwoWay;
            if (context.isCustomAttr || isTwoWay) {
                const dialog = new Dialog({
                    title: isTwoWay ? window.siyuan.languages.removeColConfirm : window.siyuan.languages.deleteOpConfirm,
                    content: `<div class="b3-dialog__content">
    ${isTwoWay ? window.siyuan.languages.confirmRemoveRelationField
                        .replace("${x}", context.menuElement.querySelector("input").value || window.siyuan.languages._kernel[272])
                        .replace("${y}", context.menuElement.querySelector('.b3-menu__item[data-type="goSearchAV"] .b3-menu__accelerator').textContent)
                        .replace("${z}", (context.menuElement.querySelector('input[data-type="colName"]') as HTMLInputElement).value || window.siyuan.languages._kernel[272])
                        : window.siyuan.languages.removeCol.replace("${x}", context.menuElement.querySelector("input").value || window.siyuan.languages._kernel[272])}
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
                                protyle: context.options.protyle,
                                fields: context.fields,
                                avID: context.avID,
                                blockID: context.blockID,
                                menuElement: context.menuElement,
                                isCustomAttr: context.isCustomAttr,
                                blockElement: context.options.blockElement,
                                avPanelElement: context.avPanelElement,
                                tabRect: context.tabRect,
                                isTwoWay: true
                            });
                            dialog.destroy();
                            break;
                        }
                        else if (action === "keep-relation") {
                            removeCol({
                                protyle: context.options.protyle,
                                fields: context.fields,
                                avID: context.avID,
                                blockID: context.blockID,
                                menuElement: context.menuElement,
                                isCustomAttr: context.isCustomAttr,
                                blockElement: context.options.blockElement,
                                avPanelElement: context.avPanelElement,
                                tabRect: context.tabRect,
                                isTwoWay: false
                            });
                            dialog.destroy();
                            break;
                        }
                        else if (target.classList.contains("b3-button--cancel") || (isDispatch && dialogEvent.detail === "Escape")) {
                            dialog.destroy();
                            break;
                        }
                        target = target.parentElement;
                    }
                });
                dialog.element.setAttribute("data-key", Constants.DIALOG_CONFIRM);
            }
            else {
                removeCol({
                    protyle: context.options.protyle,
                    fields: context.fields,
                    avID: context.avID,
                    blockID: context.blockID,
                    menuElement: context.menuElement,
                    isCustomAttr: context.isCustomAttr,
                    blockElement: context.options.blockElement,
                    avPanelElement: context.avPanelElement,
                    tabRect: context.tabRect,
                    isTwoWay: false
                });
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
