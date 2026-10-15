import {toggleMenu} from "../../menus/menuToggle";
import type {BlockQueryRequestInput} from "../../types/api";
import {fetchPost} from "../../util/fetch";
import {hideTooltip} from "../../dialog/tooltip";
import {isEncryptedBox} from "../../util/pathName";
import {openDocumentMenu} from "./documentMenu";

export const openTitleMenu = (protyle: IProtyle, position: IPosition, from: string, restoreKeyboard?: () => void) => {
    toggleMenu({
        target: position.target,
        build: (_menu, session) => {
            hideTooltip();

            const docInfoParam: BlockQueryRequestInput = {
                id: protyle.block.rootID
            };
            if (isEncryptedBox(protyle.notebookId)) {
                docInfoParam.notebook = protyle.notebookId;
            }
            fetchPost("/api/block/getDocInfo", docInfoParam, (response) => {
                if (!session.isCurrent()) {
                    return;
                }

                if (response.code !== 0 || !response.data) {
                    return;
                }
                session.show(() => openDocumentMenu({
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
                }));
            });

        },
    });
};
