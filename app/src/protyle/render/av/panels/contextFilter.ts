import { getContextFilterHTML, bindContextFilterEvent } from "../contextFilter";
import type { IAVPanelDescriptor } from "./types";
export const contextFilterPanel: IAVPanelDescriptor = {
    render: context => {
        context.html = getContextFilterHTML(context.data);
        return true;
    },
    bind: context => {
        bindContextFilterEvent({ protyle: context.options.protyle, menuElement: context.menuElement, data: context.data, blockID: context.blockID, avID: context.avID });
    },
};
