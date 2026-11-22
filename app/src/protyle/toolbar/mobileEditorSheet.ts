import {AdaptiveDialog, type DialogCloseReason} from "../../dialog/adaptiveDialog";
import {createNewFileSelectionContext, isNewFileSelectionValid} from "../../util/newFileSelection";
import {escapeAttr} from "../../util/escape";
import {focusByRange} from "../util/selectionOffsets";
import {showMessage} from "../../dialog/message";

const openSheets = new WeakMap<IProtyle, AdaptiveDialog>();

export const invalidateMobileEditorSheet = (protyle: IProtyle) => {
    const dialog = openSheets.get(protyle);
    openSheets.delete(protyle);
    dialog?.invalidate();
};

export const mobileEditorSheetActions = (confirm?: string) =>
    `<div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--cancel" data-action="cancel">${window.siyuan.languages.cancel}</button>
    ${confirm ? `<button type="button" class="b3-button b3-button--text" data-action="confirm">${confirm}</button>` : ""}
</div>`;

export const mobileEditorSearchInput = () => {
    const label = escapeAttr(window.siyuan.languages.searchPlaceholder);
    return `<input type="search" class="b3-text-field" spellcheck="false" aria-label="${label}" placeholder="${label}">`;
};

export const openMobileEditorSheet = (protyle: IProtyle, title: string, content: string, options: {
    range?: Range;
    save?: () => void | boolean;
    dispose?: () => void;
} = {}) => {
    const previous = openSheets.get(protyle);
    if (previous && previous.element.dataset.dialogClosing !== "true") return;
    const {notebookId, path, block: {rootID}} = protyle;
    const selection = options.range && createNewFileSelectionContext(protyle, options.range);
    const documentIsCurrent = () => protyle.notebookId === notebookId && protyle.path === path &&
        protyle.block.rootID === rootID && protyle.wysiwyg.element.isConnected &&
        !protyle.wysiwyg.element.closest(".fn__none");
    const getRange = () => selection && documentIsCurrent() && isNewFileSelectionValid(protyle, selection) ?
        selection.range.cloneRange() : undefined;
    let reason: DialogCloseReason;
    let selectionAction: (range: Range) => void;
    const dialog = new AdaptiveDialog({
        title,
        content,
        mobileSheet: {beforeClose: closeReason => {
            reason = closeReason;
            if (reason === "cancel") return true;
            if (options.save && (!documentIsCurrent() || protyle.disabled || options.save() === false)) {
                showMessage(window.siyuan.languages.settingsPendingSaveError);
                return false;
            }
            if (documentIsCurrent() && !protyle.disabled) {
                const range = selectionAction && getRange();
                if (range && reason === "confirm") selectionAction(range);
            }
            return true;
        }},
        destroyCallback: () => {
            const current = openSheets.get(protyle) === dialog;
            if (current) openSheets.delete(protyle);
            options.dispose?.();
            if (current && (!selectionAction || reason !== "confirm") && !protyle.disabled) {
                const range = getRange();
                const dialogs = window.siyuan.dialogs;
                if (range && dialogs[dialogs.length - 1] === dialog && document.activeElement === document.body) {
                    focusByRange(range);
                }
            }
        },
    });
    openSheets.set(protyle, dialog);
    dialog.element.classList.add("editor-tool-sheet");
    dialog.element.querySelector('[data-action="cancel"]')?.addEventListener("click", () => void dialog.requestClose("cancel"));
    dialog.element.querySelector('[data-action="confirm"]')?.addEventListener("click", () => void dialog.requestClose("confirm"));
    const isCurrent = () => openSheets.get(protyle) === dialog && dialog.element.dataset.dialogClosing !== "true" &&
        documentIsCurrent();
    return {
        dialog,
        isCurrent,
        choose(action: (range: Range) => void) {
            if (!isCurrent() || protyle.disabled || !getRange()) return;
            selectionAction = action;
            void dialog.requestClose("confirm");
        },
    };
};
