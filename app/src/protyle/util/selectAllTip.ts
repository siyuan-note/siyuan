import {hideMessage, showMessage} from "../../dialog/message";
import {countBlockWord} from "../../layout/status";
import {activeBlur} from "../../mobile/util/keyboardToolbar";
import {updateMultiSelectToolbar} from "../../mobile/util/multiSelectToolbar";
import {escapeHtml} from "../../util/escape";
import {isMobile} from "../../util/functions";
import {hideElements} from "../ui/hideElements";
import {selectAllLoadedBlocks} from "../wysiwyg/blockSelection";
import {hasUnloadedDocumentBlocks} from "./documentRange";
import {focusBlock} from "./selection";

export const showSelectAllIncompleteTip = (protyle: IProtyle) => {
    if (window.siyuan.config.appearance.notifications?.selectAllIncompleteTip === false ||
        !hasUnloadedDocumentBlocks(protyle.wysiwyg.element,
            !protyle.lite && !protyle.block.showAll && protyle.block.scroll && !protyle.options.backlinkData)) {
        return;
    }
    const messageID = "selectAllIncompleteTip";
    showMessage(`<div class="fn__flex fn__flex-wrap">
<span class="fn__flex-center">${window.siyuan.languages.selectAllIncompleteTip}</span>
<span class="fn__space"></span>
<button type="button" class="b3-button b3-button--white">${window.siyuan.languages.loadAllAndSelectAll}</button>
</div>`, 6000, "info", messageID);
    const button = document.querySelector<HTMLButtonElement>(`#message [data-id="${messageID}"] button`);
    const rootID = protyle.block.rootID;
    const parentID = protyle.block.parentID;
    const editorElement = protyle.wysiwyg.element;
    const isCurrent = () => protyle.element.isConnected && protyle.block.rootID === rootID &&
        protyle.block.parentID === parentID && protyle.wysiwyg.element === editorElement;
    button?.addEventListener("click", async () => {
        if (button.disabled || !isCurrent()) {
            return;
        }
        button.disabled = true;
        try {
            if (hasUnloadedDocumentBlocks(editorElement, protyle.block.scroll) &&
                !await protyle.scroll.loadAll(protyle, {messageId: messageID})) {
                return;
            }
            if (!isCurrent()) {
                return;
            }
            hideElements(["toolbar"], protyle);
            if (isMobile()) {
                window.getSelection()?.removeAllRanges();
                activeBlur();
            } else {
                focusBlock(editorElement.firstElementChild);
            }
            const elements = selectAllLoadedBlocks(editorElement);
            countBlockWord(elements.map(item => item.getAttribute("data-node-id")), protyle);
            if (isMobile() && elements.length > 0) {
                if (protyle.toolbar.isMultiSelectMode()) {
                    updateMultiSelectToolbar(protyle.toolbar.subElement, elements.length);
                } else {
                    protyle.toolbar.showMultiSelectMode(protyle, elements[0] as HTMLElement);
                }
            }
            if (button.isConnected) {
                hideMessage(messageID);
            }
        } catch (error) {
            showMessage(escapeHtml(error.message), 7000, "error");
        } finally {
            button.disabled = false;
        }
    });
};
