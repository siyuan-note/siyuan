import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
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

interface IFlashcardMigrationReport {
    Complete: boolean;
    MigratedCards: number;
    ArchivedCards: number;
    ReviewSets: number;
    ReviewEvents: number;
    InvalidCards: number;
    UnmappedLogs: number;
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
    order?: {mode: "priorityDue" | "due" | "added" | "random"};
    newLimit: number;
    reviewLimit: number;
    defaultReviewMode: "normal" | "reinforcement";
}

interface IFlashcardReviewSetSummary {
    reviewSetID: string;
    cards: number;
    due: number;
    included: number;
    excluded: number;
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
        accuracy: number;
        trueRetention: number;
        retentionReviews: number;
        durationTotalMS: number;
        durationKnown: number;
        durationUnknown: number;
        averageDurationMS?: number;
    };
    overdue: number;
    futureDue: Array<{ start: number, cards: number }>;
    series: Array<{ start: number, reviews: number, uniqueCards: number, correct: number, durationTotalMS: number }>;
    byHour: Array<{ hour: number, reviews: number, correct: number, retention: number }>;
    intervalDistribution: IFlashcardStatisticsDistribution[];
    stabilityDistribution: IFlashcardStatisticsDistribution[];
    difficultyDistribution: IFlashcardStatisticsDistribution[];
    retrievabilityDistribution: IFlashcardStatisticsDistribution[];
}

interface IFlashcardStatisticsDistribution {
    label: string;
    count: number;
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
    schedulerVersion: "fsrs-6";
    requestRetention: number;
    maximumInterval: number;
    weights: number[];
    newLimit: number;
    reviewLimit: number;
    buryNewSiblings: boolean;
    buryReviewSiblings: boolean;
    leechThreshold: number;
    leechAction: "tag" | "suspend" | "tagAndSuspend";
}

interface IFlashcardTemplate {
    id: string;
    name: string;
}

interface IFlashcardFlagDefinition {
    id: string;
    flag: number;
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

interface IFlashcardManagementFilters {
    content?: string;
    notebookID?: string;
    path?: string;
    sourceType?: string;
    templateID?: string;
    tagID?: string;
    flag?: string;
    generationStatus?: string;
    reviewState?: string;
    suspended?: string;
    buried?: string;
    priority?: string;
    presetID?: string;
    dueFrom?: string;
    dueTo?: string;
    repsFrom?: string;
    repsTo?: string;
    lapsesFrom?: string;
    lapsesTo?: string;
    stabilityFrom?: string;
    stabilityTo?: string;
    difficultyFrom?: string;
    difficultyTo?: string;
    retrievabilityFrom?: string;
    retrievabilityTo?: string;
}

interface IFlashcardManagementOptions {
    tags: IFlashcardTag[];
    presets: IFlashcardPreset[];
    templates: IFlashcardTemplate[];
    flagDefinitions: Array<IFlashcardEntityRevision<IFlashcardFlagDefinition>>;
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

const flashcardFlagColors = ["", "#d14343", "#d97706", "#2f9e44", "#3b82f6", "#8b5cf6", "#0891b2", "#db2777"];

const flashcardFlagStyle = (flag: number) => flag > 0 && flag < flashcardFlagColors.length ?
    ` style="color:${flashcardFlagColors[flag]}"` : "";

const flashcardFlagLabel = (flag: number, definitions: IFlashcardFlagDefinition[]) => {
    if (flag === 0) {
        return "○";
    }
    return `● ${definitions.find((definition) => definition.flag === flag)?.name || flag}`;
};

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
        const report = previewResponse.data.report as IFlashcardMigrationReport;
        const unresolved = report.InvalidCards + report.UnmappedLogs;
        const summary = [
            `${window.siyuan.languages.flashcardReviewSet}: ${report.ReviewSets}`,
            `${window.siyuan.languages.riffCard}: ${report.MigratedCards}`,
            `${window.siyuan.languages.flashcardHistoryOnlyCards}: ${report.ArchivedCards}`,
            `${window.siyuan.languages.flashcardReviewHistory}: ${report.ReviewEvents}`,
            `${window.siyuan.languages.invalid}: ${unresolved}`,
        ].join("<br>");
        if (!report.Complete) {
            showMessage(`${window.siyuan.languages.dataMigration}<br>${summary}`, 0, "error");
            return;
        }
        const details = `${window.siyuan.languages.flashcardMigrationConfirm}<br><br>${summary}`;
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

const renderReviewSet = (revision: IFlashcardEntityRevision<IReviewSet>, summary?: IFlashcardReviewSetSummary) => {
    const summaryHTML = summary ? `<span class="b3-list-item__meta b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.riffCard}">${summary.cards}</span>
<span class="b3-list-item__meta b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardDueCard}">${summary.due}</span>
<span class="b3-list-item__meta b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.new}">${summary.included}</span>
<span class="b3-list-item__meta b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}">${summary.excluded}</span>` : "";
    return `<li class="b3-list-item b3-list-item--narrow" data-id="${escapeAttr(revision.entityID)}" data-revision="${escapeAttr(revision.revisionID)}" data-review-mode="${escapeAttr(revision.payload.defaultReviewMode || "normal")}">
<svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg>
<span class="b3-list-item__text">${escapeHtml(revision.payload.name)}</span>
<span class="b3-list-item__meta">${revision.payload.defaultReviewMode === "reinforcement" ? window.siyuan.languages.flashcardReviewReinforcement : window.siyuan.languages.flashcardReviewNormal}</span>
${revision.payload.queryAST ? `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.filter}"><svg><use xlink:href="#iconFilter"></use></svg></span>` : ""}
${summaryHTML}
<span data-type="review" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.continueReview1}"><svg><use xlink:href="#iconPlay"></use></svg></span>
<span data-type="statistics" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardStatistics}"><svg><use xlink:href="#iconGraph"></use></svg></span>
<span data-type="edit" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.edit}"><svg><use xlink:href="#iconEdit"></use></svg></span>
<span data-type="delete" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.delete}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
</li>`;
};

const loadFlashcardV2ReviewSetSummaries = (reviewSetIDs: string[],
    callback: (summaries: Record<string, IFlashcardReviewSetSummary>) => void) => {
    if (reviewSetIDs.length === 0) {
        callback({});
        return;
    }
    fetchPost("/api/flashcard/summarizeReviewSets", {reviewSetIDs, now: Date.now()}, (response) => {
        callback(response.data.summaries as Record<string, IFlashcardReviewSetSummary>);
    });
};

const editableReviewSetPredicates: Record<string, string> = {
    notebookID: "equal",
    path: "startsWith",
    tagID: "equal",
    priority: "equal",
};

const isEditableReviewSetPredicate = (expression: IFlashcardQueryExpression): expression is
    IFlashcardQueryExpression & { field: string, value: string } => expression.operator === "predicate" &&
        typeof expression.field === "string" && typeof expression.value === "string" &&
        editableReviewSetPredicates[expression.field] === expression.comparator;

const reviewSetPredicateValues = (query?: IFlashcardQueryAST) => {
    const ret: Record<string, string> = {};
    if (!query || query.version !== 1) {
        return ret;
    }
    const expressions = query.root.operator === "and" ? query.root.children || [] : [query.root];
    expressions.forEach((expression) => {
        if (isEditableReviewSetPredicate(expression)) {
            ret[expression.field] = expression.value;
        }
    });
    return ret;
};

const reviewSetQuery = (values: Record<string, string>, base?: IFlashcardQueryAST): IFlashcardQueryAST => {
    const original = base?.version === 1 && base.root.operator === "and" ? base.root.children || [] :
        base?.version === 1 && base.root.operator !== "matchAll" ? [base.root] : [];
    const predicates: IFlashcardQueryExpression[] = original.filter((expression) =>
        !isEditableReviewSetPredicate(expression));
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

const flashcardManagementQuery = (filters: IFlashcardManagementFilters): IFlashcardQueryAST | undefined => {
    const predicates: IFlashcardQueryExpression[] = [];
    const add = (field: string, comparator: string, value: unknown) => {
        predicates.push({operator: "predicate", field, comparator, value});
    };
    if (filters.content) {
        add("content", "contains", filters.content);
    }
    if (filters.notebookID) {
        add("notebookID", "equal", filters.notebookID);
    }
    if (filters.path) {
        add("path", "startsWith", filters.path);
    }
    if (filters.sourceType) {
        add("sourceType", "equal", filters.sourceType);
    }
    if (filters.templateID) {
        add("templateID", "equal", filters.templateID);
    }
    if (filters.tagID) {
        add("tagID", "equal", filters.tagID);
    }
    if (filters.flag !== undefined && filters.flag !== "") {
        add("flag", "equal", Number(filters.flag));
    }
    if (filters.generationStatus) {
        add("generationStatus", "equal", filters.generationStatus);
    }
    if (filters.reviewState) {
        add("reviewState", "equal", filters.reviewState);
    }
    if (filters.suspended) {
        add("suspended", "equal", filters.suspended === "true");
    }
    if (filters.buried) {
        add("buried", "equal", filters.buried === "true");
    }
    if (filters.priority) {
        add("priority", "equal", filters.priority);
    }
    if (filters.presetID) {
        add("presetID", "equal", filters.presetID);
    }
    const dueFrom = filters.dueFrom ? new Date(filters.dueFrom).getTime() : Number.NaN;
    if (Number.isFinite(dueFrom)) {
        add("due", "greaterOrEqual", dueFrom);
    }
    const dueTo = filters.dueTo ? new Date(filters.dueTo).getTime() : Number.NaN;
    if (Number.isFinite(dueTo)) {
        add("due", "lessOrEqual", dueTo);
    }
    ([
        ["repsFrom", "reps", "greaterOrEqual"], ["repsTo", "reps", "lessOrEqual"],
        ["lapsesFrom", "lapses", "greaterOrEqual"], ["lapsesTo", "lapses", "lessOrEqual"],
        ["stabilityFrom", "stability", "greaterOrEqual"], ["stabilityTo", "stability", "lessOrEqual"],
        ["difficultyFrom", "difficulty", "greaterOrEqual"], ["difficultyTo", "difficulty", "lessOrEqual"],
        ["retrievabilityFrom", "retrievability", "greaterOrEqual"],
        ["retrievabilityTo", "retrievability", "lessOrEqual"],
    ] as const).forEach(([filter, field, comparator]) => {
        const value = filters[filter] === undefined ? Number.NaN : Number(filters[filter]);
        if (Number.isFinite(value) && value >= 0) {
            add(field, comparator, value);
        }
    });
    if (predicates.length === 0) {
        return undefined;
    }
    return {
        version: 1,
        root: predicates.length === 1 ? predicates[0] : {operator: "and", children: predicates},
    };
};

const flashcardManagementFilterCount = (filters: IFlashcardManagementFilters) =>
    Object.values(filters).filter((value) => value !== undefined && value !== "").length;

const openFlashcardV2ReviewSetEditor = (revision: IFlashcardEntityRevision<IReviewSet> | undefined,
    callback: (saved: IFlashcardEntityRevision<IReviewSet>) => void, initialName = "",
    initialQuery?: IFlashcardQueryAST) => {
    fetchPost("/api/flashcard/listEntities", {
        entityType: "tag",
        options: {limit: 1000, offset: 0},
    }, (response) => {
        const tags = (response.data.entities as Array<IFlashcardEntityRevision<IFlashcardTag>>)
            .map((item) => item.payload);
        const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
        const current = revision?.payload;
        const filters = reviewSetPredicateValues(current?.queryAST || initialQuery);
        const notebooks = window.siyuan.notebooks.filter((notebook) => !notebook.closed && !notebook.encrypted);
        const priorityOptions = ["exam", "learning", "retaining", "paused"]
            .map((priority) => `<option value="${priority}">${escapeHtml(priorityLabel(priority))}</option>`).join("");
        const dialog = new Dialog({
            title: window.siyuan.languages.flashcardReviewSet,
            width: isMobile() ? "92vw" : "560px",
            content: `<div class="b3-dialog__content">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.name}</div><input data-type="name" class="b3-text-field fn__block" value="${escapeAttr(current?.name || initialName)}"></label>
