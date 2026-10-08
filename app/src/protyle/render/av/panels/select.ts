import { getSelectHTML, bindSelectEvent, setColOption, removeCellOption, addColOptionOrCell } from "../select";
import { escapeAttr } from "../../../../util/escape";
import type { IAVPanelDescriptor } from "./types";
export const selectPanel: IAVPanelDescriptor = {
    render: context => {
        context.html = getSelectHTML(context.fields, context.options.cellElements, true, context.options.blockElement);
        return true;
    },
    bind: context => {
        bindSelectEvent(context.options.protyle, context.data, context.menuElement, context.options.cellElements, context.options.blockElement);
    },
    actions: {
        "setColOption": (context, action) => {
            setColOption(context.options.protyle, context.data, action.target, context.options.blockElement, context.isCustomAttr, context.options.cellElements, context.options.keepMenuOpen);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "addColOptionOrCell": (context, action) => {
            context.menuElement.querySelector(".b3-menu__item--current")?.classList.remove("b3-menu__item--current");
            action.target.classList.add("b3-menu__item--current");
            if (action.target.querySelector(".b3-menu__checked")) {
                removeCellOption(context.options.protyle, context.options.cellElements, context.menuElement.querySelector(`.b3-chips .b3-chip[data-content="${escapeAttr(action.target.dataset.name)}"]`), context.options.blockElement);
            }
            else {
                addColOptionOrCell(context.options.protyle, context.data, context.options.cellElements, action.target, context.menuElement, context.options.blockElement);
            }
            if (!context.options.keepMenuOpen) {
                window.siyuan.menus.menu.remove();
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "removeCellOption": (context, action) => {
            removeCellOption(context.options.protyle, context.options.cellElements, action.target.parentElement, context.options.blockElement);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
