import { getDateHTML, bindDateEvent } from "../date";
import { formatDate } from "../dateFormatMenu";
import { getColId } from "../col";
import { updateCellsValue } from "../cell";
import type { IAVPanelDescriptor } from "./types";
export const datePanel: IAVPanelDescriptor = {
    render: context => {
        const colId = getColId(context.options.cellElements[0], context.data.viewType);
        context.html = getDateHTML(context.options.cellElements, context.fields.find(field => field.id === colId)?.dateFormat || "");
        return true;
    },
    bind: context => {
        context.closeCB = bindDateEvent({
            protyle: context.options.protyle,
            data: context.data,
            menuElement: context.menuElement,
            cellElements: context.options.cellElements,
            blockElement: context.options.blockElement,
            requireExplicitChange: context.options.requireExplicitChange,
            format: context.fields.find(field => field.id === getColId(context.options.cellElements[0], context.data.viewType))?.dateFormat || "",
        });
    },
    actions: {
        "dateFormat": (context, action) => {
            const colId = context.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
            const colData = context.fields.find((item) => item.id === colId);
            formatDate({
                avPanelElement: context.avPanelElement,
                element: action.target,
                protyle: context.options.protyle,
                oldFormat: action.target.dataset.format as TAVDateFormat,
                colId,
                avID: context.avID,
                type: colData.type as "date" | "created" | "updated",
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "clearDate": (context, action) => {
            const colData = context.fields.find((item: IAVColumn) => {
                if (item.id === getColId(context.options.cellElements[0], context.data.viewType)) {
                    return true;
                }
            });
            updateCellsValue(context.options.protyle, context.options.blockElement as HTMLElement, {
                isNotEmpty2: false,
                isNotEmpty: false,
                content: null,
                content2: null,
                hasEndDate: false,
                isNotTime: colData.date ? !colData.date.fillSpecificTime : true,
            }, context.options.cellElements, context.fields);
            context.avPanelElement.remove();
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