<label class="b3-label fn__flex-center"><input data-type="queryEnabled" class="b3-switch fn__flex-center" type="checkbox"${current?.queryAST || initialQuery ? " checked" : ""}><span class="fn__space"></span>${window.siyuan.languages.filter}</label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.targetNotebook}</div><select data-filter="notebookID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${notebooks.map((notebook) => `<option value="${escapeAttr(notebook.id)}">${escapeHtml(notebook.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.copyPath}</div><input data-filter="path" class="b3-text-field fn__block" value="${escapeAttr(filters.path || "")}" placeholder="/"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.tag}</div><select data-filter="tagID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${tags.map((tag) => `<option value="${escapeAttr(tag.id)}">${escapeHtml(flashcardTagPath(tag, tagMap))}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardPriority}</div><select data-filter="priority" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${priorityOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.reviewMode}</div><select data-type="reviewMode" class="b3-select fn__block"><option value="normal">${window.siyuan.languages.flashcardReviewNormal}</option><option value="reinforcement">${window.siyuan.languages.flashcardReviewReinforcement}</option></select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.sort}</div><select data-type="order" class="b3-select fn__block"><option value="priorityDue">${window.siyuan.languages.sortDefault}</option><option value="due">${window.siyuan.languages.setDueTime}</option><option value="added">${window.siyuan.languages.createdAt}</option><option value="random">${window.siyuan.languages.random}</option></select></label>
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
        const order = dialog.element.querySelector('[data-type="order"]') as HTMLSelectElement;
        order.value = current?.order?.mode || "priorityDue";
        const queryEnabled = dialog.element.querySelector('[data-type="queryEnabled"]') as HTMLInputElement;
        const updateQueryEnabled = () => filterElements.forEach((element) => element.disabled = !queryEnabled.checked);
        updateQueryEnabled();
        queryEnabled.addEventListener("change", updateQueryEnabled);
        let filtersChanged = revision === undefined && initialQuery === undefined;
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
                queryAST: queryEnabled.checked ? filtersChanged ?
                    reviewSetQuery(values, current?.queryAST || initialQuery) : current?.queryAST || initialQuery ||
                    {version: 1, root: {operator: "matchAll"}} : undefined,
                order: {mode: order.value as "priorityDue" | "due" | "added" | "random"},
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

const renderFlashcardV2Preset = (revision: IFlashcardEntityRevision<IFlashcardPreset>) => {
    return `<li class="b3-list-item b3-list-item--narrow" data-id="${escapeAttr(revision.entityID)}" data-revision="${escapeAttr(revision.revisionID)}">
<svg class="b3-list-item__graphic"><use xlink:href="#iconSettings"></use></svg>
<span class="b3-list-item__text">${escapeHtml(revision.payload.name)}</span>
<span class="b3-list-item__meta">${revision.payload.requestRetention} / ${revision.payload.maximumInterval}</span>
<span data-type="copy" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.copy}"><svg><use xlink:href="#iconCopy"></use></svg></span>
<span data-type="edit" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.edit}"><svg><use xlink:href="#iconEdit"></use></svg></span>
<span data-type="delete" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.delete}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
</li>`;
};

const parseFlashcardV2PresetWeights = (value: string) => {
    const parts = value.split(",").map((part) => part.trim());
    if (parts.length !== 19 || parts.some((part) => part === "")) {
        return;
    }
    const weights = parts.map(Number);
    return weights.every(Number.isFinite) ? weights : undefined;
};

const openFlashcardV2PresetEditor = (revision: IFlashcardEntityRevision<IFlashcardPreset> | undefined,
    callback: (saved: IFlashcardEntityRevision<IFlashcardPreset>) => void, initial?: IFlashcardPreset) => {
    const current = revision?.payload || initial;
    const defaultWeights = window.siyuan.config.flashcard.weights.split(",").map((part) => Number(part.trim()));
    const dialog = new Dialog({
        title: window.siyuan.languages.flashcardPreset,
        width: isMobile() ? "92vw" : "560px",
        content: `<div class="b3-dialog__content" style="overflow:auto">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.name}</div><input data-type="name" class="b3-text-field fn__block" value="${escapeAttr(current?.name || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardFSRSParamRequestRetention}</div><input data-type="retention" class="b3-text-field fn__block" type="number" min="0.01" max="1" step="0.01" value="${current?.requestRetention ?? window.siyuan.config.flashcard.requestRetention}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardFSRSParamMaximumInterval}</div><input data-type="maximumInterval" class="b3-text-field fn__block" type="number" min="1" step="1" value="${current?.maximumInterval ?? window.siyuan.config.flashcard.maximumInterval}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardFSRSParamWeights}</div><textarea data-type="weights" class="b3-text-field fn__block">${escapeHtml((current?.weights || defaultWeights).join(","))}</textarea></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardNewCardLimit}</div><input data-type="newLimit" class="b3-text-field fn__block" type="number" min="0" step="1" value="${current?.newLimit ?? window.siyuan.config.flashcard.newCardLimit}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardReviewCardLimit}</div><input data-type="reviewLimit" class="b3-text-field fn__block" type="number" min="0" step="1" value="${current?.reviewLimit ?? window.siyuan.config.flashcard.reviewCardLimit}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardLeeches}</div><input data-type="leechThreshold" class="b3-text-field fn__block" type="number" min="0" step="1" value="${current?.leechThreshold ?? 8}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.manage}</div><select data-type="leechAction" class="b3-select fn__block"><option value="tag">${window.siyuan.languages.tag}</option><option value="suspend">${window.siyuan.languages.flashcardSuspendCard}</option><option value="tagAndSuspend">${window.siyuan.languages.tag} ${window.siyuan.languages.flashcardSuspendCard}</option></select></label>
