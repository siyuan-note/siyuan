import {Dialog} from "../dialog";
import type {App} from "../index";
import {isMobile} from "../util/functions";
import {escapeHtml} from "../util/escape";
import type {IFlashcardQueryAST} from "./flashcardV2Query";
import {openFlashcardV2ReviewSession} from "./flashcardV2Session";
import {
    flashcardV2SubsetOptions,
    orderFlashcardV2StudyCards,
    type IFlashcardV2StudyCard,
    type TFlashcardV2StudyOrder,
} from "./flashcardV2Study";

export const openFlashcardV2SubsetSession = (app: App, name: string, reviewSetID: string,
                                           query: IFlashcardQueryAST | undefined, cards: IFlashcardV2StudyCard[]) => {
    const languages = window.siyuan.languages;
    const dialog = new Dialog({
        title: languages.flashcardStudy,
        width: isMobile() ? "92vw" : "480px",
        content: `<div class="b3-dialog__content card__v2-form">
<label class="b3-label"><div class="b3-label__text">${languages.flashcardStudyScope}</div>
<select data-type="scope" class="b3-select fn__block">${cards.length ? `<option value="selected">${escapeHtml(languages.flashcardStudySelection.replace("${count}", cards.length.toString()))}</option>` : ""}<option value="filtered">${languages.flashcardStudyFiltered}</option></select></label>
<label class="b3-label"><div class="b3-label__text">${languages.reviewMode}</div>
<select data-type="mode" class="b3-select fn__block"><option value="normal">${languages.flashcardReviewNormal}</option><option value="reinforcement">${languages.flashcardReviewReinforcement}</option></select>
<div data-type="modeTip" class="b3-label__text"></div></label>
<label data-type="orderField" class="b3-label"><div class="b3-label__text">${languages.sort}</div>
<select data-type="order" class="b3-select fn__block"><option value="selected">${languages.sortDefault}</option><option value="random">${languages.random}</option><option value="due">${languages.flashcardStudyDueFirst}</option><option value="difficulty">${languages.flashcardStudyDifficultFirst}</option><option value="lapses">${languages.flashcardStudyLapsesFirst}</option></select></label>
</div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${languages.flashcardStudy}</button></div>`,
    });
    const scope = dialog.element.querySelector<HTMLSelectElement>('[data-type="scope"]');
    const mode = dialog.element.querySelector<HTMLSelectElement>('[data-type="mode"]');
    const order = dialog.element.querySelector<HTMLSelectElement>('[data-type="order"]');
    const update = () => {
        dialog.element.querySelector('[data-type="orderField"]').classList.toggle("fn__none", scope.value !== "selected");
        dialog.element.querySelector('[data-type="modeTip"]').textContent = mode.value === "normal" ?
            languages.flashcardReviewNormalTip : languages.flashcardReviewReinforcementTip;
    };
    scope.addEventListener("change", update);
    mode.addEventListener("change", update);
    update();
    const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", () => {
        const cardIDs = scope.value === "selected" ?
            orderFlashcardV2StudyCards(cards, order.value as TFlashcardV2StudyOrder) : undefined;
        const options = flashcardV2SubsetOptions(reviewSetID, query, cardIDs,
            mode.value === "reinforcement" ? "reinforcement" : "normal");
        dialog.destroy();
        openFlashcardV2ReviewSession(app, "", name, options);
    });
};
