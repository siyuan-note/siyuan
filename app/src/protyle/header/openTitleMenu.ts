import type {BlockQueryRequestInput} from "../../types/api";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {hideTooltip} from "../../dialog/tooltip";
import {isEncryptedBox} from "../../util/pathName";
import {isMobile} from "../../util/functions";
import {openDocumentMenu} from "./documentMenu";

export const openTitleMenu = (protyle: IProtyle, position: IPosition, from: string, restoreKeyboard?: () => void) => {
    hideTooltip();
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_TITLE) {
        if (isMobile()) {
            window.siyuan.menus.menu.closeSheet();
        } else {
            window.siyuan.menus.menu.remove();
        }
        return;
    }
    const docInfoParam: BlockQueryRequestInput = {
        id: protyle.block.rootID
    };
    if (isEncryptedBox(protyle.notebookId)) {
        docInfoParam.notebook = protyle.notebookId;
    }
    fetchPost("/api/block/getDocInfo", docInfoParam, (response) => {
        if (response.code !== 0 || !response.data) {
            return;
        }
        openDocumentMenu({
            app: protyle.app,
            id: protyle.block.rootID,
            notebookId: protyle.notebookId,
            path: protyle.path,
            docInfo: response.data,
            target: protyle.element,
            position,
            from,
            disabled: protyle.disabled,
            protyle,
            blockId: protyle.block.id,
            showAll: protyle.block.showAll,
            restoreKeyboard,
        });
    });
};