<label class="b3-label fn__flex-center"><input data-type="buryNew" class="b3-switch fn__flex-center" type="checkbox"${current?.buryNewSiblings === false ? "" : " checked"}><span class="fn__space"></span>${window.siyuan.languages.flashcardBury} - ${window.siyuan.languages.flashcardNewCard}</label>
<label class="b3-label fn__flex-center"><input data-type="buryReview" class="b3-switch fn__flex-center" type="checkbox"${current?.buryReviewSiblings === false ? "" : " checked"}><span class="fn__space"></span>${window.siyuan.languages.flashcardBury} - ${window.siyuan.languages.flashcardReviewCard}</label>
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
    });
    const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
    const leechAction = dialog.element.querySelector('[data-type="leechAction"]') as HTMLSelectElement;
    leechAction.value = current?.leechAction || "tag";
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", () => {
        const name = (dialog.element.querySelector('[data-type="name"]') as HTMLInputElement).value.trim();
        const requestRetention = Number((dialog.element.querySelector('[data-type="retention"]') as HTMLInputElement).value);
        const maximumInterval = Number((dialog.element.querySelector('[data-type="maximumInterval"]') as HTMLInputElement).value);
        const newLimit = Number((dialog.element.querySelector('[data-type="newLimit"]') as HTMLInputElement).value);
        const reviewLimit = Number((dialog.element.querySelector('[data-type="reviewLimit"]') as HTMLInputElement).value);
        const leechThreshold = Number((dialog.element.querySelector('[data-type="leechThreshold"]') as HTMLInputElement).value);
        const weights = parseFlashcardV2PresetWeights((dialog.element.querySelector('[data-type="weights"]') as HTMLTextAreaElement).value);
        if (!name || !Number.isFinite(requestRetention) || requestRetention <= 0 || requestRetention > 1 ||
            !Number.isInteger(maximumInterval) || maximumInterval < 1 || !Number.isInteger(newLimit) || newLimit < 0 ||
            !Number.isInteger(reviewLimit) || reviewLimit < 0 || !Number.isInteger(leechThreshold) ||
            leechThreshold < 0 || !weights) {
            return;
        }
        const entityID = revision?.entityID || genUUID();
        const payload: IFlashcardPreset = {
            id: entityID,
            name,
            schedulerVersion: "fsrs-6",
            requestRetention,
            maximumInterval,
            weights,
            newLimit,
            reviewLimit,
            buryNewSiblings: (dialog.element.querySelector('[data-type="buryNew"]') as HTMLInputElement).checked,
            buryReviewSiblings: (dialog.element.querySelector('[data-type="buryReview"]') as HTMLInputElement).checked,
            leechThreshold,
            leechAction: leechAction.value as "tag" | "suspend" | "tagAndSuspend",
        };
        fetchPost("/api/flashcard/mutateEntities", {
            operationID: genUUID(),
            mutations: [{
                entityType: "schedulerPreset",
                entityID,
                expectedRevisionID: revision?.revisionID,
                requireAbsent: revision === undefined,
                updatedAt: Date.now(),
                payload,
            }],
        }, (response) => {
            callback(response.data.revisions[0] as IFlashcardEntityRevision<IFlashcardPreset>);
            dialog.destroy();
        });
    });
    (dialog.element.querySelector('[data-type="name"]') as HTMLInputElement).focus();
};

export const openFlashcardV2Presets = () => {
    ensureFlashcardV2(() => {
        fetchPost("/api/flashcard/listEntities", {
            entityType: "schedulerPreset",
            options: {limit: 1000, offset: 0},
        }, (response) => {
            const revisions = response.data.entities as Array<IFlashcardEntityRevision<IFlashcardPreset>>;
            const dialog = new Dialog({
                title: window.siyuan.languages.flashcardPreset,
                width: isMobile() ? "92vw" : "640px",
                height: "70vh",
                content: `<div class="b3-dialog__content fn__flex-column" style="box-sizing:border-box;height:100%">
<div class="fn__flex"><span class="fn__flex-1"></span><button data-type="create" class="b3-button b3-button--text"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}</button></div>
<div class="fn__hr"></div><ul class="b3-list b3-list--background fn__flex-1">${revisions.map(renderFlashcardV2Preset).join("")}</ul></div>`,
            });
            dialog.element.addEventListener("click", (event) => {
                const target = (event.target as HTMLElement).closest("[data-type]") as HTMLElement;
                if (!target) {
                    return;
                }
                if (target.dataset.type === "create") {
                    openFlashcardV2PresetEditor(undefined, (saved) => {
                        revisions.unshift(saved);
                        dialog.element.querySelector(".b3-list").insertAdjacentHTML("afterbegin",
                            renderFlashcardV2Preset(saved));
                    });
                    return;
                }
                const item = target.closest(".b3-list-item") as HTMLElement;
                const index = revisions.findIndex((entry) => entry.entityID === item?.dataset.id);
                if (index < 0) {
                    return;
                }
                if (target.dataset.type === "edit") {
                    openFlashcardV2PresetEditor(revisions[index], (saved) => {
                        revisions[index] = saved;
                        item.outerHTML = renderFlashcardV2Preset(saved);
                    });
                    return;
                }
                if (target.dataset.type === "copy") {
                    openFlashcardV2PresetEditor(undefined, (saved) => {
                        revisions.unshift(saved);
                        dialog.element.querySelector(".b3-list").insertAdjacentHTML("afterbegin",
                            renderFlashcardV2Preset(saved));
                    }, {...revisions[index].payload, name: ""});
                    return;
                }
                if (target.dataset.type === "delete") {
                    confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.confirmDelete, () => {
                        fetchPost("/api/flashcard/mutateEntities", {
                            operationID: genUUID(),
                            mutations: [{
                                entityType: "schedulerPreset",
                                entityID: revisions[index].entityID,
                                expectedRevisionID: revisions[index].revisionID,
                                updatedAt: Date.now(),
                                deleted: true,
                            }],
                        }, () => {
                            revisions.splice(index, 1);
                            item.remove();
                        });
                    }, undefined, true);
                }
            });
        });
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

const renderManagedCard = (result: IFlashcardSearchResult, reviewSetID = "",
    selectedCardIDs: ReadonlySet<string> = new Set(), flagDefinitions: IFlashcardFlagDefinition[] = []) => {
    const buried = (result.reviewState.buriedUntil || 0) > Date.now();
    return `<li class="b3-list-item b3-list-item--narrow" data-id="${escapeAttr(result.card.id)}" data-flag="${result.card.flag}">
<input data-type="selectCard" class="b3-list-item__graphic" type="checkbox"${selectedCardIDs.has(result.card.id) ? " checked" : ""}>
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
<span data-type="flag" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.cardStatus} - ${escapeAttr(flashcardFlagLabel(result.card.flag, flagDefinitions))}"${flashcardFlagStyle(result.card.flag)}><svg><use xlink:href="#iconBookmark"></use></svg></span>
<span data-type="history" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.dataHistory}"><svg><use xlink:href="#iconHistory"></use></svg></span>
${reviewSetID ? `<span data-type="exclude" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconClose"></use></svg></span>` : `<span data-type="membership" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardReviewSet}"><svg><use xlink:href="#iconDatabase"></use></svg></span>`}
<span data-type="reset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.reset}"><svg><use xlink:href="#iconUndo"></use></svg></span>
</li>`;
};

const renderManagedCards = (cards: IFlashcardSearchResult[], grouped: boolean, reviewSetID = "",
    selectedCardIDs: ReadonlySet<string> = new Set(), flagDefinitions: IFlashcardFlagDefinition[] = []) => {
    if (!grouped) {
        return cards.map((card) => renderManagedCard(card, reviewSetID, selectedCardIDs, flagDefinitions)).join("");
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
</li>${sourceCards.map((card) => renderManagedCard(card, reviewSetID, selectedCardIDs, flagDefinitions)).join("")}`).join("");
};

const setFlashcardV2ReviewSetMembership = (reviewSetID: string, cardIDs: string | string[],
    mode: "include" | "exclude" | "automatic", callback: () => void) => {
    fetchPost("/api/flashcard/setReviewSetMemberships", {
        operationID: genUUID(),
        reviewSetID,
        cardIDs: typeof cardIDs === "string" ? [cardIDs] : cardIDs,
        mode,
        changedAt: Date.now(),
    }, callback);
};

const openFlashcardV2Membership = (cardIDs: string | string[], callback: () => void) => {
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
<div class="fn__hr"></div><select data-type="mode" class="b3-select fn__block"><option value="include">${window.siyuan.languages.new}</option><option value="exclude">${window.siyuan.languages.remove}</option><option value="automatic">${window.siyuan.languages.default}</option></select>
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
        });
        const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            const reviewSetID = (dialog.element.querySelector('[data-type="reviewSet"]') as HTMLSelectElement).value;
            const mode = (dialog.element.querySelector('[data-type="mode"]') as HTMLSelectElement).value as
                "include" | "exclude" | "automatic";
            setFlashcardV2ReviewSetMembership(reviewSetID, cardIDs, mode, () => {
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

const openFlashcardV2BatchDue = (cardIDs: string[], callback: () => void) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.setDueTime,
        width: isMobile() ? "92vw" : "420px",
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" type="datetime-local" value="${flashcardV2LocalDateTime(Date.now())}"></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
    });
    const input = dialog.element.querySelector("input") as HTMLInputElement;
    const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-button");
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", () => {
        const due = new Date(input.value).getTime();
        if (!Number.isFinite(due)) {
            input.focus();
            return;
        }
        fetchPost("/api/flashcard/manageCards", {
            operationID: genUUID(),
            cardIDs,
            action: "setDue",
            changedAt: Date.now(),
            due,
        }, () => {
            dialog.destroy();
            callback();
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
        .map((tag) => `<div class="b3-list-item b3-list-item--narrow" data-id="${escapeAttr(tag.id)}">
<span class="b3-list-item__text">${escapeHtml(flashcardTagPath(tag, byID))}</span>
<input class="b3-switch" type="checkbox" value="${escapeAttr(tag.id)}"${selected.has(tag.id) ? " checked" : ""}>
<span data-type="editTag" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.edit}"><svg><use xlink:href="#iconEdit"></use></svg></span>
</div>`).join("");
};

const flashcardTagDescendants = (tagID: string, tags: IFlashcardTag[]) => {
    const descendants = new Set([tagID]);
    let changed = true;
    while (changed) {
        changed = false;
        tags.forEach((tag) => {
            if (!descendants.has(tag.id) && descendants.has(tag.parentID)) {
                descendants.add(tag.id);
                changed = true;
            }
        });
    }
    return descendants;
};

const flashcardTagParentOptions = (tags: IFlashcardTag[], excluded: ReadonlySet<string> = new Set()) => {
    const byID = new Map(tags.map((tag) => [tag.id, tag]));
    return `<option value="">${window.siyuan.languages.all}</option>${[...tags]
        .filter((tag) => !excluded.has(tag.id))
        .sort((left, right) => flashcardTagPath(left, byID).localeCompare(flashcardTagPath(right, byID)))
        .map((tag) => `<option value="${escapeAttr(tag.id)}">${escapeHtml(flashcardTagPath(tag, byID))}</option>`)
        .join("")}`;
};

const openFlashcardV2TagEditor = (revision: IFlashcardEntityRevision<IFlashcardTag>, tags: IFlashcardTag[],
    callback: (saved: IFlashcardEntityRevision<IFlashcardTag>) => void) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        width: isMobile() ? "92vw" : "460px",
        content: `<div class="b3-dialog__content">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.name}</div><input data-type="name" class="b3-text-field fn__block" value="${escapeAttr(revision.payload.name)}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.move}</div><select data-type="parent" class="b3-select fn__block">${flashcardTagParentOptions(tags, flashcardTagDescendants(revision.entityID, tags))}</select></label>
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
    });
    const parent = dialog.element.querySelector('[data-type="parent"]') as HTMLSelectElement;
    parent.value = revision.payload.parentID || "";
    const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", () => {
        const name = (dialog.element.querySelector('[data-type="name"]') as HTMLInputElement).value.trim();
        if (!name) {
            return;
        }
        fetchPost("/api/flashcard/saveTag", {
            operationID: genUUID(),
            tagID: revision.entityID,
            parentID: parent.value,
            name,
            expectedRevisionID: revision.revisionID,
            updatedAt: Date.now(),
        }, (response) => {
            callback(response.data as IFlashcardEntityRevision<IFlashcardTag>);
            dialog.destroy();
        });
    });
};

