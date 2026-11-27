import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {fetchPost} from "../util/fetch";
import {genUUID} from "../util/genID";
import {isMobile} from "../util/functions";
import {isFlashcardV2Object} from "./flashcardV2Contract";
import {createFlashcardV2DisclosureTitle} from "./flashcardV2Form";
import {FlashcardV2OrderedState} from "./flashcardV2OrderedState";
import {readOrderedSummaryBlock, resolveOrderedSummaries, type OrderedSummaryStep} from "./flashcardV2OrderedSummary";
import type {FlashcardV2OrderedSourceDetails} from "../types/api";

export const readOrderedDetails = (details: FlashcardV2OrderedSourceDetails, sourceID: string) => {
    const revision = details?.sourceRevision;
    const source = revision?.payload;
    if (!revision?.revisionID || revision.deleted || revision.entityID !== sourceID || !isFlashcardV2Object(source) ||
        source.id !== sourceID || source.sourceType !== "ordered" || source.pluginNamespace ||
        !isFlashcardV2Object(source.generationConfig) || !Array.isArray(source.generationConfig.steps) ||
        !details.references?.length || !details.doms || !/^[a-f0-9]{64}$/.test(details.contentFingerprint)) { return; }
    const steps: OrderedSummaryStep[] = [];
    for (const step of source.generationConfig.steps) {
        if (!isFlashcardV2Object(step) || typeof step.id !== "string" || typeof step.displayOrder !== "number" ||
            !Array.isArray(step.occlusionIDs) || !step.occlusionIDs.every(id => typeof id === "string")) { return; }
        steps.push({id: step.id, displayOrder: step.displayOrder, occlusionIDs: step.occlusionIDs});
    }
    const blocks = new Map<string, ReturnType<typeof readOrderedSummaryBlock>>();
    for (const ref of details.references) {
        if (ref.sourceID !== sourceID || typeof details.doms[ref.entityID] !== "string") { return; }
        if (!blocks.has(ref.entityID)) { blocks.set(ref.entityID, readOrderedSummaryBlock(details.doms[ref.entityID])); }
    }
    const summaries = resolveOrderedSummaries(steps, details.references, blocks);
    if (!summaries) { return; }
    return {steps: summaries, revisionID: revision.revisionID, contentFingerprint: details.contentFingerprint};
};

