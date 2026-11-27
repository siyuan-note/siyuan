import {createFlashcardV2AnkiImportState} from "./flashcardV2AnkiImport";
import {loadFlashcardV2GroupNumbers} from "./flashcardV2GroupNumber";
import {openFlashcardV2Template} from "./flashcardV2Template";
import {openFlashcardV2Ordered} from "./flashcardV2Ordered";
import {Dialog} from "../dialog";
import {FlashcardV2DraftPreview} from "./flashcardV2DraftPreview";
import {FlashcardV2TagSave} from "./flashcardV2TagSave";
import {readFlashcardV2RenderModel} from "./flashcardV2Render";
import {FlashcardV2ManagementView} from "./flashcardV2ManagementView";
import {flashcardV2ConflictSummary, FlashcardV2ConflictProgress} from "./flashcardV2ConflictSummary";
import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
import {Menu} from "../plugin/Menu";
import {toggleMenu} from "../menus/menuToggle";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {withFetchTimeout} from "../util/fetchTimeout";
import {ContractFormData} from "../util/contractFormData";
import {isFlashcardV2Object, isFlashcardV2Strings, readFlashcardV2Payload, readFlashcardV2Revision, toFlashcardV2JSON} from "./flashcardV2Contract";
import {isMobile} from "../util/functions";
import {escapeAttr, escapeHtml} from "../util/escape";
import {genUUID} from "../util/genID";
import {openFlashcardV2DocumentHistory, openFlashcardV2SourceHistory} from "./flashcardV2SourceHistory";
import {openFlashcardV2Cleanup} from "./flashcardV2Cleanup";
import {openFlashcardV2Preview, openFlashcardV2ReviewSession, openFlashcardV2SourceEditor} from "./flashcardV2Session";
import {
    createFlashcardV2Operation,
    enhanceFlashcardV2MultiSelect,
    reportFlashcardV2Field,
    submitFlashcardV2Form,
    validateFlashcardV2Fields,
} from "./flashcardV2Form";
import {openFlashcardV2Due} from "./flashcardV2Due";
import {flashcardV2LocalDateTime} from "./flashcardV2Calendar";
import {openFlashcardV2EditLater, type IFlashcardV2EditLater} from "./flashcardV2EditLater";
import {openFlashcardV2SubsetSession} from "./flashcardV2Subset";
import type {App} from "../index";
import {listFlashcardV2PluginTypes} from "./flashcardV2Plugin";
import type {IFlashcardQueryAST, IFlashcardQueryExpression} from "./flashcardV2Query";
import {flashcardV2FlagColors, flashcardV2FlagMenuItems} from "./flashcardV2Flag";
import {
    appendFlashcardV2ClozeTargets,
    resolveFlashcardV2InlineOcclusions,
    type IFlashcardV2InlineOcclusion,
} from "./flashcardV2Occlusion";
import {
    buildFlashcardV2TagAssignmentGroups,
    getFlashcardV2TagSelection,
} from "./flashcardV2State";

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
        editLater?: IFlashcardV2EditLater;
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
        difficulty?: number;
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
    schedulerVersion: "go-fsrs-v3.3.1-fsrs6";
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
    defaultPresetID?: string;
    targetDate?: number;
    createdAt: number;
    updatedAt: number;
}

const isFlashcardTag = (value: unknown): value is IFlashcardTag => isFlashcardV2Object(value) &&
    typeof value.id === "string" && typeof value.name === "string" &&
    (value.parentID === undefined || typeof value.parentID === "string");

const isFlashcardTemplate = (value: unknown): value is IFlashcardTemplate => isFlashcardV2Object(value) &&
    typeof value.id === "string" && typeof value.name === "string";

const isFlashcardFlagDefinition = (value: unknown): value is IFlashcardFlagDefinition =>
    isFlashcardTemplate(value) && "flag" in value && typeof value.flag === "number";

const isFlashcardQueryExpression = (value: unknown): value is IFlashcardQueryExpression => {
    if (!isFlashcardV2Object(value) || !["matchAll", "and", "or", "not", "predicate"].includes(String(value.operator))) {
        return false;
    }
    return (value.children === undefined || Array.isArray(value.children) && value.children.every(isFlashcardQueryExpression)) &&
        (value.field === undefined || typeof value.field === "string") &&
        (value.comparator === undefined || typeof value.comparator === "string");
};

const isFlashcardQuery = (value: unknown): value is IFlashcardQueryAST => isFlashcardV2Object(value) &&
    typeof value.version === "number" && isFlashcardQueryExpression(value.root);

const isFlashcardReviewSet = (value: unknown): value is IReviewSet => isFlashcardV2Object(value) &&
    typeof value.id === "string" && typeof value.name === "string" &&
    typeof value.newLimit === "number" && typeof value.reviewLimit === "number" &&
    (value.defaultReviewMode === "normal" || value.defaultReviewMode === "reinforcement") &&
    (value.legacyDeckID === undefined || typeof value.legacyDeckID === "string") &&
    (value.queryAST === undefined || isFlashcardQuery(value.queryAST)) &&
    (value.order === undefined || isFlashcardV2Object(value.order) &&
        ["priorityDue", "due", "added", "random"].includes(String(value.order.mode)));

const isFlashcardPreset = (value: unknown): value is IFlashcardPreset => isFlashcardV2Object(value) &&
    typeof value.id === "string" && typeof value.name === "string" &&
    value.schedulerVersion === "go-fsrs-v3.3.1-fsrs6" &&
    [value.requestRetention, value.maximumInterval, value.newLimit, value.reviewLimit, value.leechThreshold]
        .every((item) => typeof item === "number") &&
    [value.buryNewSiblings, value.buryReviewSiblings].every((item) => typeof item === "boolean") &&
    Array.isArray(value.weights) && value.weights.every((item) => typeof item === "number") &&
    ["tag", "suspend", "tagAndSuspend"].includes(String(value.leechAction));

const isFlashcardStudyPolicy = (value: unknown): value is IFlashcardStudyPolicy => isFlashcardV2Object(value) &&
    typeof value.id === "string" && (value.scopeType === "document" || value.scopeType === "notebook") &&
    typeof value.scopeID === "string" && typeof value.priority === "string" &&
    typeof value.createdAt === "number" && typeof value.updatedAt === "number" &&
    (value.targetDate === undefined || typeof value.targetDate === "number") &&
    (value.defaultPresetID === undefined || typeof value.defaultPresetID === "string");

interface IFlashcardManagementFilters {
    blockIDs?: string[];
    rootIDs?: string[];
    content?: string;
    notebookID?: string;
    path?: string;
    sourceType?: string;
    templateID?: string;
    tagID?: string;
    tagScope?: string;
    flag?: string;
    generationStatus?: string;
    reviewState?: string;
    suspended?: string;
    editLater?: string;
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
    noteTypes: Array<{ id: number, name: string, noteCount: number, conversion: string }> | null;
    decks: Array<{ id: number, name: string, cardCount: number }> | null;
    unsupported: string[] | null;
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

const flashcardFlagStyle = (flag: number) => flag > 0 && flag < flashcardV2FlagColors.length ?
    ` style="color:${flashcardV2FlagColors[flag]}"` : "";

const flashcardFlagLabel = (flag: number, definitions: IFlashcardFlagDefinition[]) => {
    if (flag === 0) {
        return window.siyuan.languages.flashcardNoFlag;
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
        learning: window.siyuan.languages.flashcardLearningCards,
        review: window.siyuan.languages.flashcardReviewCard,
        relearning: window.siyuan.languages.flashcardRelearningCards,
    };
    return labels[state] || state;
};

const refreshEffectiveCardValues = (card: IFlashcardSearchResult) => {
    card.effectivePresetID = card.card.presetOverrideID || card.defaultPresetID;
    card.effectivePriority = card.card.priorityOverride || card.inheritedPriority || card.sourcePriority || "unset";
    card.effectiveTagIDs = mergedTagIDs(card.cardTagIDs || [], card.sourceTagIDs || []);
};

interface IFlashcardV2Readiness {
    cancelled: () => void;
    failed: () => void;
    isCurrent: () => boolean;
}

const activateFlashcardV2 = (callback: () => void, readiness?: IFlashcardV2Readiness) => {
    let previewReceived = false;
    fetchPost("/api/flashcard/previewMigration", {}, (previewResponse) => {
        previewReceived = true;
        if (readiness && !readiness.isCurrent()) {
            readiness.cancelled();
            return;
        }
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
            readiness?.cancelled();
            return;
        }
        const details = `${window.siyuan.languages.flashcardMigrationConfirm}<br><br>${summary}`;
        confirmDialog({
            title: window.siyuan.languages.dataMigration,
            text: details,
            confirm: () => {
                if (readiness && !readiness.isCurrent()) {
                    readiness.cancelled();
                    return;
                }
                let activated = false;
                fetchPost("/api/flashcard/activateMigration", {
                    migrationID: previewResponse.data.migrationID,
                    recordDigest: previewResponse.data.recordDigest,
                }, () => { activated = true; callback(); }, undefined, readiness?.failed, undefined, readiness ? 30000 : 0)
                    .finally(() => { if (!activated) readiness?.cancelled(); });
            },
            cancel: readiness?.cancelled,
        });
    }, undefined, readiness?.failed, undefined, readiness ? 30000 : 0)
        .finally(() => { if (!previewReceived) readiness?.cancelled(); });
};

export const ensureFlashcardV2 = (callback: () => void, readiness?: IFlashcardV2Readiness) => {
    let statusReceived = false;
    fetchPost("/api/flashcard/getMigrationStatus", {}, (response) => {
        statusReceived = true;
        if (readiness && !readiness.isCurrent()) {
            readiness.cancelled();
            return;
        }
        const status = response.data as IFlashcardMigrationStatus;
        if (status.state === "Active") {
            callback();
            return;
        }
        activateFlashcardV2(callback, readiness);
    }, undefined, readiness?.failed, undefined, readiness ? 30000 : 0)
        .finally(() => { if (!statusReceived) readiness?.cancelled(); });
};

const renderReviewSet = (revision: IFlashcardEntityRevision<IReviewSet>, summary?: IFlashcardReviewSetSummary) => {
    const summaryHTML = summary ? `<span class="b3-list-item__meta">${window.siyuan.languages.riffCard} ${summary.cards}</span>
<span class="b3-list-item__meta">${window.siyuan.languages.flashcardDueCard} ${summary.due}</span>` : "";
    return `<li class="b3-list-item b3-list-item--narrow card__v2-review-set" data-id="${escapeAttr(revision.entityID)}" data-revision="${escapeAttr(revision.revisionID)}" data-review-mode="${escapeAttr(revision.payload.defaultReviewMode || "normal")}">
<svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg>
<button type="button" data-type="cards" class="b3-list-item__text">${escapeHtml(revision.payload.name)}</button>
<span class="b3-list-item__meta">${revision.payload.defaultReviewMode === "reinforcement" ? window.siyuan.languages.flashcardReviewReinforcement : window.siyuan.languages.flashcardReviewNormal}</span>
${revision.payload.queryAST ? `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.filter}"><svg><use xlink:href="#iconFilter"></use></svg></span>` : ""}
${summaryHTML}
<button type="button" data-type="review" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.continueReview1}"><svg><use xlink:href="#iconPlay"></use></svg></button>
<button type="button" data-type="statistics" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardStatistics}"><svg><use xlink:href="#iconGraph"></use></svg></button>
<button type="button" data-type="edit" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.edit}"><svg><use xlink:href="#iconEdit"></use></svg></button>
<button type="button" data-type="delete" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.delete}"><svg><use xlink:href="#iconTrashcan"></use></svg></button>
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
        (editableReviewSetPredicates[expression.field] === expression.comparator ||
            expression.field === "tagID" && expression.comparator === "descendantOf");