const openFlashcardV2Tags = (targetType: "source" | "card", targetID: string | string[], selectedTagIDs: string[],
    callback: (tagIDs: string[]) => void) => {
    fetchPost("/api/flashcard/listEntities", {
        entityType: "tag",
        options: {limit: 1000, offset: 0},
    }, (response) => {
        const revisions = response.data.entities as Array<IFlashcardEntityRevision<IFlashcardTag>>;
        const tags = revisions.map((revision) => revision.payload);
        const selected = new Set(selectedTagIDs);
        const dialog = new Dialog({
            title: window.siyuan.languages.tag,
            width: isMobile() ? "92vw" : "520px",
            height: "70vh",
            content: `<div class="b3-dialog__content fn__flex-column" style="box-sizing:border-box;height:100%">
<div class="fn__flex"><input class="b3-text-field fn__flex-1" placeholder="${window.siyuan.languages.newTag}"><span class="fn__space"></span>
<button data-type="createTag" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}</button></div>
<div class="fn__hr"></div><label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.move}</div><select data-type="createTagParent" class="b3-select fn__block">${flashcardTagParentOptions(tags)}</select></label>
<div class="fn__hr"></div><div data-tag-list class="b3-list b3-list--background fn__flex-1" style="overflow:auto">${renderFlashcardTagChoices(tags, selected)}</div></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        });
        const refreshTags = () => {
            dialog.element.querySelector("[data-tag-list]").innerHTML = renderFlashcardTagChoices(tags, selected);
            const parent = dialog.element.querySelector('[data-type="createTagParent"]') as HTMLSelectElement;
            const parentID = parent.value;
            parent.innerHTML = flashcardTagParentOptions(tags);
            parent.value = tags.some((tag) => tag.id === parentID) ? parentID : "";
        };
        dialog.element.querySelector("[data-tag-list]").addEventListener("change", (event) => {
            const input = event.target as HTMLInputElement;
            if (input.type !== "checkbox") {
                return;
            }
            if (input.checked) {
                selected.add(input.value);
            } else {
                selected.delete(input.value);
            }
        });
        dialog.element.querySelector("[data-tag-list]").addEventListener("click", (event) => {
            const target = (event.target as HTMLElement).closest('[data-type="editTag"]');
            const item = (event.target as HTMLElement).closest<HTMLElement>("[data-id]");
            if (!target || !item) {
                return;
            }
            const index = revisions.findIndex((revision) => revision.entityID === item.dataset.id);
            if (index < 0) {
                return;
            }
            openFlashcardV2TagEditor(revisions[index], tags, (saved) => {
                revisions[index] = saved;
                const tagIndex = tags.findIndex((tag) => tag.id === saved.entityID);
                tags[tagIndex] = saved.payload;
                refreshTags();
            });
        });
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
                parentID: (dialog.element.querySelector('[data-type="createTagParent"]') as HTMLSelectElement).value,
                name,
                updatedAt: Date.now(),
            }, (saveResponse) => {
                const revision = saveResponse.data as IFlashcardEntityRevision<IFlashcardTag>;
                revisions.push(revision);
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
                targetIDs: Array.isArray(targetID) ? targetID : [targetID],
                tagIDs,
                changedAt: Date.now(),
            }, () => {
                callback(tagIDs);
                dialog.destroy();
            });
        });
    });
};

const openFlashcardV2FlagDefinitions = (
    revisions: Array<IFlashcardEntityRevision<IFlashcardFlagDefinition>>, callback: () => void) => {
    const byFlag = new Map(revisions.map((revision) => [revision.payload.flag, revision]));
    const dialog = new Dialog({
        title: window.siyuan.languages.cardStatus,
        width: isMobile() ? "92vw" : "480px",
        content: `<div class="b3-dialog__content">${Array.from({length: 7}, (_, index) => {
            const flag = index + 1;
            return `<label class="b3-label"><div class="b3-label__text"${flashcardFlagStyle(flag)}>● ${flag}</div><input data-flag="${flag}" class="b3-text-field fn__block" maxlength="100" value="${escapeAttr(byFlag.get(flag)?.payload.name || "")}"></label>`;
        }).join("")}</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
    });
    const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", () => {
        const updatedAt = Date.now();
        const mutations: Array<Record<string, unknown>> = [];
        dialog.element.querySelectorAll<HTMLInputElement>("[data-flag]").forEach((input) => {
            const flag = Number(input.dataset.flag);
            const name = input.value.trim();
            const current = byFlag.get(flag);
            if (name === (current?.payload.name || "")) {
                return;
            }
            const entityID = `flag-definition-${flag}`;
            mutations.push({
                entityType: "flagDefinition",
                entityID,
                expectedRevisionID: current?.revisionID,
                requireAbsent: !current,
                updatedAt,
                deleted: name === "",
                payload: name === "" ? undefined : {id: entityID, flag, name},
            });
        });
        if (mutations.length === 0) {
            dialog.destroy();
            return;
        }
        fetchPost("/api/flashcard/mutateEntities", {operationID: genUUID(), mutations}, () => {
            dialog.destroy();
            callback();
        });
    });
};

