import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {escapeAttr, escapeHtml} from "../util/escape";
import {genUUID} from "../util/genID";
import {openFlashcardV2ReviewSession} from "./flashcardV2Session";
import type {App} from "../index";
import {listFlashcardV2PluginTypes} from "./flashcardV2Plugin";

interface IFlashcardMigrationStatus {
    state: "Legacy" | "Preparing" | "Active" | "LegacyDiverged";
}

interface IFlashcardEntityRevision<T> {
    entityType: string;
    entityID: string;
    revisionID: string;
    updatedAt: number;
    deleted: boolean;
    payload: T;
}

interface IReviewSet {
    id: string;
    name: string;
    legacyDeckID?: string;
    queryAST?: IFlashcardQueryAST;
    order?: unknown;
    newLimit: number;
    reviewLimit: number;
    defaultReviewMode: "normal" | "reinforcement";
}

interface IFlashcardQueryExpression {
    operator: "matchAll" | "and" | "or" | "not" | "predicate";
    children?: IFlashcardQueryExpression[];
    field?: string;
    comparator?: string;
    value?: unknown;
}

interface IFlashcardQueryAST {
    version: number;
    root: IFlashcardQueryExpression;
}

interface IFlashcardStatistics {
    overview: {
        currentCards: number;
        deletedCards: number;
        reviewStates: Record<string, number>;
        generationStatuses: Record<string, number>;
        suspended: number;
        buried: number;
        paused: number;
        leeches: number;
    };
    history: {
        reviews: number;
        uniqueCards: number;
        ratings: Record<string, number>;
        correct: number;
        lapses: number;
        trueRetention: number;
        durationTotalMS: number;
        durationKnown: number;
        durationUnknown: number;
        averageDurationMS?: number;
    };
    overdue: number;
    futureDue: Array<{ start: number, cards: number }>;
}

interface IFlashcardSearchResult {
    card: {
        id: string;
        sourceID: string;
        variantKey: string;
        generationStatus: string;
        flag: number;
        presetOverrideID?: string;
        priorityOverride?: string;
    };
    sourceType: string;
    sourcePriority: string;
    inheritedPriority: string;
    defaultPresetID: string;
    cardTagIDs: string[];
    sourceTagIDs: string[];
    effectiveTagIDs: string[];
    effectivePriority: string;
    effectivePresetID: string;
    sourceNotebookID?: string;
    sourceRootID?: string;
    sourcePath?: string;
    sourceBlockID?: string;
    sourceTitle?: string;
    reviewState: {
        state: string;
        due: number;
        reps: number;
        lapses: number;
        suspended: boolean;
        buriedUntil?: number;
    };
}

interface IFlashcardTag {
    id: string;
    parentID?: string;
    name: string;
}

interface IFlashcardPreset {
    id: string;
    name: string;
}

interface IFlashcardStudyPolicy {
    id: string;
    scopeType: "document" | "notebook";
    scopeID: string;
    priority: string;
    targetDate?: number;
    createdAt: number;
    updatedAt: number;
}

interface IAnkiPackagePreview {
    collectionID: string;
    noteCount: number;
    cardCount: number;
    reviewCount: number;
    mediaCount: number;
    noteTypes: Array<{ id: number, name: string, noteCount: number, conversion: string }>;
    decks: Array<{ id: number, name: string, cardCount: number }>;
    unsupported: string[];
}

interface IAnkiImportReport {
    notes: number;
    cards: number;
    reviewEvents: number;
    reviewSets: number;
    tags: number;
    media: number;
    updatedSources: number;
    retiredSources: number;
}

const mergedTagIDs = (...sets: string[][]) => [...new Set(sets.flat())].sort();

const priorityLabel = (priority: string) => {
    const labels: Record<string, string> = {
        exam: window.siyuan.languages.flashcardPriorityExam,
        learning: window.siyuan.languages.flashcardPriorityLearning,
        retaining: window.siyuan.languages.flashcardPriorityRetaining,
        paused: window.siyuan.languages.flashcardPriorityPaused,
        unset: window.siyuan.languages.flashcardPriorityUnset,
    };
    return labels[priority] || labels.unset;
};

const refreshEffectiveCardValues = (card: IFlashcardSearchResult) => {
    card.effectivePresetID = card.card.presetOverrideID || card.defaultPresetID;
    card.effectivePriority = card.card.priorityOverride || card.inheritedPriority || card.sourcePriority || "unset";
    card.effectiveTagIDs = mergedTagIDs(card.cardTagIDs || [], card.sourceTagIDs || []);
};

const activateFlashcardV2 = (callback: () => void) => {
    fetchPost("/api/flashcard/previewMigration", {}, (previewResponse) => {
        const report = previewResponse.data.report;
        const details = `${window.siyuan.languages.flashcardMigrationConfirm}<br><br>${window.siyuan.languages.flashcardReviewSet}: ${report.ReviewSets}<br>${window.siyuan.languages.riffCard}: ${report.MigratedCards}`;
        confirmDialog(window.siyuan.languages.dataMigration, details, () => {
            fetchPost("/api/flashcard/activateMigration", {
                migrationID: previewResponse.data.migrationID,
                recordDigest: previewResponse.data.recordDigest,
            }, () => callback());
        });
    });
};

export const ensureFlashcardV2 = (callback: () => void) => {
    fetchPost("/api/flashcard/getMigrationStatus", {}, (response) => {
        const status = response.data as IFlashcardMigrationStatus;
        if (status.state === "Active") {
            callback();
            return;
        }
        activateFlashcardV2(callback);
    });
};

const renderReviewSet = (revision: IFlashcardEntityRevision<IReviewSet>) => {
    return `<li class="b3-list-item b3-list-item--narrow" data-id="${escapeAttr(revision.entityID)}" data-revision="${escapeAttr(revision.revisionID)}" data-review-mode="${escapeAttr(revision.payload.defaultReviewMode || "normal")}">
<svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg>
<span class="b3-list-item__text">${escapeHtml(revision.payload.name)}</span>
<span data-type="review" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.continueReview1}"><svg><use xlink:href="#iconPlay"></use></svg></span>
<span data-type="statistics" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardStatistics}"><svg><use xlink:href="#iconGraph"></use></svg></span>
<span data-type="edit" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.edit}"><svg><use xlink:href="#iconEdit"></use></svg></span>
<span data-type="delete" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.delete}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
</li>`;
};

const reviewSetPredicateValues = (query?: IFlashcardQueryAST) => {
    const ret: Record<string, string> = {};
    if (!query || query.version !== 1) {
        return ret;
    }
    const expressions = query.root.operator === "and" ? query.root.children || [] : [query.root];
    expressions.forEach((expression) => {
        if (expression.operator === "predicate" && typeof expression.field === "string" &&
            typeof expression.value === "string") {
            ret[expression.field] = expression.value;
        }
    });
    return ret;
};

const reviewSetQuery = (values: Record<string, string>): IFlashcardQueryAST => {
    const predicates: IFlashcardQueryExpression[] = [];
    if (values.notebookID) {
        predicates.push({operator: "predicate", field: "notebookID", comparator: "equal", value: values.notebookID});
    }
    if (values.path) {
        predicates.push({operator: "predicate", field: "path", comparator: "startsWith", value: values.path});
    }
    if (values.tagID) {
        predicates.push({operator: "predicate", field: "tagID", comparator: "equal", value: values.tagID});
    }
    if (values.priority) {
        predicates.push({operator: "predicate", field: "priority", comparator: "equal", value: values.priority});
    }
    const root: IFlashcardQueryExpression = predicates.length === 0 ? {operator: "matchAll"} :
        predicates.length === 1 ? predicates[0] : {operator: "and", children: predicates};
    return {version: 1, root};
};