export const openFlashcardV2Ordered = (sourceID: string, reload: () => void, parentConnected: () => boolean) => {
    const language = window.siyuan.languages;
    const state = new FlashcardV2OrderedState(sourceID, () => ({operationID: genUUID(), updatedAt: Date.now()}));
    let saving = false;
    let readable = false;
    let maybeChanged = false;
    const abort = new AbortController();
    const dialog = new Dialog({
        title: language.flashcardReorderSteps,
        width: isMobile() ? "92vw" : "640px",
        content: "<div class=\"b3-dialog__content\"><p data-role=\"tip\" class=\"ft__on-surface\"></p><p data-role=\"status\" role=\"status\" aria-live=\"polite\"></p><ol data-role=\"steps\" class=\"fn__list card__v2-ordered-steps\"></ol></div><div class=\"b3-dialog__action\"><button type=\"button\" data-action=\"refresh\" class=\"b3-button b3-button--outline\"></button><div class=\"fn__space\"></div><button type=\"button\" data-action=\"cancel\" class=\"b3-button b3-button--cancel\"></button><div class=\"fn__space\"></div><button type=\"button\" data-action=\"save\" class=\"b3-button b3-button--text\"></button></div>",
        beforeClose: () => !saving,
        destroyCallback: () => {
            state.close(); abort.abort();
            if (maybeChanged && parentConnected()) { reload(); }
        },
    });
    const root = dialog.element;
    const status = root.querySelector<HTMLElement>('[data-role="status"]');
    const list = root.querySelector<HTMLOListElement>('[data-role="steps"]');
    const save = root.querySelector<HTMLButtonElement>('[data-action="save"]');
    const refresh = root.querySelector<HTMLButtonElement>('[data-action="refresh"]');
    const cancel = root.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    root.querySelector('[data-role="tip"]').textContent = language.flashcardReorderStepsTip;
    save.textContent = language.save; refresh.textContent = language.refresh; cancel.textContent = language.cancel;
    const connected = () => !state.closed && root.isConnected;
    const render = (focusID?: string, direction?: "up" | "down") => {
        if (!connected()) { return; }
        const scroll = root.querySelector<HTMLElement>(".b3-dialog__content").scrollTop;
        root.setAttribute("aria-busy", String(state.busy));
        const expanded = new Set(Array.from(list.querySelectorAll<HTMLLIElement>("li")).filter(item =>
            item.querySelector<HTMLDetailsElement>("details")?.open).map(item => item.dataset.stepId));
        list.replaceChildren();
        const steps = state.steps;
        steps.forEach((step, index) => {
            const item = document.createElement("li"); item.className = "b3-label"; item.dataset.stepId = step.id;
            const details = document.createElement("details");
            details.className = "card__v2-disclosure";
            details.open = expanded.has(step.id);
            const summary = createFlashcardV2DisclosureTitle(step.text.length > 160 ? step.text.slice(0, 160) + "..." : step.text);
            summary.className = "ft__breakword";
            summary.id = genUUID(); item.setAttribute("role", "group"); item.setAttribute("aria-labelledby", summary.id);
            const full = document.createElement("p"); full.className = "ft__breakword"; full.textContent = step.text;
            details.append(summary, full); item.append(details);
            const controls = document.createElement("div"); controls.className = "fn__flex"; item.append(controls);
            (["up", "down"] as const).forEach(action => {
                const button = document.createElement("button"); button.type = "button";
                button.className = "b3-button b3-button--outline"; button.textContent = language[action]; button.dataset.action = action; button.setAttribute("aria-describedby", summary.id);
                button.disabled = !readable || state.busy || (action === "up" ? index === 0 : index === steps.length - 1);
                button.addEventListener("click", () => {
                    if (readable && state.move(step.id, action === "up" ? -1 : 1)) { render(step.id, action); }
                });
                if (action === "down") { const space = document.createElement("div"); space.className = "fn__space"; controls.append(space); }
                controls.append(button);
            });
            list.append(item);
        });
        save.disabled = !readable || state.busy || !state.dirty;
        refresh.disabled = state.busy;
        cancel.disabled = saving;
        root.querySelector<HTMLElement>(".b3-dialog__content").scrollTop = scroll;
        if (focusID) {
            const row = Array.from(list.children).find(item => (item as HTMLElement).dataset.stepId === focusID);
            const preferred = row?.querySelector<HTMLButtonElement>(`[data-action="${direction}"]`);
            (preferred && !preferred.disabled ? preferred : row?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus({preventScroll: true});
        }
    };
    const load = async () => {
        const token = state.beginLoad();
        if (token === undefined) { return; }
        readable = false; status.textContent = language.loading; render();
        let received = false;
        try {
            await fetchPost("/api/flashcard/getOrderedSourceDetails", {sourceID}, response => {
                if (!connected()) { return; }
                const value = readOrderedDetails(response.data, sourceID);
                if (value && state.completeLoad(token, value)) { received = true; readable = true; status.textContent = ""; }
            }, undefined, () => {}, abort.signal, 30000);
        } finally {
            if (connected()) {
                if (!received) { state.failLoad(token); status.textContent = language.flashcardReorderUnavailable; }
                render();
            }
        }
    };
    refresh.addEventListener("click", () => {
        if (state.busy) { return; }
        if (state.dirty) {
            confirmDialog({
                title: language.refresh,
                text: language.flashcardReorderDiscard,
                confirm: () => { if (connected()) { void load(); } },
            });
        } else {
            void load();
        }
    });
    cancel.addEventListener("click", () => dialog.destroy());
    save.addEventListener("click", async () => {
        if (!readable) { return; }
        const attempt = state.beginSave();
        if (!attempt) { return; }
        saving = true; maybeChanged = true; status.textContent = language.loading; render();
        let success = false;
        try {
            await fetchPost("/api/flashcard/reorderAdvancedSource", attempt.request, response => { success = response.code === 0; },
                undefined, () => {}, abort.signal, 30000);
        } finally {
            saving = false;
            if (state.completeSave(attempt.token, success) && connected()) {
                if (success) { dialog.destroy(); }
                else { status.textContent = language.flashcardReorderRetry; render(); save.focus(); }
            }
        }
    });
    void load();
};
