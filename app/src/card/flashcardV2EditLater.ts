import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {escapeHtml} from "../util/escape";
import {createFlashcardV2Operation, submitFlashcardV2Form, validateFlashcardV2Fields} from "./flashcardV2Form";

export interface IFlashcardV2EditLater {
    note: string;
    updatedAt: number;
}

// 打开时读取当前修订，避免留言或完成操作覆盖另一窗口中的修改。
export const openFlashcardV2EditLater = (cardID: string, callback: () => void, isCurrent = () => true) => {
    return fetchPost("/api/flashcard/getEntity", {entityType: "card", entityID: cardID}, (response) => {
        if (!isCurrent() || !response.data.found || response.data.revision.deleted) {
            return;
        }
        const revision = response.data.revision as {revisionID: string, payload: {editLater?: IFlashcardV2EditLater}};
        const pending = revision.payload.editLater;
        const lang = window.siyuan.languages;
        const operation = createFlashcardV2Operation();
        const dialog = new Dialog({
            title: lang.flashcardEditLater,
            width: isMobile() ? "92vw" : "460px",
            content: `<div class="b3-dialog__content card__v2-form">
<div class="card__v2-form-note">${lang.flashcardEditLaterTip}</div>
<label class="b3-label"><div class="b3-label__text">${lang.flashcardEditLaterNote}</div><textarea class="b3-text-field fn__block" rows="4" maxlength="4000">${escapeHtml(pending?.note || "")}</textarea></label></div>
<div class="b3-dialog__action card__v2-edit-later-actions"><button data-action="cancel" class="b3-button b3-button--cancel">${lang.cancel}</button><div class="fn__space"></div><button data-action="save" class="b3-button ${pending ? "b3-button--outline" : "b3-button--text"}">${pending ? lang.save : lang.flashcardEditLater}</button>${pending ? `<div class="fn__space"></div><button data-action="complete" class="b3-button b3-button--text">${lang.flashcardEditLaterComplete}</button>` : ""}</div>`,
        });
        const input = dialog.element.querySelector<HTMLTextAreaElement>("textarea");
        dialog.element.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.destroy());
        dialog.element.querySelectorAll<HTMLButtonElement>('[data-action="save"], [data-action="complete"]')
            .forEach((button) => button.addEventListener("click", () => {
                if (button.dataset.action !== "complete" && !validateFlashcardV2Fields(dialog.element)) {
                    return;
                }
                const enabled = button.dataset.action !== "complete";
                const payload = {cardID, enabled, note: enabled ? input.value.trim() : "",
                    expectedRevisionID: revision.revisionID};
                void submitFlashcardV2Form(dialog.element, async () => {
                    let saved = false;
                    await fetchPost("/api/flashcard/setCardEditLater", {...payload, ...operation(payload)}, () => {
                        saved = true;
                        dialog.destroy();
                        if (isCurrent()) {
                            callback();
                        }
                    });
                    return saved;
                });
            }));
        input.focus();
    });
};