const openFlashcardV2ReviewSetEditor = (revision: IFlashcardEntityRevision<IReviewSet> | undefined,
    callback: (saved: IFlashcardEntityRevision<IReviewSet>) => void, initialName = "") => {
    fetchPost("/api/flashcard/listEntities", {
        entityType: "tag",
        options: {limit: 1000, offset: 0},
    }, (response) => {
        const tags = (response.data.entities as Array<IFlashcardEntityRevision<IFlashcardTag>>)
            .map((item) => item.payload);
        const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
        const current = revision?.payload;
        const filters = reviewSetPredicateValues(current?.queryAST);
        const notebooks = window.siyuan.notebooks.filter((notebook) => !notebook.closed && !notebook.encrypted);
        const priorityOptions = ["exam", "learning", "retaining", "paused"]
            .map((priority) => `<option value="${priority}">${escapeHtml(priorityLabel(priority))}</option>`).join("");
        const dialog = new Dialog({
            title: window.siyuan.languages.flashcardReviewSet,
            width: isMobile() ? "92vw" : "560px",
            content: `<div class="b3-dialog__content">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.name}</div><input data-type="name" class="b3-text-field fn__block" value="${escapeAttr(current?.name || initialName)}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.targetNotebook}</div><select data-filter="notebookID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${notebooks.map((notebook) => `<option value="${escapeAttr(notebook.id)}">${escapeHtml(notebook.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.copyPath}</div><input data-filter="path" class="b3-text-field fn__block" value="${escapeAttr(filters.path || "")}" placeholder="/"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.tag}</div><select data-filter="tagID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${tags.map((tag) => `<option value="${escapeAttr(tag.id)}">${escapeHtml(flashcardTagPath(tag, tagMap))}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardPriority}</div><select data-filter="priority" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${priorityOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.reviewMode}</div><select data-type="reviewMode" class="b3-select fn__block"><option value="normal">${window.siyuan.languages.flashcardReviewNormal}</option><option value="reinforcement">${window.siyuan.languages.flashcardReviewReinforcement}</option></select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardNewCardLimit}</div><input data-type="newLimit" class="b3-text-field fn__block" type="number" min="0" value="${current?.newLimit ?? window.siyuan.config.flashcard.newCardLimit}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardReviewCardLimit}</div><input data-type="reviewLimit" class="b3-text-field fn__block" type="number" min="0" value="${current?.reviewLimit ?? window.siyuan.config.flashcard.reviewCardLimit}"></label>
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
        });
        const filterElements = [...dialog.element.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-filter]")];
        filterElements.forEach((element) => {
            element.value = filters[element.dataset.filter] || "";
        });
        const mode = dialog.element.querySelector('[data-type="reviewMode"]') as HTMLSelectElement;
        mode.value = current?.defaultReviewMode || "normal";
        let filtersChanged = revision === undefined;
        filterElements.forEach((element) => element.addEventListener("change", () => filtersChanged = true));
        const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            const name = (dialog.element.querySelector('[data-type="name"]') as HTMLInputElement).value.trim();
            const newLimit = Number((dialog.element.querySelector('[data-type="newLimit"]') as HTMLInputElement).value);
            const reviewLimit = Number((dialog.element.querySelector('[data-type="reviewLimit"]') as HTMLInputElement).value);
            if (!name || !Number.isInteger(newLimit) || newLimit < 0 || !Number.isInteger(reviewLimit) || reviewLimit < 0) {
                return;
            }
            const entityID = revision?.entityID || genUUID();
            const values = Object.fromEntries(filterElements.map((element) => [element.dataset.filter, element.value.trim()]));
            const payload: IReviewSet = {
                id: entityID,
                name,
                legacyDeckID: current?.legacyDeckID,
                queryAST: filtersChanged ? reviewSetQuery(values) : current?.queryAST,
                order: current?.order,
                newLimit,
                reviewLimit,
                defaultReviewMode: mode.value as "normal" | "reinforcement",
            };
            fetchPost("/api/flashcard/mutateEntities", {
                operationID: genUUID(),
                mutations: [{
                    entityType: "reviewSet",
                    entityID,
                    expectedRevisionID: revision?.revisionID,
                    requireAbsent: revision === undefined,
                    updatedAt: Date.now(),
                    payload,
                }],
            }, (mutationResponse) => {
                callback(mutationResponse.data.revisions[0] as IFlashcardEntityRevision<IReviewSet>);
                dialog.destroy();
            });
        });
        (dialog.element.querySelector('[data-type="name"]') as HTMLInputElement).focus();
    });
};

const openFlashcardV2ReviewSetSession = (app: App, reviewSetID: string, name: string,
    defaultMode: "normal" | "reinforcement") => {
    const dialog = new Dialog({
        title: name,
        width: isMobile() ? "92vw" : "480px",
        content: `<div class="b3-dialog__content">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardSessionMode}</div>
<select data-type="reviewMode" class="b3-select fn__block"><option value="normal">${window.siyuan.languages.flashcardReviewNormal}</option><option value="reinforcement">${window.siyuan.languages.flashcardReviewReinforcement}</option></select></label>
<div data-type="reinforcementOptions" class="fn__none">
<div class="b3-label ft__secondary">${window.siyuan.languages.flashcardReviewReinforcementTip}</div>
<label class="b3-label fn__flex-center"><input data-type="includeSuspended" class="b3-switch fn__flex-center" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.flashcardIncludeSuspended}</label>
<label class="b3-label fn__flex-center"><input data-type="includeBuried" class="b3-switch fn__flex-center" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.flashcardIncludeBuried}</label>
<label class="b3-label fn__flex-center"><input data-type="includePaused" class="b3-switch fn__flex-center" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.flashcardIncludePaused}</label>
</div></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
    });
    const mode = dialog.element.querySelector('[data-type="reviewMode"]') as HTMLSelectElement;
    const reinforcementOptions = dialog.element.querySelector('[data-type="reinforcementOptions"]');
    const updateMode = () => reinforcementOptions.classList.toggle("fn__none", mode.value !== "reinforcement");
    mode.value = defaultMode || "normal";
    updateMode();
    mode.addEventListener("change", updateMode);
    const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", () => {
        const reviewMode = mode.value as "normal" | "reinforcement";
        openFlashcardV2ReviewSession(app, reviewSetID, name, {
            reviewMode,
            includeSuspended: (dialog.element.querySelector('[data-type="includeSuspended"]') as HTMLInputElement).checked,
            includeBuried: (dialog.element.querySelector('[data-type="includeBuried"]') as HTMLInputElement).checked,
            includePaused: (dialog.element.querySelector('[data-type="includePaused"]') as HTMLInputElement).checked,
        });
        dialog.destroy();
    });
};

const renderManagedCard = (result: IFlashcardSearchResult, reviewSetID = "") => {
    const buried = (result.reviewState.buriedUntil || 0) > Date.now();
    return `<li class="b3-list-item b3-list-item--narrow" data-id="${escapeAttr(result.card.id)}" data-flag="${result.card.flag}">
<svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg>
<span class="b3-list-item__text">${escapeHtml(result.sourceTitle || result.sourceBlockID || result.card.id)}</span>
<span class="b3-list-item__meta">${escapeHtml(result.card.variantKey)}</span>
<span data-type="state" class="b3-list-item__meta">${escapeHtml(result.reviewState.state)}</span>
<span class="b3-list-item__meta">${result.reviewState.reps}</span>
<span class="b3-list-item__meta">${escapeHtml(priorityLabel(result.effectivePriority))}</span>
${result.sourceType === "qa" ? `<span data-type="direction" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardDirectionBidirectional}"><svg><use xlink:href="#iconBoth"></use></svg></span>` : ""}
<span data-type="preset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardPreset}"><svg><use xlink:href="#iconSettings"></use></svg></span>
<span data-type="priority" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardPriority}"><svg><use xlink:href="#iconSort"></use></svg></span>
<span data-type="tags" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.tag}"><svg><use xlink:href="#iconTag"></use></svg></span>
<span data-type="suspend" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${result.reviewState.suspended ? window.siyuan.languages.continueReview1 : window.siyuan.languages.flashcardDirectionClosed}"><svg><use xlink:href="#icon${result.reviewState.suspended ? "Play" : "Pause"}"></use></svg></span>
<span data-type="bury" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${buried ? window.siyuan.languages.flashcardUnbury : window.siyuan.languages.flashcardBury}"><svg><use xlink:href="#iconClock"></use></svg></span>
<span data-type="due" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.setDueTime}"><svg><use xlink:href="#iconCalendar"></use></svg></span>
<span data-type="flag" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.cardStatus}"><svg><use xlink:href="#iconBookmark"></use></svg></span>
<span data-type="history" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.dataHistory}"><svg><use xlink:href="#iconHistory"></use></svg></span>
${reviewSetID ? `<span data-type="exclude" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconClose"></use></svg></span>` : `<span data-type="membership" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardReviewSet}"><svg><use xlink:href="#iconDatabase"></use></svg></span>`}
<span data-type="reset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.reset}"><svg><use xlink:href="#iconUndo"></use></svg></span>
</li>`;
};

const renderManagedCards = (cards: IFlashcardSearchResult[], grouped: boolean, reviewSetID = "") => {
    if (!grouped) {
        return cards.map((card) => renderManagedCard(card, reviewSetID)).join("");
    }
    const sources = new Map<string, IFlashcardSearchResult[]>();
    cards.forEach((card) => {
        const sourceCards = sources.get(card.card.sourceID) || [];
        sourceCards.push(card);
        sources.set(card.card.sourceID, sourceCards);
    });
    return [...sources.entries()].map(([sourceID, sourceCards]) => `<li class="b3-list-item b3-list-item--focus" data-source-id="${escapeAttr(sourceID)}">
<svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
<span class="b3-list-item__text">${escapeHtml(sourceCards[0].sourceTitle || sourceCards[0].sourceBlockID || sourceID)}</span>
<span class="b3-list-item__meta">${sourceCards.length}</span>
<span data-type="sourceTags" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.tag}"><svg><use xlink:href="#iconTag"></use></svg></span>
<span data-type="documentPolicy" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.doc} - ${window.siyuan.languages.flashcardPriority}"><svg><use xlink:href="#iconFile"></use></svg></span>
<span data-type="notebookPolicy" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.notebook} - ${window.siyuan.languages.flashcardPriority}"><svg><use xlink:href="#iconFilesRoot"></use></svg></span>
</li>${sourceCards.map((card) => renderManagedCard(card, reviewSetID)).join("")}`).join("");
};

const setFlashcardV2ReviewSetMembership = (reviewSetID: string, cardID: string,
    mode: "include" | "exclude", callback: () => void) => {
    fetchPost("/api/flashcard/setReviewSetMemberships", {
        operationID: genUUID(),
        reviewSetID,
        cardIDs: [cardID],
        mode,
        changedAt: Date.now(),
    }, callback);
};

const openFlashcardV2Membership = (cardID: string, callback: () => void) => {
    fetchPost("/api/flashcard/listEntities", {
        entityType: "reviewSet",
        options: {limit: 1000, offset: 0},
    }, (response) => {
        const reviewSets = response.data.entities as Array<IFlashcardEntityRevision<IReviewSet>>;
        if (reviewSets.length === 0) {
            return;
        }
        const dialog = new Dialog({
            title: window.siyuan.languages.flashcardReviewSet,
            width: isMobile() ? "92vw" : "460px",
            content: `<div class="b3-dialog__content">
<select data-type="reviewSet" class="b3-select fn__block">${reviewSets.map((revision) => `<option value="${escapeAttr(revision.entityID)}">${escapeHtml(revision.payload.name)}</option>`).join("")}</select>
<div class="fn__hr"></div><select data-type="mode" class="b3-select fn__block"><option value="include">${window.siyuan.languages.new}</option><option value="exclude">${window.siyuan.languages.remove}</option></select>
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
        });
        const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            const reviewSetID = (dialog.element.querySelector('[data-type="reviewSet"]') as HTMLSelectElement).value;
            const mode = (dialog.element.querySelector('[data-type="mode"]') as HTMLSelectElement).value as
                "include" | "exclude";
            setFlashcardV2ReviewSetMembership(reviewSetID, cardID, mode, () => {
                callback();
                dialog.destroy();
            });
        });
    });
};

const basicSourceDirection = (cards: IFlashcardSearchResult[]) => {
    const active = new Set(cards.filter((card) => card.card.generationStatus === "active")
        .map((card) => card.card.variantKey));
    if (active.has("forward") && active.has("reverse")) {
        return "bidirectional";
    }
    if (active.has("reverse")) {
        return "reverse";
    }
    if (active.has("forward")) {
        return "forward";
    }
    return "closed";
};

const openFlashcardV2Direction = (sourceID: string, cards: IFlashcardSearchResult[], callback: () => void) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.type,
        width: isMobile() ? "92vw" : "420px",
        content: `<div class="b3-dialog__content"><select class="b3-select fn__block">
<option value="forward">${window.siyuan.languages.flashcardDirectionForward}</option>
<option value="reverse">${window.siyuan.languages.flashcardDirectionReverse}</option>
<option value="bidirectional">${window.siyuan.languages.flashcardDirectionBidirectional}</option>
<option value="closed">${window.siyuan.languages.flashcardDirectionClosed}</option>
</select></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
    });
    (dialog.element.querySelector("select") as HTMLSelectElement).value = basicSourceDirection(cards);
    const buttons = dialog.element.querySelectorAll(".b3-button");
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", () => {
        const direction = (dialog.element.querySelector("select") as HTMLSelectElement).value;
        fetchPost("/api/flashcard/updateBasicDirection", {
            operationID: genUUID(),
            sourceID,
            direction,
            updatedAt: Date.now(),
        }, () => {
            cards.forEach((card) => {
                const active = direction === "bidirectional" || card.card.variantKey === direction;
                card.card.generationStatus = active ? "active" : "disabledByTemplate";
            });
            callback();
            dialog.destroy();
        });
    });
};

const openFlashcardV2CardHistory = (cardID: string) => {
    fetchPost("/api/flashcard/getCardHistory", {cardID, limit: 100, offset: 0}, (response) => {
        const events = response.data.events as Array<{
            eventType: string,
            occurredAt: number,
            payload: { rating?: string, action?: string }
        }>;
        new Dialog({
            title: window.siyuan.languages.dataHistory,
            width: isMobile() ? "92vw" : "640px",
            height: "70vh",
            content: `<div class="b3-dialog__content" style="box-sizing:border-box;height:100%;overflow:auto"><ul class="b3-list b3-list--background">${events.map((event) => `<li class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(event.payload.rating || event.payload.action || event.eventType)}</span><span class="b3-list-item__meta">${new Date(event.occurredAt).toLocaleString()}</span></li>`).join("")}</ul></div>`,
        });
    });
};

const updateManagedCard = (card: IFlashcardSearchResult, response: {
    cards?: Record<string, IFlashcardSearchResult["card"]>,
    states?: Record<string, IFlashcardSearchResult["reviewState"]>
}) => {
    if (response.cards?.[card.card.id]) {
        card.card = response.cards[card.card.id];
    }
    if (response.states?.[card.card.id]) {
        card.reviewState = response.states[card.card.id];
    }
    refreshEffectiveCardValues(card);
};

const flashcardV2LocalDateTime = (value: number) => {
    const date = new Date(value);
    return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const openFlashcardV2Due = (card: IFlashcardSearchResult, callback: () => void) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.setDueTime,
        width: isMobile() ? "92vw" : "420px",
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" type="datetime-local" value="${flashcardV2LocalDateTime(card.reviewState.due || Date.now())}"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
    });
    const input = dialog.element.querySelector("input") as HTMLInputElement;
    const buttons = dialog.element.querySelectorAll(".b3-button");
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", () => {
        const due = new Date(input.value).getTime();
        if (!Number.isFinite(due)) {
            input.focus();
            return;
        }
        fetchPost("/api/flashcard/manageCards", {
            operationID: genUUID(),
            cardIDs: [card.card.id],
            action: "setDue",
            changedAt: Date.now(),
            due,
        }, (response) => {
            updateManagedCard(card, response.data);
            callback();
            dialog.destroy();
        });
    });
    input.focus();
};

const openFlashcardV2CardSetting = (card: IFlashcardSearchResult, type: "preset" | "priority",
    callback: () => void) => {
    const openDialog = (presets: IFlashcardPreset[] = []) => {
        const priorityOptions = ["exam", "learning", "retaining", "paused", "unset"]
            .map((priority) => `<option value="${priority}">${escapeHtml(priorityLabel(priority))}</option>`).join("");
        const presetOptions = presets.map((preset) => `<option value="${escapeAttr(preset.id)}">${escapeHtml(preset.name)}</option>`).join("");
        const dialog = new Dialog({
            title: type === "preset" ? window.siyuan.languages.flashcardPreset : window.siyuan.languages.flashcardPriority,
            width: isMobile() ? "92vw" : "420px",
            content: `<div class="b3-dialog__content"><select class="b3-select fn__block">
<option value="">${window.siyuan.languages.default}</option>
${type === "preset" ? presetOptions : priorityOptions}
</select></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        });
        const select = dialog.element.querySelector("select") as HTMLSelectElement;
        select.value = type === "preset" ? card.card.presetOverrideID || "" : card.card.priorityOverride || "";
        const buttons = dialog.element.querySelectorAll(".b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            const request: Record<string, unknown> = type === "preset" ? {presetID: select.value} : {priority: select.value};
            fetchPost("/api/flashcard/manageCards", {
                operationID: genUUID(),
                cardIDs: [card.card.id],
                action: type === "preset" ? "setPreset" : "setPriority",
                changedAt: Date.now(),
                ...request,
            }, (response) => {
                updateManagedCard(card, response.data);
                callback();
                dialog.destroy();
            });
        });
    };
    if (type === "priority") {
        openDialog();
        return;
    }
    fetchPost("/api/flashcard/listEntities", {
        entityType: "schedulerPreset",
        options: {limit: 1000, offset: 0},
    }, (response) => {
        const revisions = response.data.entities as Array<IFlashcardEntityRevision<IFlashcardPreset>>;
        openDialog(revisions.map((revision) => revision.payload));
    });
};

