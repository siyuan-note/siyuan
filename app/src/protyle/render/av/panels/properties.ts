import { setPosition } from "../../../../util/setPosition";
import { openFieldVisibilityPanel } from "../fieldVisibility";
import { transaction } from "../../../wysiwyg/transaction";
import { getEditHTML, bindEditEvent, getColIconByType } from "../col";
import { unicode2Emoji } from "../../../../emoji";
import { escapeHtml } from "../../../../util/escape";
import type { IAVPanelDescriptor } from "./types";
export const getPropertiesHTML = (fields: IAVColumn[], viewType: TAVView) => {
    let showHTML = "";
    let hideHTML = "";
    fields.forEach((item: IAVColumn) => {
        if (item.hidden) {
            hideHTML += `<button class="b3-menu__item" data-type="editCol" draggable="true" data-id="${item.id}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="b3-menu__label fn__flex">${item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}<span class="fn__flex-1">${escapeHtml(item.name) || "&nbsp;"}</span></div>
    <svg class="b3-menu__action" data-type="showCol"><use xlink:href="#iconEye"></use></svg>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
        }
        else {
            showHTML += `<button class="b3-menu__item" data-type="editCol" draggable="true" data-id="${item.id}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="b3-menu__label fn__flex">${item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}<span class="fn__flex-1">${escapeHtml(item.name) || "&nbsp;"}</span></div>
    <svg class="b3-menu__action${item.type === "block" && viewType !== "gallery" ? " fn__none" : ""}" data-type="hideCol"><use xlink:href="#iconEyeoff"></use></svg>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
        }
    });
    if (hideHTML) {
        hideHTML = `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">${window.siyuan.languages.hideCol}</span>
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
    <span class="block__icon block__icon--menu-back" data-type="go-config">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.fields}</span>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">${window.siyuan.languages.showCol}</span>
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
export const propertiesPanel: IAVPanelDescriptor = {
    render: context => {
        context.html = getPropertiesHTML(context.fields, context.data.viewType);
        return true;
    },
    actions: {
        "go-properties": (context, action) => {
            // 复制列后点击返回到属性面板，宽度不一致，需重新计算
            context.tabRect = context.options.blockElement.querySelector(".av__views").getBoundingClientRect();
            context.menuElement.classList.remove("av__filter-panel");
            context.menuElement.innerHTML = getPropertiesHTML(context.fields, context.data.viewType);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            window.siyuan.menus.menu.remove();
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "fieldVisibility": (context, action) => {
            const colId = context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
            openFieldVisibilityPanel({
                protyle: context.options.protyle,
                blockElement: context.options.blockElement,
                colId,
                menuElement: context.menuElement,
                field: context.fields.find((item) => item.id === colId),
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "showAllCol": (context, action) => {
            const doOperations: IOperation[] = [];
            const undoOperations: IOperation[] = [];
            context.fields.forEach((item: IAVColumn) => {
                if (item.hidden) {
                    doOperations.push({
                        action: "setAttrViewColHidden",
                        id: item.id,
                        avID: context.avID,
                        data: false,
                        blockID: context.blockID,
                        viewID: context.data.viewID,
                    });
                    undoOperations.push({
                        action: "setAttrViewColHidden",
                        id: item.id,
                        avID: context.avID,
                        data: true,
                        blockID: context.blockID,
                        viewID: context.data.viewID,
                    });
                    item.hidden = false;
                }
            });
            if (doOperations.length > 0) {
                transaction(context.options.protyle, doOperations, undoOperations);
                context.menuElement.innerHTML = getPropertiesHTML(context.fields, context.data.viewType);
                setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "hideAllCol": (context, action) => {
            const doOperations: IOperation[] = [];
            const undoOperations: IOperation[] = [];
            context.fields.forEach((item: IAVColumn) => {
                if (!item.hidden && (item.type !== "block" || context.data.viewType === "gallery")) {
                    doOperations.push({
                        action: "setAttrViewColHidden",
                        id: item.id,
                        avID: context.avID,
                        data: true,
                        blockID: context.blockID,
                        viewID: context.data.viewID,
                    });
                    undoOperations.push({
                        action: "setAttrViewColHidden",
                        id: item.id,
                        avID: context.avID,
                        data: false,
                        blockID: context.blockID,
                        viewID: context.data.viewID,
                    });
                    item.hidden = true;
                }
            });
            if (doOperations.length > 0) {
                transaction(context.options.protyle, doOperations, undoOperations);
                context.menuElement.innerHTML = getPropertiesHTML(context.fields, context.data.viewType);
                setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "hideCol": (context, action) => {
            const isEdit = context.menuElement.querySelector('[data-type="go-properties"]');
            const colId = isEdit ? context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id") : action.target.parentElement.getAttribute("data-id");
            transaction(context.options.protyle, [{
                    action: "setAttrViewColHidden",
                    id: colId,
                    avID: context.avID,
                    data: true,
                    blockID: context.blockID,
                    viewID: context.data.viewID,
                }], [{
                    action: "setAttrViewColHidden",
                    id: colId,
                    avID: context.avID,
                    data: false,
                    blockID: context.blockID,
                    viewID: context.data.viewID,
                }]);
            context.fields.find((item: IAVColumn) => item.id === colId).hidden = true;
            if (isEdit) {
                context.menuElement.innerHTML = getEditHTML({
                    protyle: context.options.protyle,
                    data: context.data,
                    colId,
                    isCustomAttr: context.isCustomAttr
                });
                bindEditEvent({ protyle: context.options.protyle, data: context.data, menuElement: context.menuElement, isCustomAttr: context.isCustomAttr, blockID: context.blockID });
            }
            else {
                context.menuElement.innerHTML = getPropertiesHTML(context.fields, context.data.viewType);
            }
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "showCol": (context, action) => {
            const isEdit = context.menuElement.querySelector('[data-type="go-properties"]');
            const colId = isEdit ? context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id") : action.target.parentElement.getAttribute("data-id");
            transaction(context.options.protyle, [{
                    action: "setAttrViewColHidden",
                    id: colId,
                    avID: context.avID,
                    data: false,
                    blockID: context.blockID,
                    viewID: context.data.viewID,
                }], [{
                    action: "setAttrViewColHidden",
                    id: colId,
                    avID: context.avID,
                    data: true,
                    blockID: context.blockID,
                    viewID: context.data.viewID,
                }]);
            context.fields.find((item: IAVColumn) => item.id === colId).hidden = false;
            if (isEdit) {
                context.menuElement.innerHTML = getEditHTML({
                    protyle: context.options.protyle,
                    data: context.data,
                    colId,
                    isCustomAttr: context.isCustomAttr
                });
                bindEditEvent({ protyle: context.options.protyle, data: context.data, menuElement: context.menuElement, isCustomAttr: context.isCustomAttr, blockID: context.blockID });
            }
            else {
                context.menuElement.innerHTML = getPropertiesHTML(context.fields, context.data.viewType);
            }
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
