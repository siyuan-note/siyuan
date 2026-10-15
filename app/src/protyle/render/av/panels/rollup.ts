import { getRollupHTML, bindRollupData, goSearchRollupCol } from "../rollup";
import { openCalcMenu } from "../calc";
import type { IAVPanelDescriptor } from "./types";
export const rollupPanel: IAVPanelDescriptor = {
    render: context => {
        context.html = `<div class="b3-menu__items">${getRollupHTML({ data: context.data, cellElements: context.options.cellElements })}</div>`;
        return true;
    },
    bind: context => {
        bindRollupData({ protyle: context.options.protyle, data: context.data, menuElement: context.menuElement });
    },
    actions: {
        "goSearchRollupCol": (context, action) => {
            goSearchRollupCol({
                target: action.target,
                data: context.data,
                isRelation: true,
                protyle: context.options.protyle,
                colId: context.options.colId || context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id")
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "goSearchRollupTarget": (context, action) => {
            goSearchRollupCol({
                target: action.target,
                data: context.data,
                isRelation: false,
                protyle: context.options.protyle,
                colId: context.options.colId || context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id")
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "goSearchRollupCalc": (context, action) => {
            openCalcMenu(context.options.protyle, action.target, {
                data: context.data,
                colId: context.options.colId || context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id"),
                blockID: context.blockID
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
