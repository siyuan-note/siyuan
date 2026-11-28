import type {IFlashcardV2ReviewSessionOptions} from "./flashcardV2Session";

const inclusionFields = [
    ["includeSuspended", "flashcardIncludeSuspended"],
    ["includeBuried", "flashcardIncludeBuried"],
    ["includePaused", "flashcardIncludePaused"],
] as const;

export const flashcardV2ReviewOptionsHTML = () => `<div data-type="reinforcementOptions" class="fn__none card__v2-form-section">
${inclusionFields.map(([field, label]) => `<label class="b3-label fn__flex-center"><input data-type="${field}" class="b3-switch fn__flex-center" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages[label]}</label>`).join("")}
</div>`;

export const bindFlashcardV2ReviewOptions = (element: HTMLElement, mode: HTMLSelectElement): () =>
    Pick<IFlashcardV2ReviewSessionOptions, "reviewMode" | "includeSuspended" | "includeBuried" | "includePaused"> => {
    const tip = element.querySelector('[data-type="modeTip"]');
    const inclusions = element.querySelector('[data-type="reinforcementOptions"]');
    const update = () => {
        const reinforcement = mode.value === "reinforcement";
        inclusions.classList.toggle("fn__none", !reinforcement);
        tip.textContent = window.siyuan.languages[reinforcement ? "flashcardReviewReinforcementTip" : "flashcardReviewNormalTip"];
    };
    mode.addEventListener("change", update);
    update();
    return () => mode.value === "reinforcement" ? {
        reviewMode: "reinforcement",
        includeSuspended: inclusions.querySelector<HTMLInputElement>('[data-type="includeSuspended"]').checked,
        includeBuried: inclusions.querySelector<HTMLInputElement>('[data-type="includeBuried"]').checked,
        includePaused: inclusions.querySelector<HTMLInputElement>('[data-type="includePaused"]').checked,
    } : {reviewMode: "normal"};
};
