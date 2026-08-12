import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
import {Menu} from "../plugin/Menu";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {escapeAttr, escapeHtml} from "../util/escape";
import {genUUID} from "../util/genID";
import {openFlashcardV2ReviewSession} from "./flashcardV2Session";
import type {App} from "../index";
import {listFlashcardV2PluginTypes} from "./flashcardV2Plugin";
import type {IFlashcardQueryAST, IFlashcardQueryExpression} from "./flashcardV2Query";

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

interface IFlashcardEntityConflict {
    entityType: string;
    entityID: string;
    selectedRevisionID: string;
    detectedAt: number;
    revisions: Array<IFlashcardEntityRevision<unknown>>;
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
    sourceStatus: "active" | "orphaned" | "deleted";
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
    blockIDs?: string[];
    rootIDs?: string[];
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

type TFlashcardManagementStringFilter = Exclude<keyof IFlashcardManagementFilters, "blockIDs" | "rootIDs">;

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

const reviewStateLabel = (state: string) => {
    const labels: Record<string, string> = {
        new: window.siyuan.languages.flashcardNewCard,
        learning: window.siyuan.languages.flashcardPriorityLearning,
        review: window.siyuan.languages.flashcardReviewCard,
        relearning: `${window.siyuan.languages.flashcardPriorityLearning} - ${window.siyuan.languages.flashcardReviewCard}`,
    };
    return labels[state] || state;
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
    return `<li class="b3-list-item b3-list-item--narrow${isMobile() ? "" : " b3-list-item--hide-action"}" data-id="${escapeAttr(revision.entityID)}" data-revision="${escapeAttr(revision.revisionID)}" data-review-mode="${escapeAttr(revision.payload.defaultReviewMode || "normal")}">
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
    if (filters.blockIDs?.length === 1) {
        add("blockID", "equal", filters.blockIDs[0]);
    } else if (filters.blockIDs && filters.blockIDs.length > 1) {
        predicates.push({
            operator: "predicate",
            field: "blockID",
            comparator: "in",
            value: filters.blockIDs,
        });
    }
    if (filters.rootIDs?.length === 1) {
        add("rootID", "equal", filters.rootIDs[0]);
    } else if (filters.rootIDs && filters.rootIDs.length > 1) {
        predicates.push({
            operator: "or",
            children: filters.rootIDs.map((rootID) => ({
                operator: "predicate",
                field: "rootID",
                comparator: "equal",
                value: rootID,
            })),
        });
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
    Object.entries(filters).filter(([key, value]) => !["blockIDs", "rootIDs"].includes(key) &&
        value !== undefined && value !== "").length;

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
            height: "82vh",
            content: `<div class="b3-dialog__content card__v2-form">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.name}</div><input data-type="name" class="b3-text-field fn__block" value="${escapeAttr(current?.name || initialName)}"></label>
<div class="card__v2-filter">
<label class="card__v2-filter-toggle">
<span class="card__v2-filter-copy"><span class="card__v2-filter-title">${window.siyuan.languages.flashcardDynamicFilter}</span><span class="card__v2-filter-tip">${window.siyuan.languages.flashcardDynamicFilterTip}</span></span>
<input data-type="queryEnabled" class="b3-switch" type="checkbox"${current?.queryAST || initialQuery ? " checked" : ""}>
</label>
<div data-type="queryFilters" class="card__v2-filter-fields">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.targetNotebook}</div><select data-filter="notebookID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${notebooks.map((notebook) => `<option value="${escapeAttr(notebook.id)}">${escapeHtml(notebook.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.copyPath}</div><input data-filter="path" class="b3-text-field fn__block" value="${escapeAttr(filters.path || "")}" placeholder="/"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.tag}</div><select data-filter="tagID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${tags.map((tag) => `<option value="${escapeAttr(tag.id)}">${escapeHtml(flashcardTagPath(tag, tagMap))}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardPriority}</div><select data-filter="priority" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${priorityOptions}</select></label>
</div>
</div>
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
        const queryFilters = dialog.element.querySelector('[data-type="queryFilters"]');
        const updateQueryEnabled = () => {
            filterElements.forEach((element) => element.disabled = !queryEnabled.checked);
            queryFilters.classList.toggle("card__v2-filter-fields--disabled", !queryEnabled.checked);
        };
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
    return `<li class="b3-list-item b3-list-item--narrow${isMobile() ? "" : " b3-list-item--hide-action"}" data-id="${escapeAttr(revision.entityID)}" data-revision="${escapeAttr(revision.revisionID)}">
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
        height: "82vh",
        content: `<div class="b3-dialog__content card__v2-form">
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
                content: `<div class="b3-dialog__content card__v2-panel">
<div class="card__v2-panel-toolbar"><span class="fn__flex-1"></span><button data-type="create" class="b3-button b3-button--text"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}</button></div>
<ul class="b3-list b3-list--background fn__flex-1 card__v2-panel-list">${revisions.map(renderFlashcardV2Preset).join("")}</ul></div>`,
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
        content: `<div class="b3-dialog__content card__v2-form">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardSessionMode}</div>