const openFlashcardV2StudyPolicy = (card: IFlashcardSearchResult, scopeType: "document" | "notebook",
    callback: (priority: string) => void) => {
    const scopeID = scopeType === "document" ? card.sourceRootID : card.sourceNotebookID;
    if (!scopeID) {
        return;
    }
    fetchPost("/api/flashcard/getStudyPolicy", {
        scopeType,
        scopeID,
    }, (response) => {
        const current = response.data.found ?
            response.data.revision as IFlashcardEntityRevision<IFlashcardStudyPolicy> : undefined;
        const options = ["exam", "learning", "retaining", "paused", "unset"]
            .map((priority) => `<option value="${priority}">${escapeHtml(priorityLabel(priority))}</option>`).join("");
        const dialog = new Dialog({
            title: `${scopeType === "document" ? window.siyuan.languages.doc : window.siyuan.languages.notebook} - ${window.siyuan.languages.flashcardPriority}`,
            width: isMobile() ? "92vw" : "440px",
            content: `<div class="b3-dialog__content"><select data-type="priority" class="b3-select fn__block">${options}</select>
<div class="fn__hr"></div><label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.setDueTime}</div><input data-type="targetDate" class="b3-text-field fn__block" type="datetime-local" value="${current?.payload.targetDate ? flashcardV2LocalDateTime(current.payload.targetDate) : ""}"></label></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
        });
        const priority = dialog.element.querySelector('[data-type="priority"]') as HTMLSelectElement;
        priority.value = current?.payload.priority || "unset";
        const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            const now = Date.now();
            const targetValue = (dialog.element.querySelector('[data-type="targetDate"]') as HTMLInputElement).value;
            const targetDate = targetValue ? new Date(targetValue).getTime() : undefined;
            if (targetDate !== undefined && !Number.isFinite(targetDate)) {
                return;
            }
            fetchPost("/api/flashcard/saveStudyPolicy", {
                operationID: genUUID(),
                scopeType,
                scopeID,
                priority: priority.value,
                targetDate,
                expectedRevisionID: current?.revisionID,
                updatedAt: now,
            }, () => {
                callback(priority.value);
                dialog.destroy();
            });
        });
    });
};

const flashcardTagPath = (tag: IFlashcardTag, tags: Map<string, IFlashcardTag>) => {
    const names = [tag.name];
    const seen = new Set([tag.id]);
    let parentID = tag.parentID;
    while (parentID && !seen.has(parentID)) {
        seen.add(parentID);
        const parent = tags.get(parentID);
        if (!parent) {
            break;
        }
        names.unshift(parent.name);
        parentID = parent.parentID;
    }
    return names.join(" / ");
};

const renderFlashcardTagChoices = (tags: IFlashcardTag[], selected: Set<string>) => {
    const byID = new Map(tags.map((tag) => [tag.id, tag]));
    return [...tags].sort((left, right) => flashcardTagPath(left, byID).localeCompare(flashcardTagPath(right, byID)))
        .map((tag) => `<label class="b3-list-item b3-list-item--narrow">
<span class="b3-list-item__text">${escapeHtml(flashcardTagPath(tag, byID))}</span>
<input class="b3-switch" type="checkbox" value="${escapeAttr(tag.id)}"${selected.has(tag.id) ? " checked" : ""}>
</label>`).join("");
};

const openFlashcardV2Tags = (targetType: "source" | "card", targetID: string, selectedTagIDs: string[],
    callback: (tagIDs: string[]) => void) => {
    fetchPost("/api/flashcard/listEntities", {
        entityType: "tag",
        options: {limit: 1000, offset: 0},
    }, (response) => {
        const tags = (response.data.entities as Array<IFlashcardEntityRevision<IFlashcardTag>>)
            .map((revision) => revision.payload);
        const selected = new Set(selectedTagIDs);
        const dialog = new Dialog({
            title: window.siyuan.languages.tag,
            width: isMobile() ? "92vw" : "520px",
            height: "70vh",
            content: `<div class="b3-dialog__content fn__flex-column" style="box-sizing:border-box;height:100%">
<div class="fn__flex"><input class="b3-text-field fn__flex-1" placeholder="${window.siyuan.languages.newTag}"><span class="fn__space"></span>
<button data-type="createTag" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}</button></div>
<div class="fn__hr"></div><div data-tag-list class="b3-list b3-list--background fn__flex-1" style="overflow:auto">${renderFlashcardTagChoices(tags, selected)}</div></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        });
        const refreshTags = () => {
            dialog.element.querySelector("[data-tag-list]").innerHTML = renderFlashcardTagChoices(tags, selected);
        };
        dialog.element.querySelector('[data-type="createTag"]').addEventListener("click", () => {
            const input = dialog.element.querySelector("input.b3-text-field") as HTMLInputElement;
            const name = input.value.trim();
            if (!name) {
                input.focus();
                return;
            }
            const tagID = genUUID();
            fetchPost("/api/flashcard/saveTag", {
                operationID: genUUID(),
                tagID,
                name,
                updatedAt: Date.now(),
            }, (saveResponse) => {
                const revision = saveResponse.data as IFlashcardEntityRevision<IFlashcardTag>;
                tags.push(revision.payload);
                selected.add(tagID);
                input.value = "";
                refreshTags();
            });
        });
        const buttons = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            const tagIDs = [...dialog.element.querySelectorAll<HTMLInputElement>("[data-tag-list] input:checked")]
                .map((input) => input.value).sort();
            fetchPost("/api/flashcard/setTagAssignments", {
                operationID: genUUID(),
                targetType,
                targetIDs: [targetID],
                tagIDs,
                changedAt: Date.now(),
            }, () => {
                callback(tagIDs);
                dialog.destroy();
            });
        });
    });
};

const flashcardV2ManagementPageSize = 200;