const reviewSetPredicateValues = (query?: IFlashcardQueryAST) => {
    const ret: Record<string, string> = {};
    if (!query || query.version !== 1) {
        return ret;
    }
    const expressions = query.root.operator === "and" ? query.root.children || [] : [query.root];
    expressions.forEach((expression) => {
        if (isEditableReviewSetPredicate(expression)) {
            ret[expression.field] = expression.value;
            if (expression.field === "tagID") {
                ret.tagScope = expression.comparator === "descendantOf" ? "descendantOf" : "";
            }
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
        predicates.push({operator: "predicate", field: "tagID",
            comparator: values.tagScope === "descendantOf" ? "descendantOf" : "equal", value: values.tagID});
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
    const add = (field: string, comparator: string, value: IFlashcardQueryExpression["value"]) => {
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
        add("tagID", filters.tagScope === "descendantOf" ? "descendantOf" : "equal", filters.tagID);
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
    if (filters.editLater) {
        add("editLater", "equal", filters.editLater === "true");
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
    Object.entries(filters).filter(([key, value]) => !["blockIDs", "rootIDs", "tagScope"].includes(key) &&
        value !== undefined && value !== "").length;

const openFlashcardV2ReviewSetEditor = (revision: IFlashcardEntityRevision<IReviewSet> | undefined,
    callback: (saved: IFlashcardEntityRevision<IReviewSet>, canContinue: boolean) => void, initialName = "",
    initialQuery?: IFlashcardQueryAST) => {
    fetchPost("/api/flashcard/listEntities", {
        entityType: "tag",
        options: {limit: 1000, offset: 0},
    }, (response) => {
        const tags = (response.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardTag)))
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
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.name}</div><input data-type="name" required class="b3-text-field fn__block" value="${escapeAttr(current?.name || initialName)}"></label>
<div class="card__v2-filter">
<label class="card__v2-filter-toggle">
<span class="card__v2-filter-copy"><span class="card__v2-filter-title">${window.siyuan.languages.flashcardDynamicFilter}</span><span class="card__v2-filter-tip">${window.siyuan.languages.flashcardDynamicFilterTip}</span></span>
<input data-type="queryEnabled" class="b3-switch" type="checkbox"${current?.queryAST || initialQuery ? " checked" : ""}>
</label>
<div data-type="queryFilters" class="card__v2-filter-fields">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.targetNotebook}</div><select data-filter="notebookID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${notebooks.map((notebook) => `<option value="${escapeAttr(notebook.id)}">${escapeHtml(notebook.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardDocumentPath}</div><input data-filter="path" class="b3-text-field fn__block" value="${escapeAttr(filters.path || "")}" placeholder="/"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.tag}</div><select data-filter="tagID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${tags.map((tag) => `<option value="${escapeAttr(tag.id)}">${escapeHtml(flashcardTagPath(tag, tagMap))}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardTagScope}</div><select data-filter="tagScope" class="b3-select fn__block"><option value="">${window.siyuan.languages.flashcardTagOnly}</option><option value="descendantOf">${window.siyuan.languages.flashcardTagWithChildren}</option></select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardPriority}</div><select data-filter="priority" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${priorityOptions}</select></label>
</div>
</div>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.reviewMode}</div><select data-type="reviewMode" class="b3-select fn__block"><option value="normal">${window.siyuan.languages.flashcardReviewNormal}</option><option value="reinforcement">${window.siyuan.languages.flashcardReviewReinforcement}</option></select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.sort}</div><select data-type="order" class="b3-select fn__block"><option value="priorityDue">${window.siyuan.languages.sortDefault}</option><option value="due">${window.siyuan.languages.setDueTime}</option><option value="added">${window.siyuan.languages.createdAt}</option><option value="random">${window.siyuan.languages.random}</option></select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardNewCardLimit}</div><input data-type="newLimit" class="b3-text-field fn__block" required type="number" min="0" value="${current?.newLimit ?? window.siyuan.config.flashcard.newCardLimit}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardReviewCardLimit}</div><input data-type="reviewLimit" class="b3-text-field fn__block" required type="number" min="0" value="${current?.reviewLimit ?? window.siyuan.config.flashcard.reviewCardLimit}"></label>
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
            queryFilters.classList.toggle("fn__none", !queryEnabled.checked);
        };
        updateQueryEnabled();
        queryEnabled.addEventListener("change", updateQueryEnabled);
        let filtersChanged = revision === undefined && initialQuery === undefined;
        filterElements.forEach((element) => element.addEventListener("change", () => filtersChanged = true));
        const entityID = revision?.entityID || genUUID();
        const operationFor = createFlashcardV2Operation();
        const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            if (!validateFlashcardV2Fields(dialog.element)) {
                return;
            }
            const name = (dialog.element.querySelector('[data-type="name"]') as HTMLInputElement).value.trim();
            const newLimit = Number((dialog.element.querySelector('[data-type="newLimit"]') as HTMLInputElement).value);
            const reviewLimit = Number((dialog.element.querySelector('[data-type="reviewLimit"]') as HTMLInputElement).value);

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
            const operation = operationFor(payload);
            void submitFlashcardV2Form(dialog.element, async () => {
                let saved = false;
                await fetchPost("/api/flashcard/mutateEntities", {
                    operationID: operation.operationID,
                    mutations: [{
                        entityType: "reviewSet",
                        entityID,
                        expectedRevisionID: revision?.revisionID,
                        requireAbsent: revision === undefined,
                        updatedAt: operation.changedAt,
                        payload: toFlashcardV2JSON(payload),
                    }],
                }, (mutationResponse) => {
                    saved = true;
                    const canContinue = dialog.element.isConnected && dialog.element.dataset.dialogClosing !== "true";
                    callback(readFlashcardV2Revision(mutationResponse.data.revisions[0], isFlashcardReviewSet), canContinue);
                    if (canContinue) {
                        dialog.destroy();
                    }
                });
                return saved;
            });
        });
        (dialog.element.querySelector('[data-type="name"]') as HTMLInputElement).focus();
    });
};

const renderFlashcardV2Preset = (revision: IFlashcardEntityRevision<IFlashcardPreset>) => {
    const retention = `${Number((revision.payload.requestRetention * 100).toFixed(10))}%`;
    return `<li class="b3-list-item b3-list-item--narrow card__v2-preset${isMobile() ? "" : " b3-list-item--hide-action"}" data-id="${escapeAttr(revision.entityID)}" data-revision="${escapeAttr(revision.revisionID)}">
<svg class="b3-list-item__graphic"><use xlink:href="#iconSettings"></use></svg>
<div class="card__v2-preset-content"><div>${escapeHtml(revision.payload.name)}</div>
<dl class="card__v2-preset-summary">
<div><dt>${escapeHtml(window.siyuan.languages.flashcardNewCardLimit)}</dt><dd>${revision.payload.newLimit}</dd></div>
<div><dt>${escapeHtml(window.siyuan.languages.flashcardReviewCardLimit)}</dt><dd>${revision.payload.reviewLimit}</dd></div>
<div><dt>${escapeHtml(window.siyuan.languages.flashcardTargetRetention)}</dt><dd>${retention}</dd></div>
</dl></div>
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
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.name}</div><input data-type="name" required class="b3-text-field fn__block" value="${escapeAttr(current?.name || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardTargetRetention}</div><input data-type="retention" class="b3-text-field fn__block" required type="number" min="0" max="1" step="any" value="${current?.requestRetention ?? window.siyuan.config.flashcard.requestRetention}"><div class="b3-label__text ft__on-surface">${window.siyuan.languages.flashcardFSRSParamRequestRetentionTip}</div></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardNewCardLimit}</div><input data-type="newLimit" class="b3-text-field fn__block" required type="number" min="0" step="1" value="${current?.newLimit ?? window.siyuan.config.flashcard.newCardLimit}"><div class="b3-label__text ft__on-surface">${window.siyuan.languages.flashcardNewCardLimitTip}</div></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardReviewCardLimit}</div><input data-type="reviewLimit" class="b3-text-field fn__block" required type="number" min="0" step="1" value="${current?.reviewLimit ?? window.siyuan.config.flashcard.reviewCardLimit}"><div class="b3-label__text ft__on-surface">${window.siyuan.languages.flashcardReviewCardLimitTip}</div></label>
<details class="card__v2-details"><summary>${window.siyuan.languages.configGroupAdvanced}</summary><div class="card__v2-form-section">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardFSRSParamMaximumInterval}</div><input data-type="maximumInterval" class="b3-text-field fn__block" required type="number" min="1" step="1" value="${current?.maximumInterval ?? window.siyuan.config.flashcard.maximumInterval}"><div class="b3-label__text ft__on-surface">${window.siyuan.languages.flashcardFSRSParamMaximumIntervalTip}</div></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardFSRSParamWeights}</div><textarea data-type="weights" class="b3-text-field fn__block">${escapeHtml((current?.weights || defaultWeights).join(","))}</textarea><div class="b3-label__text ft__on-surface">${window.siyuan.languages.flashcardFSRSParamWeightsTip}</div></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardLeeches}</div><input data-type="leechThreshold" class="b3-text-field fn__block" required type="number" min="0" step="1" value="${current?.leechThreshold ?? 8}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.manage}</div><select data-type="leechAction" class="b3-select fn__block"><option value="tag">${window.siyuan.languages.tag}</option><option value="suspend">${window.siyuan.languages.flashcardSuspendCard}</option><option value="tagAndSuspend">${window.siyuan.languages.tag} ${window.siyuan.languages.flashcardSuspendCard}</option></select></label>
<label class="b3-label fn__flex-center"><input data-type="buryNew" class="b3-switch fn__flex-center" type="checkbox"${current?.buryNewSiblings === false ? "" : " checked"}><span class="fn__space"></span>${window.siyuan.languages.flashcardBury} - ${window.siyuan.languages.flashcardNewCard}</label>
<label class="b3-label fn__flex-center"><input data-type="buryReview" class="b3-switch fn__flex-center" type="checkbox"${current?.buryReviewSiblings === false ? "" : " checked"}><span class="fn__space"></span>${window.siyuan.languages.flashcardBury} - ${window.siyuan.languages.flashcardReviewCard}</label>
</div></details>
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
    });
    const entityID = revision?.entityID || genUUID();
    const operationFor = createFlashcardV2Operation();
    const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
    const leechAction = dialog.element.querySelector('[data-type="leechAction"]') as HTMLSelectElement;
    leechAction.value = current?.leechAction || "tag";
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", () => {
        if (!validateFlashcardV2Fields(dialog.element)) {
            return;
        }
        const name = (dialog.element.querySelector('[data-type="name"]') as HTMLInputElement).value.trim();
        const requestRetention = Number((dialog.element.querySelector('[data-type="retention"]') as HTMLInputElement).value);
        const maximumInterval = Number((dialog.element.querySelector('[data-type="maximumInterval"]') as HTMLInputElement).value);
        const newLimit = Number((dialog.element.querySelector('[data-type="newLimit"]') as HTMLInputElement).value);
        const reviewLimit = Number((dialog.element.querySelector('[data-type="reviewLimit"]') as HTMLInputElement).value);
        const leechThreshold = Number((dialog.element.querySelector('[data-type="leechThreshold"]') as HTMLInputElement).value);
        const weights = parseFlashcardV2PresetWeights((dialog.element.querySelector('[data-type="weights"]') as HTMLTextAreaElement).value);
        if (requestRetention <= 0) {
            reportFlashcardV2Field(dialog.element.querySelector<HTMLInputElement>('[data-type="retention"]'));
            return;
        }
        if (!weights) {
            reportFlashcardV2Field(dialog.element.querySelector<HTMLTextAreaElement>('[data-type="weights"]'));
            return;
        }
        const payload: IFlashcardPreset = {
            id: entityID,
            name,
            schedulerVersion: "go-fsrs-v3.3.1-fsrs6",
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
        const operation = operationFor(payload);
        void submitFlashcardV2Form(dialog.element, async () => {
            let saved = false;
            await fetchPost("/api/flashcard/mutateEntities", {
                operationID: operation.operationID,
                mutations: [{
                    entityType: "schedulerPreset",
                    entityID,
                    expectedRevisionID: revision?.revisionID,
                    requireAbsent: revision === undefined,
                    updatedAt: operation.changedAt,
                    payload: toFlashcardV2JSON(payload),
                }],
            }, (response) => {
                saved = true;
                callback(readFlashcardV2Revision(response.data.revisions[0], isFlashcardPreset));
                dialog.destroy();
            });
            return saved;
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
            const revisions = response.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardPreset));
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
                    confirmDialog({
                        title: window.siyuan.languages.deleteOpConfirm,
                        text: window.siyuan.languages.confirmDelete,
                        confirm: () => {
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
                        },
                        isDelete: true,
                    });
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

const flashcardV2SourceTypeLabels = () => {
    const sourceTypeLabels: Record<string, string> = {
        block: window.siyuan.languages.flashcardBlockCard,
        "multi-block": window.siyuan.languages.riffCard,
        qa: window.siyuan.languages.flashcardQA,
        cloze: window.siyuan.languages.flashcardClozeCards,
        ordered: window.siyuan.languages.flashcardOrdered,
        "image-occlusion": window.siyuan.languages.flashcardImageOcclusion,
        choice: window.siyuan.languages.flashcardChoiceQuestion,
        "multi-line": window.siyuan.languages.flashcardMultiLine,
        "typed-answer": window.siyuan.languages.flashcardTypedAnswer,
        anki: "Anki",
        "av-row": window.siyuan.languages.database,
    };
    listFlashcardV2PluginTypes().forEach((plugin) => {
        sourceTypeLabels[plugin.sourceType] = plugin.registration.displayName || plugin.registration.typeName;
    });
    return sourceTypeLabels;
};

const renderManagedCard = (result: IFlashcardSearchResult, reviewSetID = "",
    selectedCardIDs: ReadonlySet<string> = new Set(), flagDefinitions: IFlashcardFlagDefinition[] = [],
    grouped = false, position = 0) => {
    const type = flashcardV2SourceTypeLabels()[result.sourceType] || result.sourceType;
    const variant = result.card.variantKey === "forward" ? window.siyuan.languages.flashcardDirectionForward :
        result.card.variantKey === "reverse" ? window.siyuan.languages.flashcardDirectionReverse : "";
    const groupedTitle = ["cloze", "image-occlusion"].includes(result.sourceType) ?
        type :
        `${type} ${variant || position + 1}`;
    const title = grouped ? groupedTitle :
        result.sourceTitle || result.sourceBlockID || result.card.id;
    const statuses = [reviewStateLabel(result.reviewState.state)];
    if (result.card.editLater) {
        statuses.push(window.siyuan.languages.flashcardPendingEdits);
    }
    if (result.reviewState.suspended) {
        statuses.push(window.siyuan.languages.flashcardSuspendedCards);
    }
    if ((result.reviewState.buriedUntil || 0) > Date.now()) {
        statuses.push(window.siyuan.languages.flashcardBuriedCards);
    }
    const generationLabels: Record<string, string> = {
        disabledByTemplate: window.siyuan.languages.flashcardDisabledCards,
        orphaned: window.siyuan.languages.flashcardOrphanedCards,
        deleted: window.siyuan.languages.flashcardDeletedCards,
    };
    if (generationLabels[result.card.generationStatus]) {
        statuses.push(generationLabels[result.card.generationStatus]);
    }
    return `<li class="b3-list-item b3-list-item--narrow b3-list-item--hide-action card__v2-managed-card" data-id="${escapeAttr(result.card.id)}" data-flag="${result.card.flag}">
<input data-type="selectCard" aria-label="${escapeAttr(title)}" class="b3-list-item__graphic" type="checkbox"${selectedCardIDs.has(result.card.id) ? " checked" : ""}>
<svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg>
<span class="card__v2-managed-main">
<button data-type="preview" class="card__v2-managed-title" aria-label="${escapeAttr(`${window.siyuan.languages.flashcardPreview} - ${title}`)}">${escapeHtml(title)}</button>
<span class="card__v2-managed-details">${grouped ? "" : `<span>${escapeHtml(`${type} ${variant}`.trim())}</span>`}${statuses.map((status) => `<span class="card__v2-managed-badge">${escapeHtml(status)}</span>`).join("")}<span>${window.siyuan.languages.flashcardReviews} ${result.reviewState.reps}</span>${result.effectivePriority === "unset" ? "" : `<span>${escapeHtml(priorityLabel(result.effectivePriority))}</span>`}</span>
${result.card.editLater?.note ? `<span class="card__v2-edit-later-note ft__on-surface">${escapeHtml(result.card.editLater.note)}</span>` : ""}
${result.card.editLater ? `<span class="card__v2-edit-later-tools">${result.sourceBlockID ? `<button data-type="editCard" class="b3-button b3-button--outline"><svg><use xlink:href="#iconEdit"></use></svg>${window.siyuan.languages.edit}</button>` : ""}<button data-type="editLater" class="b3-button b3-button--text">${window.siyuan.languages.flashcardEditLaterComplete}</button></span>` : ""}
</span>
${result.sourceType === "qa" ? `<span data-type="direction" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardDirectionSettings}"><svg><use xlink:href="#iconBoth"></use></svg></span>` : ""}
<span data-type="preset" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardPreset}"><svg><use xlink:href="#iconSettings"></use></svg></span>
<span data-type="priority" class="fn__none"></span>
<span data-type="tags" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.tag}"><svg><use xlink:href="#iconTag"></use></svg></span>
<span data-type="suspend" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${result.reviewState.suspended ? window.siyuan.languages.flashcardResumeReview : window.siyuan.languages.flashcardSuspendUntilResumed}"><svg><use xlink:href="#icon${result.reviewState.suspended ? "Play" : "Pause"}"></use></svg></span>
<span data-type="bury" class="fn__none"></span>
<span data-type="due" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.setDueTime}"><svg><use xlink:href="#iconCalendar"></use></svg></span>
<button type="button" data-type="flag" data-menu="true" aria-haspopup="menu" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${escapeAttr(window.siyuan.languages.flashcardFlag)} - ${escapeAttr(flashcardFlagLabel(result.card.flag, flagDefinitions))}"${flashcardFlagStyle(result.card.flag)}><svg><use xlink:href="#iconBookmark"></use></svg></button>
<span data-type="history" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardReviewHistory}"><svg><use xlink:href="#iconHistory"></use></svg></span>
<span data-type="sourceHistory" class="fn__none" aria-label="${window.siyuan.languages.flashcardSourceHistory}"></span>
${reviewSetID ? `<span data-type="exclude" class="fn__none b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconClose"></use></svg></span>` : '<span data-type="membership" class="fn__none"></span>'}
<span data-type="reset" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.reset}"><svg><use xlink:href="#iconUndo"></use></svg></span>
<button data-type="more" data-menu="true" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></button>
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
<span data-type="sourceHistory" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardSourceHistory}"><svg><use xlink:href="#iconHistory"></use></svg></span>
${editable && !deleted ? `<span data-type="editSource" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.edit}"><svg><use xlink:href="#iconEdit"></use></svg></span>` : ""}
<span data-type="sourceTags" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.tag}"><svg><use xlink:href="#iconTag"></use></svg></span>
<span data-type="sourcePreset" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardSourcePreset}"><svg><use xlink:href="#iconSettings"></use></svg></span>
<span data-type="documentPolicy" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardDocumentSettings}"><svg><use xlink:href="#iconFile"></use></svg></span>
<span data-type="notebookPolicy" class="fn__none b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardNotebookSettings}"><svg><use xlink:href="#iconFilesRoot"></use></svg></span>
<span data-type="sourceLifecycle" class="fn__none b3-list-item__action${deleted ? "" : " b3-list-item__action--warning"} b3-tooltips b3-tooltips__w" aria-label="${deleted ? window.siyuan.languages.flashcardRestoreSource : window.siyuan.languages.delete}"><svg><use xlink:href="#icon${deleted ? "Undo" : "Trashcan"}"></use></svg></span>
<button data-type="sourceMore" data-menu="true" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></button>
</li>${sourceCards.map((card, index) => renderManagedCard(card, reviewSetID, selectedCardIDs, flagDefinitions, true, index)).join("")}`;
    }).join("");
};

const setFlashcardV2ReviewSetMembership = async (reviewSetID: string, cardIDs: string | string[],
    mode: "include" | "exclude" | "automatic", callback: () => void,
    operation: {operationID: string, changedAt: number}) => {
    let saved = false;
    await fetchPost("/api/flashcard/setReviewSetMemberships", {
        ...operation,
        reviewSetID,
        cardIDs: typeof cardIDs === "string" ? [cardIDs] : cardIDs,
        mode,
    }, () => { saved = true; callback(); });
    return saved;
};

const createFlashcardV2MembershipSubmission = () => {
    let operationFor = createFlashcardV2Operation();
    let pending = false;
    return {
        get pending() { return pending; },
        submit: async (reviewSetID: string, cardIDs: string | string[],
            mode: "include" | "exclude" | "automatic", callback: () => void) => {
            if (pending) { return false; }
            pending = true;
            const ids = [...new Set(typeof cardIDs === "string" ? [cardIDs] : cardIDs)].sort();
            const operation = operationFor({reviewSetID, cardIDs: ids, mode});
            try {
                return await setFlashcardV2ReviewSetMembership(reviewSetID, ids, mode, () => {
                    operationFor = createFlashcardV2Operation();
                    callback();
                }, operation);
            } finally {
                pending = false;
            }
        },
    };
};

const openFlashcardV2Membership = (cardIDs: string | string[], callback: () => void) => {
    fetchPost("/api/flashcard/listEntities", {
        entityType: "reviewSet",
        options: {limit: 1000, offset: 0},
    }, (response) => {
        const reviewSets = response.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardReviewSet));
        if (reviewSets.length === 0) {
            const empty = new Dialog({
                title: window.siyuan.languages.flashcardReviewSet,
                width: isMobile() ? "92vw" : "460px",
                content: `<div class="b3-dialog__content">${window.siyuan.languages.emptyContent}</div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.new}</button></div>`,
            });
            const buttons = empty.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
            buttons[0].addEventListener("click", () => empty.destroy());
            let creating = false;
            buttons[1].addEventListener("click", () => {
                if (creating) {
                    return;
                }
                creating = true;
                buttons[1].disabled = true;
                empty.destroy();
                openFlashcardV2ReviewSetEditor(undefined, (_saved, canContinue) => {
                    if (canContinue) {
                        openFlashcardV2Membership(cardIDs, callback);
                    }
                });
            });
            return;
        }
        const dialog = new Dialog({
            title: window.siyuan.languages.flashcardReviewSet,
            width: isMobile() ? "92vw" : "460px",
            content: `<div class="b3-dialog__content card__v2-form">
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardReviewSet}</div><select data-type="reviewSet" class="b3-select fn__block">${reviewSets.map((revision) => `<option value="${escapeAttr(revision.entityID)}">${escapeHtml(revision.payload.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.manage}</div><select data-type="mode" class="b3-select fn__block"><option value="include">${window.siyuan.languages.addDeck}</option><option value="exclude">${window.siyuan.languages.removeDeck}</option><option value="automatic">${window.siyuan.languages.flashcardMembershipAutomatic}</option></select><div data-type="automaticTip" class="b3-label__text ft__on-surface fn__none">${window.siyuan.languages.flashcardMembershipAutomaticTip}</div></label>
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
        });
        const modeSelect = dialog.element.querySelector<HTMLSelectElement>('[data-type="mode"]');
        const automaticTip = dialog.element.querySelector<HTMLElement>('[data-type="automaticTip"]');
        const updateAutomaticTip = () => automaticTip.classList.toggle("fn__none", modeSelect.value !== "automatic");
        modeSelect.addEventListener("change", updateAutomaticTip);
        updateAutomaticTip();
        const submission = createFlashcardV2MembershipSubmission();
        const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            const reviewSetID = (dialog.element.querySelector('[data-type="reviewSet"]') as HTMLSelectElement).value;
            const mode = (dialog.element.querySelector('[data-type="mode"]') as HTMLSelectElement).value as
                "include" | "exclude" | "automatic";
            if (!dialog.element.isConnected || dialog.element.dataset.dialogClosing === "true") {
                return;
            }
            void submitFlashcardV2Form(dialog.element, () => submission.submit(reviewSetID, cardIDs, mode, () => {
                callback();
                if (dialog.element.isConnected && dialog.element.dataset.dialogClosing !== "true") {
                    dialog.destroy();
                }
            }));
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
        title: window.siyuan.languages.flashcardDirectionSettings,
        width: isMobile() ? "92vw" : "420px",
        content: `<div class="b3-dialog__content card__v2-form"><div class="card__v2-form-note">${window.siyuan.languages.flashcardSourceActionTip}</div><select class="b3-select fn__block">
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
    const pageSize = 100;
    let offset = 0;
    let hasNext = false;
    const dialog = new Dialog({
        title: window.siyuan.languages.flashcardReviewHistory,
        width: isMobile() ? "92vw" : "640px",
        height: "70vh",
        content: `<div class="b3-dialog__content fn__flex-column card__v2-panel"><div class="card__v2-management-pagination"><button data-type="previous" class="b3-button b3-button--outline" disabled>${window.siyuan.languages.previous}</button><span data-type="page" class="b3-list-item__meta"></span><button data-type="next" class="b3-button b3-button--outline" disabled>${window.siyuan.languages.next}</button></div><ul class="b3-list b3-list--background fn__flex-1 card__v2-panel-list"></ul></div>`,
    });
    const previous = dialog.element.querySelector<HTMLButtonElement>('[data-type="previous"]');
    const next = dialog.element.querySelector<HTMLButtonElement>('[data-type="next"]');
    const labels: Record<string, string> = {
        again: window.siyuan.languages.cardRatingAgain,
        hard: window.siyuan.languages.cardRatingHard,
        good: window.siyuan.languages.cardRatingGood,
        easy: window.siyuan.languages.cardRatingEasy,
        reset: window.siyuan.languages.reset,
        setDue: window.siyuan.languages.setDueTime,
        suspend: window.siyuan.languages.flashcardSuspendCard,
        resume: window.siyuan.languages.continueReview1,
        bury: window.siyuan.languages.flashcardBury,
        unbury: window.siyuan.languages.flashcardUnbury,
    };
    const load = (nextOffset: number) => {
        previous.disabled = true;
        next.disabled = true;
        fetchPost("/api/flashcard/getCardHistory", {cardID, limit: pageSize + 1, offset: nextOffset}, (response) => {
            const events = response.data.events as Array<{
                eventType: string,
                occurredAt: number,
                payload: {rating?: string, action?: string, durationMS?: number | null}
            }>;
            offset = nextOffset;
            hasNext = events.length > pageSize;
            const page = events.slice(0, pageSize);
            dialog.element.querySelector('[data-type="page"]').textContent =
                `${page.length > 0 ? offset + 1 : 0} - ${offset + page.length}`;
            dialog.element.querySelector("ul").innerHTML = page.length === 0 ?
                `<li class="b3-list-item card__empty">${window.siyuan.languages.emptyContent}</li>` :
                page.map((event) => {
                    const type = event.payload.rating || event.payload.action || event.eventType;
                    return `<li class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(labels[type] || type)}</span>${typeof event.payload.durationMS !== "number" ? "" : `<span class="b3-list-item__meta">${(event.payload.durationMS / 1000).toFixed(1)} ${window.siyuan.languages.second}</span>`}<span class="b3-list-item__meta">${new Date(event.occurredAt).toLocaleString()}</span></li>`;
                }).join("");
        }).finally(() => {
            previous.disabled = offset === 0;
            next.disabled = !hasNext;
        });
    };
    previous.addEventListener("click", () => load(Math.max(0, offset - pageSize)));
    next.addEventListener("click", () => load(offset + pageSize));
    load(0);
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

const openFlashcardV2CardSetting = (card: IFlashcardSearchResult, type: "preset" | "priority",
    callback: () => void) => {
    const openDialog = (presets: IFlashcardPreset[] = []) => {
        const priorityOptions = ["exam", "learning", "retaining", "paused", "unset"]
            .map((priority) => `<option value="${priority}">${escapeHtml(priorityLabel(priority))}</option>`).join("");
        const presetOptions = presets.map((preset) => `<option value="${escapeAttr(preset.id)}">${escapeHtml(preset.name)}</option>`).join("");
        const inheritedPreset = presets.find((preset) => preset.id === card.defaultPresetID);
        const defaultLabel = type === "preset" ? window.siyuan.languages.flashcardInheritedPreset
            .replace("${name}", inheritedPreset?.name || window.siyuan.languages.default) : window.siyuan.languages.default;
        const dialog = new Dialog({
            title: type === "preset" ? window.siyuan.languages.flashcardPreset : window.siyuan.languages.flashcardPriority,
            width: isMobile() ? "92vw" : "420px",
            content: `<div class="b3-dialog__content card__v2-form"><select class="b3-select fn__block">
<option value="">${escapeHtml(defaultLabel)}</option>
${type === "preset" ? presetOptions : priorityOptions}
</select>${type === "preset" ? `<div class="b3-label__text">${window.siyuan.languages.flashcardInheritedPresetTip}</div>` : ""}</div>
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
        const revisions = response.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardPreset));
        openDialog(revisions.map((revision) => revision.payload));
    });
};

const openFlashcardV2StudyPolicy = (scopeType: "document" | "notebook", scopeID: string,
    presets: IFlashcardPreset[],
    callback: () => void) => {
    if (!scopeID) {
        return;
    }
    fetchPost("/api/flashcard/getStudyPolicy", {
        scopeType,
        scopeID,
    }, (response) => {
        const current = response.data.found ?
            readFlashcardV2Revision(response.data.revision, isFlashcardStudyPolicy) : undefined;
        const options = ["exam", "learning", "retaining", "paused", "unset"]
            .map((priority) => `<option value="${priority}">${escapeHtml(priorityLabel(priority))}</option>`).join("");
        const dialog = new Dialog({
            title: scopeType === "document" ? window.siyuan.languages.flashcardDocumentSettings :
                window.siyuan.languages.flashcardNotebookSettings,
            width: isMobile() ? "92vw" : "440px",
            content: `<div class="b3-dialog__content card__v2-form"><label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardPriority}</div><select data-type="priority" class="b3-select fn__block"><option value="">${window.siyuan.languages.default}</option>${options}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardDefaultPreset}</div><select data-type="defaultPreset" class="b3-select fn__block"><option value="">${window.siyuan.languages.default}</option>${presets.map((preset) => `<option value="${escapeAttr(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}</select><div class="b3-label__text">${window.siyuan.languages.flashcardDefaultPresetTip}</div></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.setDueTime}</div><input data-type="targetDate" class="b3-text-field fn__block" type="datetime-local" value="${current?.payload.targetDate ? flashcardV2LocalDateTime(current.payload.targetDate) : ""}"></label></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
        });
        const priority = dialog.element.querySelector('[data-type="priority"]') as HTMLSelectElement;
        priority.value = current?.payload.priority || "";
        const defaultPreset = dialog.element.querySelector('[data-type="defaultPreset"]') as HTMLSelectElement;
        defaultPreset.value = current?.payload.defaultPresetID || "";
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
                defaultPresetID: defaultPreset.value,
                targetDate,
                expectedRevisionID: current?.revisionID,
                updatedAt: now,
            }, () => {
                callback();
                dialog.destroy();
            });
        });
    });
};

const openFlashcardV2SourcePreset = (sourceID: string, presets: IFlashcardPreset[], callback: () => void) => {
    fetchPost("/api/flashcard/getEntity", {entityType: "cardSource", entityID: sourceID}, (response) => {
        if (!response.data.found) {
            return;
        }
        const revision = response.data.revision as IFlashcardEntityRevision<{defaultPresetID: string}>;
        const dialog = new Dialog({
            title: window.siyuan.languages.flashcardSourcePreset,
            width: isMobile() ? "92vw" : "440px",
            content: `<div class="b3-dialog__content card__v2-form"><select class="b3-select fn__block">${presets.map((preset) => `<option value="${escapeAttr(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}</select><div class="b3-label__text">${window.siyuan.languages.flashcardSourcePresetTip}</div></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
        });
        const select = dialog.element.querySelector("select") as HTMLSelectElement;
        select.value = revision.payload.defaultPresetID;
        const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            if (!select.value) {
                return;
            }
            buttons[1].disabled = true;
            fetchPost("/api/flashcard/mutateEntities", {
                operationID: genUUID(),
                mutations: [{
                    entityType: "cardSource",
                    entityID: sourceID,
                    expectedRevisionID: revision.revisionID,
                    updatedAt: Date.now(),
                    payload: {...revision.payload, defaultPresetID: select.value},
                }],
            }, () => {
                dialog.destroy();
                callback();
            }).finally(() => buttons[1].disabled = false);
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

const renderFlashcardTagChoices = (tags: IFlashcardTag[], selected: Set<string>, mixed: Set<string> = new Set()) => {
    const byID = new Map(tags.map((tag) => [tag.id, tag]));
    return [...tags].sort((left, right) => flashcardTagPath(left, byID).localeCompare(flashcardTagPath(right, byID)))
        .map((tag) => `<div class="b3-list-item b3-list-item--narrow card__v2-tag-choice${isMobile() ? "" : " b3-list-item--hide-action"}" data-id="${escapeAttr(tag.id)}"${mixed.has(tag.id) ? " data-mixed=\"true\"" : ""}>
<span class="b3-list-item__text">${escapeHtml(flashcardTagPath(tag, byID))}</span>
<input class="b3-switch" type="checkbox" value="${escapeAttr(tag.id)}" aria-label="${escapeAttr(flashcardTagPath(tag, byID))}" aria-checked="${mixed.has(tag.id) ? "mixed" : selected.has(tag.id)}"${selected.has(tag.id) ? " checked" : ""}>
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
    callback: (saved: IFlashcardEntityRevision<IFlashcardTag>) => void, onClose?: () => void,
    onAttempt?: () => void) => {
    const operationFor = createFlashcardV2Operation();
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        beforeClose: () => dialog.element.getAttribute("aria-busy") !== "true",
        destroyCallback: onClose,
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
        const payload = {
            tagID: revision.entityID,
            parentID: parent.value,
            name,
            expectedRevisionID: revision.revisionID,
        };
        const operation = operationFor(payload);
        void submitFlashcardV2Form(dialog.element, async () => {
            let saved = false;
            onAttempt?.();
            await fetchPost("/api/flashcard/saveTag", {
                ...payload, operationID: operation.operationID, updatedAt: operation.changedAt,
            }, (response) => {
                saved = true;
                if (dialog.element.isConnected) {
                    callback(readFlashcardV2Revision(response.data, isFlashcardTag));
                    dialog.element.removeAttribute("aria-busy");
                    dialog.destroy();
                }
            }, undefined, undefined, undefined, 30000);
            return saved;
        });
    });
};

const renderFlashcardInheritedTags = (tags: IFlashcardTag[], inheritedTagIDs: readonly string[]) => {
    const byID = new Map(tags.map(tag => [tag.id, tag]));
    const names = [...new Set(inheritedTagIDs)].map(id => {
        const tag = byID.get(id);
        return tag ? flashcardTagPath(tag, byID) : id;
    });
    return `<div class="b3-label__text">${escapeHtml(window.siyuan.languages.flashcardDirectTagsTip)}</div>
<div class="ft__breakword">${escapeHtml(window.siyuan.languages.flashcardInheritedTags)}: ${names.length ? names.map(escapeHtml).join("; ") : escapeHtml(window.siyuan.languages.empty)}</div>`;
};

const openFlashcardV2Tags = (targetType: "source" | "card", targetID: string | string[], selectedTagIDs: string[],
    callback: () => void,
    initialAssignments?: Readonly<Record<string, readonly string[]>>, inheritedTagIDs?: readonly string[]) => {
    fetchPost("/api/flashcard/listEntities", {
        entityType: "tag",
        options: {limit: 1000, offset: 0},
    }, (response) => {
        const revisions = response.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardTag));
        const tags = revisions.map((revision) => revision.payload);
        const targetIDs = [...new Set(Array.isArray(targetID) ? targetID : [targetID])];
        const assignments = Object.fromEntries(targetIDs.map((id) =>
            [id, [...(initialAssignments ? initialAssignments[id] || [] : selectedTagIDs)]]));
        const initialSelection = getFlashcardV2TagSelection(targetIDs, assignments);
        const selected = new Set(initialSelection.selected);
        const mixed = new Set(initialSelection.mixed);
        const changes = new Map<string, boolean>();
        const tagSave = new FlashcardV2TagSave();
        let refreshOnClose = false;
        let closed = false;
        let createOperationFor = createFlashcardV2Operation();
        const dialog = new Dialog({
            title: window.siyuan.languages.tag,
            beforeClose: () => dialog.element.getAttribute("aria-busy") !== "true",
            destroyCallback: () => {
                closed = true;
                tagSave.close();
                if (refreshOnClose) {
                    callback();
                }
            },
            width: isMobile() ? "92vw" : "520px",
            height: "70vh",
            content: `<div class="b3-dialog__content card__v2-panel">
${inheritedTagIDs === undefined ? "" : `<div data-inherited-tags>${renderFlashcardInheritedTags(tags, inheritedTagIDs)}</div>`}
<div class="card__v2-panel-toolbar"><input class="b3-text-field fn__flex-1" placeholder="${window.siyuan.languages.newTag}">
<button data-type="createTag" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.new}</button></div>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.move}</div><select data-type="createTagParent" class="b3-select fn__block">${flashcardTagParentOptions(tags)}</select></label>
<div data-tag-list class="b3-list b3-list--background fn__flex-1 card__v2-panel-list">${renderFlashcardTagChoices(tags, selected, mixed)}</div></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        });
        const unavailable = () => closed || !dialog.element.isConnected ||
            dialog.element.getAttribute("aria-busy") === "true";
        const beginAuxiliary = () => {
            if (unavailable()) {
                return;
            }
            const controls = [...dialog.element.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
                "input, select, button")];
            const disabled = controls.map(control => control.disabled);
            dialog.element.setAttribute("aria-busy", "true");
            controls.forEach(control => control.disabled = true);
            return () => {
                dialog.element.removeAttribute("aria-busy");
                controls.forEach((control, index) => control.disabled = disabled[index]);
            };
        };
        const applyMixedState = () => {
            dialog.element.querySelectorAll<HTMLInputElement>("[data-tag-list] input[type=checkbox]")
                .forEach((input) => {
                    const isMixed = mixed.has(input.value) && !changes.has(input.value);
                    input.indeterminate = isMixed;
                    input.setAttribute("aria-checked", isMixed ? "mixed" : input.checked.toString());
                });
        };
        const refreshTags = () => {
            if (closed || !dialog.element.isConnected) {
                return;
            }
            dialog.element.querySelector("[data-tag-list]").innerHTML =
                renderFlashcardTagChoices(tags, selected, mixed);
            if (inheritedTagIDs !== undefined) {
                dialog.element.querySelector("[data-inherited-tags]").innerHTML = renderFlashcardInheritedTags(tags, inheritedTagIDs);
            }
            const parent = dialog.element.querySelector('[data-type="createTagParent"]') as HTMLSelectElement;
            const parentID = parent.value;
            parent.innerHTML = flashcardTagParentOptions(tags);
            parent.value = tags.some((tag) => tag.id === parentID) ? parentID : "";
            applyMixedState();
        };
        applyMixedState();
        dialog.element.querySelector("[data-tag-list]").addEventListener("change", (event) => {
            if (unavailable()) {
                return;
            }
            const input = event.target as HTMLInputElement;
            if (input.type !== "checkbox") {
                return;
            }
            if (input.checked) {
                selected.add(input.value);
            } else {
                selected.delete(input.value);
            }
            mixed.delete(input.value);
            changes.set(input.value, input.checked);
            input.indeterminate = false;
            input.setAttribute("aria-checked", input.checked.toString());
            input.closest("[data-mixed]")?.removeAttribute("data-mixed");
        });
        dialog.element.querySelector("[data-tag-list]").addEventListener("click", (event) => {
            if (unavailable()) {
                return;
            }
            const target = (event.target as HTMLElement).closest('[data-type="editTag"]');
            const item = (event.target as HTMLElement).closest<HTMLElement>("[data-id]");
            if (!target || !item) {
                return;
            }
            const index = revisions.findIndex((revision) => revision.entityID === item.dataset.id);
            if (index < 0) {
                return;
            }
            const release = beginAuxiliary();
            if (!release) {
                return;
            }
            openFlashcardV2TagEditor(revisions[index], tags, (saved) => {
                if (closed || !dialog.element.isConnected) {
                    return;
                }
                revisions[index] = saved;
                const tagIndex = tags.findIndex((tag) => tag.id === saved.entityID);
                tags[tagIndex] = saved.payload;
            }, () => { release(); refreshTags(); }, () => { refreshOnClose = true; });
        });
        dialog.element.querySelector('[data-type="createTag"]').addEventListener("click", () => {
            if (unavailable()) {
                return;
            }
            const input = dialog.element.querySelector("input.b3-text-field") as HTMLInputElement;
            const name = input.value.trim();
            if (!name) {
                input.focus();
                return;
            }
            const parentID = (dialog.element.querySelector('[data-type="createTagParent"]') as HTMLSelectElement).value;
            const operation = createOperationFor({name, parentID});
            const tagID = operation.operationID;
            const release = beginAuxiliary();
            if (!release) {
                return;
            }
            refreshOnClose = true;
            let saved = false;
            void fetchPost("/api/flashcard/saveTag", {
                operationID: operation.operationID,
                tagID,
                parentID,
                name,
                updatedAt: operation.changedAt,
            }, (saveResponse) => {
                saved = true;
                createOperationFor = createFlashcardV2Operation();
                if (closed || !dialog.element.isConnected) {
                    return;
                }
                const revision = readFlashcardV2Revision(saveResponse.data, isFlashcardTag);
                revisions.push(revision);
                tags.push(revision.payload);
                selected.add(tagID);
                mixed.delete(tagID);
                changes.set(tagID, true);
                input.value = "";
            }, undefined, undefined, undefined, 30000).finally(() => {
                release();
                refreshTags();
                if (!saved && !closed && dialog.element.isConnected) {
                    showMessage(window.siyuan.languages.flashcardSaveFailed);
                }
            });
        });
        const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            if (unavailable()) {
                return;
            }
            if (changes.size === 0) {
                dialog.destroy();
                return;
            }
            const groups = buildFlashcardV2TagAssignmentGroups(targetIDs, assignments, Object.fromEntries(changes));
            void submitFlashcardV2Form(dialog.element, async () => {
                const saved = await tagSave.run(groups, async (group, operation) => {
                    let completed = false;
                    refreshOnClose = true;
                    await fetchPost("/api/flashcard/setTagAssignments", {
                        ...operation, targetType, ...group,
                    }, () => { completed = true; refreshOnClose = true; }, undefined, undefined, undefined, 30000);
                    return completed;
                });
                if (saved) {
                    refreshOnClose = false;
                    callback();
                    dialog.element.removeAttribute("aria-busy");
                    dialog.destroy();
                }
                return saved;
            });
        });
    });
};

const openFlashcardV2FlagDefinitions = (
    revisions: Array<IFlashcardEntityRevision<IFlashcardFlagDefinition>>, callback: () => void) => {
    const byFlag = new Map(revisions.map((revision) => [revision.payload.flag, revision]));
    const dialog = new Dialog({
        title: window.siyuan.languages.flashcardFlag,
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
    const sourceTypeLabels = flashcardV2SourceTypeLabels();
    const sourceTypeOptions = Object.entries(sourceTypeLabels)
        .map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`).join("");
    const generationOptions = `<option value="">${window.siyuan.languages.all}</option><option value="active">${window.siyuan.languages.enable}</option><option value="disabledByTemplate">${window.siyuan.languages.flashcardDirectionClosed}</option><option value="orphaned">${window.siyuan.languages.invalid}</option><option value="deleted">${window.siyuan.languages.delete}</option>`;
    const reviewStateOptions = `<option value="">${window.siyuan.languages.all}</option><option value="new">${window.siyuan.languages.flashcardNewCard}</option><option value="learning">${window.siyuan.languages.flashcardPriorityLearning}</option><option value="review">${window.siyuan.languages.flashcardReviewCard}</option><option value="relearning">${window.siyuan.languages.flashcardPriorityLearning} - ${window.siyuan.languages.flashcardReviewCard}</option>`;
    const dialog = new Dialog({
        title: window.siyuan.languages.filter,
        width: isMobile() ? "92vw" : "620px",
        height: "70vh",
        content: `<div class="b3-dialog__content card__v2-form"><div class="card__v2-form--grid">
<label class="b3-label card__v2-form-field--wide"><div class="b3-label__text">${window.siyuan.languages.search}</div><input data-filter="content" class="b3-text-field fn__block" value="${escapeAttr(filters.content || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.targetNotebook}</div><select data-filter="notebookID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${notebooks.map((notebook) => `<option value="${escapeAttr(notebook.id)}">${escapeHtml(notebook.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardDocumentPath}</div><input data-filter="path" class="b3-text-field fn__block" placeholder="/" value="${escapeAttr(filters.path || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.type}</div><select data-filter="sourceType" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${sourceTypeOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.template}</div><select data-filter="templateID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${options.templates.map((template) => `<option value="${escapeAttr(template.id)}">${escapeHtml(template.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.tag}</div><select data-filter="tagID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${options.tags.map((tag) => `<option value="${escapeAttr(tag.id)}">${escapeHtml(flashcardTagPath(tag, tagMap))}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardTagScope}</div><select data-filter="tagScope" class="b3-select fn__block"><option value="">${window.siyuan.languages.flashcardTagOnly}</option><option value="descendantOf">${window.siyuan.languages.flashcardTagWithChildren}</option></select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardFlag}</div><select data-filter="flag" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${flagOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardPreset}</div><select data-filter="presetID" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${options.presets.map((preset) => `<option value="${escapeAttr(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardGenerationStatus}</div><select data-filter="generationStatus" class="b3-select fn__block">${generationOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardReviewState}</div><select data-filter="reviewState" class="b3-select fn__block">${reviewStateOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardPendingEdits}</div><select data-filter="editLater" class="b3-select fn__block">${booleanOptions}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardPriority}</div><select data-filter="priority" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option>${priorities}</select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardSuspensionStatus}</div><select data-filter="suspended" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option><option value="true">${window.siyuan.languages.flashcardSuspendedCards}</option><option value="false">${window.siyuan.languages.flashcardUnsuspendedCards}</option></select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardBurialStatus}</div><select data-filter="buried" class="b3-select fn__block"><option value="">${window.siyuan.languages.all}</option><option value="true">${window.siyuan.languages.flashcardBuriedCards}</option><option value="false">${window.siyuan.languages.flashcardUnburiedCards}</option></select></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardDueOnOrAfter}</div><input data-filter="dueFrom" class="b3-text-field fn__block" type="datetime-local" value="${escapeAttr(filters.dueFrom || "")}"></label>
<label class="b3-label"><div class="b3-label__text">${window.siyuan.languages.flashcardDueOnOrBefore}</div><input data-filter="dueTo" class="b3-text-field fn__block" type="datetime-local" value="${escapeAttr(filters.dueTo || "")}"></label>
</div><details class="card__v2-details"><summary>${window.siyuan.languages.configGroupAdvanced}</summary><div class="card__v2-form--grid">
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
</div></details></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button data-type="clear" class="b3-button b3-button--cancel">${window.siyuan.languages.removeFilters}</button><button data-type="confirm" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
    });
    const elements = [...dialog.element.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-filter]")];
    elements.forEach((element) => {
        element.value = filters[element.dataset.filter as TFlashcardManagementStringFilter] || "";
        if (element.value && element.closest("details")) {
            element.closest("details").open = true;
        }
    });
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector('[data-type="clear"]').addEventListener("click", () => {
        callback({blockIDs: filters.blockIDs, rootIDs: filters.rootIDs});
        dialog.destroy();
    });
    dialog.element.querySelector('[data-type="confirm"]').addEventListener("click", () => {
        if (!validateFlashcardV2Fields(dialog.element)) {
            return;
        }
        for (const field of ["due", "reps", "lapses", "stability", "difficulty", "retrievability"]) {
            const from = dialog.element.querySelector<HTMLInputElement>(`[data-filter="${field}From"]`);
            const to = dialog.element.querySelector<HTMLInputElement>(`[data-filter="${field}To"]`);
            if (from.value && to.value && from.valueAsNumber > to.valueAsNumber) {
                reportFlashcardV2Field(to);
                return;
            }
        }
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
        const progress = new FlashcardV2ConflictProgress();
        const operations = conflicts.map(() => createFlashcardV2Operation());
        let changed = false;
        const entityLabels: Record<string, string> = {
            reviewSet: window.siyuan.languages.flashcardReviewSet,
            schedulerPreset: window.siyuan.languages.flashcardPreset,
            cardSource: window.siyuan.languages.flashcardCardSource,
            card: window.siyuan.languages.riffCard,
            tag: window.siyuan.languages.tag,
            flagDefinition: window.siyuan.languages.flashcardFlag,
        };
        const dialog = new Dialog({
            title: window.siyuan.languages.conflict,
            width: isMobile() ? "96vw" : "760px",
            height: "70vh",
            beforeClose: () => dialog.element.getAttribute("aria-busy") !== "true",
            destroyCallback: () => { if (changed) { callback(); } },
            content: `<div class="b3-dialog__content card__v2-conflicts">
${conflicts.length === 0 ? `<div class="card__empty">${window.siyuan.languages.emptyContent}</div>` : conflicts.map((conflict, conflictIndex) => `<div class="card__v2-conflict" data-conflict-index="${conflictIndex}">
<div class="card__v2-section-title">${escapeHtml(entityLabels[conflict.entityType] || conflict.entityType)}</div>
${conflict.revisions.map((revision) => {
                const payload = JSON.stringify(revision.payload, undefined, 2);
                const summary = flashcardV2ConflictSummary(revision.payload, window.siyuan.languages,
                    conflict.revisions.map(item => item.payload));
                return `<div class="card__v2-conflict-revision"><label class="fn__flex-center"><input type="radio" name="flashcardConflict${conflictIndex}" value="${escapeAttr(revision.revisionID)}"${revision.revisionID === conflict.selectedRevisionID ? " checked" : ""}><span class="fn__space"></span><span class="fn__flex-1">${new Date(revision.updatedAt).toLocaleString()}</span>${revision.deleted ? `<span class="ft__error">${window.siyuan.languages.delete}</span>` : ""}</label>
${summary.map(field => `<div class="fn__flex"><span class="ft__secondary">${escapeHtml(field.label)}</span><span class="fn__space"></span>${field.different ? `<mark>${escapeHtml(field.value)}</mark>` : `<span>${escapeHtml(field.value)}</span>`}</div>`).join("")}
<details><summary>JSON</summary><div class="ft__secondary">${escapeHtml(conflict.entityID)} / ${escapeHtml(revision.revisionID)}</div><pre class="fn__code">${escapeHtml(payload || "null")}</pre></details></div>`;
            }).join("")}
</div>`).join("")}
</div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text"${conflicts.length === 0 ? " disabled" : ""}>${window.siyuan.languages.confirm}</button></div>`,
        });
        const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
        buttons[0].addEventListener("click", () => dialog.destroy());
        buttons[1].addEventListener("click", () => {
            void submitFlashcardV2Form(dialog.element, async () => {
                const complete = await progress.resolve(conflicts.length, async (index) => {
                    const selected = dialog.element.querySelector<HTMLInputElement>(
                        `input[name="flashcardConflict${index}"]:checked`);
                    if (!selected) {
                        return false;
                    }
                    const payload = {
                        entityType: conflicts[index].entityType,
                        entityID: conflicts[index].entityID,
                        selectedRevisionID: selected.value,
                    };
                    const operation = operations[index](payload);
                    let saved = false;
                    await fetchPost("/api/flashcard/resolveConflict", {
                        ...payload, operationID: operation.operationID, resolvedAt: operation.changedAt,
                    }, () => { saved = true; changed = true; }, undefined, undefined, undefined, 30000);
                    return saved;
                });
                if (complete) {
                    dialog.element.removeAttribute("aria-busy");
                    dialog.destroy();
                }
                return complete;
            }).then(() => {
                conflicts.forEach((_conflict, index) => {
                    if (progress.has(index)) {
                        dialog.element.querySelectorAll<HTMLInputElement>(`input[name="flashcardConflict${index}"]`)
                            .forEach(input => input.disabled = true);
                    }
                });
            });
        });
    });
};

interface IFlashcardManagementDialog {
    view: FlashcardV2ManagementView;
    dialog?: Dialog;
    membershipSubmission?: ReturnType<typeof createFlashcardV2MembershipSubmission>;
    batchPending?: symbol;
    batchOperation?: ReturnType<typeof createFlashcardV2Operation>;
    refreshBatch?: () => void;
}

const openFlashcardV2ReviewSetCards = (reviewSetID: string, name: string, offset = 0,
    filters: IFlashcardManagementFilters = {}, managementOptions?: IFlashcardManagementOptions, grouped = true,
    owner: IFlashcardManagementDialog = {view: new FlashcardV2ManagementView()}, preserve = true) => {
    const isCurrent = owner.view.request(() =>
        openFlashcardV2ReviewSetCards(reviewSetID, name, offset, filters, undefined, grouped, owner, preserve));
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
                        if (!isCurrent()) { return; }
                        openFlashcardV2ReviewSetCards(reviewSetID, name, offset, filters, {
                            tags: (tagResponse.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardTag)))
                                .map((item) => item.payload),
                            presets: presetResponse.data.entities.map((revision) =>
                                readFlashcardV2Revision(revision, isFlashcardPreset).payload),
                            templates: templateResponse.data.entities.map((revision) =>
                                readFlashcardV2Revision(revision, isFlashcardTemplate).payload),
                            flagDefinitions: flagResponse.data.entities.map((revision) =>
                                readFlashcardV2Revision(revision, isFlashcardFlagDefinition)),
                        }, grouped, owner, preserve);
                    });
                });
            });
        });
        return;
    }
    const now = Date.now();
    const managementQuery = flashcardManagementQuery(filters);
    const filterCount = flashcardManagementFilterCount(filters);
    const policyScope = filters.rootIDs?.length === 1 ?
        {type: "document" as const, id: filters.rootIDs[0]} : filters.notebookID ?
            {type: "notebook" as const, id: filters.notebookID} : undefined;
    const queryCards = (cardIDs?: string[], total?: number, resolvedCards?: IFlashcardSearchResult[]) => {
        const renderCards = (fetchedCards: IFlashcardSearchResult[]) => {
            if (!isCurrent()) { return; }
            if (fetchedCards.length === 0 && offset > 0) {
                openFlashcardV2ReviewSetCards(reviewSetID, name,
                    Math.max(0, offset - flashcardV2ManagementPageSize), filters, managementOptions, grouped, owner, false);
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
            if (owner.dialog) {
                owner.view.capture(owner.dialog.element, preserve);
            }
            owner.view.reconcile(cards.map(card => card.card.id));
            const selectedCardIDs = owner.view.selected;
            const flagDefinitions = managementOptions.flagDefinitions.map((revision) => revision.payload);
            const content = `<div class="b3-dialog__content fn__flex-column card__v2-management">
<div class="card__v2-management-toolbar">
<div class="card__v2-management-pagination">
<button data-type="pagePrevious" class="b3-button b3-button--outline"${offset === 0 ? " disabled" : ""}>${window.siyuan.languages.previous}</button>
<span class="b3-list-item__meta">${pageLength === 0 ? 0 : offset + 1} - ${offset + pageLength}${total === undefined ? "" : ` / ${total}`}</span>
<button data-type="pageNext" class="b3-button b3-button--outline"${hasNext ? "" : " disabled"}>${window.siyuan.languages.next}</button>
</div>
<div class="card__v2-management-tools">
<button data-type="study" class="b3-button b3-button--text"${filters.editLater === "true" ? " disabled" : ""}>${window.siyuan.languages.flashcardStudy}</button>
<button data-type="pendingEdits" class="b3-button b3-button--outline" aria-pressed="${filters.editLater === "true"}">${window.siyuan.languages.flashcardPendingEdits}</button>
<button data-type="filter" class="b3-button b3-button--outline">${window.siyuan.languages.filter}${filterCount === 0 ? "" : ` (${filterCount})`}</button>
<button data-type="conflicts" class="fn__none b3-button b3-button--outline">${window.siyuan.languages.conflict}</button>
<button data-type="cleanup" class="fn__none b3-button b3-button--outline">${window.siyuan.languages.invalid}</button>
<button data-type="statistics" class="b3-button b3-button--outline">${window.siyuan.languages.statistics}</button>
${policyScope ? `<button data-type="scopePolicy" class="fn__none b3-button b3-button--outline">${window.siyuan.languages.config}</button>` : ""}
${reviewSetID === "" ? `<button data-type="saveReviewSet" class="fn__none b3-button b3-button--outline">${window.siyuan.languages.flashcardReviewSet}</button>` : ""}
<button data-type="flagDefinitions" class="fn__none b3-button b3-button--outline">${window.siyuan.languages.flashcardFlag}</button>
<button data-type="managementMore" class="b3-button b3-button--outline">${window.siyuan.languages.more}</button>
<label class="fn__flex-center"><input data-type="group" type="checkbox"${grouped ? " checked" : ""}><span class="fn__space"></span>${window.siyuan.languages.flashcardGroupBySource}</label>
</div>
</div>
<div class="card__v2-management-selection">
<label class="fn__flex-center"><input data-type="selectPage" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.flashcardSelectPage}</label>
<span data-type="selectedCount" class="b3-list-item__meta fn__flex-1">${window.siyuan.languages.selected} 0</span>
<button data-type="batchMenu" class="b3-button b3-button--outline" disabled>${window.siyuan.languages.manage}</button>
<button data-type="batchApply" class="b3-button b3-button--text" disabled>${window.siyuan.languages.confirm}</button>
</div>
<ul class="b3-list b3-list--background fn__flex-1 card__v2-management-list" tabindex="-1">${cards.length === 0 ? `<li class="b3-list-item card__empty">${filters.editLater === "true" ? window.siyuan.languages.flashcardEditLaterEmpty : window.siyuan.languages.emptyContent}</li>` : renderManagedCards(cards, grouped, reviewSetID, selectedCardIDs, flagDefinitions)}</ul></div>`;
            if (owner.dialog) {
                owner.dialog.element.querySelector(".card__v2-management").outerHTML = content;
            } else {
                owner.dialog = new Dialog({title: name, width: "min(1100px, 96vw)", height: "min(800px, 90vh)",
                    content, beforeClose: () => { owner.view.close(); return true; },
                    destroyCallback: () => owner.view.close()});
            }
            const dialog = owner.dialog;
            const listenerOptions = owner.view.bind();
            if (grouped) {
                void loadFlashcardV2GroupNumbers(cards, async sourceID => {
                    const response = await withFetchTimeout(signal => fetchSyncPost(
                        "/api/flashcard/getEntity", {entityType: "cardSource", entityID: sourceID},
                        undefined, false, signal), listenerOptions.signal, 30000);
                    const payload = response.code === 0 && response.data?.found ?
                        response.data.revision?.payload : undefined;
                    return isFlashcardV2Object(payload) ? payload.generationConfig : undefined;
                }).then(numbers => {
                    if (!isCurrent() || listenerOptions.signal.aborted) { return; }
                    dialog.element.querySelectorAll<HTMLElement>(".card__v2-managed-card").forEach(item => {
                        const card = cards.find(candidate => candidate.card.id === item.dataset.id);
                        const number = numbers.get(item.dataset.id);
                        if (!card || number === undefined) { return; }
                        const title = `${flashcardV2SourceTypeLabels()[card.sourceType] || card.sourceType} ${number}`;
                        const preview = item.querySelector<HTMLElement>('[data-type="preview"]');
                        preview.textContent = title;
                        preview.setAttribute("aria-label", `${window.siyuan.languages.flashcardPreview} - ${title}`);
                        item.querySelector('[data-type="selectCard"]').setAttribute("aria-label", title);
                    });
                });
            }
            owner.view.setRefresh(() =>
                openFlashcardV2ReviewSetCards(reviewSetID, name, offset, filters, undefined, grouped, owner));
            let batchAction = "";
            const refreshSelection = () => {
                const selectPage = dialog.element.querySelector('[data-type="selectPage"]') as HTMLInputElement;
                const selectedCount = dialog.element.querySelector('[data-type="selectedCount"]');
                const batchMenu = dialog.element.querySelector('[data-type="batchMenu"]') as HTMLButtonElement;
                const batchApply = dialog.element.querySelector('[data-type="batchApply"]') as HTMLButtonElement;
                const selectedOnPage = cards.filter((card) => selectedCardIDs.has(card.card.id)).length;
                selectPage.checked = cards.length > 0 && selectedOnPage === cards.length;
                selectPage.indeterminate = selectedOnPage > 0 && selectedOnPage < cards.length;
                selectedCount.textContent = `${window.siyuan.languages.selected} ${selectedOnPage}`;
                batchMenu.disabled = Boolean(owner.batchPending) || selectedOnPage === 0;
                batchApply.disabled = Boolean(owner.batchPending) || selectedOnPage === 0 || batchAction === "";
                if (owner.batchPending) {
                    batchApply.setAttribute("aria-busy", "true");
                } else {
                    batchApply.removeAttribute("aria-busy");
                }
                batchApply.textContent = batchAction === "tags" || batchAction === "setDue" ||
                    (batchAction === "membership" && !reviewSetID) ?
                    window.siyuan.languages.next : window.siyuan.languages.confirm;
            };
            owner.refreshBatch = () => {
                if (!listenerOptions.signal.aborted && dialog.element.isConnected &&
                    dialog.element.dataset.dialogClosing !== "true") {
                    refreshSelection();
                }
            };
            const refreshList = () => {
                owner.view.capture(dialog.element, true);
                dialog.element.querySelector(".b3-list").innerHTML = renderManagedCards(cards, grouped, reviewSetID,
                    selectedCardIDs, flagDefinitions);
                refreshSelection();
                owner.view.restore(dialog.element);
            };
            const reloadPage = () => {
                if (!dialog.element.isConnected) {
                    return;
                }
                owner.view.refresh();
            };
            owner.membershipSubmission ||= createFlashcardV2MembershipSubmission();
            const removeMembership = async (cardIDs: string | string[], target: HTMLElement) => {
                if (owner.membershipSubmission.pending || listenerOptions.signal.aborted ||
                    !dialog.element.isConnected || dialog.element.dataset.dialogClosing === "true") {
                    return;
                }
                target.setAttribute("aria-busy", "true");
                const button = target instanceof HTMLButtonElement ? target : undefined;
                const disabled = button?.disabled;
                if (button) { button.disabled = true; }
                let saved = false;
                try {
                    saved = await owner.membershipSubmission.submit(reviewSetID, cardIDs, "exclude", reloadPage);
                } catch (error) {
                    console.error(error);
                } finally {
                    if (!listenerOptions.signal.aborted && target.isConnected &&
                        dialog.element.dataset.dialogClosing !== "true") {
                        target.removeAttribute("aria-busy");
                        if (button?.dataset.type === "batchApply") {
                            refreshSelection();
                        } else if (button) {
                            button.disabled = disabled;
                        }
                        if (!saved) { showMessage(window.siyuan.languages.flashcardSaveFailed, 6000, "error"); }
                    }
                }
            };
            dialog.element.addEventListener("click", (event) => {
                const target = (event.target as HTMLElement).closest("[data-type]") as HTMLElement;
                const item = (event.target as HTMLElement).closest(".b3-list-item") as HTMLElement;
                if (!target) {
                    return;
                }
                if (target.dataset.type === "cleanup") {
                    openFlashcardV2Cleanup(reloadPage);
                    return;
                }
                const type = target.dataset.type;
                if (type === "pendingEdits") {
                    openFlashcardV2ReviewSetCards(reviewSetID, name, 0,
                        {...filters, editLater: filters.editLater === "true" ? undefined : "true"}, managementOptions, false, owner, false);
                    return;
                }
                if (type === "editLater" && item) {
                    void openFlashcardV2EditLater(item.dataset.id, reloadPage, () => dialog.element.isConnected);
                    return;
                }
                if (type === "editCard" && item) {
                    const card = cards.find((result) => result.card.id === item.dataset.id);
                    if (card?.sourceBlockID) {
                        openFlashcardV2SourceEditor(window.siyuan.ws.app, card.sourceBlockID, reloadPage);
                    }
                    return;
                }
                if (type === "managementMore") {
                    toggleMenu({
                        target: target,
                        build: (_menu, session) => {
                            const menu = new Menu();
                            ["saveReviewSet", "scopePolicy", "flagDefinitions", "cleanup", "conflicts"].forEach((action) => {
                                const button = dialog.element.querySelector<HTMLButtonElement>(`[data-type="${action}"]`);
                                if (button) {
                                    menu.addItem({label: button.textContent, click: () => button.click()});
                                }
                            });
                            if (isMobile()) {
                                session.show(() => menu.fullscreen());
                            } else {
                                const rect = target.getBoundingClientRect();
                                session.show(() => menu.open({x: rect.left, y: rect.bottom}));
                            }
                        },
                    });
                    return;
                }
                if (type === "preview" && item) {
                    openFlashcardV2Preview(cards.map((card) => card.card.id),
                        cards.findIndex((card) => card.card.id === item.dataset.id));
                    return;
                }
                if (type === "study") {
                    openFlashcardV2SubsetSession(window.siyuan.ws.app, name, reviewSetID, managementQuery,
                        cards.filter((card) => selectedCardIDs.has(card.card.id)), () => {
                            if (owner.dialog !== dialog || !dialog.element.isConnected ||
                                dialog.element.dataset.dialogClosing === "true") { return; }
                            owner.view.close();
                            dialog.destroy();
                        });
                    return;
                }
                if (type === "pagePrevious" || type === "pageNext") {
                    const nextOffset = type === "pagePrevious" ? Math.max(0, offset - flashcardV2ManagementPageSize) :
                        offset + flashcardV2ManagementPageSize;
                    openFlashcardV2ReviewSetCards(reviewSetID, name, nextOffset, filters, managementOptions, grouped, owner, false);
                    return;
                }
                if (type === "filter") {
                    openFlashcardV2ManagementFilter(filters, managementOptions, (nextFilters) => {
                        if (listenerOptions.signal.aborted) { return; }
                        openFlashcardV2ReviewSetCards(reviewSetID, name, 0, nextFilters, managementOptions, grouped, owner, false);
                    });
                    return;
                }
                if (type === "statistics") {
                    openFlashcardV2Statistics(reviewSetID, managementQuery);
                    return;
                }
                if (type === "scopePolicy" && policyScope) {
                    openFlashcardV2StudyPolicy(policyScope.type, policyScope.id, managementOptions.presets, reloadPage);
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
                    openFlashcardV2ReviewSetCards(reviewSetID, name, 0, filters, managementOptions, !grouped, owner, false);
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
                if (type === "batchMenu") {
                    if (owner.batchPending) { return; }
                    const lang = window.siyuan.languages;
                    const option = (value: string, label: string): IMenu => ({
                        label, type: "submenu", checked: batchAction === value,
                        click: () => {
                            if (listenerOptions.signal.aborted || owner.batchPending) { return; }
                            batchAction = value;
                            target.textContent = label;
                            refreshSelection();
                        },
                    });
                    toggleMenu({target, build: (_menu, session) => {
                        const menu = new Menu();
                        menu.addItem(option("tags", lang.tag));
                        menu.addItem(option("membership", reviewSetID ? lang.remove : lang.flashcardReviewSet));
                        menu.addItem({label: lang.flashcardReviewState, submenu: [
                            option("suspend", lang.flashcardSuspendUntilResumed), option("resume", lang.flashcardResumeReview),
                            option("bury", lang.flashcardBury), option("unbury", lang.flashcardUnbury),
                        ]});
                        menu.addItem({label: lang.setDueTime, submenu: [
                            option("setDue", lang.setDueTime), option("reset", lang.reset),
                        ]});
                        menu.addItem({label: lang.flashcardFlag, submenu: Array.from({length: 8}, (_, flag) =>
                            option("setFlag:" + flag, flashcardFlagLabel(flag, flagDefinitions)))});
                        menu.addItem({label: lang.flashcardPreset, submenu: [option("setPreset:", lang.default),
                            ...managementOptions.presets.map(preset => option("setPreset:" + preset.id, preset.name))]});
                        menu.addItem({label: lang.flashcardPriority, submenu: ["", "exam", "learning", "retaining", "paused"]
                            .map(priority => option("setPriority:" + priority, priority ? priorityLabel(priority) : lang.default))});
                        if (isMobile()) {
                            session.show(() => menu.fullscreen());
                        } else {
                            const rect = target.getBoundingClientRect();
                            session.show(() => menu.open({x: rect.left, y: rect.bottom}));
                        }
                    }});
                    return;
                }
                if (type === "batchApply") {
                    if (owner.batchPending || listenerOptions.signal.aborted ||
                        !dialog.element.isConnected || dialog.element.dataset.dialogClosing === "true") { return; }
                    const [action, flagValue] = batchAction.split(":");
                    const selectedCards = cards.filter((card) => selectedCardIDs.has(card.card.id));
                    const selected = selectedCards.map((card) => card.card.id);
                    if (action === "" || selected.length === 0) {
                        return;
                    }
                    if (action === "tags") {
                        const assignments = Object.fromEntries(selectedCards.map((card) =>
                            [card.card.id, card.cardTagIDs || []]));
                        const selection = getFlashcardV2TagSelection(selected, assignments);
                        openFlashcardV2Tags("card", selected, selection.selected, reloadPage, assignments);
                        return;
                    }
                    if (action === "setDue") {
                        openFlashcardV2Due(selected, Date.now(), reloadPage);
                        return;
                    }
                    if (action === "membership") {
                        if (reviewSetID) {
                            void removeMembership(selected, target);
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
                    const token = Symbol();
                    owner.batchPending = token;
                    owner.refreshBatch?.();
                    let started = false;
                    const release = () => {
                        if (owner.batchPending !== token) { return; }
                        owner.batchPending = undefined;
                        owner.refreshBatch?.();
                    };
                    const execute = async () => {
                        if (started || owner.batchPending !== token) { return; }
                        started = true;
                        if (listenerOptions.signal.aborted || !dialog.element.isConnected ||
                            dialog.element.dataset.dialogClosing === "true") {
                            release();
                            return;
                        }
                        const payload = {cardIDs: selected, action, ...request};
                        owner.batchOperation ||= createFlashcardV2Operation();
                        const operation = owner.batchOperation(payload);
                        let saved = false;
                        let failureMessage = window.siyuan.languages.flashcardSaveFailed;
                        try {
                            const response = await withFetchTimeout(signal => fetchSyncPost(
                                "/api/flashcard/manageCards", {...payload, ...operation}, undefined, false, signal),
                            undefined, 30000);
                            saved = response.code === 0;
                            if (saved) {
                                owner.batchOperation = undefined;
                                if (dialog.element.isConnected &&
                                    dialog.element.dataset.dialogClosing !== "true") {
                                    reloadPage();
                                }
                            } else if (response.msg) {
                                failureMessage = response.msg;
                            }
                        } catch (error) {
                            console.error(error);
                        } finally {
                            release();
                            if (!saved && dialog.element.isConnected &&
                                dialog.element.dataset.dialogClosing !== "true") {
                                showMessage(escapeHtml(failureMessage), 6000, "error");
                            }
                        }
                    };
                    if (action === "reset") {
                        confirmDialog({
                            title: window.siyuan.languages.reset,
                            text: window.siyuan.languages.resetCardTip.replace("${x}", selected.length.toString()),
                            confirm: () => { void execute(); },
                            cancel: release,
                        });
                    } else {
                        void execute();
                    }
                    return;
                }
                if (!item) {
                    return;
                }
                if (type === "sourceMore") {
                    toggleMenu({
                        target: target,
                        build: (_menu, session) => {
                            const menu = new Menu();
                            ["editSource", "sourceHistory", "sourceTags", "sourcePreset", "documentPolicy", "notebookPolicy", "sourceLifecycle"]
                                .forEach((action) => {
                                    const actionElement = item.querySelector(`[data-type="${action}"]`) as HTMLElement;
                                    if (!actionElement) {
                                        return;
                                    }
                                    menu.addItem({
                                        id: `flashcardV2${action}`,
                                        label: actionElement.getAttribute("aria-label") || "",
                                        click: () => actionElement.click(),
                                    });
                                });
                            if (isMobile()) {
                                session.show(() => menu.fullscreen());
                            } else {
                                const rect = target.getBoundingClientRect();
                                session.show(() => menu.open({x: rect.left, y: rect.bottom}));
                            }
                        },
                    });
                    return;
                }
                if (type === "more") {
                    const card = cards.find((result) => result.card.id === item.dataset.id);
                    if (!card) {
                        return;
                    }
                    toggleMenu({
                        target: target,
                        build: (_menu, session) => {
                            const menu = new Menu();
                            const addAction = (id: string, label: string, action: string) => {
                                menu.addItem({
                                    id,
                                    label,
                                    click: () => (item.querySelector(`[data-type="${action}"]`) as HTMLElement)?.click(),
                                });
                            };
                            const addElementAction = (id: string, action: string) => {
                                const actionElement = item.querySelector(`[data-type="${action}"]`) as HTMLElement;
                                if (actionElement) {
                                    addAction(id, actionElement.getAttribute("aria-label") || "", action);
                                }
                            };
                            addAction("flashcardV2Preview", window.siyuan.languages.flashcardPreview, "preview");
                            menu.addItem({
                                id: "flashcardV2InspectTemplate",
                                label: window.siyuan.languages.flashcardInspectTemplate,
                                click: () => openFlashcardV2Template(card.card.id),
                            });
                            if (card.sourceType === "ordered") {
                                menu.addItem({
                                    id: "flashcardV2ReorderSteps",
                                    label: window.siyuan.languages.flashcardReorderSteps,
                                    click: () => openFlashcardV2Ordered(card.card.sourceID, reloadPage, () => dialog.element.isConnected),
                                });
                            }
                            if (card.sourceBlockID) {
                                menu.addItem({
                                    id: "flashcardV2EditCard",
                                    icon: "iconEdit",
                                    label: window.siyuan.languages.edit,
                                    click: () => openFlashcardV2SourceEditor(window.siyuan.ws.app, card.sourceBlockID, reloadPage),
                                });
                            }
                            menu.addItem({
                                id: "flashcardV2EditLater",
                                icon: "iconEdit",
                                label: window.siyuan.languages.flashcardEditLater,
                                click: () => {
                                    void openFlashcardV2EditLater(card.card.id, reloadPage, () => dialog.element.isConnected);
                                },
                            });
                            menu.addItem({
                                label: window.siyuan.languages.statistics,
                                icon: "iconGraph",
                                click: () => openFlashcardV2Statistics("", {version: 1, root: {
                                    operator: "predicate", field: "cardID", comparator: "equal", value: card.card.id,
                                }}),
                            });
                            menu.addSeparator();
                            addElementAction("flashcardV2Direction", "direction");
                            addElementAction("flashcardV2Preset", "preset");
                            addAction("flashcardV2Priority", window.siyuan.languages.flashcardPriority, "priority");
                            addElementAction("flashcardV2Tags", "tags");
                            addElementAction("flashcardV2Suspend", "suspend");
                            addAction("flashcardV2Bury", (card.reviewState.buriedUntil || 0) > Date.now() ?
                                window.siyuan.languages.flashcardUnbury : window.siyuan.languages.flashcardBury, "bury");
                            addElementAction("flashcardV2Due", "due");
                            menu.addItem({
                                id: "flashcardV2Flag",
                                icon: "iconBookmark",
                                label: window.siyuan.languages.flashcardFlag,
                                submenu: flashcardV2FlagMenuItems(card.card.flag, flagDefinitions, (flag) => {
                                    fetchPost("/api/flashcard/manageCards", {
                                        operationID: genUUID(), cardIDs: [card.card.id], action: "setFlag", flag,
                                        changedAt: Date.now(),
                                    }, reloadPage);
                                }),
                            });
                            addElementAction("flashcardV2History", "history");
                            addElementAction("flashcardV2SourceHistory", "sourceHistory");
                            menu.addItem({
                                id: "flashcardV2DocumentHistory",
                                label: window.siyuan.languages.fileHistory,
                                icon: "iconHistory",
                                click: () => { void openFlashcardV2DocumentHistory(card.sourceRootID || card.sourceBlockID); },
                            });
                            if (reviewSetID) {
                                addElementAction("flashcardV2Exclude", "exclude");
                            } else {
                                addAction("flashcardV2Membership", window.siyuan.languages.flashcardReviewSet, "membership");
                            }
                            addElementAction("flashcardV2Reset", "reset");
                            if (isMobile()) {
                                session.show(() => menu.fullscreen());
                            } else {
                                const rect = target.getBoundingClientRect();
                                session.show(() => menu.open({x: rect.left, y: rect.bottom}));
                            }
                        },
                    });
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
                if (type === "sourceHistory") {
                    const sourceID = item.dataset.sourceId || cards.find((card) => card.card.id === item.dataset.id)?.card.sourceID;
                    if (sourceID) {
                        void openFlashcardV2SourceHistory(sourceID, reloadPage);
                    }
                    return;
                }
                if (type === "sourceTags") {
                    const sourceID = item.dataset.sourceId;
                    const sourceCards = sourceID ? cards.filter((card) => card.card.sourceID === sourceID) : [];
                    if (sourceID && sourceCards.length > 0) {
                        openFlashcardV2Tags("source", sourceID, sourceCards[0].sourceTagIDs || [], reloadPage);
                    }
                    return;
                }
                if (type === "sourcePreset" && item.dataset.sourceId) {
                    openFlashcardV2SourcePreset(item.dataset.sourceId, managementOptions.presets, reloadPage);
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
                        confirmDialog({
                            title: window.siyuan.languages.deleteOpConfirm,
                            text: `${window.siyuan.languages.confirmDelete}<br>${window.siyuan.languages.flashcardSourceActionTip}`,
                            confirm: execute,
                        });
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
                        const model = renderResponse.data;
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
                                generationConfig: readFlashcardV2Payload(model.source.generationConfig, isFlashcardV2AdvancedGenerationConfig),
                                references,
                                modeHint: readFlashcardV2Payload(model.template.generationRule, isFlashcardV2GenerationRule).mode,
                            }, reloadPage);
                        });
                    });
                    return;
                }
                if ((type === "documentPolicy" || type === "notebookPolicy") && item.dataset.sourceId) {
                    const sourceCards = cards.filter((card) => card.card.sourceID === item.dataset.sourceId);
                    if (sourceCards.length > 0) {
                        const scopeType = type === "documentPolicy" ? "document" : "notebook";
                        const scopeID = scopeType === "document" ? sourceCards[0].sourceRootID :
                            sourceCards[0].sourceNotebookID;
                        openFlashcardV2StudyPolicy(scopeType, scopeID, managementOptions.presets, reloadPage);
                    }
                    return;
                }
                if (type === "history") {
                    openFlashcardV2CardHistory(item.dataset.id);
                    return;
                }
                if (type === "exclude" && reviewSetID && item.dataset.id) {
                    void removeMembership(item.dataset.id, target);
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
                    openFlashcardV2Tags("card", selectedCard.card.id, selectedCard.cardTagIDs || [], reloadPage, undefined,
                        selectedCard.sourceTagIDs || []);
                    return;
                }
                if ((type === "preset" || type === "priority") && selectedCard) {
                    openFlashcardV2CardSetting(selectedCard, type, reloadPage);
                    return;
                }
                if (type === "due" && selectedCard) {
                    openFlashcardV2Due([selectedCard.card.id], selectedCard.reviewState.due, reloadPage);
                    return;
                }
                if (type === "flag" && selectedCard) {
                    toggleMenu({
                        target: target,
                        build: (_menu, session) => {
                            const menu = new Menu();
                            flashcardV2FlagMenuItems(selectedCard.card.flag, flagDefinitions, (flag) => {
                                fetchPost("/api/flashcard/manageCards", {
                                    operationID: genUUID(),
                                    cardIDs: [selectedCard.card.id],
                                    action: "setFlag",
                                    flag,
                                    changedAt: Date.now(),
                                }, reloadPage);
                            }).forEach((option) => menu.addItem(option));
                            if (isMobile()) {
                                session.show(() => menu.fullscreen());
                            } else {
                                const rect = target.getBoundingClientRect();
                                session.show(() => menu.open({x: rect.left, y: rect.bottom}));
                            }
                        },
                    });
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
                }
                if (action === "") {
                    return;
                }
                const execute = () => fetchPost("/api/flashcard/manageCards", {
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
                if (action === "reset") {
                    confirmDialog({
                        title: window.siyuan.languages.reset,
                        text: window.siyuan.languages.resetCardTip.replace("${x}", "1"),
                        confirm: execute,
                    });
                } else {
                    void execute();
                }
            }, listenerOptions);
            refreshSelection();
            owner.view.restore(dialog.element);
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

export const openFlashcardV2PendingEdits = () => {
    ensureFlashcardV2(() => openFlashcardV2ReviewSetCards("", window.siyuan.languages.manage,
        0, {editLater: "true"}, undefined, false));
};

export const openFlashcardV2ManagementByNotebook = (notebookID: string) => {
    ensureFlashcardV2(() => openFlashcardV2ReviewSetCards("", window.siyuan.languages.manage, 0, {notebookID}));
};

export const openFlashcardV2ManagementByBlocks = (blockIDs: string[], name: string) => {
    const uniqueBlockIDs = [...new Set(blockIDs.filter(Boolean))];
    ensureFlashcardV2(() => openFlashcardV2ReviewSetCards("", name, 0, {blockIDs: uniqueBlockIDs}));
};

export const openFlashcardV2ManagementByRoots = (rootIDs: string[], name: string) => {
    const uniqueRootIDs = [...new Set(rootIDs.filter(Boolean))];
    ensureFlashcardV2(() => openFlashcardV2ReviewSetCards("", name, 0, {rootIDs: uniqueRootIDs}));
};

export const openFlashcardV2ReviewPicker = (app: App) => {
    ensureFlashcardV2(() => {
        fetchPost("/api/flashcard/listEntities", {
            entityType: "reviewSet",
            options: {limit: 1000, offset: 0},
        }, (response) => {
            const revisions = response.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardReviewSet));
            let multiple = false;
            let next: (() => void) | undefined;
            const dialog = new Dialog({
                title: window.siyuan.languages.spaceRepetition,
                width: isMobile() ? "92vw" : "520px",
                height: `min(70vh, ${240 + revisions.length * 36}px)`,
                destroyCallback: () => {
                    if (next) {
                        queueMicrotask(next);
                    }
                },
                content: `<div class="b3-dialog__content card__v2-panel card__v2-review-picker">
<div class="b3-list b3-list--background card__v2-panel-list">
<button data-type="all" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.all}</span></button>
${revisions.map((revision, index) => `<div class="card__v2-picker-row"><input data-type="selectSet" data-index="${index}" type="checkbox" class="fn__none" aria-label="${escapeAttr(revision.payload.name)}"><button data-type="review" data-index="${index}" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconPlay"></use></svg><span class="b3-list-item__text">${escapeHtml(revision.payload.name)}</span><span class="b3-list-item__meta">${revision.payload.defaultReviewMode === "reinforcement" ? window.siyuan.languages.flashcardReviewReinforcement : window.siyuan.languages.flashcardReviewNormal}</span></button></div>`).join("")}
</div>
<div data-type="selectionOptions" class="card__v2-picker-options fn__none">
<label class="fn__flex"><span class="fn__flex-1">${window.siyuan.languages.reviewMode}</span><select data-type="reviewMode" class="b3-select"><option value="normal">${window.siyuan.languages.flashcardReviewNormal}</option><option value="reinforcement">${window.siyuan.languages.flashcardReviewReinforcement}</option></select></label>
<div data-type="modeTip" class="ft__on-surface">${window.siyuan.languages.flashcardReviewNormalTip}</div>
</div></div>
<div class="b3-dialog__action card__v2-picker-actions"><button data-type="pendingEdits" class="b3-button b3-button--outline">${window.siyuan.languages.flashcardPendingEdits}</button><button data-type="manage" class="b3-button b3-button--outline">${window.siyuan.languages.manage}</button><button data-type="multiple" class="b3-button b3-button--outline" aria-pressed="false"${revisions.length === 0 ? " disabled" : ""}>${window.siyuan.languages.multiSelect}</button><button data-type="start" class="b3-button b3-button--text fn__none" disabled>${window.siyuan.languages.flashcardStudy}</button></div>`,
            });
            const checkboxes = [...dialog.element.querySelectorAll<HTMLInputElement>('[data-type="selectSet"]')];
            const mode = dialog.element.querySelector<HTMLSelectElement>('[data-type="reviewMode"]');
            const start = dialog.element.querySelector<HTMLButtonElement>('[data-type="start"]');
            const updateSelection = () => {
                const count = checkboxes.filter((checkbox) => checkbox.checked).length;
                start.disabled = count === 0;
                start.textContent = `${window.siyuan.languages.flashcardStudy} (${count})`;
                checkboxes.forEach((checkbox) => {
                    checkbox.parentElement.classList.toggle("b3-list-item--focus", checkbox.checked);
                    const button = checkbox.parentElement.querySelector("button");
                    button.querySelector(".b3-list-item__meta").classList.toggle("fn__none", multiple);
                    if (multiple) {
                        button.setAttribute("aria-pressed", String(checkbox.checked));
                    } else {
                        button.removeAttribute("aria-pressed");
                    }
                });
            };
            dialog.element.addEventListener("change", updateSelection);
            mode.addEventListener("change", () => {
                dialog.element.querySelector('[data-type="modeTip"]').textContent = mode.value === "normal" ?
                    window.siyuan.languages.flashcardReviewNormalTip : window.siyuan.languages.flashcardReviewReinforcementTip;
            });
            dialog.element.addEventListener("click", (event) => {
                const target = (event.target as HTMLElement).closest<HTMLElement>("button[data-type]");
                if (!target) {
                    return;
                }
                if (target.dataset.type === "multiple") {
                    multiple = !multiple;
                    target.setAttribute("aria-pressed", String(multiple));
                    checkboxes.forEach((checkbox) => checkbox.classList.toggle("fn__none", !multiple));
                    dialog.element.querySelector('[data-type="selectionOptions"]').classList.toggle("fn__none", !multiple);
                    start.classList.toggle("fn__none", !multiple);
                    updateSelection();
                    return;
                }
                if (multiple && ["review", "all"].includes(target.dataset.type)) {
                    if (target.dataset.type === "all") {
                        const checked = !checkboxes.every((checkbox) => checkbox.checked);
                        checkboxes.forEach((checkbox) => checkbox.checked = checked);
                    } else {
                        const checkbox = checkboxes[Number(target.dataset.index)];
                        checkbox.checked = !checkbox.checked;
                    }
                    updateSelection();
                    return;
                }
                if (target.dataset.type === "pendingEdits") {
                    next = openFlashcardV2PendingEdits;
                } else if (target.dataset.type === "manage") {
                    next = () => openFlashcardV2ReviewSets(app);
                } else if (target.dataset.type === "all") {
                    next = () => openFlashcardV2ReviewSession(app, "", window.siyuan.languages.riffCard, {reviewMode: "normal"});
                } else if (target.dataset.type === "review") {
                    const revision = revisions[Number(target.dataset.index)];
                    next = () => openFlashcardV2ReviewSession(app, revision.entityID, revision.payload.name, {
                        reviewMode: revision.payload.defaultReviewMode || "normal",
                    });
                } else if (target.dataset.type === "start") {
                    const selected = checkboxes.filter((checkbox) => checkbox.checked)
                        .map((checkbox) => revisions[Number(checkbox.dataset.index)]);
                    if (selected.length === 0) {
                        return;
                    }
                    next = () => openFlashcardV2ReviewSession(app, "", selected.map((revision) => revision.payload.name).join(" / "), {
                        reviewMode: mode.value === "reinforcement" ? "reinforcement" : "normal",
                        reviewSetIDs: selected.map((revision) => revision.entityID),
                    });
                }
                if (next) {
                    dialog.destroy();
                }
            });
        });
    });
};

export const openFlashcardV2ReviewSets = (app: App) => {
    ensureFlashcardV2(() => {
        fetchPost("/api/flashcard/listEntities", {
            entityType: "reviewSet",
            options: {limit: 1000, offset: 0},
        }, (response) => {
            const revisions = response.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardReviewSet));
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
                    const active = document.activeElement as HTMLElement;
                    const action = item.contains(active) ? active.dataset.type : undefined;
                    item.outerHTML = renderReviewSet(revision, summaries[revision.entityID]);
                    if (action) {
                        [...dialog.element.querySelectorAll<HTMLElement>(".b3-list-item")]
                            .find((element) => element.dataset.id === revision.entityID)
                            ?.querySelector<HTMLElement>(`[data-type="${action}"]`)?.focus();
                    }
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
                const actionTarget = target.closest("[data-type]");
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
                        confirmDialog({
                            title: window.siyuan.languages.deleteOpConfirm,
                            text: window.siyuan.languages.confirmDelete,
                            confirm: () => {
                                fetchPost("/api/flashcard/deleteReviewSet", {
                                    operationID: genUUID(),
                                    reviewSetID: item.dataset.id,
                                    expectedRevisionID: item.dataset.revision,
                                    deletedAt: Date.now(),
                                }, () => item.remove());
                            },
                            isDelete: true,
                        });
                        return;
                    }
                    if (item && (type === "cards" || (!type && !actionTarget))) {
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
            const revisions = response.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardReviewSet));
            const dialog = new Dialog({
                title: window.siyuan.languages.flashcardQA,
                width: isMobile() ? "92vw" : "520px",
                content: `<div class="b3-dialog__content card__v2-basic card__v2-form">
<label class="b3-label b3-label--inner card__v2-basic-field">
    <div class="b3-label__text">${window.siyuan.languages.flashcardDirectionSettings}</div>
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
            const sourceID = genUUID();
            const operationFor = createFlashcardV2Operation();
            const reviewSets = dialog.element.querySelector<HTMLSelectElement>('[data-type="reviewSets"]');
            enhanceFlashcardV2MultiSelect(reviewSets);
            const buttons = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
            buttons[0].addEventListener("click", () => dialog.destroy());
            buttons[1].addEventListener("click", () => {
                const direction = (dialog.element.querySelector('[data-type="direction"]') as HTMLSelectElement).value;
                const payload = {
                    sourceID,
                    blockIDs,
                    direction,
                    reviewSetIDs: [...reviewSets.selectedOptions].map((option) => option.value),
                };
                const operation = operationFor(payload);
                void submitFlashcardV2Form(dialog.element, async () => {
                    let saved = false;
                    await fetchPost("/api/flashcard/createBasicSource", {
                        ...payload, operationID: operation.operationID, createdAt: operation.changedAt,
                    }, () => {
                        saved = true;
                        dialog.destroy();
                    });
                    return saved;
                });
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

const isFlashcardV2GenerationRule = (value: unknown): value is {mode: string} => isFlashcardV2Object(value) &&
    typeof value.mode === "string";

const isFlashcardV2AdvancedGenerationConfig = (value: unknown): value is IFlashcardV2AdvancedGenerationConfig => {
    if (!isFlashcardV2Object(value)) {
        return false;
    }
    const optionalList = (items: unknown, valid: (item: unknown) => boolean) =>
        items === undefined || Array.isArray(items) && items.every(valid);
    const orderedItem = (item: unknown): item is {id: string, displayOrder: number} => isFlashcardV2Object(item) &&
        typeof item.id === "string" && typeof item.displayOrder === "number";
    if (!optionalList(value.occlusions, (item) => orderedItem(item) && "groupIDs" in item && isFlashcardV2Strings(item.groupIDs)) ||
        !optionalList(value.groups, (item) => orderedItem(item) &&
            (!("shapeIDs" in item) || isFlashcardV2Strings(item.shapeIDs))) ||
        !optionalList(value.steps, (item) => orderedItem(item) && "occlusionIDs" in item && isFlashcardV2Strings(item.occlusionIDs)) ||
        !optionalList(value.options, orderedItem)) {
        return false;
    }
    if (!optionalList(value.shapes, (item) => isFlashcardV2Object(item) && typeof item.id === "string" &&
        ["rectangle", "ellipse", "polygon"].includes(String(item.type)) &&
        [item.x, item.y, item.width, item.height].every((number) => number === undefined || typeof number === "number") &&
        optionalList(item.points, (point) => isFlashcardV2Object(point) &&
            typeof point.x === "number" && typeof point.y === "number"))) {
        return false;
    }
    return [value.frontMode, value.mode, value.revealMode].every((item) => item === undefined || typeof item === "string") &&
        [value.randomize, value.caseSensitive, value.ignoreDiacritics, value.trimWhitespace, value.collapseWhitespace]
            .every((item) => item === undefined || typeof item === "boolean") &&
        [value.dynamicDistractorCount, value.fuzzyMaxDistance, value.fuzzyMaxRatio]
            .every((item) => item === undefined || typeof item === "number") &&
        (value.correctOptionIDs === undefined || isFlashcardV2Strings(value.correctOptionIDs)) &&
        (value.distractorQuery === undefined || isFlashcardQuery(value.distractorQuery));
};

interface IFlashcardV2AdvancedEdit {
    sourceID: string;
    expectedRevisionID: string;
    sourceType: string;
    generationConfig: IFlashcardV2AdvancedGenerationConfig;
    references: Array<{ entityID: string, role: string, sort: number }>;
    modeHint?: string;
}

interface IFlashcardV2AdvancedCandidate {
    edit: IFlashcardV2AdvancedEdit;
    updatedAt: number;
}

interface IFlashcardV2AdvancedRenderModel {
    source: {sourceType: string, generationConfig: IFlashcardV2AdvancedGenerationConfig};
    references: Array<{entityType: string, entityID: string, role: string, sort: number}>;
    template: {generationRule: {mode: string}};
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

const flashcardV2AdvancedModeLabel = (edit: IFlashcardV2AdvancedEdit) => {
    const labels: Record<string, string> = {
        cloze: window.siyuan.languages.flashcardClozeCards,
        orderedSingle: window.siyuan.languages.flashcardOrderedSingle,
        orderedCards: window.siyuan.languages.flashcardOrderedCards,
        imageOcclusion: window.siyuan.languages.flashcardImageOcclusion,
        choiceSingle: window.siyuan.languages.flashcardChoiceSingle,
        choiceMultiple: window.siyuan.languages.flashcardChoiceMultiple,
        multiLineAll: window.siyuan.languages.flashcardMultiLineAll,
        multiLineSteps: window.siyuan.languages.flashcardMultiLineSteps,
        typedAnswer: window.siyuan.languages.flashcardTypedAnswer,
    };
    return labels[flashcardV2AdvancedEditMode(edit)] || edit.sourceType;
};

const fetchFlashcardV2Data = <T>(url: string, data: unknown) => new Promise<T | undefined>((resolve) => {
    let completed = false;
    fetchPost(url, data, (response) => {
        completed = true;
        resolve(response.data as T);
    }).finally(() => {
        if (!completed) {
            resolve(undefined);
        }
    });
});

const loadFlashcardV2AdvancedCandidates = async (blockIDs: string[]) => {
    const advancedSourceTypes = ["cloze", "ordered", "image-occlusion", "choice", "multi-line", "typed-answer"];
    const queryData = await fetchFlashcardV2Data<{cards: IFlashcardSearchResult[]}>("/api/flashcard/queryCards", {
        query: {
            version: 1,
            root: {
                operator: "and",
                children: [
                    {operator: "predicate", field: "blockID", comparator: "equal", value: blockIDs[0]},
                    {operator: "predicate", field: "sourceType", comparator: "in", value: advancedSourceTypes},
                ],
            },
        },
        options: {
            now: Date.now(),
            includeInactive: true,
            includeSuspended: true,
            includeBuried: true,
            includePaused: true,
            groupBySource: true,
            limit: 1000,
            offset: 0,
        },
    });
    const cardBySource = new Map<string, IFlashcardSearchResult>();
    (queryData?.cards || []).forEach((card) => {
        if (card.sourceStatus === "active" && !cardBySource.has(card.card.sourceID)) {
            cardBySource.set(card.card.sourceID, card);
        }
    });
    const candidates = await Promise.all([...cardBySource.values()].map(async (card) => {
        const [model, entity] = await Promise.all([
            fetchFlashcardV2Data<IFlashcardV2AdvancedRenderModel>("/api/flashcard/getRenderModel", {
                cardID: card.card.id,
            }),
            fetchFlashcardV2Data<{found: boolean, revision: IFlashcardEntityRevision<unknown>}>(
                "/api/flashcard/getEntity", {entityType: "cardSource", entityID: card.card.sourceID}),
        ]);
        if (!model || !entity?.found) {
            return;
        }
        const references = model.references.filter((reference) => reference.entityType === "block")
            .sort((left, right) => left.sort - right.sort);
        if (references.length !== blockIDs.length ||
            references.some((reference, index) => reference.entityID !== blockIDs[index])) {
            return;
        }
        return {
            edit: {
                sourceID: card.card.sourceID,
                expectedRevisionID: entity.revision.revisionID,
                sourceType: model.source.sourceType,
                generationConfig: model.source.generationConfig,
                references,
                modeHint: model.template.generationRule.mode,
            },
            updatedAt: entity.revision.updatedAt,
        } as IFlashcardV2AdvancedCandidate;
    }));
    return candidates.filter((candidate): candidate is IFlashcardV2AdvancedCandidate => !!candidate)
        .sort((left, right) => right.updatedAt - left.updatedAt);
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

const prepareFlashcardV2InlineOcclusions = (blockIDs: string[], doms: Record<string, string>) => {
    const updates: Array<{ id: string, data: string, dataType: "dom" }> = [];
    const blocks = [...new Set(blockIDs)].map((blockID) => {
        const template = document.createElement("template");
        template.innerHTML = doms[blockID] || "";
        return {blockID, template, marks: [...template.content.querySelectorAll<HTMLElement>('span[data-type~="mark"]')]};
    });
    const resolved = resolveFlashcardV2InlineOcclusions(blocks.flatMap(({blockID, marks}) =>
        marks.map((mark) => ({id: mark.dataset.occlusionId, blockID, label: mark.textContent || ""}))),
    () => Lute.NewNodeID());
    let index = 0;
    blocks.forEach(({blockID, template, marks}) => {
        let changed = false;
        marks.forEach((mark) => {
            const id = resolved.ids[index++];
            if (mark.dataset.occlusionId !== id) {
                mark.dataset.occlusionId = id;
                changed = true;
            }
        });
        if (changed && template.content.firstElementChild) {
            updates.push({id: blockID, data: template.content.firstElementChild.outerHTML, dataType: "dom"});
        }
    });
    return {targets: resolved.targets, updates};
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
    let destroyed = false;
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
        if (destroyed) {
            return;
        }
        const ratio = window.devicePixelRatio || 1;
        // 画布与图片共享父级变换，使用布局尺寸避免将弹窗缩放重复应用到画布。
        const width = Math.max(1, image.clientWidth);
        const height = Math.max(1, image.clientHeight);
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
        }
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
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
    window.addEventListener("resize", redraw);
    const observer = new ResizeObserver(redraw);
    observer.observe(image);
    const frame = requestAnimationFrame(redraw);
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
        destroy: () => {
            destroyed = true;
            observer.disconnect();
            cancelAnimationFrame(frame);
            image.removeEventListener("load", redraw);
            window.removeEventListener("resize", redraw);
            document.removeEventListener("keydown", keydown, true);
        },
    };
};

const openFlashcardV2AdvancedSourceEditor = (blockIDs: string[], edit?: IFlashcardV2AdvancedEdit,
    callback?: () => void) => {
    if (blockIDs.length === 0) {
        return;
    }
    ensureFlashcardV2(() => {
        fetchPost("/api/flashcard/listEntities", {
            entityType: "reviewSet",
            options: {limit: 1000, offset: 0},
        }, (response) => {
            const revisions = response.data.entities.map((revision) => readFlashcardV2Revision(revision, isFlashcardReviewSet));
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
                const newInlineTargets = edit?.sourceType === "cloze" && editingInlineOcclusions ?
                    preparedInline.targets.filter((target) => !initialOcclusionIDs.has(target.id)) : [];
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
                const clozeTargetHTML = (target: IFlashcardV2InlineOcclusion, targetIndex: number,
                    selected: ReadonlySet<string>) =>
                    `<label class="b3-label b3-label--inner card__v2-advanced-field"><div class="b3-label__text">${escapeHtml(target.label)}</div><select data-type="clozeGroups" data-target-index="${targetIndex}" class="b3-select fn__block" multiple size="${Math.min(6, Math.max(2, clozeTargets.length))}">${clozeGroupOrder.map((groupID, groupIndex) => `<option value="${escapeAttr(groupID)}"${selected.has(groupID) ? " selected" : ""}>${groupIndex + 1}</option>`).join("")}</select></label>`;
                const clozeEditorHTML = `<div data-type="clozeEditor" class="card__v2-advanced-section">
<div data-type="clozeTargets" class="fn__flex-column" style="gap:12px">
${clozeTargets.map((target, targetIndex) => {
                    const selected = initialGroupIDs(target);
                    return clozeTargetHTML(target, targetIndex, selected.size > 0 ? selected :
                        new Set([clozeGroupOrder[targetIndex]]));
                }).join("")}
</div>
${clozeTargets.length === 0 ? `<div data-type="clozeEmpty" class="card__empty">${window.siyuan.languages.emptyContent}</div>` : ""}
${newInlineTargets.length > 0 ? `<div class="card__v2-advanced-section-action"><button data-type="includeNewMarks" class="b3-button b3-button--outline">${window.siyuan.languages.flashcardIncludeNewMarks} (${newInlineTargets.length})</button></div>` : ""}
<div data-type="clozeGroupOrder" class="b3-list b3-list--background"></div>
<div class="card__v2-advanced-section-action"><button data-type="addClozeGroup" class="b3-button b3-button--outline"><svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.group}</button></div>
</div>`;
                const imageEditorHTML = imageSource ? `<div data-type="imageEditor" class="fn__none card__v2-advanced-section">
<div class="card__v2-advanced-image-toolbar">
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
                const typedFuzzyDistance = edit?.generationConfig.fuzzyMaxDistance;
                const typedFuzzyRatio = edit?.generationConfig.fuzzyMaxRatio ?? 0.1;
                const typedFuzzyEnabled = (Number.isInteger(typedFuzzyDistance) && typedFuzzyDistance > 0) ||
                    (Number.isFinite(typedFuzzyRatio) && typedFuzzyRatio > 0 && typedFuzzyRatio <= 1);
                const typedEditorHTML = blockIDs.length >= 2 ? `<div data-type="typedEditor" class="fn__none card__v2-advanced-section">
<label class="b3-label b3-label--inner fn__flex-center card__v2-advanced-switch"><input data-type="typedCaseSensitive" class="b3-switch fn__flex-center" type="checkbox"><span class="fn__space"></span>${window.siyuan.languages.searchCaseSensitive}</label>
<label class="b3-label b3-label--inner fn__flex-center card__v2-advanced-switch"><input data-type="typedMatchDiacritics" class="b3-switch fn__flex-center" type="checkbox" checked><span class="fn__space"></span>${window.siyuan.languages.matchDiacritics}</label>
${typedFuzzyEnabled ? `<div class="b3-label__text ft__on-surface">${window.siyuan.languages.flashcardTypedFuzzyTip}</div>` : ""}
</div>` : "";
                let imageEditor: IFlashcardV2ImageEditor | undefined;
                const draftPreview = new FlashcardV2DraftPreview();
                const dialog = new Dialog({
                    title: window.siyuan.languages.configGroupAdvanced,
                    width: isMobile() ? "96vw" : "720px",
                    height: imageSource || blockIDs.length >= 3 ? "82vh" : undefined,
                    containerClassName: "card__v2-advanced-dialog",
                    beforeClose: () => { draftPreview.close(); return true; },
                    destroyCallback: () => imageEditor?.destroy(),
                    content: `<div class="b3-dialog__content card__v2-advanced">
${edit ? `<div class="card__v2-form-note">${window.siyuan.languages.flashcardSourceActionTip}</div>` : ""}
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
<div class="card__v2-advanced-summary"><span>${window.siyuan.languages.blockCount}</span><strong>${blockIDs.length}</strong></div>
${edit ? "" : `<label class="b3-label b3-label--inner card__v2-advanced-field">
    <div class="b3-label__text">${window.siyuan.languages.flashcardReviewSet}</div>
    <select data-type="reviewSets" class="b3-select fn__block" multiple size="${Math.min(6, Math.max(2, revisions.length))}">
        ${revisions.map((revision) => `<option value="${escapeAttr(revision.entityID)}">${escapeHtml(revision.payload.name)}</option>`).join("")}
    </select>
</label>`}
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button><div class="fn__space"></div>
    <button data-type="draftPreview" class="b3-button b3-button--outline">${window.siyuan.languages.flashcardPreview}</button>
</div>`,
                });
                const sourceID = edit?.sourceID || genUUID();
                const operationFor = createFlashcardV2Operation();
                const reviewSets = dialog.element.querySelector<HTMLSelectElement>('[data-type="reviewSets"]');
                if (reviewSets) {
                    enhanceFlashcardV2MultiSelect(reviewSets);
                }
                const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
                const previewButton = buttons[2];
                ["input", "change", "click", "pointerup"].forEach((type) =>
                    dialog.element.addEventListener(type, () => draftPreview.invalidate(), true));
                const modeElement = dialog.element.querySelector('[data-type="mode"]') as HTMLSelectElement;
                const clozeElement = dialog.element.querySelector('[data-type="clozeEditor"]');
                const imageElement = dialog.element.querySelector('[data-type="imageEditor"]');
                const choiceElement = dialog.element.querySelector('[data-type="choiceEditor"]');
                const typedElement = dialog.element.querySelector('[data-type="typedEditor"]');
                const choiceInputs = [...dialog.element.querySelectorAll<HTMLInputElement>('[data-type="choiceCorrect"]')];
                const dynamicChoice = dialog.element.querySelector('[data-type="choiceDynamic"]') as HTMLInputElement;
                const dynamicChoiceCount = dialog.element.querySelector('[data-type="choiceDynamicCount"]') as HTMLInputElement;
                const clozeSelects = [...dialog.element.querySelectorAll<HTMLSelectElement>('[data-type="clozeGroups"]')];
                const clozeChoices = new Map(clozeSelects.map((select) =>
                    [select, enhanceFlashcardV2MultiSelect(select)]));
                const updateConfirm = () => {
                    draftPreview.invalidate();
                    const clozeMode = modeElement.value === "cloze";
                    const orderedMode = modeElement.value === "orderedSingle" || modeElement.value === "orderedCards";
                    const imageMode = modeElement.value === "imageOcclusion";
                    const choiceMode = modeElement.value === "choiceSingle" || modeElement.value === "choiceMultiple";
                    buttons[1].disabled = dialog.element.getAttribute("aria-busy") === "true" || (clozeMode || orderedMode) && clozeTargets.length === 0 ||
                        clozeMode && clozeSelects.some((select) => select.selectedOptions.length === 0) ||
                        imageMode && !imageEditor?.hasShapes() ||
                        choiceMode && !choiceInputs.some((input) => input.checked);
                    const unavailable = modeElement.value.startsWith("plugin:") || choiceMode && dynamicChoice?.checked ||
                        (clozeMode || orderedMode) && usesInlineTargets && preparedInline.updates.length > 0;
                    previewButton.disabled = buttons[1].disabled || previewButton.dataset.busy === "true" || unavailable;
                    previewButton.title = unavailable ? window.siyuan.languages.flashcardDraftPreviewUnsupported : "";
                };
                dialog.element.querySelector<HTMLButtonElement>('[data-type="includeNewMarks"]')
                    ?.addEventListener("click", (event) => {
                        const previousLength = clozeTargets.length;
                        const appended = appendFlashcardV2ClozeTargets({
                            targets: clozeTargets,
                            groupOrder: clozeGroupOrder,
                            assignments: Object.fromEntries(clozeSelects.map((select) =>
                                [clozeTargets[Number(select.dataset.targetIndex)].id,
                                    [...select.selectedOptions].map((option) => option.value)])),
                        }, newInlineTargets, genUUID);
                        clozeTargets.push(...appended.targets.slice(previousLength));
                        clozeGroupOrder.splice(0, clozeGroupOrder.length, ...appended.groupOrder);
                        const holder = dialog.element.querySelector('[data-type="clozeTargets"]');
                        holder.insertAdjacentHTML("beforeend", clozeTargets.slice(previousLength)
                            .map((target, index) => clozeTargetHTML(target, previousLength + index,
                                new Set(appended.assignments[target.id]))).join(""));
                        const addedSelects = [...holder.querySelectorAll<HTMLSelectElement>('[data-type="clozeGroups"]')]
                            .slice(previousLength);
                        addedSelects.forEach((select) => {
                            select.addEventListener("change", updateConfirm);
                            clozeChoices.set(select, enhanceFlashcardV2MultiSelect(select));
                        });
                        clozeSelects.push(...addedSelects);
                        dialog.element.querySelector('[data-type="clozeEmpty"]')?.remove();
                        (event.currentTarget as HTMLButtonElement).disabled = true;
                        renderClozeGroupOptions();
                    });
                const renderClozeGroupOptions = () => {
                    clozeSelects.forEach((select) => {
                        const selected = new Set([...select.selectedOptions].map((option) => option.value));
                        select.innerHTML = clozeGroupOrder.map((groupID, groupIndex) =>
                            `<option value="${escapeAttr(groupID)}"${selected.has(groupID) ? " selected" : ""}>${groupIndex + 1}</option>`).join("");
                    });
                    clozeChoices.forEach((render) => render());
                    dialog.element.querySelector('[data-type="clozeGroupOrder"]').innerHTML =
                        clozeGroupOrder.map((groupID, groupIndex) => `<div class="b3-list-item" data-group-id="${escapeAttr(groupID)}"><span class="b3-list-item__text">${window.siyuan.languages.group} ${groupIndex + 1}</span><button data-type="moveClozeGroupUp" class="b3-button b3-button--outline"${groupIndex === 0 ? " disabled" : ""}>${window.siyuan.languages.up}</button><span class="fn__space"></span><button data-type="moveClozeGroupDown" class="b3-button b3-button--outline"${groupIndex === clozeGroupOrder.length - 1 ? " disabled" : ""}>${window.siyuan.languages.down}</button><span class="fn__space"></span><button data-type="removeClozeGroup" class="b3-button b3-button--outline">${window.siyuan.languages.delete}</button></div>`).join("");
                    updateConfirm();
                };
                dialog.element.querySelector('[data-type="clozeGroupOrder"]').addEventListener("click", (event) => {
                    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-type]");
                    const groupID = button?.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
                    const groupIndex = clozeGroupOrder.indexOf(groupID);
                    if (!button || button.disabled || groupIndex < 0) {
                        return;
                    }
                    if (button.dataset.type === "removeClozeGroup") {
                        clozeGroupOrder.splice(groupIndex, 1);
                    } else {
                        const nextIndex = groupIndex + (button.dataset.type === "moveClozeGroupUp" ? -1 : 1);
                        [clozeGroupOrder[groupIndex], clozeGroupOrder[nextIndex]] =
                            [clozeGroupOrder[nextIndex], clozeGroupOrder[groupIndex]];
                    }
                    renderClozeGroupOptions();
                });
                renderClozeGroupOptions();
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
                    updateConfirm();
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
                const submit = (preview = false) => {
                    const mode = modeElement.value;
                    if (!validateFlashcardV2Fields(dialog.element) ||
                        mode === "imageOcclusion" && !imageEditor?.hasShapes()) {
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
                    })) : undefined;
                    if (preview && (mode.startsWith("plugin:") ||
                        (mode === "choiceSingle" || mode === "choiceMultiple") && dynamicChoice?.checked ||
                        (mode === "cloze" || mode === "orderedSingle" || mode === "orderedCards") &&
                        usesInlineTargets && preparedInline.updates.length > 0)) {
                        showMessage(window.siyuan.languages.flashcardDraftPreviewUnsupported);
                        return;
                    }
                    if (mode.startsWith("plugin:")) {
                        const pluginType = pluginTypes.find((item) => item.sourceType === mode);
                        if (pluginType?.registration.create) {
                            void submitFlashcardV2Form(dialog.element, async () => {
                                await pluginType.registration.create({blockIDs, reviewSetIDs});
                                dialog.destroy();
                                return true;
                            });
                        }
                        return;
                    }
                    const payload = {
                        sourceID,
                        expectedRevisionID: edit?.expectedRevisionID,
                        mode,
                        blockIDs: mode === "imageOcclusion" ? [imageSource.blockID] : blockIDs,
                        clozeGroups,
                        inlineOcclusions: (mode === "cloze" || mode === "orderedSingle" ||
                        mode === "orderedCards") && usesInlineTargets && clozeTargets.length > 0 ?
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
                    };
                    if (preview) {
                        previewButton.dataset.busy = "true";
                        previewButton.disabled = true;
                        void draftPreview.run(async () => {
                            const request = {...payload};
                            delete request.expectedRevisionID;
                            delete request.reviewSetIDs;
                            let result: {models: ReturnType<typeof readFlashcardV2RenderModel>[], doms: Record<string, string>};
                            let failed = false;
                            await fetchPost("/api/flashcard/previewAdvancedSource", request, (response) => {
                                result = {models: response.data.models.map(readFlashcardV2RenderModel), doms: response.data.doms};
                            }, undefined, () => { failed = true; }, undefined, 30000);
                            return {result, failed};
                        }, ({result, failed}) => {
                            if (failed) {
                                showMessage(window.siyuan.languages.flashcardLoadFailed);
                                return;
                            }
                            if (result?.models.length) {
                                openFlashcardV2Preview(result.models.map((model) => model.card.id), 0, result);
                            }
                        }, () => dialog.element.isConnected).catch((error) => {
                            console.error("Flashcard draft preview failed", error);
                        }).finally(() => {
                            delete previewButton.dataset.busy;
                            updateConfirm();
                        });
                        return;
                    }
                    const operation = operationFor(payload);
                    void submitFlashcardV2Form(dialog.element, async () => {
                        if (usesInlineTargets && (mode === "cloze" || mode === "orderedSingle" ||
                            mode === "orderedCards") && preparedInline.updates.length > 0) {
                            let updated = false;
                            await fetchPost("/api/block/batchUpdateBlock", {blocks: preparedInline.updates}, () => {
                                updated = true;
                            });
                            if (!updated) {
                                return false;
                            }
                            // 卡源保存重试不重复覆盖已经写入的标记。
                            preparedInline.updates.length = 0;
                        }
                        let saved = false;
                        const onSaved = () => {
                            saved = true;
                            dialog.destroy();
                            callback?.();
                        };
                        const request = {...payload, operationID: operation.operationID};
                        if (edit) {
                            await fetchPost("/api/flashcard/updateAdvancedSource", {
                                ...request, updatedAt: operation.changedAt,
                            }, onSaved);
                        } else {
                            await fetchPost("/api/flashcard/createAdvancedSource", {
                                ...request, createdAt: operation.changedAt,
                            }, onSaved);
                        }
                        return saved;
                    });
                };
                buttons[1].addEventListener("click", () => submit());
                previewButton.addEventListener("click", () => submit(true));
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

const openFlashcardV2AdvancedSourcePicker = (blockIDs: string[], candidates: IFlashcardV2AdvancedCandidate[],
    callback?: () => void) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.configGroupAdvanced,
        width: isMobile() ? "92vw" : "520px",
        content: `<div class="b3-dialog__content card__v2-review-picker"><ul class="b3-list b3-list--background">
<li><button type="button" data-type="newAdvancedSource" class="b3-list-item b3-list-item--narrow">
<svg class="b3-list-item__graphic"><use xlink:href="#iconAdd"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.new}</span>
</button></li>
${candidates.map((candidate, index) => `<li><button type="button" data-candidate-index="${index}" class="b3-list-item b3-list-item--narrow">
<svg class="b3-list-item__graphic"><use xlink:href="#iconEdit"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.edit} - ${escapeHtml(flashcardV2AdvancedModeLabel(candidate.edit))}</span>
<span class="b3-list-item__meta">${escapeHtml(new Date(candidate.updatedAt).toLocaleString())}</span>
</button></li>`).join("")}
</ul></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button></div>`,
    });
    dialog.element.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
    dialog.element.addEventListener("click", (event) => {
        const item = (event.target as HTMLElement).closest<HTMLElement>("[data-type='newAdvancedSource'], [data-candidate-index]");
        if (!item) {
            return;
        }
        const candidateIndex = item.dataset.candidateIndex;
        dialog.destroy();
        if (candidateIndex === undefined) {
            openFlashcardV2AdvancedSourceEditor(blockIDs, undefined, callback);
        } else {
            openFlashcardV2AdvancedSourceEditor(blockIDs, candidates[Number(candidateIndex)].edit, callback);
        }
    });
};

export const openFlashcardV2AdvancedSource = (blockIDs: string[], edit?: IFlashcardV2AdvancedEdit,
    callback?: () => void) => {
    if (blockIDs.length === 0) {
        return;
    }
    if (edit) {
        openFlashcardV2AdvancedSourceEditor(blockIDs, edit, callback);
        return;
    }
    ensureFlashcardV2(() => {
        void loadFlashcardV2AdvancedCandidates(blockIDs).then((candidates) => {
            if (candidates.length === 0) {
                openFlashcardV2AdvancedSourceEditor(blockIDs, undefined, callback);
                return;
            }
            openFlashcardV2AdvancedSourcePicker(blockIDs, candidates, callback);
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
        const formData = new ContractFormData({file});
        fetchPost("/api/flashcard/previewAnkiPackage", formData, (response) => {
            const preview = response.data as IAnkiPackagePreview;
            const unsupported = preview.unsupported ?? [];
            const notebooks = window.siyuan.notebooks.filter((notebook) => !notebook.closed && !notebook.encrypted);
            const importState = createFlashcardV2AnkiImportState();
            const dialog = new Dialog({
                beforeClose: () => { importState.close(); return true; },
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
${(preview.noteTypes ?? []).map((noteType) => `<li class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(noteType.name)}</span><span class="b3-list-item__meta">${escapeHtml(noteType.conversion)} · ${noteType.noteCount}</span></li>`).join("")}
</ul>
<div class="card__v2-section-title">${window.siyuan.languages.flashcardReviewSet}</div>
<ul class="b3-list b3-list--background card__v2-panel-list">
${(preview.decks ?? []).map((deck) => `<li class="b3-list-item"><span class="b3-list-item__text">${escapeHtml(deck.name)}</span><span class="b3-list-item__meta">${deck.cardCount}</span></li>`).join("")}
</ul>
${unsupported.length === 0 ? "" : `<div class="ft__error">${unsupported.map(escapeHtml).join("<br>")}</div>`}
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
            buttons[0].addEventListener("click", () => {
                dialog.destroy();
            });
            buttons[1].addEventListener("click", () => {
                const notebookID = (dialog.element.querySelector('[data-type="notebook"]') as HTMLSelectElement).value;
                const attempt = importState.begin(file, notebookID);
                if (!attempt) {
                    return;
                }
                buttons[1].disabled = true;
                const target = dialog.element.querySelector<HTMLSelectElement>('[data-type="notebook"]');
                target.disabled = true;
                const finish = (saved: boolean) => {
                    attempt.finish(saved);
                    if (!importState.closed && !importState.pending) {
                        buttons[0].textContent = window.siyuan.languages.cancel;
                        buttons[1].disabled = false;
                        target.disabled = false;
                    }
                };
                const reportFailure = () => {
                    if (!importState.closed) {
                        showMessage(window.siyuan.languages.flashcardSaveFailed, 6000, "error");
                    }
                };
                ensureFlashcardV2(() => {
                    if (!attempt.start()) {
                        finish(false);
                        return;
                    }
                    buttons[0].textContent = window.siyuan.languages.close;
                    const importData = new ContractFormData({file: attempt.file, notebookID: attempt.notebookID,
                        operationID: attempt.operationID});
                    let saved = false;
                    fetchPost("/api/flashcard/importAnkiPackage", importData, (importResponse) => {
                        saved = true;
                        if (importState.closed) {
                            return;
                        }
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
                    }, undefined, reportFailure).finally(() => finish(saved));
                }, {cancelled: () => finish(false), failed: reportFailure, isCurrent: () => !importState.closed});
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
    count: (value: T) => number, detail?: (value: T) => string) => {
    if (values.length === 0) {
        return `<div class="ft__on-surface">${escapeHtml(window.siyuan.languages.emptyContent)}</div>`;
    }
    const maximum = Math.max(1, ...values.map(count));
    return `<div class="b3-list b3-list--background">${values.map((value) => {
        const current = count(value);
        return `<div class="b3-list-item"><span class="b3-list-item__text" style="flex:0 0 112px">${escapeHtml(label(value))}</span><span class="fn__flex-1" aria-hidden="true"><span class="card__v2-statistics-bar" style="width:${current / maximum * 100}%;min-width:${current > 0 ? "2px" : "0"}"></span></span><span class="b3-list-item__meta" style="min-width:48px;text-align:right">${current}${detail ? ` · ${escapeHtml(detail(value))}` : ""}</span></div>`;
    }).join("")}</div>`;
};

const flashcardV2StatisticsDistribution = (label: string, values: IFlashcardStatisticsDistribution[]) => {
    return `<div class="card__v2-section-title">${escapeHtml(label)}</div>${flashcardV2StatisticsBars(values,
        (value) => value.label, (value) => value.count)}`;
};

const renderFlashcardV2Statistics = (statistics: IFlashcardStatistics) => {
    const ratings = statistics.history.ratings;
    const state = statistics.overview.reviewStates;
    const generation = statistics.overview.generationStatuses;
    const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
    const averageDuration = statistics.history.averageDurationMS === undefined ? "-" :
        `${(statistics.history.averageDurationMS / 1000).toFixed(1)} ${window.siyuan.languages.second}`;
    const summary = [
        [window.siyuan.languages.riffCard, statistics.overview.currentCards],
        [window.siyuan.languages.flashcardDueCard, statistics.overdue],
        [window.siyuan.languages.flashcardReviews, statistics.history.reviews],
        [window.siyuan.languages.flashcardAccuracy, statistics.history.reviews > 0 ? percent(statistics.history.accuracy) : "-"],
    ];
    return `<div class="card__v2-statistics-summary">${summary.map(([label, value]) => `<div><span class="ft__on-surface">${label}</span><strong>${value}</strong></div>`).join("")}</div>
<details class="card__v2-details"><summary>${window.siyuan.languages.cardStatus}</summary>
${statisticsItem(window.siyuan.languages.riffCard, statistics.overview.currentCards)}
${statisticsItem(window.siyuan.languages.flashcardNewCard, state.new || 0)}
${statisticsItem(window.siyuan.languages.flashcardLearningCards, state.learning || 0)}
${statisticsItem(window.siyuan.languages.flashcardReviewCard, state.review || 0)}
${statisticsItem(window.siyuan.languages.flashcardRelearningCards, state.relearning || 0)}
${statisticsItem(window.siyuan.languages.flashcardDueCard, statistics.overdue)}
${statisticsItem(window.siyuan.languages.flashcardSuspendedCards, statistics.overview.suspended)}
${statisticsItem(window.siyuan.languages.flashcardBuriedCards, statistics.overview.buried)}
${statisticsItem(window.siyuan.languages.flashcardPausedCards, statistics.overview.paused)}
${statisticsItem(window.siyuan.languages.flashcardDisabledCards, generation.disabledByTemplate || 0)}
${statisticsItem(window.siyuan.languages.flashcardOrphanedCards, generation.orphaned || 0)}
${statisticsItem(window.siyuan.languages.flashcardDeletedCards, statistics.overview.deletedCards)}
${statisticsItem(window.siyuan.languages.flashcardLeeches, statistics.overview.leeches)}
<div class="fn__hr"></div>
</details><details class="card__v2-details"><summary>${window.siyuan.languages.flashcardReviewHistory}</summary>
${statisticsItem(window.siyuan.languages.total, statistics.history.reviews)}
${statisticsItem(window.siyuan.languages.flashcardReviewedCards, statistics.history.uniqueCards)}
${statisticsItem(window.siyuan.languages.flashcardLapses, statistics.history.lapses)}
${statisticsItem(window.siyuan.languages.flashcardAccuracy, statistics.history.reviews > 0 ? percent(statistics.history.accuracy) : "-")}
${statisticsItem(window.siyuan.languages.flashcardTrueRetention, statistics.history.retentionReviews > 0 ? percent(statistics.history.trueRetention) : "-")}
${statisticsItem(window.siyuan.languages.flashcardAverageReviewDuration, averageDuration)}
${statisticsItem(window.siyuan.languages.flashcardTotalReviewDuration, statistics.history.durationKnown > 0 ? `${(statistics.history.durationTotalMS / 1000).toFixed(1)} ${window.siyuan.languages.second}` : "-")}
${statisticsItem(window.siyuan.languages.flashcardKnownDurationReviews, statistics.history.durationKnown)}
${statisticsItem(window.siyuan.languages.flashcardUnknownDurationReviews, statistics.history.durationUnknown)}
${statisticsItem(window.siyuan.languages.cardRatingAgain, ratings.again || 0)}
${statisticsItem(window.siyuan.languages.cardRatingHard, ratings.hard || 0)}
${statisticsItem(window.siyuan.languages.cardRatingGood, ratings.good || 0)}
${statisticsItem(window.siyuan.languages.cardRatingEasy, ratings.easy || 0)}
<div class="fn__hr"></div>
</details><div class="card__v2-section-title">${window.siyuan.languages.flashcardReviews} - ${window.siyuan.languages.flashcardReviewedCards}</div>
${flashcardV2StatisticsBars(statistics.series, (value) => new Date(value.start).toLocaleDateString(),
        (value) => value.reviews, (value) => String(value.uniqueCards))}
<div class="fn__hr"></div>
<div class="card__v2-section-title">${window.siyuan.languages.flashcardReviewsByHour} - ${window.siyuan.languages.flashcardAccuracy}</div>
${flashcardV2StatisticsBars(statistics.byHour, (value) => `${String(value.hour).padStart(2, "0")}:00`,
        (value) => value.reviews, (value) => value.reviews > 0 ? percent(value.retention) : "-")}
<div class="fn__hr"></div>
<div class="card__v2-section-title">${window.siyuan.languages.flashcardUpcomingReviews}</div>
${flashcardV2StatisticsBars(statistics.futureDue, (value) => new Date(value.start).toLocaleDateString(),
        (value) => value.cards)}
<div class="fn__hr"></div>
<details class="card__v2-details"><summary>${window.siyuan.languages.configGroupAdvanced}</summary>
${flashcardV2StatisticsDistribution(window.siyuan.languages.flashcardInterval, statistics.intervalDistribution)}
<div class="fn__hr"></div>
${flashcardV2StatisticsDistribution(window.siyuan.languages.flashcardStability, statistics.stabilityDistribution)}
<div class="fn__hr"></div>
${flashcardV2StatisticsDistribution(window.siyuan.languages.flashcardDifficulty, statistics.difficultyDistribution)}
<div class="fn__hr"></div>
${flashcardV2StatisticsDistribution(window.siyuan.languages.flashcardRetrievability, statistics.retrievabilityDistribution)}</details>`;
};

export const openFlashcardV2Statistics = (reviewSetID = "", query?: IFlashcardQueryAST) => {
    ensureFlashcardV2(() => {
        const now = Date.now();
        const fromDate = new Date(now);
        fromDate.setDate(fromDate.getDate() - 29);
        const toDate = new Date(now);
        let requestGeneration = 0;
        const dialog = new Dialog({
            title: window.siyuan.languages.flashcardStatistics,
            width: isMobile() ? "96vw" : "780px",
            height: "82vh",
            destroyCallback: () => requestGeneration++,
            content: `<div class="b3-dialog__content fn__flex-column card__v2-statistics">
<div class="card__v2-statistics-filter"><div class="card__v2-section-title">${window.siyuan.languages.flashcardStatisticsRange}</div><div class="card__v2-statistics-controls">
<select data-type="statisticsRange" aria-label="${escapeAttr(window.siyuan.languages.flashcardStatisticsRange)}" class="b3-select">${[1, 7, 30, 365].map((days) => `<option value="${days}"${days === 30 ? " selected" : ""}>${days} ${window.siyuan.languages.day}</option>`).join("")}<option value="all">${window.siyuan.languages.flashcardAllHistory}</option><option value="custom">${window.siyuan.languages.custom}</option></select>
<input data-type="statisticsFrom" aria-label="${escapeAttr(window.siyuan.languages.startDate)}" class="b3-text-field fn__flex-1" type="date" value="${flashcardV2StatisticsDate(fromDate)}">
<input data-type="statisticsTo" aria-label="${escapeAttr(window.siyuan.languages.endDate)}" class="b3-text-field fn__flex-1" type="date" value="${flashcardV2StatisticsDate(toDate)}">
<select data-type="statisticsBucket" aria-label="${escapeAttr(window.siyuan.languages.group)}" class="b3-select"><option value="day">${window.siyuan.languages.day}</option><option value="week">${window.siyuan.languages.week}</option><option value="month">${window.siyuan.languages.month}</option></select>
<button data-type="statisticsApply" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div><div class="b3-label__text ft__on-surface">${escapeHtml(window.siyuan.languages.flashcardStatisticsScopeTip)}</div></div><div data-type="statisticsContent" class="card__v2-statistics-content"></div></div>`,
        });
        const from = dialog.element.querySelector('[data-type="statisticsFrom"]') as HTMLInputElement;
        const to = dialog.element.querySelector('[data-type="statisticsTo"]') as HTMLInputElement;
        const range = dialog.element.querySelector('[data-type="statisticsRange"]') as HTMLSelectElement;
        const bucket = dialog.element.querySelector('[data-type="statisticsBucket"]') as HTMLSelectElement;
        const content = dialog.element.querySelector('[data-type="statisticsContent"]');
        const apply = dialog.element.querySelector('[data-type="statisticsApply"]') as HTMLButtonElement;
        const isCurrent = (generation = requestGeneration) => generation === requestGeneration &&
            dialog.element.isConnected && dialog.element.dataset.dialogClosing !== "true";
        const load = () => {
            if (!isCurrent()) { return; }
            const fromTime = range.value === "all" ? 0 : new Date(`${from.value}T00:00:00`).getTime();
            const toExclusive = new Date(`${to.value}T00:00:00`);
            toExclusive.setDate(toExclusive.getDate() + 1);
            const toTime = toExclusive.getTime();
            if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime <= fromTime) {
                reportFlashcardV2Field(!Number.isFinite(fromTime) ? from : to);
                return;
            }
            const generation = ++requestGeneration;
            let loaded = false;
            apply.disabled = true;
            content.setAttribute("aria-busy", "true");
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
                if (!isCurrent(generation)) {
                    return;
                }
                loaded = true;
                content.innerHTML = renderFlashcardV2Statistics(response.data as IFlashcardStatistics);
            }).catch(error => console.error("Flashcard statistics request failed", error)).finally(() => {
                if (isCurrent(generation)) {
                    apply.disabled = false;
                    content.setAttribute("aria-busy", "false");
                    if (!loaded) {
                        content.innerHTML = `<div class="card__v2-form-note">${window.siyuan.languages.flashcardLoadFailed}</div><button data-type="retry" class="b3-button b3-button--outline">${window.siyuan.languages.retry}</button>`;
                        content.querySelector("button").addEventListener("click", load);
                    }
                }
            });
        };
        range.addEventListener("change", () => {
            from.disabled = range.value === "all";
            if (range.value !== "custom") {
                const today = new Date();
                to.value = flashcardV2StatisticsDate(today);
                if (range.value !== "all") {
                    today.setDate(today.getDate() - Number(range.value) + 1);
                    from.value = flashcardV2StatisticsDate(today);
                } else {
                    from.value = "";
                }
                load();
            }
        });
        [from, to].forEach((input) => input.addEventListener("change", () => {
            if (range.value === "all") {
                return;
            }
            range.value = "custom";
            from.disabled = false;
        }));
        apply.addEventListener("click", load);
        load();
    });
};