<select data-type="reviewMode" class="b3-select fn__block"><option value="normal">${window.siyuan.languages.flashcardReviewNormal}</option><option value="reinforcement">${window.siyuan.languages.flashcardReviewReinforcement}</option></select></label>
<div data-type="reinforcementOptions" class="fn__none card__v2-form-section">
<div class="card__v2-form-note">${window.siyuan.languages.flashcardReviewReinforcementTip}</div>
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
    selectedCardIDs: ReadonlySet<string> = new Set(), flagDefinitions: IFlashcardFlagDefinition[] = [],
    grouped = false) => {
    return `<li class="b3-list-item b3-list-item--narrow b3-list-item--hide-action card__v2-managed-card" data-id="${escapeAttr(result.card.id)}" data-flag="${result.card.flag}">
<input data-type="selectCard" class="b3-list-item__graphic" type="checkbox"${selectedCardIDs.has(result.card.id) ? " checked" : ""}>
<svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg>
<span class="card__v2-managed-main">
${grouped ? "" : `<span class="b3-list-item__text">${escapeHtml(result.sourceTitle || result.sourceBlockID || result.card.id)}</span>`}
<span class="card__v2-managed-details"><span data-type="state" class="card__v2-managed-badge">${escapeHtml(reviewStateLabel(result.reviewState.state))}</span><span>${window.siyuan.languages.flashcardReviews} ${result.reviewState.reps}</span>${result.effectivePriority === "unset" ? "" : `<span>${escapeHtml(priorityLabel(result.effectivePriority))}</span>`}</span>
</span>
${result.sourceType === "qa" ? `<span data-type="direction" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardDirectionBidirectional}"><svg><use xlink:href="#iconBoth"></use></svg></span>` : ""}
<span data-type="preset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardPreset}"><svg><use xlink:href="#iconSettings"></use></svg></span>
<span data-type="priority" class="fn__none"></span>
<span data-type="tags" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.tag}"><svg><use xlink:href="#iconTag"></use></svg></span>
<span data-type="suspend" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${result.reviewState.suspended ? window.siyuan.languages.continueReview1 : window.siyuan.languages.flashcardDirectionClosed}"><svg><use xlink:href="#icon${result.reviewState.suspended ? "Play" : "Pause"}"></use></svg></span>
<span data-type="bury" class="fn__none"></span>
<span data-type="due" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.setDueTime}"><svg><use xlink:href="#iconCalendar"></use></svg></span>
<span data-type="flag" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.cardStatus} - ${escapeAttr(flashcardFlagLabel(result.card.flag, flagDefinitions))}"${flashcardFlagStyle(result.card.flag)}><svg><use xlink:href="#iconBookmark"></use></svg></span>
<span data-type="history" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.dataHistory}"><svg><use xlink:href="#iconHistory"></use></svg></span>
${reviewSetID ? `<span data-type="exclude" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconClose"></use></svg></span>` : '<span data-type="membership" class="fn__none"></span>'}
<span data-type="reset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.reset}"><svg><use xlink:href="#iconUndo"></use></svg></span>
<span data-type="more" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></span>
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
    return [...sources.entries()].map(([sourceID, sourceCards]) => {
        const deleted = sourceCards[0].sourceStatus === "deleted";
        const editable = ["cloze", "ordered", "image-occlusion", "choice", "multi-line", "typed-answer"]
            .includes(sourceCards[0].sourceType);
        return `<li class="b3-list-item b3-list-item--focus b3-list-item--hide-action card__v2-managed-source" data-source-id="${escapeAttr(sourceID)}">
<svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
<span class="b3-list-item__text">${escapeHtml(sourceCards[0].sourceTitle || sourceCards[0].sourceBlockID || sourceID)}</span>
<span class="b3-list-item__meta">${sourceCards.length}</span>
${editable && !deleted ? `<span data-type="editSource" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.edit}"><svg><use xlink:href="#iconEdit"></use></svg></span>` : ""}
<span data-type="sourceTags" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.tag}"><svg><use xlink:href="#iconTag"></use></svg></span>
<span data-type="documentPolicy" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.doc} - ${window.siyuan.languages.flashcardPriority}"><svg><use xlink:href="#iconFile"></use></svg></span>
<span data-type="notebookPolicy" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.notebook} - ${window.siyuan.languages.flashcardPriority}"><svg><use xlink:href="#iconFilesRoot"></use></svg></span>
<span data-type="sourceLifecycle" class="b3-list-item__action${deleted ? "" : " b3-list-item__action--warning"} b3-tooltips b3-tooltips__w" aria-label="${deleted ? window.siyuan.languages.restore : window.siyuan.languages.delete}"><svg><use xlink:href="#icon${deleted ? "Undo" : "Trashcan"}"></use></svg></span>
</li>${sourceCards.map((card) => renderManagedCard(card, reviewSetID, selectedCardIDs, flagDefinitions, true)).join("")}`;
    }).join("");
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
            content: `<div class="b3-dialog__content card__v2-form">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardReviewSet}</div><select data-type="reviewSet" class="b3-select fn__block">${reviewSets.map((revision) => `<option value="${escapeAttr(revision.entityID)}">${escapeHtml(revision.payload.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.manage}</div><select data-type="mode" class="b3-select fn__block"><option value="include">${window.siyuan.languages.new}</option><option value="exclude">${window.siyuan.languages.remove}</option><option value="automatic">${window.siyuan.languages.default}</option></select></label>
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
        content: `<div class="b3-dialog__content card__v2-form"><select class="b3-select fn__block">
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
            content: `<div class="b3-dialog__content card__v2-panel"><ul class="b3-list b3-list--background fn__flex-1 card__v2-panel-list">${events.map((event) => `<li class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(event.payload.rating || event.payload.action || event.eventType)}</span><span class="b3-list-item__meta">${new Date(event.occurredAt).toLocaleString()}</span></li>`).join("")}</ul></div>`,
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
        content: `<div class="b3-dialog__content card__v2-form"><input class="b3-text-field fn__block" type="datetime-local" value="${flashcardV2LocalDateTime(card.reviewState.due || Date.now())}"></div>
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
        content: `<div class="b3-dialog__content card__v2-form"><input class="b3-text-field fn__block" type="datetime-local" value="${flashcardV2LocalDateTime(Date.now())}"></div>
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
            content: `<div class="b3-dialog__content card__v2-form"><select class="b3-select fn__block">
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
            content: `<div class="b3-dialog__content card__v2-form"><select data-type="priority" class="b3-select fn__block">${options}</select>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.setDueTime}</div><input data-type="targetDate" class="b3-text-field fn__block" type="datetime-local" value="${current?.payload.targetDate ? flashcardV2LocalDateTime(current.payload.targetDate) : ""}"></label></div>
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
        .map((tag) => `<div class="b3-list-item b3-list-item--narrow${isMobile() ? "" : " b3-list-item--hide-action"}" data-id="${escapeAttr(tag.id)}">
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
        content: `<div class="b3-dialog__content card__v2-form">
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
            content: `<div class="b3-dialog__content card__v2-panel">
<div class="card__v2-panel-toolbar"><input class="b3-text-field fn__flex-1" placeholder="${window.siyuan.languages.newTag}">
<button data-type="createTag" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}</button></div>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.move}</div><select data-type="createTagParent" class="b3-select fn__block">${flashcardTagParentOptions(tags)}</select></label>
<div data-tag-list class="b3-list b3-list--background fn__flex-1 card__v2-panel-list">${renderFlashcardTagChoices(tags, selected)}</div></div>
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
        content: `<div class="b3-dialog__content card__v2-form card__v2-form--grid">${Array.from({length: 7}, (_, index) => {
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
        block: window.siyuan.languages.flashcardBlockCard,
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
        content: `<div class="b3-dialog__content card__v2-form card__v2-form--grid" style="height:100%">
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
        element.value = filters[element.dataset.filter as TFlashcardManagementStringFilter] || "";
    });
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector('[data-type="clear"]').addEventListener("click", () => {
        callback({blockIDs: filters.blockIDs, rootIDs: filters.rootIDs});
        dialog.destroy();
    });
    dialog.element.querySelector('[data-type="confirm"]').addEventListener("click", () => {
        const next: IFlashcardManagementFilters = {blockIDs: filters.blockIDs, rootIDs: filters.rootIDs};
        elements.forEach((element) => {
            const value = element.value.trim();
            if (value !== "") {
                next[element.dataset.filter as TFlashcardManagementStringFilter] = value;
            }
        });
        callback(next);
        dialog.destroy();
    });
};

const flashcardV2ManagementPageSize = 200;

const openFlashcardV2Conflicts = (callback: () => void) => {
    fetchPost("/api/flashcard/listConflicts", {limit: 1000}, (response) => {
        const conflicts = response.data as IFlashcardEntityConflict[];
        const dialog = new Dialog({
            title: window.siyuan.languages.conflict,
            width: isMobile() ? "96vw" : "760px",
            height: "70vh",
            content: `<div class="b3-dialog__content card__v2-conflicts">
${conflicts.length === 0 ? `<div class="card__empty">${window.siyuan.languages.emptyContent}</div>` : conflicts.map((conflict, conflictIndex) => `<div class="card__v2-conflict" data-conflict-index="${conflictIndex}">
<div class="card__v2-section-title">${escapeHtml(conflict.entityType)} - ${escapeHtml(conflict.entityID)}</div>
${conflict.revisions.map((revision) => {
                const payload = JSON.stringify(revision.payload, undefined, 2);
                return `<label class="card__v2-conflict-revision"><div class="fn__flex-center"><input type="radio" name="flashcardConflict${conflictIndex}" value="${escapeAttr(revision.revisionID)}"${revision.revisionID === conflict.selectedRevisionID ? " checked" : ""}><span class="fn__space"></span><span class="fn__flex-1">${new Date(revision.updatedAt).toLocaleString()}</span><span class="b3-list-item__meta">${escapeHtml(revision.revisionID)}</span></div><pre class="fn__code">${escapeHtml(payload.length > 4000 ? `${payload.slice(0, 4000)}...` : payload)}</pre></label>`;
            }).join("")}
</div>`).join("")}
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text"${conflicts.length === 0 ? " disabled" : ""}>${window.siyuan.languages.confirm}</button></div>`,
        });
        const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            const resolveNext = (index: number) => {
                if (index >= conflicts.length) {
                    dialog.destroy();
                    callback();
                    return;
                }
                const selected = dialog.element.querySelector<HTMLInputElement>(
                    `input[name="flashcardConflict${index}"]:checked`);
                if (!selected) {
                    resolveNext(index + 1);
                    return;
                }
                fetchPost("/api/flashcard/resolveConflict", {
                    operationID: genUUID(),
                    entityType: conflicts[index].entityType,
                    entityID: conflicts[index].entityID,
                    selectedRevisionID: selected.value,
                    resolvedAt: Date.now(),
                }, () => resolveNext(index + 1));
            };
            buttons[1].disabled = true;
            resolveNext(0);
        });
    });
};

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
                content: `<div class="b3-dialog__content fn__flex-column card__v2-management">
<div class="card__v2-management-toolbar">
<div class="card__v2-management-pagination">
<button data-type="pagePrevious" class="b3-button b3-button--outline"${offset === 0 ? " disabled" : ""}>${window.siyuan.languages.previous}</button>
<span class="b3-list-item__meta">${pageLength === 0 ? 0 : offset + 1} - ${offset + pageLength}${total === undefined ? "" : ` / ${total}`}</span>
<button data-type="pageNext" class="b3-button b3-button--outline"${hasNext ? "" : " disabled"}>${window.siyuan.languages.next}</button>
</div>
<div class="card__v2-management-tools">
<button data-type="filter" class="b3-button b3-button--outline"><svg><use xlink:href="#iconFilter"></use></svg>${window.siyuan.languages.filter}${filterCount === 0 ? "" : ` (${filterCount})`}</button>
<button data-type="conflicts" class="b3-button b3-button--outline"><svg><use xlink:href="#iconWarning"></use></svg>${window.siyuan.languages.conflict}</button>
<button data-type="statistics" class="b3-button b3-button--outline"><svg><use xlink:href="#iconGraph"></use></svg>${window.siyuan.languages.flashcardStatistics}</button>
${reviewSetID === "" ? `<button data-type="saveReviewSet" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.flashcardReviewSet}</button>` : ""}
<button data-type="flagDefinitions" class="b3-button b3-button--outline"><svg><use xlink:href="#iconBookmark"></use></svg>${window.siyuan.languages.cardStatus}</button>
<button data-type="group" class="b3-button b3-button--outline">${window.siyuan.languages.group}</button>
</div>
</div>
<div class="card__v2-management-selection">
<label class="fn__flex-center"><input data-type="selectPage" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.selectAll}</label>
<span data-type="selectedCount" class="b3-list-item__meta fn__flex-1">${window.siyuan.languages.selected} 0</span>
<select data-type="batchAction" class="b3-select"><option value="">${window.siyuan.languages.manage}</option><option value="tags">${window.siyuan.languages.tag}</option><option value="membership">${reviewSetID ? window.siyuan.languages.remove : window.siyuan.languages.flashcardReviewSet}</option><option value="setDue">${window.siyuan.languages.setDueTime}</option><option value="suspend">${window.siyuan.languages.flashcardSuspendCard}</option><option value="resume">${window.siyuan.languages.continueReview1}</option><option value="bury">${window.siyuan.languages.flashcardBury}</option><option value="unbury">${window.siyuan.languages.flashcardUnbury}</option><option value="reset">${window.siyuan.languages.reset}</option>${batchFlagOptions}${batchPresetOptions}${batchPriorityOptions}</select>
<button data-type="batchApply" class="b3-button b3-button--text" disabled>${window.siyuan.languages.confirm}</button>
</div>
<ul class="b3-list b3-list--background fn__flex-1 card__v2-management-list">${cards.length === 0 ? `<li class="b3-list-item card__empty">${window.siyuan.languages.emptyContent}</li>` : renderManagedCards(cards, grouped, reviewSetID, selectedCardIDs, flagDefinitions)}</ul></div>`,
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
                if (type === "conflicts") {
                    openFlashcardV2Conflicts(reloadPage);
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
                if (type === "more") {
                    const card = cards.find((result) => result.card.id === item.dataset.id);
                    if (!card) {
                        return;
                    }
                    const menu = new Menu();
                    const addAction = (id: string, label: string, action: string) => {
                        menu.addItem({
                            id,
                            label,
                            click: () => (item.querySelector(`[data-type="${action}"]`) as HTMLElement)?.click(),
                        });
                    };
                    addAction("flashcardV2Priority", window.siyuan.languages.flashcardPriority, "priority");
                    addAction("flashcardV2Bury", (card.reviewState.buriedUntil || 0) > Date.now() ?
                        window.siyuan.languages.flashcardUnbury : window.siyuan.languages.flashcardBury, "bury");
                    if (!reviewSetID) {
                        addAction("flashcardV2Membership", window.siyuan.languages.flashcardReviewSet, "membership");
                    }
                    if (isMobile()) {
                        menu.fullscreen();
                    } else {
                        const rect = target.getBoundingClientRect();
                        menu.open({x: rect.left, y: rect.bottom});
                    }
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
                if (type === "sourceLifecycle" && item.dataset.sourceId) {
                    const sourceCard = cards.find((card) => card.card.sourceID === item.dataset.sourceId);
                    if (!sourceCard) {
                        return;
                    }
                    const action = sourceCard.sourceStatus === "deleted" ? "restore" : "delete";
                    const execute = () => fetchPost("/api/flashcard/manageSourceLifecycle", {
                        operationID: genUUID(),
                        sourceID: item.dataset.sourceId,
                        action,
                        changedAt: Date.now(),
                    }, reloadPage);
                    if (action === "delete") {
                        confirmDialog(window.siyuan.languages.deleteOpConfirm,
                            window.siyuan.languages.confirmDelete, execute);
                    } else {
                        execute();
                    }
                    return;
                }
                if (type === "editSource" && item.dataset.sourceId) {
                    const sourceCards = cards.filter((card) => card.card.sourceID === item.dataset.sourceId);
                    const sourceCard = sourceCards.find((card) => card.card.generationStatus === "active") ||
                        sourceCards[0];
                    if (!sourceCard) {
                        return;
                    }
                    fetchPost("/api/flashcard/getRenderModel", {cardID: sourceCard.card.id}, (renderResponse) => {
                        const model = renderResponse.data as {
                            source: {sourceType: string, generationConfig: IFlashcardV2AdvancedGenerationConfig},
                            references: Array<{entityType: string, entityID: string, role: string, sort: number}>,
                            template: {generationRule: {mode: string}},
                        };
                        fetchPost("/api/flashcard/getEntity", {
                            entityType: "cardSource",
                            entityID: item.dataset.sourceId,
                        }, (entityResponse) => {
                            const revision = entityResponse.data.revision as IFlashcardEntityRevision<unknown>;
                            const references = model.references.filter((reference) => reference.entityType === "block")
                                .sort((left, right) => left.sort - right.sort);
                            const blockIDs = references.map((reference) => reference.entityID);
                            if (!entityResponse.data.found || blockIDs.length === 0) {
                                return;
                            }
                            openFlashcardV2AdvancedSource(blockIDs, {
                                sourceID: item.dataset.sourceId,
                                expectedRevisionID: revision.revisionID,
                                sourceType: model.source.sourceType,
                                generationConfig: model.source.generationConfig,
                                references,
                                modeHint: model.template.generationRule.mode,
                            }, reloadPage);
                        });
                    });
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

export const openFlashcardV2ManagementByNotebook = (notebookID: string, name: string) => {
    ensureFlashcardV2(() => openFlashcardV2ReviewSetCards("", name, 0, {notebookID}));
};

export const openFlashcardV2ManagementByBlocks = (blockIDs: string[], name: string) => {
    const uniqueBlockIDs = [...new Set(blockIDs.filter(Boolean))];
    ensureFlashcardV2(() => openFlashcardV2ReviewSetCards("", name, 0, {blockIDs: uniqueBlockIDs}));
};

export const openFlashcardV2ManagementByRoots = (rootIDs: string[], name: string) => {
    const uniqueRootIDs = [...new Set(rootIDs.filter(Boolean))];
    ensureFlashcardV2(() => openFlashcardV2ReviewSetCards("", name, 0, {rootIDs: uniqueRootIDs}));
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
                content: `<div class="b3-dialog__content card__v2-panel">
<div class="card__v2-panel-toolbar">
    <input class="b3-text-field fn__flex-1" placeholder="${window.siyuan.languages.flashcardReviewSet}">
    <button data-type="create" class="b3-button b3-button--text"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}</button>
</div>
<ul class="b3-list b3-list--background fn__flex-1 card__v2-panel-list">${revisions.map((revision) => renderReviewSet(revision)).join("")}</ul>
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
                content: `<div class="b3-dialog__content card__v2-basic card__v2-form">
<label class="b3-label b3-label--inner card__v2-basic-field">
    <div class="b3-label__text">${window.siyuan.languages.type}</div>
    <select data-type="direction" class="b3-select fn__block">
        <option value="forward">${window.siyuan.languages.flashcardDirectionForward}</option>
        <option value="reverse">${window.siyuan.languages.flashcardDirectionReverse}</option>
        <option value="bidirectional">${window.siyuan.languages.flashcardDirectionBidirectional}</option>
        <option value="closed">${window.siyuan.languages.flashcardDirectionClosed}</option>
    </select>
</label>
<label class="b3-label b3-label--inner card__v2-basic-field">
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
    destroy: () => void;
}

interface IFlashcardV2AdvancedGenerationConfig {
    occlusions?: Array<{ id: string, groupIDs: string[], displayOrder: number }>;
    groups?: Array<{ id: string, displayOrder: number, shapeIDs?: string[] }>;
    steps?: Array<{ id: string, displayOrder: number, occlusionIDs: string[] }>;
    shapes?: Array<Omit<IFlashcardV2ImageShape, "groupID">>;
    frontMode?: string;
    mode?: string;
    options?: Array<{ id: string, displayOrder: number }>;
    correctOptionIDs?: string[];
    randomize?: boolean;
    distractorQuery?: IFlashcardQueryAST;
    dynamicDistractorCount?: number;
    revealMode?: string;
    caseSensitive?: boolean;
    ignoreDiacritics?: boolean;
    fuzzyMaxDistance?: number;
    fuzzyMaxRatio?: number;
    trimWhitespace?: boolean;
    collapseWhitespace?: boolean;
}

interface IFlashcardV2AdvancedEdit {
    sourceID: string;
    expectedRevisionID: string;
    sourceType: string;
    generationConfig: IFlashcardV2AdvancedGenerationConfig;
    references: Array<{ entityID: string, role: string, sort: number }>;
    modeHint?: string;
}

const flashcardV2AdvancedEditMode = (edit?: IFlashcardV2AdvancedEdit) => {
    if (!edit) {
        return "cloze";
    }
    const config = edit.generationConfig;
    switch (edit.sourceType) {
        case "ordered":
            return edit.modeHint === "orderedCards" ? "orderedCards" : "orderedSingle";
        case "image-occlusion":
            return "imageOcclusion";
        case "choice":
            return config.mode === "multiple" ? "choiceMultiple" : "choiceSingle";
        case "multi-line":
            return config.revealMode === "steps" ? "multiLineSteps" : "multiLineAll";
        case "typed-answer":
            return "typedAnswer";
        default:
            return "cloze";
    }
};

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

interface IFlashcardV2InlineOcclusion {
    id: string;
    blockID: string;
    displayOrder: number;
    label: string;
}

const prepareFlashcardV2InlineOcclusions = (blockIDs: string[], doms: Record<string, string>) => {
    const targets: IFlashcardV2InlineOcclusion[] = [];
    const updates: Array<{ id: string, data: string, dataType: "dom" }> = [];
    const seen = new Set<string>();
    blockIDs.forEach((blockID) => {
        const template = document.createElement("template");
        template.innerHTML = doms[blockID] || "";
        let changed = false;
        template.content.querySelectorAll<HTMLElement>('span[data-type~="mark"]').forEach((mark) => {
            let id = mark.dataset.occlusionId;
            if (!id) {
                id = Lute.NewNodeID();
                mark.dataset.occlusionId = id;
                changed = true;
            }
            if (seen.has(id)) {
                id = Lute.NewNodeID();
                mark.dataset.occlusionId = id;
                changed = true;
            }
            seen.add(id);
            targets.push({
                id,
                blockID,
                displayOrder: targets.length,
                label: mark.textContent?.replace(/\s+/g, " ").trim() || blockID,
            });
        });
        if (changed && template.content.firstElementChild) {
            updates.push({id: blockID, data: template.content.firstElementChild.outerHTML, dataType: "dom"});
        }
    });
    return {targets, updates};
};

const bindFlashcardV2ImageEditor = (element: Element, assetID: string,
    onChange: (hasShapes: boolean) => void, initial?: IFlashcardV2AdvancedEdit["generationConfig"]): IFlashcardV2ImageEditor => {
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
    if (initial?.groups && initial?.shapes) {
        [...initial.groups].sort((left, right) => left.displayOrder - right.displayOrder).forEach((group) => {
            groupOrder.push(group.id);
            group.shapeIDs?.forEach((shapeID) => {
                const shape = initial.shapes.find((item) => item.id === shapeID);
                if (shape) {
                    shapes.push({...shape, groupID: group.id});
                }
            });
        });
        frontMode.value = initial.frontMode || "hideAllAnswerOne";
    }

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
    const drawShape = (shape: IFlashcardV2ImageShape, width: number, height: number, alpha = 1) => {
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
    updateGroups();
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
    const undo = () => {
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
    };
    const keydown = (event: KeyboardEvent) => {
        if (element.classList.contains("fn__none") || event.altKey || !(event.ctrlKey || event.metaKey) ||
            event.key.toLowerCase() !== "z") {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (!event.shiftKey) {
            undo();
        }
    };
    document.addEventListener("keydown", keydown, true);
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
    undoButton.addEventListener("click", undo);
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
        destroy: () => document.removeEventListener("keydown", keydown, true),
    };
};

export const openFlashcardV2AdvancedSource = (blockIDs: string[], edit?: IFlashcardV2AdvancedEdit,
    callback?: () => void) => {
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
                const preparedInline = prepareFlashcardV2InlineOcclusions(blockIDs, doms);
                const initialOcclusionIDs = new Set([
                    ...(edit?.generationConfig.occlusions || []).map((occlusion) => occlusion.id),
                    ...(edit?.generationConfig.steps || []).flatMap((step) => step.occlusionIDs),
                ]);
                const referenceOcclusionByBlock = new Map(edit?.references
                    .filter((reference) => reference.role.startsWith("occlusion:"))
                    .map((reference) => [reference.entityID, reference.role.slice("occlusion:".length)]) || []);
                const editingInlineOcclusions = !!edit && initialOcclusionIDs.size > 0 &&
                    referenceOcclusionByBlock.size === 0;
                const preparedTargets = edit && referenceOcclusionByBlock.size > 0 ? [] :
                    edit && initialOcclusionIDs.size > 0 ? preparedInline.targets.filter((target) =>
                        initialOcclusionIDs.has(target.id) ||
                        initialOcclusionIDs.has(referenceOcclusionByBlock.get(target.blockID) || "")) :
                        preparedInline.targets;
                const usesInlineTargets = preparedTargets.length > 0 || editingInlineOcclusions;
                const clozeTargets = preparedTargets.length > 0 ? preparedTargets : editingInlineOcclusions ? [] :
                    blockIDs.map((blockID, displayOrder) => ({
                    id: blockID,
                    blockID,
                    displayOrder,
                    label: flashcardV2BlockText(blockID, doms[blockID] || ""),
                }));
                const initialGroups = edit?.sourceType === "cloze" ?
                    [...(edit.generationConfig.groups || [])].sort((left, right) => left.displayOrder - right.displayOrder) : [];
                const clozeGroupOrder = initialGroups.length > 0 ? initialGroups.map((group) => group.id) :
                    clozeTargets.map(() => genUUID());
                const initialGroupIDs = (target: IFlashcardV2InlineOcclusion) => {
                    const occlusionID = initialOcclusionIDs.has(target.id) ? target.id :
                        referenceOcclusionByBlock.get(target.blockID);
                    return new Set(edit?.generationConfig.occlusions?.find((occlusion) =>
                        occlusion.id === occlusionID)?.groupIDs || []);
                };
                const clozeEditorHTML = `<div data-type="clozeEditor" class="card__v2-advanced-section">
${clozeTargets.map((target, targetIndex) => {
                    const selected = initialGroupIDs(target);
                    return `<label class="b3-label b3-label--inner card__v2-advanced-field"><div class="b3-label__text">${escapeHtml(target.label)}</div><select data-type="clozeGroups" data-target-index="${targetIndex}" class="b3-select fn__block" multiple size="${Math.min(6, Math.max(2, clozeTargets.length))}">${clozeGroupOrder.map((groupID, groupIndex) => `<option value="${escapeAttr(groupID)}"${selected.size > 0 ? selected.has(groupID) ? " selected" : "" : groupIndex === targetIndex ? " selected" : ""}>${groupIndex + 1}</option>`).join("")}</select></label>`;
                }).join("")}
${clozeTargets.length === 0 ? `<div class="card__empty">${window.siyuan.languages.emptyContent}</div>` : ""}
<div class="card__v2-advanced-section-action"><button data-type="addClozeGroup" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.group}</button></div>
</div>`;
                const imageEditorHTML = imageSource ? `<div data-type="imageEditor" class="fn__none card__v2-advanced-section">
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
<select data-type="imageFrontMode" class="b3-select fn__block">
    <option value="hideAllAnswerOne">${window.siyuan.languages.flashcardImageHideAll}</option>
    <option value="hideCurrent">${window.siyuan.languages.flashcardImageHideCurrent}</option>
</select>
<div class="card__v2-image-editor"><img src="${escapeAttr(imageSource.assetID)}"><canvas></canvas></div>
</div>` : "";
                const choiceEditorHTML = blockIDs.length >= 3 ? `<div data-type="choiceEditor" class="fn__none card__v2-advanced-section">
<div class="b3-label b3-label--inner card__v2-advanced-field"><div class="b3-label__text">${window.siyuan.languages.flashcardChoiceQuestion}</div>${escapeHtml(flashcardV2BlockText(blockIDs[0], doms[blockIDs[0]] || ""))}</div>
<div class="b3-label b3-label--inner card__v2-advanced-field"><div class="b3-label__text">${window.siyuan.languages.flashcardCorrectAnswer}</div>
${blockIDs.slice(1).map((blockID, index) => `<label class="fn__flex card__v2-choice-source"><input data-type="choiceCorrect" data-choice-index="${index}" type="radio" name="flashcardChoiceCorrect"><span>${escapeHtml(flashcardV2BlockText(blockID, doms[blockID] || ""))}</span></label>`).join("")}
</div>
<label class="b3-label b3-label--inner fn__flex-center card__v2-advanced-switch"><input data-type="choiceRandomize" class="b3-switch fn__flex-center" type="checkbox" checked><span class="fn__space"></span>${window.siyuan.languages.flashcardRandomizeOptions}</label>
<label class="b3-label b3-label--inner fn__flex-center card__v2-advanced-switch"><input data-type="choiceDynamic" class="b3-switch fn__flex-center" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.flashcardDynamicDistractors}<span class="fn__flex-1"></span><input data-type="choiceDynamicCount" class="b3-text-field" style="width:72px" type="number" min="1" max="50" value="3" disabled></label>
</div>` : "";
                const typedEditorHTML = blockIDs.length >= 2 ? `<div data-type="typedEditor" class="fn__none card__v2-advanced-section">
<label class="b3-label b3-label--inner fn__flex-center card__v2-advanced-switch"><input data-type="typedCaseSensitive" class="b3-switch fn__flex-center" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.searchCaseSensitive}</label>
<label class="b3-label b3-label--inner fn__flex-center card__v2-advanced-switch"><input data-type="typedMatchDiacritics" class="b3-switch fn__flex-center" type="checkbox" checked><span class="fn__space"></span>${window.siyuan.languages.matchDiacritics}</label>
</div>` : "";
                let imageEditor: IFlashcardV2ImageEditor | undefined;
                const dialog = new Dialog({
                    title: window.siyuan.languages.configGroupAdvanced,
                    width: isMobile() ? "96vw" : "720px",
                    height: imageSource || blockIDs.length >= 3 ? "82vh" : undefined,
                    destroyCallback: () => imageEditor?.destroy(),
                    content: `<div class="b3-dialog__content card__v2-advanced">
<label class="b3-label b3-label--inner card__v2-advanced-field">
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
<div class="card__v2-advanced-summary"><span>${window.siyuan.languages.total}</span><strong>${blockIDs.length}</strong></div>
${edit ? "" : `<label class="b3-label b3-label--inner card__v2-advanced-field">
    <div class="b3-label__text">${window.siyuan.languages.flashcardReviewSet}</div>
    <select data-type="reviewSets" class="b3-select fn__block" multiple size="${Math.min(6, Math.max(2, revisions.length))}">
        ${revisions.map((revision) => `<option value="${escapeAttr(revision.entityID)}">${escapeHtml(revision.payload.name)}</option>`).join("")}
    </select>
</label>`}
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
                    const orderedMode = modeElement.value === "orderedSingle" || modeElement.value === "orderedCards";
                    const imageMode = modeElement.value === "imageOcclusion";
                    const choiceMode = modeElement.value === "choiceSingle" || modeElement.value === "choiceMultiple";
                    buttons[1].disabled = (clozeMode || orderedMode) && clozeTargets.length === 0 ||
                        clozeMode && clozeSelects.some((select) => select.selectedOptions.length === 0) ||
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
                if (imageSource) {
                    imageEditor = bindFlashcardV2ImageEditor(imageElement, imageSource.assetID, updateConfirm,
                        edit?.sourceType === "image-occlusion" ? edit.generationConfig : undefined);
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
                modeElement.value = flashcardV2AdvancedEditMode(edit);
                if (edit?.sourceType === "choice") {
                    const correctOptionIDs = new Set(edit.generationConfig.correctOptionIDs || []);
                    choiceInputs.forEach((input) => {
                        const option = edit.generationConfig.options?.[Number(input.dataset.choiceIndex)];
                        input.checked = !!option && correctOptionIDs.has(option.id);
                    });
                    (dialog.element.querySelector('[data-type="choiceRandomize"]') as HTMLInputElement).checked =
                        edit.generationConfig.randomize !== false;
                    if (dynamicChoice && dynamicChoiceCount) {
                        dynamicChoice.checked = !!edit.generationConfig.distractorQuery;
                        dynamicChoiceCount.value = String(edit.generationConfig.dynamicDistractorCount || 3);
                        dynamicChoiceCount.disabled = !dynamicChoice.checked;
                    }
                }
                if (edit?.sourceType === "typed-answer") {
                    (dialog.element.querySelector('[data-type="typedCaseSensitive"]') as HTMLInputElement).checked =
                        !!edit.generationConfig.caseSensitive;
                    (dialog.element.querySelector('[data-type="typedMatchDiacritics"]') as HTMLInputElement).checked =
                        !edit.generationConfig.ignoreDiacritics;
                }
                modeElement.dispatchEvent(new Event("change"));
                buttons[0].addEventListener("click", () => dialog.destroy());
                buttons[1].addEventListener("click", () => {
                    const mode = modeElement.value;
                    if (mode === "imageOcclusion" && !imageEditor?.hasShapes()) {
                        return;
                    }
                    const reviewSets = dialog.element.querySelector('[data-type="reviewSets"]') as HTMLSelectElement;
                    const reviewSetIDs = reviewSets ? [...reviewSets.selectedOptions].map((option) => option.value) : [];
                    const clozeGroups = mode === "cloze" ? clozeGroupOrder.map((groupID, displayOrder) => ({
                        id: groupID,
                        displayOrder,
                        ...(usesInlineTargets ? {
                            occlusionIDs: clozeSelects.filter((select) =>
                                [...select.selectedOptions].some((option) => option.value === groupID))
                                .map((select) => clozeTargets[Number(select.dataset.targetIndex)].id),
                        } : {
                            blockIDs: clozeSelects.filter((select) =>
                                [...select.selectedOptions].some((option) => option.value === groupID))
                                .map((select) => clozeTargets[Number(select.dataset.targetIndex)].blockID),
                        }),
                    })).filter((group) => ("occlusionIDs" in group ? group.occlusionIDs : group.blockIDs).length > 0) :
                        undefined;
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
                    buttons[1].disabled = true;
                    const operationID = genUUID();
                    const sourceID = edit?.sourceID || genUUID();
                    const changedAt = Date.now();
                    const saveSource = () => fetchPost(edit ? "/api/flashcard/updateAdvancedSource" :
                        "/api/flashcard/createAdvancedSource", {
                        operationID,
                        sourceID,
                        expectedRevisionID: edit?.expectedRevisionID,
                        mode,
                        blockIDs: mode === "imageOcclusion" ? [imageSource.blockID] : blockIDs,
                        clozeGroups,
                        inlineOcclusions: (mode === "cloze" || mode === "orderedSingle" ||
                            mode === "orderedCards") && preparedTargets.length > 0 ?
                            clozeTargets.map(({id, blockID, displayOrder}) => ({id, blockID, displayOrder})) :
                            undefined,
                        imageConfig: mode === "imageOcclusion" ? imageEditor.getConfig() : undefined,
                        correctOptionIndexes: mode === "choiceSingle" || mode === "choiceMultiple" ?
                            choiceInputs.filter((input) => input.checked).map((input) => Number(input.dataset.choiceIndex)) :
                            undefined,
                        randomizeOptions: mode === "choiceSingle" || mode === "choiceMultiple" ?
                            (dialog.element.querySelector('[data-type="choiceRandomize"]') as HTMLInputElement).checked :
                            undefined,
                        distractorQuery: (mode === "choiceSingle" || mode === "choiceMultiple") &&
                        dynamicChoice?.checked ? edit?.generationConfig.distractorQuery ||
                            {version: 1, root: {operator: "matchAll"}} : undefined,
                        dynamicDistractors: (mode === "choiceSingle" || mode === "choiceMultiple") &&
                        dynamicChoice?.checked ? Math.min(50, Math.max(1, Number(dynamicChoiceCount.value) || 1)) :
                            undefined,
                        typedConfig: mode === "typedAnswer" ? {
                            caseSensitive: (dialog.element.querySelector('[data-type="typedCaseSensitive"]') as
                                HTMLInputElement).checked,
                            ignoreDiacritics: !(dialog.element.querySelector('[data-type="typedMatchDiacritics"]') as
                                HTMLInputElement).checked,
                            fuzzyMaxDistance: edit?.generationConfig.fuzzyMaxDistance,
                            fuzzyMaxRatio: edit?.generationConfig.fuzzyMaxRatio ?? 0.1,
                            trimWhitespace: edit?.generationConfig.trimWhitespace ?? true,
                            collapseWhitespace: edit?.generationConfig.collapseWhitespace ?? true,
                        } : undefined,
                        reviewSetIDs: edit ? undefined : reviewSetIDs,
                        createdAt: edit ? undefined : changedAt,
                        updatedAt: edit ? changedAt : undefined,
                    }, () => {
                        dialog.destroy();
                        callback?.();
                    });
                    if (usesInlineTargets && (mode === "cloze" || mode === "orderedSingle" ||
                        mode === "orderedCards") &&
                        preparedInline.updates.length > 0) {
                        fetchPost("/api/block/batchUpdateBlock", {blocks: preparedInline.updates}, saveSource);
                    } else {
                        saveSource();
                    }
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
                content: `<div class="b3-dialog__content card__v2-panel">
${statisticsItem(window.siyuan.languages.total, preview.noteCount)}
${statisticsItem(window.siyuan.languages.riffCard, preview.cardCount)}
${statisticsItem(window.siyuan.languages.revisionCount, preview.reviewCount)}
${statisticsItem(window.siyuan.languages.assets, preview.mediaCount)}
<div class="card__v2-section-title">${window.siyuan.languages.template}</div>
<ul class="b3-list b3-list--background card__v2-panel-list">
${preview.noteTypes.map((noteType) => `<li class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(noteType.name)}</span><span class="b3-list-item__meta">${escapeHtml(noteType.conversion)} · ${noteType.noteCount}</span></li>`).join("")}
</ul>
<div class="card__v2-section-title">${window.siyuan.languages.flashcardReviewSet}</div>
<ul class="b3-list b3-list--background card__v2-panel-list">
${preview.decks.map((deck) => `<li class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(deck.name)}</span><span class="b3-list-item__meta">${deck.cardCount}</span></li>`).join("")}
</ul>
${preview.unsupported.length === 0 ? "" : `<div class="ft__warning">${preview.unsupported.map(escapeHtml).join("<br>")}</div>`}
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
    return `<div class="card__v2-section-title">${escapeHtml(label)}</div>${flashcardV2StatisticsBars(values,
        (value) => value.label, (value) => value.count)}`;
};

const renderFlashcardV2Statistics = (statistics: IFlashcardStatistics) => {
    const ratings = statistics.history.ratings;
    const state = statistics.overview.reviewStates;
    const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
    const averageDuration = statistics.history.averageDurationMS === undefined ? "-" :
        `${(statistics.history.averageDurationMS / 1000).toFixed(1)} ${window.siyuan.languages.second}`;
    return `<div class="card__v2-section-title">${window.siyuan.languages.cardStatus}</div>
${statisticsItem(window.siyuan.languages.riffCard, statistics.overview.currentCards)}
${statisticsItem(window.siyuan.languages.flashcardNewCard, state.new || 0)}
${statisticsItem(window.siyuan.languages.flashcardReviewCard, (state.learning || 0) + (state.review || 0) + (state.relearning || 0))}
${statisticsItem(window.siyuan.languages.flashcardDueCard, statistics.overdue)}
${statisticsItem(window.siyuan.languages.flashcardSuspendedCards, statistics.overview.suspended)}
${statisticsItem(window.siyuan.languages.flashcardBuriedCards, statistics.overview.buried)}
${statisticsItem(window.siyuan.languages.flashcardLeeches, statistics.overview.leeches)}
<div class="fn__hr"></div>
<div class="card__v2-section-title">${window.siyuan.languages.flashcardReviewHistory}</div>
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
<div class="card__v2-section-title">${window.siyuan.languages.flashcardUpcomingReviews}</div>
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
            content: `<div class="b3-dialog__content fn__flex-column card__v2-statistics">
<div class="card__v2-statistics-filter"><div class="card__v2-section-title">${window.siyuan.languages.flashcardStatisticsRange}</div><div class="card__v2-statistics-controls">
<input data-type="statisticsFrom" class="b3-text-field fn__flex-1" type="date" value="${flashcardV2StatisticsDate(fromDate)}">
<input data-type="statisticsTo" class="b3-text-field fn__flex-1" type="date" value="${flashcardV2StatisticsDate(toDate)}">
<select data-type="statisticsBucket" class="b3-select"><option value="day">${window.siyuan.languages.day}</option><option value="week">${window.siyuan.languages.week}</option><option value="month">${window.siyuan.languages.month}</option></select>
<button data-type="statisticsApply" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div></div><div data-type="statisticsContent" class="card__v2-statistics-content"></div></div>`,
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