const openFlashcardV2ReviewSetCards = (reviewSetID: string, name: string, offset = 0) => {
    const now = Date.now();
    const queryCards = (cardIDs?: string[], total?: number) => {
        if (cardIDs && cardIDs.length === 0) {
            new Dialog({
                title: name,
                width: isMobile() ? "92vw" : "720px",
                content: `<div class="b3-dialog__content card__empty">${window.siyuan.languages.emptyContent}</div>`,
            });
            return;
        }
        fetchPost("/api/flashcard/queryCards", {
            query: cardIDs ? {
                version: 1,
                root: {operator: "predicate", field: "cardID", comparator: "in", value: cardIDs},
            } : undefined,
            options: {
                now,
                includeInactive: true,
                includeSuspended: true,
                includeBuried: true,
                includePaused: true,
                includeConflicts: true,
                limit: cardIDs ? flashcardV2ManagementPageSize : flashcardV2ManagementPageSize + 1,
                offset: cardIDs ? 0 : offset,
            },
        }, (queryResponse) => {
            const fetchedCards = queryResponse.data.cards as IFlashcardSearchResult[];
            const cards = fetchedCards.slice(0, flashcardV2ManagementPageSize);
            const pageLength = cardIDs?.length ?? cards.length;
            const hasNext = total === undefined ? fetchedCards.length > flashcardV2ManagementPageSize :
                offset + pageLength < total;
            let grouped = true;
            const dialog = new Dialog({
                title: name,
                width: isMobile() ? "92vw" : "760px",
                height: "70vh",
                content: `<div class="b3-dialog__content fn__flex-column" style="box-sizing:border-box;height:100%">
<div class="fn__flex"><button data-type="pagePrevious" class="b3-button b3-button--outline"${offset === 0 ? " disabled" : ""}>${window.siyuan.languages.previous}</button><span class="fn__space"></span>
<span class="b3-list-item__meta fn__flex-1">${cards.length === 0 ? 0 : offset + 1} - ${offset + cards.length}${total === undefined ? "" : ` / ${total}`}</span>
<button data-type="pageNext" class="b3-button b3-button--outline"${hasNext ? "" : " disabled"}>${window.siyuan.languages.next}</button><span class="fn__space"></span>
<button data-type="group" class="b3-button b3-button--outline"><svg><use xlink:href="#iconList"></use></svg>${window.siyuan.languages.group}</button></div>
<div class="fn__hr"></div><ul class="b3-list b3-list--background fn__flex-1">${renderManagedCards(cards, grouped, reviewSetID)}</ul></div>`,
            });
            const refreshList = () => {
                dialog.element.querySelector(".b3-list").innerHTML = renderManagedCards(cards, grouped, reviewSetID);
            };
            dialog.element.addEventListener("click", (event) => {
                const target = (event.target as HTMLElement).closest("[data-type]") as HTMLElement;
                const item = (event.target as HTMLElement).closest(".b3-list-item") as HTMLElement;
                if (!target) {
                    return;
                }
                const type = target.dataset.type;
                if (type === "pagePrevious" || type === "pageNext") {
                    const nextOffset = type === "pagePrevious" ? Math.max(0, offset - flashcardV2ManagementPageSize) :
                        offset + flashcardV2ManagementPageSize;
                    dialog.destroy();
                    openFlashcardV2ReviewSetCards(reviewSetID, name, nextOffset);
                    return;
                }
                if (type === "group") {
                    grouped = !grouped;
                    refreshList();
                    return;
                }
                if (!item) {
                    return;
                }
                if (type === "sourceTags") {
                    const sourceID = item.dataset.sourceId;
                    const sourceCards = sourceID ? cards.filter((card) => card.card.sourceID === sourceID) : [];
                    if (sourceID && sourceCards.length > 0) {
                        openFlashcardV2Tags("source", sourceID, sourceCards[0].sourceTagIDs || [], (tagIDs) => {
                            sourceCards.forEach((card) => {
                                card.sourceTagIDs = tagIDs;
                                refreshEffectiveCardValues(card);
                            });
                            refreshList();
                        });
                    }
                    return;
                }
                if ((type === "documentPolicy" || type === "notebookPolicy") && item.dataset.sourceId) {
                    const sourceCards = cards.filter((card) => card.card.sourceID === item.dataset.sourceId);
                    if (sourceCards.length > 0) {
                        const scopeType = type === "documentPolicy" ? "document" : "notebook";
                        openFlashcardV2StudyPolicy(sourceCards[0], scopeType, (priority) => {
                            if (scopeType === "document") {
                                sourceCards.filter((card) => !card.sourcePriority).forEach((card) => {
                                    card.inheritedPriority = priority;
                                    refreshEffectiveCardValues(card);
                                });
                            }
                            refreshList();
                        });
                    }
                    return;
                }
                if (type === "history") {
                    openFlashcardV2CardHistory(item.dataset.id);
                    return;
                }
                if (type === "exclude" && reviewSetID && item.dataset.id) {
                    setFlashcardV2ReviewSetMembership(reviewSetID, item.dataset.id, "exclude", () => {
                        const nextOffset = cards.length === 1 ? Math.max(0, offset - flashcardV2ManagementPageSize) :
                            offset;
                        dialog.destroy();
                        openFlashcardV2ReviewSetCards(reviewSetID, name, nextOffset);
                    });
                    return;
                }
                if (type === "membership" && item.dataset.id) {
                    openFlashcardV2Membership(item.dataset.id, refreshList);
                    return;
                }
                if (type === "direction") {
                    const card = cards.find((result) => result.card.id === item.dataset.id);
                    if (card) {
                        openFlashcardV2Direction(card.card.sourceID,
                            cards.filter((result) => result.card.sourceID === card.card.sourceID), refreshList);
                    }
                    return;
                }
                const selectedCard = cards.find((result) => result.card.id === item.dataset.id);
                if (type === "tags" && selectedCard) {
                    openFlashcardV2Tags("card", selectedCard.card.id, selectedCard.cardTagIDs || [], (tagIDs) => {
                        selectedCard.cardTagIDs = tagIDs;
                        refreshEffectiveCardValues(selectedCard);
                        refreshList();
                    });
                    return;
                }
                if ((type === "preset" || type === "priority") && selectedCard) {
                    openFlashcardV2CardSetting(selectedCard, type, refreshList);
                    return;
                }
                if (type === "due" && selectedCard) {
                    openFlashcardV2Due(selectedCard, refreshList);
                    return;
                }
                let action = "";
                const request: Record<string, unknown> = {};
                if (type === "reset") {
                    action = "reset";
                } else if (type === "suspend") {
                    const card = cards.find((result) => result.card.id === item.dataset.id);
                    action = card?.reviewState.suspended ? "resume" : "suspend";
                } else if (type === "bury") {
                    const card = cards.find((result) => result.card.id === item.dataset.id);
                    if ((card?.reviewState.buriedUntil || 0) > Date.now()) {
                        action = "unbury";
                    } else {
                        action = "bury";
                        const tomorrow = new Date();
                        tomorrow.setHours(24, 0, 0, 0);
                        request.buriedUntil = tomorrow.getTime();
                        request.reason = "user";
                    }
                } else if (type === "flag") {
                    action = "setFlag";
                    request.flag = (Number(item.dataset.flag) + 1) % 8;
                }
                if (action === "") {
                    return;
                }
                fetchPost("/api/flashcard/manageCards", {
                    operationID: genUUID(),
                    cardIDs: [item.dataset.id],
                    action,
                    changedAt: Date.now(),
                    ...request,
                }, (manageResponse) => {
                    const card = cards.find((result) => result.card.id === item.dataset.id);
                    if (card) {
                        updateManagedCard(card, manageResponse.data);
                        refreshList();
                    }
                });
            });
        });
    };
    if (reviewSetID === "") {
        queryCards();
        return;
    }
    fetchPost("/api/flashcard/previewReviewSet", {
        reviewSetID,
        options: {
            now,
            includeInactive: true,
            includeSuspended: true,
            includeBuried: true,
            includePaused: true,
            includeConflicts: true,
            limit: flashcardV2ManagementPageSize,
            offset,
        },
    }, (previewResponse) => {
        queryCards(previewResponse.data.cardIDs as string[], previewResponse.data.total as number);
    });
};

export const openFlashcardV2Management = () => {
    ensureFlashcardV2(() => openFlashcardV2ReviewSetCards("", window.siyuan.languages.manage));
};

export const openFlashcardV2ReviewSets = (app: App) => {
    ensureFlashcardV2(() => {
        fetchPost("/api/flashcard/listEntities", {
            entityType: "reviewSet",
            options: {limit: 1000, offset: 0},
        }, (response) => {
            const revisions = response.data.entities as Array<IFlashcardEntityRevision<IReviewSet>>;
            const dialog = new Dialog({
                title: window.siyuan.languages.flashcardReviewSet,
                width: isMobile() ? "92vw" : "640px",
                height: "70vh",
                content: `<div class="b3-dialog__content fn__flex-column" style="box-sizing: border-box;height: 100%">
<div class="fn__flex">
    <input class="b3-text-field fn__flex-1" placeholder="${window.siyuan.languages.flashcardReviewSet}">
    <span class="fn__space"></span>
    <button data-type="create" class="b3-button b3-button--text"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}</button>
</div>
<div class="fn__hr"></div>
<ul class="b3-list b3-list--background fn__flex-1">${revisions.map(renderReviewSet).join("")}</ul>
</div>`,
            });
            dialog.element.addEventListener("click", (event) => {
                let target = event.target as HTMLElement;
                while (target && target !== dialog.element) {
                    const type = target.getAttribute("data-type");
                    if (type === "create") {
                        const input = dialog.element.querySelector("input") as HTMLInputElement;
                        const initialName = input.value.trim();
                        openFlashcardV2ReviewSetEditor(undefined, (saved) => {
                            revisions.unshift(saved);
                            dialog.element.querySelector(".b3-list").insertAdjacentHTML("afterbegin", renderReviewSet(saved));
                            input.value = "";
                        }, initialName);
                        return;
                    }
                    const item = target.closest(".b3-list-item") as HTMLElement;
                    if (type === "edit" && item) {
                        const index = revisions.findIndex((entry) => entry.entityID === item.dataset.id);
                        if (index >= 0) {
                            openFlashcardV2ReviewSetEditor(revisions[index], (saved) => {
                                revisions[index] = saved;
                                item.outerHTML = renderReviewSet(saved);
                            });
                        }
                        return;
                    }
                    if (type === "statistics" && item) {
                        openFlashcardV2Statistics(item.dataset.id);
                        return;
                    }
                    if (type === "review" && item) {
                        openFlashcardV2ReviewSetSession(app, item.dataset.id,
                            item.querySelector(".b3-list-item__text").textContent,
                            item.dataset.reviewMode as "normal" | "reinforcement");
                        return;
                    }
                    if (type === "delete" && item) {
                        confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.confirmDelete, () => {
                            fetchPost("/api/flashcard/deleteReviewSet", {
                                operationID: genUUID(),
                                reviewSetID: item.dataset.id,
                                expectedRevisionID: item.dataset.revision,
                                deletedAt: Date.now(),
                            }, () => item.remove());
                        }, undefined, true);
                        return;
                    }
                    if (!type && item) {
                        openFlashcardV2ReviewSetCards(item.dataset.id, item.querySelector(".b3-list-item__text").textContent);
                        return;
                    }
                    target = target.parentElement;
                }
            });
        });
    });
};

