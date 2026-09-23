import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {createFlashcardV2Operation, submitFlashcardV2Form, validateFlashcardV2Fields} from "./flashcardV2Form";
import {flashcardV2DueAfterDays, flashcardV2LocalDateTime} from "./flashcardV2Calendar";

// 单卡、批量和复习中的改期共享日期选择和失败重试行为。
export const openFlashcardV2Due = (cardIDs: string[], due: number, callback: () => void) => {
    const lang = window.siyuan.languages;
    const operation = createFlashcardV2Operation();
    const dialog = new Dialog({
        title: lang.setDueTime,
        width: isMobile() ? "92vw" : "460px",
        content: `<div class="b3-dialog__content card__v2-form">
<div class="card__v2-form-note">${lang.flashcardDueTip}</div>
<div class="card__v2-panel-toolbar">${[1, 3, 7].map((days) => `<button data-days="${days}" class="b3-button b3-button--outline">${days === 1 ? lang.flashcardDueTomorrow : lang.flashcardDueInDays.replace("${days}", days.toString())}</button>`).join("")}</div>
<label class="b3-label"><div class="b3-label__text">${lang.setDueTime}</div><input class="b3-text-field fn__block" type="datetime-local" min="${flashcardV2LocalDateTime(0)}" required value="${flashcardV2LocalDateTime(due || Date.now())}"></label></div>
<div class="b3-dialog__action"><button data-action="cancel" class="b3-button b3-button--cancel">${lang.cancel}</button><div class="fn__space"></div><button data-action="save" class="b3-button b3-button--text">${lang.confirm}</button></div>`,
    });
    const input = dialog.element.querySelector<HTMLInputElement>("input");
    dialog.element.querySelectorAll<HTMLButtonElement>("[data-days]").forEach((button) => {
        button.addEventListener("click", () => {
            input.value = flashcardV2LocalDateTime(flashcardV2DueAfterDays(Date.now(), Number(button.dataset.days)));
            input.focus();
        });
    });
    dialog.element.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector('[data-action="save"]').addEventListener("click", () => {
        if (!validateFlashcardV2Fields(dialog.element)) {
            return;
        }
        const payload = {cardIDs, action: "setDue", due: new Date(input.value).getTime()};
        void submitFlashcardV2Form(dialog.element, async () => {
            let saved = false;
            await fetchPost("/api/flashcard/manageCards", {...payload, ...operation(payload)}, () => {
                saved = true;
                dialog.destroy();
                callback();
            });
            return saved;
        });
    });
    input.focus();
};