const openFlashcardV2ManagementFilter = (filters: IFlashcardManagementFilters,
    options: IFlashcardManagementOptions, callback: (next: IFlashcardManagementFilters) => void) => {
    const notebooks = window.siyuan.notebooks.filter((notebook) => !notebook.closed && !notebook.encrypted);
    const tagMap = new Map(options.tags.map((tag) => [tag.id, tag]));
    const priorities = ["exam", "learning", "retaining", "paused"]
        .map((priority) => `<option value="${priority}">${escapeHtml(priorityLabel(priority))}</option>`).join("");
    const flagDefinitions = options.flagDefinitions.map((revision) => revision.payload);
    const flagOptions = Array.from({length: 8}, (_, flag) =>
        `<option value="${flag}"${flashcardFlagStyle(flag)}>${escapeHtml(flashcardFlagLabel(flag, flagDefinitions))}</option>`).join("");
    const booleanOptions = `<option value="">${window.siyuan.languages.all}</option><option value="true">${window.siyuan.languages.enable}</option><option value="false">${window.siyuan.languages.disable}</option>`;
    const sourceTypeLabels: Record<string, string> = {
        block: window.siyuan.languages.riffCard,
        "multi-block": window.siyuan.languages.riffCard,
        qa: window.siyuan.languages.riffCard,
        cloze: window.siyuan.languages.flashcardClozeCards,
        ordered: window.siyuan.languages.flashcardOrderedCards,
        "image-occlusion": window.siyuan.languages.flashcardImageOcclusion,
        choice: window.siyuan.languages.flashcardChoiceQuestion,
        "multi-line": window.siyuan.languages.flashcardMultiLineAll,
        "typed-answer": window.siyuan.languages.flashcardTypedAnswer,
        anki: "Anki",
        "av-row": window.siyuan.languages.database,
    };
    listFlashcardV2PluginTypes().forEach((plugin) => {
        sourceTypeLabels[plugin.sourceType] = plugin.registration.displayName || plugin.registration.typeName;
    });
    const sourceTypeOptions = Object.entries(sourceTypeLabels)
        .map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`).join("");
    const generationOptions = `<option value="">${window.siyuan.languages.all}</option><option value="active">${window.siyuan.languages.enable}</option><option value="disabledByTemplate">${window.siyuan.languages.flashcardDirectionClosed}</option><option value="orphaned">${window.siyuan.languages.invalid}</option><option value="deleted">${window.siyuan.languages.delete}</option>`;
    const reviewStateOptions = `<option value="">${window.siyuan.languages.all}</option><option value="new">${window.siyuan.languages.flashcardNewCard}</option><option value="learning">${window.siyuan.languages.flashcardPriorityLearning}</option><option value="review">${window.siyuan.languages.flashcardReviewCard}</option><option value="relearning">${window.siyuan.languages.flashcardPriorityLearning} - ${window.siyuan.languages.flashcardReviewCard}</option>`;
    const dialog = new Dialog({
        title: window.siyuan.languages.filter,
        width: isMobile() ? "92vw" : "620px",
        height: "70vh",
        content: `<div class="b3-dialog__content" style="box-sizing:border-box;height:100%;overflow:auto">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.search}</div><input data-filter="content" class="b3-text-field fn__block" value="${escapeAttr(filters.content || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.targetNotebook}</div><select data-filter="notebookID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${notebooks.map((notebook) => `<option value="${escapeAttr(notebook.id)}">${escapeHtml(notebook.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.copyPath}</div><input data-filter="path" class="b3-text-field fn__block" placeholder="/" value="${escapeAttr(filters.path || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.type}</div><select data-filter="sourceType" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${sourceTypeOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.template}</div><select data-filter="templateID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${options.templates.map((template) => `<option value="${escapeAttr(template.id)}">${escapeHtml(template.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.tag}</div><select data-filter="tagID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${options.tags.map((tag) => `<option value="${escapeAttr(tag.id)}">${escapeHtml(flashcardTagPath(tag, tagMap))}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.cardStatus}</div><select data-filter="flag" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${flagOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardGenerationStatus}</div><select data-filter="generationStatus" class="b3-select fn__block">${generationOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardReviewState}</div><select data-filter="reviewState" class="b3-select fn__block">${reviewStateOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardSuspendCard}</div><select data-filter="suspended" class="b3-select fn__block">${booleanOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardBury}</div><select data-filter="buried" class="b3-select fn__block">${booleanOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardPriority}</div><select data-filter="priority" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${priorities}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardPreset}</div><select data-filter="presetID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${options.presets.map((preset) => `<option value="${escapeAttr(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.setDueTime} ≥</div><input data-filter="dueFrom" class="b3-text-field fn__block" type="datetime-local" value="${escapeAttr(filters.dueFrom || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.setDueTime} ≤</div><input data-filter="dueTo" class="b3-text-field fn__block" type="datetime-local" value="${escapeAttr(filters.dueTo || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardReviews} ≥</div><input data-filter="repsFrom" class="b3-text-field fn__block" type="number" min="0" value="${escapeAttr(filters.repsFrom || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardReviews} ≤</div><input data-filter="repsTo" class="b3-text-field fn__block" type="number" min="0" value="${escapeAttr(filters.repsTo || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardLapses} ≥</div><input data-filter="lapsesFrom" class="b3-text-field fn__block" type="number" min="0" value="${escapeAttr(filters.lapsesFrom || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardLapses} ≤</div><input data-filter="lapsesTo" class="b3-text-field fn__block" type="number" min="0" value="${escapeAttr(filters.lapsesTo || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardStability} ≥</div><input data-filter="stabilityFrom" class="b3-text-field fn__block" type="number" min="0" step="any" value="${escapeAttr(filters.stabilityFrom || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardStability} ≤</div><input data-filter="stabilityTo" class="b3-text-field fn__block" type="number" min="0" step="any" value="${escapeAttr(filters.stabilityTo || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardDifficulty} ≥</div><input data-filter="difficultyFrom" class="b3-text-field fn__block" type="number" min="0" step="any" value="${escapeAttr(filters.difficultyFrom || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardDifficulty} ≤</div><input data-filter="difficultyTo" class="b3-text-field fn__block" type="number" min="0" step="any" value="${escapeAttr(filters.difficultyTo || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardRetrievability} ≥</div><input data-filter="retrievabilityFrom" class="b3-text-field fn__block" type="number" min="0" max="1" step="any" value="${escapeAttr(filters.retrievabilityFrom || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardRetrievability} ≤</div><input data-filter="retrievabilityTo" class="b3-text-field fn__block" type="number" min="0" max="1" step="any" value="${escapeAttr(filters.retrievabilityTo || "")}"></label>
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button data-type="clear" class="b3-button b3-button--outline">${window.siyuan.languages.removeFilters}</button><button data-type="confirm" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
    });
    const elements = [...dialog.element.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-filter]")];
    elements.forEach((element) => {
        element.value = filters[element.dataset.filter as keyof IFlashcardManagementFilters] || "";
    });
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector('[data-type="clear"]').addEventListener("click", () => {
        callback({});
        dialog.destroy();
    });
    dialog.element.querySelector('[data-type="confirm"]').addEventListener("click", () => {
        const next: IFlashcardManagementFilters = {};
        elements.forEach((element) => {
            const value = element.value.trim();
            if (value !== "") {
                next[element.dataset.filter as keyof IFlashcardManagementFilters] = value;
            }
        });
        callback(next);
        dialog.destroy();
    });
};

const flashcardV2ManagementPageSize = 200;

const openFlashcardV2ReviewSetCards = (reviewSetID: string, name: string, offset = 0,
    filters: IFlashcardManagementFilters = {}, managementOptions?: IFlashcardManagementOptions, grouped = true) => {
    if (!managementOptions) {
        fetchPost("/api/flashcard/listEntities", {
            entityType: "tag",
            options: {limit: 1000, offset: 0},
        }, (tagResponse) => {
            fetchPost("/api/flashcard/listEntities", {
                entityType: "schedulerPreset",
                options: {limit: 1000, offset: 0},
            }, (presetResponse) => {
                fetchPost("/api/flashcard/listEntities", {
                    entityType: "cardTemplate",
                    options: {limit: 1000, offset: 0},
                }, (templateResponse) => {
                    fetchPost("/api/flashcard/listEntities", {
                        entityType: "flagDefinition",
                        options: {limit: 7, offset: 0},
                    }, (flagResponse) => {
                        openFlashcardV2ReviewSetCards(reviewSetID, name, offset, filters, {
                            tags: (tagResponse.data.entities as Array<IFlashcardEntityRevision<IFlashcardTag>>)
                                .map((item) => item.payload),
                            presets: (presetResponse.data.entities as
                                Array<IFlashcardEntityRevision<IFlashcardPreset>>).map((item) => item.payload),
                            templates: (templateResponse.data.entities as
                                Array<IFlashcardEntityRevision<IFlashcardTemplate>>).map((item) => item.payload),
                            flagDefinitions: flagResponse.data.entities as
                                Array<IFlashcardEntityRevision<IFlashcardFlagDefinition>>,
                        }, grouped);
                    });
                });
            });
        });
        return;
    }
    const now = Date.now();
    const managementQuery = flashcardManagementQuery(filters);
    const filterCount = flashcardManagementFilterCount(filters);
    const queryCards = (cardIDs?: string[], total?: number, resolvedCards?: IFlashcardSearchResult[]) => {
        const renderCards = (fetchedCards: IFlashcardSearchResult[]) => {
            if (fetchedCards.length === 0 && offset > 0) {
                openFlashcardV2ReviewSetCards(reviewSetID, name,
                    Math.max(0, offset - flashcardV2ManagementPageSize), filters, managementOptions, grouped);
                return;
            }
            const fetchedSourceIDs = [...new Set(fetchedCards.map((card) => card.card.sourceID))];
            const visibleSourceIDs = new Set(fetchedSourceIDs.slice(0, flashcardV2ManagementPageSize));
            const cards = grouped ? fetchedCards.filter((card) => visibleSourceIDs.has(card.card.sourceID)) :
                fetchedCards.slice(0, flashcardV2ManagementPageSize);
            const pageLength = grouped ? visibleSourceIDs.size : cards.length;
            const hasNext = total === undefined ? grouped ?
                fetchedSourceIDs.length > flashcardV2ManagementPageSize :
                fetchedCards.length > flashcardV2ManagementPageSize :
                offset + pageLength < total;
            const selectedCardIDs = new Set<string>();
            const flagDefinitions = managementOptions.flagDefinitions.map((revision) => revision.payload);
            const batchFlagOptions = Array.from({length: 8}, (_, flag) =>
                `<option value="setFlag:${flag}"${flashcardFlagStyle(flag)}>${window.siyuan.languages.cardStatus} - ${escapeHtml(flashcardFlagLabel(flag, flagDefinitions))}</option>`).join("");
            const batchPresetOptions = `<option value="setPreset:">${window.siyuan.languages.flashcardPreset} - ${window.siyuan.languages.default}</option>${managementOptions.presets.map((preset) => `<option value="${escapeAttr(`setPreset:${preset.id}`)}">${window.siyuan.languages.flashcardPreset} - ${escapeHtml(preset.name)}</option>`).join("")}`;
            const batchPriorityOptions = ["", "exam", "learning", "retaining", "paused"]
                .map((priority) => `<option value="setPriority:${priority}">${window.siyuan.languages.flashcardPriority} - ${escapeHtml(priority === "" ? window.siyuan.languages.default : priorityLabel(priority))}</option>`).join("");
            const dialog = new Dialog({
                title: name,
                width: isMobile() ? "92vw" : "760px",
                height: "70vh",
                content: `<div class="b3-dialog__content fn__flex-column" style="box-sizing:border-box;height:100%">
<div class="fn__flex"><button data-type="pagePrevious" class="b3-button b3-button--outline"${offset === 0 ? " disabled" : ""}>${window.siyuan.languages.previous}</button><span class="fn__space"></span>
<span class="b3-list-item__meta fn__flex-1">${pageLength === 0 ? 0 : offset + 1} - ${offset + pageLength}${total === undefined ? "" : ` / ${total}`}</span>
<button data-type="pageNext" class="b3-button b3-button--outline"${hasNext ? "" : " disabled"}>${window.siyuan.languages.next}</button><span class="fn__space"></span>
<button data-type="filter" class="b3-button b3-button--outline"><svg><use xlink:href="#iconFilter"></use></svg>${window.siyuan.languages.filter}${filterCount === 0 ? "" : ` (${filterCount})`}</button><span class="fn__space"></span>
<button data-type="statistics" class="b3-button b3-button--outline"><svg><use xlink:href="#iconGraph"></use></svg>${window.siyuan.languages.flashcardStatistics}</button><span class="fn__space"></span>
${reviewSetID === "" ? `<button data-type="saveReviewSet" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.flashcardReviewSet}</button><span class="fn__space"></span>` : ""}
<button data-type="flagDefinitions" class="b3-button b3-button--outline"><svg><use xlink:href="#iconBookmark"></use></svg>${window.siyuan.languages.cardStatus}</button><span class="fn__space"></span>
<button data-type="group" class="b3-button b3-button--outline"><svg><use xlink:href="#iconList"></use></svg>${window.siyuan.languages.group}</button></div>
<div class="fn__hr"></div><div class="fn__flex fn__flex-center" style="flex-wrap:wrap">
<label class="fn__flex-center"><input data-type="selectPage" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.selectAll}</label><span class="fn__space"></span>
<span data-type="selectedCount" class="b3-list-item__meta fn__flex-1">${window.siyuan.languages.selected} 0</span>
<select data-type="batchAction" class="b3-select"><option value="">${window.siyuan.languages.manage}</option><option value="tags">${window.siyuan.languages.tag}</option><option value="membership">${reviewSetID ? window.siyuan.languages.remove : window.siyuan.languages.flashcardReviewSet}</option><option value="setDue">${window.siyuan.languages.setDueTime}</option><option value="suspend">${window.siyuan.languages.flashcardSuspendCard}</option><option value="resume">${window.siyuan.languages.continueReview1}</option><option value="bury">${window.siyuan.languages.flashcardBury}</option><option value="unbury">${window.siyuan.languages.flashcardUnbury}</option><option value="reset">${window.siyuan.languages.reset}</option>${batchFlagOptions}${batchPresetOptions}${batchPriorityOptions}</select><span class="fn__space"></span>
<button data-type="batchApply" class="b3-button b3-button--text" disabled>${window.siyuan.languages.confirm}</button></div>
<div class="fn__hr"></div><ul class="b3-list b3-list--background fn__flex-1">${cards.length === 0 ? `<li class="b3-list-item card__empty">${window.siyuan.languages.emptyContent}</li>` : renderManagedCards(cards, grouped, reviewSetID, selectedCardIDs, flagDefinitions)}</ul></div>`,
            });
            const refreshSelection = () => {
                const selectPage = dialog.element.querySelector('[data-type="selectPage"]') as HTMLInputElement;
                const selectedCount = dialog.element.querySelector('[data-type="selectedCount"]');
                const batchAction = dialog.element.querySelector('[data-type="batchAction"]') as HTMLSelectElement;
                const batchApply = dialog.element.querySelector('[data-type="batchApply"]') as HTMLButtonElement;
                const selectedOnPage = cards.filter((card) => selectedCardIDs.has(card.card.id)).length;
                selectPage.checked = cards.length > 0 && selectedOnPage === cards.length;
                selectPage.indeterminate = selectedOnPage > 0 && selectedOnPage < cards.length;
                selectedCount.textContent = `${window.siyuan.languages.selected} ${selectedOnPage}`;
                batchApply.disabled = selectedOnPage === 0 || batchAction.value === "";
            };
            const refreshList = () => {
                dialog.element.querySelector(".b3-list").innerHTML = renderManagedCards(cards, grouped, reviewSetID,
                    selectedCardIDs, flagDefinitions);
                refreshSelection();
            };
            const reloadPage = () => {
                dialog.destroy();
                openFlashcardV2ReviewSetCards(reviewSetID, name, offset, filters, managementOptions, grouped);
            };
            dialog.element.addEventListener("change", (event) => {
                if ((event.target as HTMLElement).dataset.type === "batchAction") {
                    refreshSelection();
                }
            });
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
                    openFlashcardV2ReviewSetCards(reviewSetID, name, nextOffset, filters, managementOptions, grouped);
                    return;
                }
                if (type === "filter") {
                    openFlashcardV2ManagementFilter(filters, managementOptions, (nextFilters) => {
                        dialog.destroy();
                        openFlashcardV2ReviewSetCards(reviewSetID, name, 0, nextFilters, managementOptions, grouped);
                    });
                    return;
                }
                if (type === "statistics") {
                    openFlashcardV2Statistics(reviewSetID, managementQuery);
                    return;
                }
                if (type === "saveReviewSet") {
                    openFlashcardV2ReviewSetEditor(undefined, () => undefined, "", managementQuery || {
                        version: 1,
                        root: {operator: "matchAll"},
                    });
                    return;
                }
                if (type === "flagDefinitions") {
                    openFlashcardV2FlagDefinitions(managementOptions.flagDefinitions, reloadPage);
                    return;
                }
                if (type === "group") {
                    dialog.destroy();
                    openFlashcardV2ReviewSetCards(reviewSetID, name, 0, filters, managementOptions, !grouped);
                    return;
                }
                if (type === "selectPage") {
                    cards.forEach((card) => {
                        if ((target as HTMLInputElement).checked) {
                            selectedCardIDs.add(card.card.id);
                        } else {
                            selectedCardIDs.delete(card.card.id);
                        }
                    });
                    refreshList();
                    return;
                }
                if (type === "batchApply") {
                    const actionElement = dialog.element.querySelector('[data-type="batchAction"]') as HTMLSelectElement;
                    const [action, flagValue] = actionElement.value.split(":");
                    const selectedCards = cards.filter((card) => selectedCardIDs.has(card.card.id));
                    const selected = selectedCards.map((card) => card.card.id);
                    if (action === "" || selected.length === 0) {
                        return;
                    }
                    if (action === "tags") {
                        const commonTags = selectedCards.slice(1).reduce((common, card) =>
                            common.filter((tagID) => card.cardTagIDs.includes(tagID)),
                        [...(selectedCards[0].cardTagIDs || [])]);
                        openFlashcardV2Tags("card", selected, commonTags, reloadPage);
                        return;
                    }
                    if (action === "setDue") {
                        openFlashcardV2BatchDue(selected, reloadPage);
                        return;
                    }
                    if (action === "membership") {
                        if (reviewSetID) {
                            setFlashcardV2ReviewSetMembership(reviewSetID, selected, "exclude", reloadPage);
                        } else {
                            openFlashcardV2Membership(selected, reloadPage);
                        }
                        return;
                    }
                    const request: Record<string, unknown> = {};
                    if (action === "bury") {
                        const tomorrow = new Date();
                        tomorrow.setHours(24, 0, 0, 0);
                        request.buriedUntil = tomorrow.getTime();
                        request.reason = "user";
                    } else if (action === "setFlag") {
                        request.flag = Number(flagValue);
                    } else if (action === "setPreset") {
                        request.presetID = flagValue;
                    } else if (action === "setPriority") {
                        request.priority = flagValue;
                    }
                    const execute = () => fetchPost("/api/flashcard/manageCards", {
                        operationID: genUUID(),
                        cardIDs: selected,
                        action,
                        changedAt: Date.now(),
                        ...request,
                    }, reloadPage);
                    if (action === "reset") {
                        confirmDialog(window.siyuan.languages.reset,
                            window.siyuan.languages.resetCardTip.replace("${x}", selected.length.toString()), execute);
                    } else {
                        execute();
                    }
                    return;
                }
                if (!item) {
                    return;
                }
                if (type === "selectCard") {
                    if ((target as HTMLInputElement).checked) {
                        selectedCardIDs.add(item.dataset.id);
                    } else {
                        selectedCardIDs.delete(item.dataset.id);
                    }
                    refreshSelection();
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
                            reloadPage();
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
                            reloadPage();
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
                        openFlashcardV2ReviewSetCards(reviewSetID, name, nextOffset, filters, managementOptions,
                            grouped);
                    });
                    return;
                }
                if (type === "membership" && item.dataset.id) {
                    openFlashcardV2Membership(item.dataset.id, reloadPage);
                    return;
                }
                if (type === "direction") {
                    const card = cards.find((result) => result.card.id === item.dataset.id);
                    if (card) {
                        openFlashcardV2Direction(card.card.sourceID,
                            cards.filter((result) => result.card.sourceID === card.card.sourceID), reloadPage);
                    }
                    return;
                }
                const selectedCard = cards.find((result) => result.card.id === item.dataset.id);
                if (type === "tags" && selectedCard) {
                    openFlashcardV2Tags("card", selectedCard.card.id, selectedCard.cardTagIDs || [], (tagIDs) => {
                        selectedCard.cardTagIDs = tagIDs;
                        refreshEffectiveCardValues(selectedCard);
                        reloadPage();
                    });
                    return;
                }
                if ((type === "preset" || type === "priority") && selectedCard) {
                    openFlashcardV2CardSetting(selectedCard, type, reloadPage);
                    return;
                }
                if (type === "due" && selectedCard) {
                    openFlashcardV2Due(selectedCard, reloadPage);
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
                        reloadPage();
                    }
                });
            });
            refreshSelection();
        };
        if (resolvedCards) {
            renderCards(resolvedCards);
            return;
        }
        fetchPost("/api/flashcard/queryCards", {
            query: cardIDs ? {
                version: 1,
                root: cardIDs.length === 0 ?
                    {operator: "predicate", field: "cardID", comparator: "equal", value: "__empty__"} :
                    {operator: "predicate", field: "cardID", comparator: "in", value: cardIDs},
            } : managementQuery,
            options: {
                now,
                includeInactive: true,
                includeSuspended: true,
                includeBuried: true,
                includePaused: true,
                includeConflicts: true,
                groupBySource: cardIDs ? false : grouped,
                limit: cardIDs ? Math.max(1, cardIDs.length) : flashcardV2ManagementPageSize + 1,
                offset: cardIDs ? 0 : offset,
            },
        }, (queryResponse) => renderCards(queryResponse.data.cards as IFlashcardSearchResult[]));
    };
    if (reviewSetID === "") {
        queryCards();
        return;
    }
    fetchPost("/api/flashcard/previewReviewSet", {
        reviewSetID,
        query: managementQuery,
        options: {
            now,
            includeInactive: true,
            includeSuspended: true,
            includeBuried: true,
            includePaused: true,
            includeConflicts: true,
            groupBySource: grouped,
            returnCards: true,
            limit: flashcardV2ManagementPageSize + 1,
            offset,
        },
    }, (previewResponse) => {
        queryCards(previewResponse.data.cardIDs as string[], previewResponse.data.total as number,
            previewResponse.data.cards as IFlashcardSearchResult[]);
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
            const summaries: Record<string, IFlashcardReviewSetSummary> = {};
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
<ul class="b3-list b3-list--background fn__flex-1">${revisions.map((revision) => renderReviewSet(revision)).join("")}</ul>
</div>`,
            });
            const refreshReviewSet = (revision: IFlashcardEntityRevision<IReviewSet>) => {
                const item = [...dialog.element.querySelectorAll<HTMLElement>(".b3-list-item")]
                    .find((element) => element.dataset.id === revision.entityID);
                if (item) {
                    item.outerHTML = renderReviewSet(revision, summaries[revision.entityID]);
                }
            };
            const refreshReviewSetSummary = (revision: IFlashcardEntityRevision<IReviewSet>) => {
                loadFlashcardV2ReviewSetSummaries([revision.entityID], (loaded) => {
                    Object.assign(summaries, loaded);
                    refreshReviewSet(revision);
                });
            };
            dialog.element.addEventListener("click", (event) => {
                let target = event.target as HTMLElement;
                while (target && target !== dialog.element) {
                    const type = target.getAttribute("data-type");
                    if (type === "create") {
                        const input = dialog.element.querySelector("input") as HTMLInputElement;
                        const initialName = input.value.trim();
                        openFlashcardV2ReviewSetEditor(undefined, (saved) => {
                            revisions.unshift(saved);
                            dialog.element.querySelector(".b3-list").insertAdjacentHTML("afterbegin",
                                renderReviewSet(saved));
                            input.value = "";
                            refreshReviewSetSummary(saved);
                        }, initialName);
                        return;
                    }
                    const item = target.closest(".b3-list-item") as HTMLElement;
                    if (type === "edit" && item) {
                        const index = revisions.findIndex((entry) => entry.entityID === item.dataset.id);
                        if (index >= 0) {
                            openFlashcardV2ReviewSetEditor(revisions[index], (saved) => {
                                revisions[index] = saved;
                                item.outerHTML = renderReviewSet(saved, summaries[saved.entityID]);
                                refreshReviewSetSummary(saved);
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
            loadFlashcardV2ReviewSetSummaries(revisions.map((revision) => revision.entityID), (loaded) => {
                Object.assign(summaries, loaded);
                revisions.forEach(refreshReviewSet);
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
                const clozeGroupOrder = blockIDs.map(() => genUUID());
                const clozeEditorHTML = `<div data-type="clozeEditor">
<div class="fn__hr"></div>
${blockIDs.map((blockID, blockIndex) => `<label class="b3-label"><div class="b3-label__text">${escapeHtml(flashcardV2BlockText(blockID, doms[blockID] || ""))}</div><select data-type="clozeGroups" data-block-index="${blockIndex}" class="b3-select fn__block" multiple size="${Math.min(6, Math.max(2, blockIDs.length))}">${clozeGroupOrder.map((groupID, groupIndex) => `<option value="${escapeAttr(groupID)}"${groupIndex === blockIndex ? " selected" : ""}>${groupIndex + 1}</option>`).join("")}</select></label>`).join("")}
<button data-type="addClozeGroup" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.group}</button>
</div>`;
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
                const typedEditorHTML = blockIDs.length >= 2 ? `<div data-type="typedEditor" class="fn__none">
<div class="fn__hr"></div>
<label class="b3-label fn__flex-center"><input data-type="typedCaseSensitive" class="b3-switch fn__flex-center" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.searchCaseSensitive}</label>
<label class="b3-label fn__flex-center"><input data-type="typedMatchDiacritics" class="b3-switch fn__flex-center" type="checkbox" checked><span class="fn__space"></span>${window.siyuan.languages.matchDiacritics}</label>
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
        ${blockIDs.length >= 2 ? `<option value="typedAnswer">${window.siyuan.languages.flashcardTypedAnswer}</option>` : ""}
        ${imageSource ? `<option value="imageOcclusion">${window.siyuan.languages.flashcardImageOcclusion}</option>` : ""}
        ${blockIDs.length >= 3 ? `<option value="choiceSingle">${window.siyuan.languages.flashcardChoiceSingle}</option><option value="choiceMultiple">${window.siyuan.languages.flashcardChoiceMultiple}</option>` : ""}
        ${pluginTypes.map((item) => `<option value="${escapeAttr(item.sourceType)}">${escapeHtml(item.registration.displayName || item.registration.typeName)}</option>`).join("")}
    </select>
</label>
${clozeEditorHTML}
${imageEditorHTML}
${choiceEditorHTML}
${typedEditorHTML}
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
                const clozeElement = dialog.element.querySelector('[data-type="clozeEditor"]');
                const imageElement = dialog.element.querySelector('[data-type="imageEditor"]');
                const choiceElement = dialog.element.querySelector('[data-type="choiceEditor"]');
                const typedElement = dialog.element.querySelector('[data-type="typedEditor"]');
                const choiceInputs = [...dialog.element.querySelectorAll<HTMLInputElement>('[data-type="choiceCorrect"]')];
                const dynamicChoice = dialog.element.querySelector('[data-type="choiceDynamic"]') as HTMLInputElement;
                const dynamicChoiceCount = dialog.element.querySelector('[data-type="choiceDynamicCount"]') as HTMLInputElement;
                const clozeSelects = [...dialog.element.querySelectorAll<HTMLSelectElement>('[data-type="clozeGroups"]')];
                const updateConfirm = () => {
                    const clozeMode = modeElement.value === "cloze";
                    const imageMode = modeElement.value === "imageOcclusion";
                    const choiceMode = modeElement.value === "choiceSingle" || modeElement.value === "choiceMultiple";
                    buttons[1].disabled = clozeMode && clozeSelects.some((select) => select.selectedOptions.length === 0) ||
                        imageMode && !imageEditor?.hasShapes() ||
                        choiceMode && !choiceInputs.some((input) => input.checked);
                };
                const renderClozeGroupOptions = () => {
                    clozeSelects.forEach((select) => {
                        const selected = new Set([...select.selectedOptions].map((option) => option.value));
                        select.innerHTML = clozeGroupOrder.map((groupID, groupIndex) =>
                            `<option value="${escapeAttr(groupID)}"${selected.has(groupID) ? " selected" : ""}>${groupIndex + 1}</option>`).join("");
                    });
                    updateConfirm();
                };
                let imageEditor: IFlashcardV2ImageEditor | undefined;
                if (imageSource) {
                    imageEditor = bindFlashcardV2ImageEditor(imageElement, imageSource.assetID, updateConfirm);
                }
                modeElement.addEventListener("change", () => {
                    const clozeMode = modeElement.value === "cloze";
                    const imageMode = modeElement.value === "imageOcclusion";
                    const choiceMode = modeElement.value === "choiceSingle" || modeElement.value === "choiceMultiple";
                    clozeElement.classList.toggle("fn__none", !clozeMode);
                    imageElement?.classList.toggle("fn__none", !imageMode);
                    choiceElement?.classList.toggle("fn__none", !choiceMode);
                    typedElement?.classList.toggle("fn__none", modeElement.value !== "typedAnswer");
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
                clozeSelects.forEach((select) => select.addEventListener("change", updateConfirm));
                dialog.element.querySelector('[data-type="addClozeGroup"]').addEventListener("click", () => {
                    clozeGroupOrder.push(genUUID());
                    renderClozeGroupOptions();
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
                    const clozeGroups = mode === "cloze" ? clozeGroupOrder.map((groupID, displayOrder) => ({
                        id: groupID,
                        displayOrder,
                        blockIDs: clozeSelects.filter((select) =>
                            [...select.selectedOptions].some((option) => option.value === groupID))
                            .map((select) => blockIDs[Number(select.dataset.blockIndex)]),
                    })).filter((group) => group.blockIDs.length > 0) : undefined;
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
                        clozeGroups,
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
                        typedConfig: mode === "typedAnswer" ? {
                            caseSensitive: (dialog.element.querySelector('[data-type="typedCaseSensitive"]') as
                                HTMLInputElement).checked,
                            ignoreDiacritics: !(dialog.element.querySelector('[data-type="typedMatchDiacritics"]') as
                                HTMLInputElement).checked,
                            fuzzyMaxRatio: 0.1,
                            trimWhitespace: true,
                            collapseWhitespace: true,
                        } : undefined,
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
    return `<div class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(label)}</span><span class="b3-list-item__meta">${escapeHtml(String(value))}</span></div>`;
};

const flashcardV2StatisticsDate = (date: Date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};

const flashcardV2StatisticsBars = <T, >(values: T[], label: (value: T) => string,
    count: (value: T) => number) => {
    const maximum = Math.max(1, ...values.map(count));
    return `<div class="b3-list b3-list--background">${values.map((value) => {
        const current = count(value);
        return `<div class="b3-list-item"><span class="b3-list-item__text" style="flex:0 0 112px">${escapeHtml(label(value))}</span><span class="fn__flex-1"><span class="fn__block" style="height:8px;width:${current / maximum * 100}%;min-width:${current > 0 ? "2px" : "0"};background:var(--b3-theme-primary);border-radius:4px"></span></span><span class="b3-list-item__meta" style="min-width:48px;text-align:right">${current}</span></div>`;
    }).join("")}</div>`;
};

const flashcardV2StatisticsDistribution = (label: string, values: IFlashcardStatisticsDistribution[]) => {
    return `<div class="b3-label">${escapeHtml(label)}</div>${flashcardV2StatisticsBars(values,
        (value) => value.label, (value) => value.count)}`;
};

const renderFlashcardV2Statistics = (statistics: IFlashcardStatistics) => {
    const ratings = statistics.history.ratings;
    const state = statistics.overview.reviewStates;
    const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
    const averageDuration = statistics.history.averageDurationMS === undefined ? "-" :
        `${(statistics.history.averageDurationMS / 1000).toFixed(1)} ${window.siyuan.languages.second}`;
    return `<div class="b3-label">${window.siyuan.languages.cardStatus}</div>
${statisticsItem(window.siyuan.languages.riffCard, statistics.overview.currentCards)}
${statisticsItem(window.siyuan.languages.flashcardNewCard, state.new || 0)}
${statisticsItem(window.siyuan.languages.flashcardReviewCard, (state.learning || 0) + (state.review || 0) + (state.relearning || 0))}
${statisticsItem(window.siyuan.languages.flashcardDueCard, statistics.overdue)}
${statisticsItem(window.siyuan.languages.flashcardSuspendedCards, statistics.overview.suspended)}
${statisticsItem(window.siyuan.languages.flashcardBuriedCards, statistics.overview.buried)}
${statisticsItem(window.siyuan.languages.flashcardLeeches, statistics.overview.leeches)}
<div class="fn__hr"></div>
<div class="b3-label">${window.siyuan.languages.flashcardReviewHistory}</div>
${statisticsItem(window.siyuan.languages.total, statistics.history.reviews)}
${statisticsItem(window.siyuan.languages.flashcardReviewedCards, statistics.history.uniqueCards)}
${statisticsItem(window.siyuan.languages.flashcardAccuracy, percent(statistics.history.accuracy))}
${statisticsItem(window.siyuan.languages.flashcardTrueRetention, percent(statistics.history.trueRetention))}
${statisticsItem(window.siyuan.languages.flashcardAverageReviewDuration, averageDuration)}
${statisticsItem(window.siyuan.languages.cardRatingAgain, ratings.again || 0)}
${statisticsItem(window.siyuan.languages.cardRatingHard, ratings.hard || 0)}
${statisticsItem(window.siyuan.languages.cardRatingGood, ratings.good || 0)}
${statisticsItem(window.siyuan.languages.cardRatingEasy, ratings.easy || 0)}
<div class="fn__hr"></div>
${flashcardV2StatisticsBars(statistics.series, (value) => new Date(value.start).toLocaleDateString(),
        (value) => value.reviews)}
<div class="fn__hr"></div>
<div class="b3-label">${window.siyuan.languages.flashcardUpcomingReviews}</div>
${flashcardV2StatisticsBars(statistics.futureDue, (value) => new Date(value.start).toLocaleDateString(),
        (value) => value.cards)}
<div class="fn__hr"></div>
${flashcardV2StatisticsDistribution(window.siyuan.languages.flashcardInterval, statistics.intervalDistribution)}
<div class="fn__hr"></div>
${flashcardV2StatisticsDistribution(window.siyuan.languages.flashcardStability, statistics.stabilityDistribution)}
<div class="fn__hr"></div>
${flashcardV2StatisticsDistribution(window.siyuan.languages.flashcardDifficulty, statistics.difficultyDistribution)}
<div class="fn__hr"></div>
${flashcardV2StatisticsDistribution(window.siyuan.languages.flashcardRetrievability, statistics.retrievabilityDistribution)}`;
};

export const openFlashcardV2Statistics = (reviewSetID = "", query?: IFlashcardQueryAST) => {
    ensureFlashcardV2(() => {
        const now = Date.now();
        const fromDate = new Date(now - 29 * 86400000);
        const toDate = new Date(now);
        const dialog = new Dialog({
            title: window.siyuan.languages.flashcardStatistics,
            width: isMobile() ? "96vw" : "780px",
            height: "82vh",
            content: `<div class="b3-dialog__content fn__flex-column" style="box-sizing:border-box;height:100%">
<div class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardStatisticsRange}</div><div class="fn__flex">
<input data-type="statisticsFrom" class="b3-text-field fn__flex-1" type="date" value="${flashcardV2StatisticsDate(fromDate)}"><span class="fn__space"></span>
<input data-type="statisticsTo" class="b3-text-field fn__flex-1" type="date" value="${flashcardV2StatisticsDate(toDate)}"><span class="fn__space"></span>
<select data-type="statisticsBucket" class="b3-select"><option value="day">${window.siyuan.languages.day}</option><option value="week">${window.siyuan.languages.week}</option><option value="month">${window.siyuan.languages.month}</option></select><span class="fn__space"></span>
<button data-type="statisticsApply" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div></div><div class="fn__hr"></div><div data-type="statisticsContent" style="overflow:auto"></div></div>`,
        });
        const from = dialog.element.querySelector('[data-type="statisticsFrom"]') as HTMLInputElement;
        const to = dialog.element.querySelector('[data-type="statisticsTo"]') as HTMLInputElement;
        const bucket = dialog.element.querySelector('[data-type="statisticsBucket"]') as HTMLSelectElement;
        const content = dialog.element.querySelector('[data-type="statisticsContent"]');
        const apply = dialog.element.querySelector('[data-type="statisticsApply"]') as HTMLButtonElement;
        const load = () => {
            const fromTime = new Date(`${from.value}T00:00:00`).getTime();
            const toExclusive = new Date(`${to.value}T00:00:00`);
            toExclusive.setDate(toExclusive.getDate() + 1);
            const toTime = toExclusive.getTime();
            if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime <= fromTime) {
                return;
            }
            apply.disabled = true;
            fetchPost("/api/flashcard/getStatistics", {
                reviewSetID,
                query,
                from: fromTime,
                to: toTime,
                now: Date.now(),
                bucket: bucket.value,
                timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
                futureDays: 30,
            }, (response) => {
                content.innerHTML = renderFlashcardV2Statistics(response.data as IFlashcardStatistics);
                apply.disabled = false;
            }).then(() => apply.disabled = false);
        };
        apply.addEventListener("click", load);
        load();
    });
};