export const openFlashcardV2BasicSource = (blockIDs: string[]) => {
    if (blockIDs.length < 2) {
        return;
    }
    ensureFlashcardV2(() => {
        fetchPost("/api/flashcard/listEntities", {
            entityType: "reviewSet",
            options: {limit: 1000, offset: 0},
        }, (response) => {
            const revisions = response.data.entities as Array<IFlashcardEntityRevision<IReviewSet>>;
            const dialog = new Dialog({
                title: window.siyuan.languages.riffCard,
                width: isMobile() ? "92vw" : "520px",
                content: `<div class="b3-dialog__content">
<label class="b3-label">
    <div class="b3-label__text">${window.siyuan.languages.type}</div>
    <select data-type="direction" class="b3-select fn__block">
        <option value="forward">${window.siyuan.languages.flashcardDirectionForward}</option>
        <option value="reverse">${window.siyuan.languages.flashcardDirectionReverse}</option>
        <option value="bidirectional">${window.siyuan.languages.flashcardDirectionBidirectional}</option>
        <option value="closed">${window.siyuan.languages.flashcardDirectionClosed}</option>
    </select>
</label>
<div class="fn__hr"></div>
<label class="b3-label">
    <div class="b3-label__text">${window.siyuan.languages.flashcardReviewSet}</div>
    <select data-type="reviewSets" class="b3-select fn__block" multiple size="${Math.min(6, Math.max(2, revisions.length))}">
        ${revisions.map((revision) => `<option value="${escapeAttr(revision.entityID)}">${escapeHtml(revision.payload.name)}</option>`).join("")}
    </select>
</label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            });
            const buttons = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
            buttons[0].addEventListener("click", () => dialog.destroy());
            buttons[1].addEventListener("click", () => {
                const direction = (dialog.element.querySelector('[data-type="direction"]') as HTMLSelectElement).value;
                const reviewSets = dialog.element.querySelector('[data-type="reviewSets"]') as HTMLSelectElement;
                const operationID = genUUID();
                fetchPost("/api/flashcard/createBasicSource", {
                    operationID,
                    sourceID: genUUID(),
                    blockIDs,
                    direction,
                    reviewSetIDs: [...reviewSets.selectedOptions].map((option) => option.value),
                    createdAt: Date.now(),
                }, () => dialog.destroy());
            });
        });
    });
};

type TFlashcardV2ImageShapeType = "rectangle" | "ellipse" | "polygon";

interface IFlashcardV2ImagePoint {
    x: number;
    y: number;
}

interface IFlashcardV2ImageShape {
    id: string;
    groupID: string;
    type: TFlashcardV2ImageShapeType;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    points?: IFlashcardV2ImagePoint[];
}

interface IFlashcardV2ImageEditor {
    getConfig: () => {
        assetID: string;
        shapes: Array<Omit<IFlashcardV2ImageShape, "groupID">>;
        groups: Array<{ id: string, shapeIDs: string[], displayOrder: number }>;
        frontMode: string;
    };
    hasShapes: () => boolean;
    redraw: () => void;
}

const flashcardV2ImageSource = (blockID: string, dom: string) => {
    const template = document.createElement("template");
    template.innerHTML = window.DOMPurify.sanitize(dom, {
        FORBID_TAGS: ["script", "style", "iframe", "frame", "frameset", "object", "embed"],
    });
    const image = template.content.querySelector("img");
    const assetID = image?.getAttribute("data-src") || image?.getAttribute("src") || "";
    if (!assetID || /^(?:javascript|data|blob):/i.test(assetID)) {
        return;
    }
    return {assetID, blockID};
};

const flashcardV2BlockText = (blockID: string, dom: string) => {
    const template = document.createElement("template");
    template.innerHTML = window.DOMPurify.sanitize(dom, {
        FORBID_TAGS: ["script", "style", "iframe", "frame", "frameset", "object", "embed"],
    });
    const text = template.content.textContent?.replace(/\s+/g, " ").trim();
    return text || blockID;
};

const bindFlashcardV2ImageEditor = (element: Element, assetID: string,
    onChange: (hasShapes: boolean) => void): IFlashcardV2ImageEditor => {
    const image = element.querySelector("img") as HTMLImageElement;
    const canvas = element.querySelector("canvas") as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    const shapeSelect = element.querySelector('[data-type="imageShape"]') as HTMLSelectElement;
    const groupSelect = element.querySelector('[data-type="imageGroup"]') as HTMLSelectElement;
    const frontMode = element.querySelector('[data-type="imageFrontMode"]') as HTMLSelectElement;
    const polygonButton = element.querySelector('[data-type="finishPolygon"]') as HTMLButtonElement;
    const undoButton = element.querySelector('[data-type="undoImageShape"]') as HTMLButtonElement;
    const shapes: IFlashcardV2ImageShape[] = [];
    const groupOrder: string[] = [];
    let start: IFlashcardV2ImagePoint | undefined;
    let current: IFlashcardV2ImagePoint | undefined;
    let polygon: IFlashcardV2ImagePoint[] = [];

    const point = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        };
    };
    const groupColor = (groupID: string, alpha: number) => {
        const index = Math.max(0, groupOrder.indexOf(groupID));
        return `hsla(${(index * 67 + 210) % 360}, 72%, 48%, ${alpha})`;
    };
    const drawShape = (shape: IFlashcardV2ImageShape, width: number, height: number, alpha = .55) => {
        context.beginPath();
        if (shape.type === "polygon") {
            shape.points?.forEach((item, index) => {
                if (index === 0) {
                    context.moveTo(item.x * width, item.y * height);
                } else {
                    context.lineTo(item.x * width, item.y * height);
                }
            });
            context.closePath();
        } else if (shape.type === "ellipse") {
            context.ellipse((shape.x + shape.width / 2) * width, (shape.y + shape.height / 2) * height,
                shape.width * width / 2, shape.height * height / 2, 0, 0, Math.PI * 2);
        } else {
            context.rect(shape.x * width, shape.y * height, shape.width * width, shape.height * height);
        }
        context.fillStyle = groupColor(shape.groupID, alpha);
        context.strokeStyle = groupColor(shape.groupID, 1);
        context.lineWidth = 2;
        context.fill();
        context.stroke();
    };
    const redraw = () => {
        const rect = image.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        shapes.forEach((shape) => drawShape(shape, width, height));
        if (start && current && shapeSelect.value !== "polygon") {
            const x = Math.min(start.x, current.x);
            const y = Math.min(start.y, current.y);
            drawShape({id: "", groupID: groupSelect.value || "", type: shapeSelect.value as TFlashcardV2ImageShapeType,
                x, y, width: Math.abs(start.x - current.x), height: Math.abs(start.y - current.y)}, width, height, .35);
        }
        if (polygon.length > 0) {
            drawShape({id: "", groupID: groupSelect.value || "", type: "polygon", points: polygon}, width, height,
                .35);
            polygon.forEach((item) => {
                context.beginPath();
                context.arc(item.x * width, item.y * height, 4, 0, Math.PI * 2);
                context.fillStyle = groupColor(groupSelect.value || "", 1);
                context.fill();
            });
        }
    };
    const updateGroups = () => {
        const selected = groupSelect.value;
        groupSelect.innerHTML = `<option value="">+</option>${groupOrder.map((groupID, index) =>
            `<option value="${escapeAttr(groupID)}">${index + 1}</option>`).join("")}`;
        if (groupOrder.includes(selected)) {
            groupSelect.value = selected;
        }
    };
    const addShape = (shape: Omit<IFlashcardV2ImageShape, "id" | "groupID">) => {
        let groupID = groupSelect.value;
        if (!groupID) {
            groupID = genUUID();
            groupOrder.push(groupID);
        }
        shapes.push({...shape, id: genUUID(), groupID});
        updateGroups();
        groupSelect.value = "";
        onChange(true);
        redraw();
    };
    const finishPolygon = () => {
        if (polygon.length >= 3) {
            addShape({type: "polygon", points: polygon});
        }
        polygon = [];
        polygonButton.disabled = true;
        redraw();
    };
    canvas.addEventListener("pointerdown", (event) => {
        if (shapeSelect.value === "polygon") {
            polygon.push(point(event));
            polygonButton.disabled = polygon.length < 3;
            redraw();
            return;
        }
        start = point(event);
        current = start;
        canvas.setPointerCapture(event.pointerId);
        redraw();
    });
    canvas.addEventListener("pointermove", (event) => {
        if (start) {
            current = point(event);
            redraw();
        }
    });
    canvas.addEventListener("pointerup", (event) => {
        if (!start) {
            return;
        }
        current = point(event);
        const x = Math.min(start.x, current.x);
        const y = Math.min(start.y, current.y);
        const width = Math.abs(start.x - current.x);
        const height = Math.abs(start.y - current.y);
        if (width >= .005 && height >= .005) {
            addShape({type: shapeSelect.value as TFlashcardV2ImageShapeType, x, y, width, height});
        }
        start = undefined;
        current = undefined;
        redraw();
    });
    shapeSelect.addEventListener("change", () => {
        polygon = [];
        polygonButton.classList.toggle("fn__none", shapeSelect.value !== "polygon");
        polygonButton.disabled = true;
        redraw();
    });
    groupSelect.addEventListener("change", redraw);
    polygonButton.addEventListener("click", finishPolygon);
    undoButton.addEventListener("click", () => {
        if (polygon.length > 0) {
            polygon.pop();
            polygonButton.disabled = polygon.length < 3;
        } else {
            const removed = shapes.pop();
            if (removed && !shapes.some((shape) => shape.groupID === removed.groupID)) {
                groupOrder.splice(groupOrder.indexOf(removed.groupID), 1);
                updateGroups();
            }
        }
        onChange(shapes.length > 0);
        redraw();
    });
    image.addEventListener("load", redraw);
    requestAnimationFrame(redraw);
    return {
        getConfig: () => ({
            assetID,
            shapes: shapes.map((shape) => ({
                id: shape.id,
                type: shape.type,
                x: shape.x,
                y: shape.y,
                width: shape.width,
                height: shape.height,
                points: shape.points,
            })),
            groups: groupOrder.map((groupID, displayOrder) => ({
                id: groupID,
                shapeIDs: shapes.filter((shape) => shape.groupID === groupID).map((shape) => shape.id),
                displayOrder,
            })),
            frontMode: frontMode.value,
        }),
        hasShapes: () => shapes.length > 0,
        redraw,
    };
};

export const openFlashcardV2AdvancedSource = (blockIDs: string[]) => {
    if (blockIDs.length === 0) {
        return;
    }
    ensureFlashcardV2(() => {
        fetchPost("/api/flashcard/listEntities", {
            entityType: "reviewSet",
            options: {limit: 1000, offset: 0},
        }, (response) => {
            const revisions = response.data.entities as Array<IFlashcardEntityRevision<IReviewSet>>;
            const openDialog = (doms: Record<string, string>, imageSource?: { assetID: string, blockID: string }) => {
                const pluginTypes = listFlashcardV2PluginTypes().filter((item) => item.registration.create);
                const imageEditorHTML = imageSource ? `<div data-type="imageEditor" class="fn__none">
<div class="fn__hr"></div>
<div class="fn__flex">
    <select data-type="imageShape" class="b3-select">
        <option value="rectangle">${window.siyuan.languages.flashcardRectangle}</option>
        <option value="ellipse">${window.siyuan.languages.flashcardEllipse}</option>
        <option value="polygon">${window.siyuan.languages.flashcardPolygon}</option>
    </select>
    <span class="fn__space"></span>
    <label class="fn__flex-center">${window.siyuan.languages.group}<span class="fn__space"></span><select data-type="imageGroup" class="b3-select"><option value="">+</option></select></label>
    <span class="fn__space"></span>
    <button data-type="finishPolygon" class="b3-button b3-button--outline fn__none" disabled>${window.siyuan.languages.confirm}</button>
    <span class="fn__space"></span>
    <button data-type="undoImageShape" class="b3-button b3-button--outline">${window.siyuan.languages.undo}</button>
</div>
<div class="fn__hr"></div>
<select data-type="imageFrontMode" class="b3-select fn__block">
    <option value="hideAllAnswerOne">${window.siyuan.languages.flashcardImageHideAll}</option>
    <option value="hideCurrent">${window.siyuan.languages.flashcardImageHideCurrent}</option>
</select>
<div class="card__v2-image-editor"><img src="${escapeAttr(imageSource.assetID)}"><canvas></canvas></div>
</div>` : "";
                const choiceEditorHTML = blockIDs.length >= 3 ? `<div data-type="choiceEditor" class="fn__none">
<div class="fn__hr"></div>
<div class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardChoiceQuestion}</div>${escapeHtml(flashcardV2BlockText(blockIDs[0], doms[blockIDs[0]] || ""))}</div>
<div class="fn__hr"></div>
<div class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardCorrectAnswer}</div>
${blockIDs.slice(1).map((blockID, index) => `<label class="fn__flex card__v2-choice-source"><input data-type="choiceCorrect" data-choice-index="${index}" type="radio" name="flashcardChoiceCorrect"><span>${escapeHtml(flashcardV2BlockText(blockID, doms[blockID] || ""))}</span></label>`).join("")}
</div>
<label class="b3-label fn__flex-center"><input data-type="choiceRandomize" class="b3-switch fn__flex-center" type="checkbox" checked><span class="fn__space"></span>${window.siyuan.languages.flashcardRandomizeOptions}</label>
<label class="b3-label fn__flex-center"><input data-type="choiceDynamic" class="b3-switch fn__flex-center" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.flashcardDynamicDistractors}<span class="fn__flex-1"></span><input data-type="choiceDynamicCount" class="b3-text-field" style="width:72px" type="number" min="1" max="50" value="3" disabled></label>
</div>` : "";
                const dialog = new Dialog({
                    title: window.siyuan.languages.configGroupAdvanced,
                    width: isMobile() ? "96vw" : "720px",
                    height: imageSource || blockIDs.length >= 3 ? "82vh" : undefined,
                    content: `<div class="b3-dialog__content" style="overflow:auto">
<label class="b3-label">
    <div class="b3-label__text">${window.siyuan.languages.type}</div>
    <select data-type="mode" class="b3-select fn__block">
        <option value="cloze">${window.siyuan.languages.flashcardClozeCards}</option>
        <option value="orderedSingle">${window.siyuan.languages.flashcardOrderedSingle}</option>
        <option value="orderedCards">${window.siyuan.languages.flashcardOrderedCards}</option>
        ${blockIDs.length >= 2 ? `<option value="multiLineAll">${window.siyuan.languages.flashcardMultiLineAll}</option><option value="multiLineSteps">${window.siyuan.languages.flashcardMultiLineSteps}</option>` : ""}
        ${imageSource ? `<option value="imageOcclusion">${window.siyuan.languages.flashcardImageOcclusion}</option>` : ""}
        ${blockIDs.length >= 3 ? `<option value="choiceSingle">${window.siyuan.languages.flashcardChoiceSingle}</option><option value="choiceMultiple">${window.siyuan.languages.flashcardChoiceMultiple}</option>` : ""}
        ${pluginTypes.map((item) => `<option value="${escapeAttr(item.sourceType)}">${escapeHtml(item.registration.displayName || item.registration.typeName)}</option>`).join("")}
    </select>
</label>
${imageEditorHTML}
${choiceEditorHTML}
<div class="fn__hr"></div>
<div class="b3-label"><div class="b3-label__text">${window.siyuan.languages.total}</div>${blockIDs.length}</div>
<div class="fn__hr"></div>
<label class="b3-label">
    <div class="b3-label__text">${window.siyuan.languages.flashcardReviewSet}</div>
    <select data-type="reviewSets" class="b3-select fn__block" multiple size="${Math.min(6, Math.max(2, revisions.length))}">
        ${revisions.map((revision) => `<option value="${escapeAttr(revision.entityID)}">${escapeHtml(revision.payload.name)}</option>`).join("")}
    </select>
</label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                });
                const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
                const modeElement = dialog.element.querySelector('[data-type="mode"]') as HTMLSelectElement;
                const imageElement = dialog.element.querySelector('[data-type="imageEditor"]');
                const choiceElement = dialog.element.querySelector('[data-type="choiceEditor"]');
                const choiceInputs = [...dialog.element.querySelectorAll<HTMLInputElement>('[data-type="choiceCorrect"]')];
                const dynamicChoice = dialog.element.querySelector('[data-type="choiceDynamic"]') as HTMLInputElement;
                const dynamicChoiceCount = dialog.element.querySelector('[data-type="choiceDynamicCount"]') as HTMLInputElement;
                const updateConfirm = () => {
                    const imageMode = modeElement.value === "imageOcclusion";
                    const choiceMode = modeElement.value === "choiceSingle" || modeElement.value === "choiceMultiple";
                    buttons[1].disabled = imageMode && !imageEditor?.hasShapes() ||
                        choiceMode && !choiceInputs.some((input) => input.checked);
                };
                let imageEditor: IFlashcardV2ImageEditor | undefined;
                if (imageSource) {
                    imageEditor = bindFlashcardV2ImageEditor(imageElement, imageSource.assetID, updateConfirm);
                }
                modeElement.addEventListener("change", () => {
                    const imageMode = modeElement.value === "imageOcclusion";
                    const choiceMode = modeElement.value === "choiceSingle" || modeElement.value === "choiceMultiple";
                    imageElement?.classList.toggle("fn__none", !imageMode);
                    choiceElement?.classList.toggle("fn__none", !choiceMode);
                    choiceInputs.forEach((input) => {
                        input.type = modeElement.value === "choiceMultiple" ? "checkbox" : "radio";
                    });
                    if (modeElement.value === "choiceSingle") {
                        choiceInputs.filter((input) => input.checked).slice(1).forEach((input) => {
                            input.checked = false;
                        });
                    }
                    updateConfirm();
                    if (imageMode) {
                        requestAnimationFrame(() => imageEditor?.redraw());
                    }
                });
                choiceInputs.forEach((input) => input.addEventListener("change", updateConfirm));
                dynamicChoice?.addEventListener("change", () => {
                    dynamicChoiceCount.disabled = !dynamicChoice.checked;
                });
                buttons[0].addEventListener("click", () => dialog.destroy());
                buttons[1].addEventListener("click", () => {
                    const mode = modeElement.value;
                    if (mode === "imageOcclusion" && !imageEditor?.hasShapes()) {
                        return;
                    }
                    const reviewSets = dialog.element.querySelector('[data-type="reviewSets"]') as HTMLSelectElement;
                    const reviewSetIDs = [...reviewSets.selectedOptions].map((option) => option.value);
                    if (mode.startsWith("plugin:")) {
                        const pluginType = pluginTypes.find((item) => item.sourceType === mode);
                        if (pluginType?.registration.create) {
                            buttons[1].disabled = true;
                            void Promise.resolve(pluginType.registration.create({blockIDs, reviewSetIDs}))
                                .then(() => dialog.destroy())
                                .catch((error) => {
                                    console.error(`Flashcard plugin creator [${mode}] failed`, error);
                                    buttons[1].disabled = false;
                                });
                        }
                        return;
                    }
                    fetchPost("/api/flashcard/createAdvancedSource", {
                        operationID: genUUID(),
                        sourceID: genUUID(),
                        mode,
                        blockIDs: mode === "imageOcclusion" ? [imageSource.blockID] : blockIDs,
                        imageConfig: mode === "imageOcclusion" ? imageEditor.getConfig() : undefined,
                        correctOptionIndexes: mode === "choiceSingle" || mode === "choiceMultiple" ?
                            choiceInputs.filter((input) => input.checked).map((input) => Number(input.dataset.choiceIndex)) :
                            undefined,
                        randomizeOptions: mode === "choiceSingle" || mode === "choiceMultiple" ?
                            (dialog.element.querySelector('[data-type="choiceRandomize"]') as HTMLInputElement).checked :
                            undefined,
                        distractorQuery: (mode === "choiceSingle" || mode === "choiceMultiple") &&
                        dynamicChoice?.checked ? {version: 1, root: {operator: "matchAll"}} : undefined,
                        dynamicDistractors: (mode === "choiceSingle" || mode === "choiceMultiple") &&
                        dynamicChoice?.checked ? Math.min(50, Math.max(1, Number(dynamicChoiceCount.value) || 1)) :
                            undefined,
                        reviewSetIDs,
                        createdAt: Date.now(),
                    }, () => dialog.destroy());
                });
            };
            fetchPost("/api/block/getBlockDOMs", {ids: blockIDs}, (domResponse) => {
                const doms = domResponse.data as Record<string, string>;
                const imageSource = blockIDs.length === 1 ?
                    flashcardV2ImageSource(blockIDs[0], doms[blockIDs[0]] || "") : undefined;
                openDialog(doms, imageSource);
            });
        });
    });
};

