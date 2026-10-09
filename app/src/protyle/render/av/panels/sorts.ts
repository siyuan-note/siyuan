import { getSortsHTML, bindSortsEvent, addSort } from "../sort";
import { setPosition } from "../../../../util/setPosition";
import { transaction } from "../../../wysiwyg/transaction";
import type { IAVPanelDescriptor } from "./types";
export const sortsPanel: IAVPanelDescriptor = {
    render: context => {
        context.html = getSortsHTML(context.fields, context.data.view.sorts);
        return true;
    },
    bind: context => {
        bindSortsEvent(context.options.protyle, context.menuElement, context.data, context.blockID);
    },
    actions: {
        "goSorts": (context, action) => {
            context.menuElement.classList.remove("av__filter-panel");
            context.menuElement.innerHTML = getSortsHTML(context.fields, context.data.view.sorts);
            bindSortsEvent(context.options.protyle, context.menuElement, context.data, context.blockID);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            window.siyuan.menus.menu.remove();
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "removeSorts": (context, action) => {
            transaction(context.options.protyle, [{
                    action: "setAttrViewSorts",
                    avID: context.avID,
                    data: [],
                    blockID: context.blockID
                }], [{
                    action: "setAttrViewSorts",
                    avID: context.avID,
                    data: context.data.view.sorts,
                    blockID: context.blockID
                }]);
            context.data.view.sorts = [];
            context.menuElement.innerHTML = getSortsHTML(context.fields, context.data.view.sorts);
            bindSortsEvent(context.options.protyle, context.menuElement, context.data, context.blockID);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "addSort": (context, action) => {
            addSort({
                data: context.data,
                rect: action.target.getBoundingClientRect(),
                menuElement: context.menuElement,
                tabRect: context.tabRect,
                avId: context.avID,
                protyle: context.options.protyle,
                blockID: context.blockID,
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "removeSort": (context, action) => {
            const oldSorts = Object.assign([], context.data.view.sorts);
            context.data.view.sorts.find((item: IAVSort, index: number) => {
                if (item.column === action.target.parentElement.dataset.id) {
                    context.data.view.sorts.splice(index, 1);
                    return true;
                }
            });
            transaction(context.options.protyle, [{
                    action: "setAttrViewSorts",
                    avID: context.avID,
                    data: context.data.view.sorts,
                    blockID: context.blockID
                }], [{
                    action: "setAttrViewSorts",
                    avID: context.avID,
                    data: oldSorts,
                    blockID: context.blockID
                }]);
            context.menuElement.innerHTML = getSortsHTML(context.fields, context.data.view.sorts);
            bindSortsEvent(context.options.protyle, context.menuElement, context.data, context.blockID);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
