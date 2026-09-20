import {showMessage} from "../../dialog/message";
import {hasUnloadedDocumentBlocks} from "./documentRange";

export const showSelectAllIncompleteTip = (protyle: IProtyle) => {
    if (window.siyuan.config.appearance.notifications?.selectAllIncompleteTip === false ||
        !hasUnloadedDocumentBlocks(protyle.wysiwyg.element,
            !protyle.lite && !protyle.block.showAll && protyle.block.scroll && !protyle.options.backlinkData)) {
        return;
    }
    showMessage(window.siyuan.languages.selectAllIncompleteTip, 6000, "info", "selectAllIncompleteTip");
};