export const openFlashcardV2AnkiPreview = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".apkg,application/zip";
    input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) {
            return;
        }
        const formData = new FormData();
        formData.append("file", file);
        fetchPost("/api/flashcard/previewAnkiPackage", formData, (response) => {
            const preview = response.data as IAnkiPackagePreview;
            const notebooks = window.siyuan.notebooks.filter((notebook) => !notebook.closed && !notebook.encrypted);
            const dialog = new Dialog({
                title: `Anki - ${window.siyuan.languages.dataMigration}`,
                width: isMobile() ? "92vw" : "720px",
                height: "70vh",
                content: `<div class="b3-dialog__content" style="box-sizing:border-box;height:100%;overflow:auto">
${statisticsItem(window.siyuan.languages.total, preview.noteCount)}
${statisticsItem(window.siyuan.languages.riffCard, preview.cardCount)}
${statisticsItem(window.siyuan.languages.revisionCount, preview.reviewCount)}
${statisticsItem(window.siyuan.languages.assets, preview.mediaCount)}
<div class="fn__hr"></div>
<ul class="b3-list b3-list--background">
${preview.noteTypes.map((noteType) => `<li class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(noteType.name)}</span><span class="b3-list-item__meta">${escapeHtml(noteType.conversion)} · ${noteType.noteCount}</span></li>`).join("")}
</ul>
<div class="fn__hr"></div>
<ul class="b3-list b3-list--background">
${preview.decks.map((deck) => `<li class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(deck.name)}</span><span class="b3-list-item__meta">${deck.cardCount}</span></li>`).join("")}
</ul>
${preview.unsupported.length === 0 ? "" : `<div class="fn__hr"></div><div class="ft__warning">${preview.unsupported.map(escapeHtml).join("<br>")}</div>`}
<div class="fn__hr"></div>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.targetNotebook}</div>
<select data-type="notebook" class="b3-select fn__block"${notebooks.length === 0 ? " disabled" : ""}>
${notebooks.map((notebook) => `<option value="${escapeAttr(notebook.id)}">${escapeHtml(notebook.name)}</option>`).join("")}
</select></label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button data-type="import" class="b3-button b3-button--text"${notebooks.length === 0 ? " disabled" : ""}>${window.siyuan.languages.import}</button>
</div>`,
            });
            const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
            let importController: AbortController | undefined;
            buttons[0].addEventListener("click", () => {
                importController?.abort();
                dialog.destroy();
            });
            buttons[1].addEventListener("click", () => {
                const notebookID = (dialog.element.querySelector('[data-type="notebook"]') as HTMLSelectElement).value;
                if (!notebookID) {
                    return;
                }
                ensureFlashcardV2(() => {
                    const importData = new FormData();
                    importData.append("file", file);
                    importData.append("notebookID", notebookID);
                    importData.append("operationID", genUUID());
                    buttons[1].disabled = true;
                    importController = new AbortController();
                    fetchPost("/api/flashcard/importAnkiPackage", importData, (importResponse) => {
                        const report = importResponse.data as IAnkiImportReport;
                        dialog.destroy();
                        new Dialog({
                            title: window.siyuan.languages.imported,
                            width: isMobile() ? "92vw" : "520px",
                            content: `<div class="b3-dialog__content">
${statisticsItem(window.siyuan.languages.doc, report.notes)}
${statisticsItem(window.siyuan.languages.riffCard, report.cards)}
${statisticsItem(window.siyuan.languages.revisionCount, report.reviewEvents)}
${statisticsItem(window.siyuan.languages.flashcardReviewSet, report.reviewSets)}
${statisticsItem(window.siyuan.languages.tag, report.tags)}
${statisticsItem(window.siyuan.languages.assets, report.media)}
${statisticsItem(window.siyuan.languages.update, report.updatedSources)}
${statisticsItem(window.siyuan.languages.remove, report.retiredSources)}
</div>`,
                        });
                    }, undefined, undefined, importController.signal).finally(() => {
                        importController = undefined;
                        buttons[1].disabled = false;
                    });
                });
            });
        });
    }, {once: true});
    input.click();
};

const statisticsItem = (label: string, value: string | number) => {
    return `<div class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(label)}</span><span class="b3-list-item__meta">${value}</span></div>`;
};

export const openFlashcardV2Statistics = (reviewSetID = "") => {
    ensureFlashcardV2(() => {
        const now = Date.now();
        fetchPost("/api/flashcard/getStatistics", {
            reviewSetID,
            from: now - 30 * 86400000,
            to: now + 1,
            now,
            bucket: "day",
            timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
            futureDays: 30,
        }, (response) => {
            const statistics = response.data as IFlashcardStatistics;
            const ratings = statistics.history.ratings;
            const state = statistics.overview.reviewStates;
            new Dialog({
                title: window.siyuan.languages.flashcardStatistics,
                width: isMobile() ? "92vw" : "720px",
                height: "70vh",
                content: `<div class="b3-dialog__content fn__flex-column" style="box-sizing: border-box;height: 100%;overflow:auto">
<div class="b3-label">${window.siyuan.languages.cardStatus}</div>
${statisticsItem(window.siyuan.languages.riffCard, statistics.overview.currentCards)}
${statisticsItem(window.siyuan.languages.flashcardNewCard, state.new || 0)}
${statisticsItem(window.siyuan.languages.flashcardReviewCard, (state.learning || 0) + (state.review || 0) + (state.relearning || 0))}
${statisticsItem(window.siyuan.languages.flashcardDueCard, statistics.overdue)}
<div class="fn__hr"></div>
<div class="b3-label">${window.siyuan.languages.revisionCount}</div>
${statisticsItem(window.siyuan.languages.total, statistics.history.reviews)}
${statisticsItem(window.siyuan.languages.cardRatingAgain, ratings.again || 0)}
${statisticsItem(window.siyuan.languages.cardRatingHard, ratings.hard || 0)}
${statisticsItem(window.siyuan.languages.cardRatingGood, ratings.good || 0)}
${statisticsItem(window.siyuan.languages.cardRatingEasy, ratings.easy || 0)}
</div>`,
            });
        });
    });
};
