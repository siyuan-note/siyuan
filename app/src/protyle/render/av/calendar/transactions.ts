import * as dayjs from "dayjs";
import {Constants} from "../../../../constants";
import {showMessage} from "../../../../dialog/message";
import {fetchSyncPost} from "../../../../util/fetch";
import {cloneCellValue, getBlockCell, getCellByFieldID, getEventDocumentID, getFieldByID, ICalendarEventDraft, ICalendarFieldMapping, ICalendarNormalizedEvent} from "./model";

export interface ICalendarOperationSet {
    doOperations: IOperation[];
    undoOperations: IOperation[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const normalizeRecurrenceValue = (value?: string) => {
    const trimmed = (value || "").trim();
    return trimmed.toLowerCase() === "none" ? "" : trimmed;
};

const recurrenceWithUntil = (value: string | undefined, untilDate: string) => {
    const normalized = normalizeRecurrenceValue(value);
    if (!normalized) {
        return "";
    }
    const upper = normalized.toUpperCase();
    const parts = upper.includes("=") ? upper.split(";").filter(Boolean) : [`FREQ=${upper}`];
    let hasUntil = false;
    const nextParts = parts.map((part) => {
        if (part.startsWith("UNTIL=")) {
            hasUntil = true;
            return `UNTIL=${untilDate}`;
        }
        return part;
    });
    if (!hasUntil) {
        nextParts.push(`UNTIL=${untilDate}`);
    }
    return nextParts.join(";");
};

const getEventRecurrenceRaw = (event: ICalendarNormalizedEvent) => event.recurrenceRaw || event.recurrence?.raw || event.recurrence?.freq || "";

const weekdayMap: { [key: string]: number } = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6};

const getRecurringStartAtIndex = (event: ICalendarNormalizedEvent, index: number) => {
    const interval = event.recurrence?.interval || 1;
    if (event.recurrence?.freq === "DAILY") {
        return event.start.add(index * interval, "day");
    }
    if (event.recurrence?.freq === "WEEKLY") {
        return event.start.add(index * interval, "week");
    }
    if (event.recurrence?.freq === "MONTHLY") {
        return event.start.add(index * interval, "month");
    }
    return event.start.add(index * interval, "year");
};

const countOccurrencesBefore = (event: ICalendarNormalizedEvent, occurrenceDate: string) => {
    if (!event.recurrence) {
        return 0;
    }
    const splitStart = dayjs(occurrenceDate).startOf("day");
    let count = 0;
    let generated = 0;
    const limit = event.recurrence.count || 10000;
    if (event.recurrence.freq === "WEEKLY" && event.recurrence.byDay?.length > 0) {
        let weekCursor = event.start.startOf("week");
        while (generated < limit && !weekCursor.isAfter(splitStart, "day")) {
            const weeksFromStart = weekCursor.diff(event.start.startOf("week"), "week");
            if (weeksFromStart >= 0 && weeksFromStart % (event.recurrence.interval || 1) === 0) {
                for (const byDay of event.recurrence.byDay) {
                    const occurrenceStart = weekCursor.day(weekdayMap[byDay])
                        .hour(event.start.hour())
                        .minute(event.start.minute())
                        .second(event.start.second())
                        .millisecond(event.start.millisecond());
                    if (occurrenceStart.isBefore(event.start)) {
                        continue;
                    }
                    if (event.recurrence.until && occurrenceStart.isAfter(event.recurrence.until)) {
                        return count;
                    }
                    if (!occurrenceStart.isBefore(splitStart, "day")) {
                        return count;
                    }
                    count++;
                    generated++;
                    if (generated >= limit) {
                        return count;
                    }
                }
            }
            weekCursor = weekCursor.add(1, "week");
        }
        return count;
    }
    let cursor = event.start;
    while (generated < limit && cursor.isBefore(splitStart, "day")) {
        if (event.recurrence.until && cursor.isAfter(event.recurrence.until)) {
            break;
        }
        count++;
        generated++;
        cursor = getRecurringStartAtIndex(event, generated);
    }
    return count;
};

const recurrenceCount = (value: string) => {
    const countPart = value.toUpperCase().split(";").find(part => part.startsWith("COUNT="));
    if (!countPart) {
        return undefined;
    }
    const countValue = countPart.slice("COUNT=".length);
    if (!/^\d+$/.test(countValue)) {
        return undefined;
    }
    const count = parseInt(countValue, 10);
    return count > 0 ? count : undefined;
};

const recurrenceWithCount = (value: string, count: number) => {
    const upper = value.toUpperCase();
    if (!upper.includes("COUNT=")) {
        return value;
    }
    return upper.split(";").filter(Boolean).map(part => part.startsWith("COUNT=") ? `COUNT=${count}` : part).join(";");
};

const canonicalRecurrenceValue = (value: string) => {
    const normalized = normalizeRecurrenceValue(value).toUpperCase();
    if (!normalized) {
        return "";
    }
    const parts = normalized.includes("=") ? normalized.split(";").filter(Boolean) : [`FREQ=${normalized}`];
    return parts.sort().join(";");
};

const recurrenceForSplitFuture = (value: string, event: ICalendarNormalizedEvent, occurrenceDate: string, originalValue: string) => {
    const count = recurrenceCount(value);
    if (!count || canonicalRecurrenceValue(value) !== canonicalRecurrenceValue(originalValue)) {
        return value;
    }
    return recurrenceWithCount(value, Math.max(count - countOccurrencesBefore(event, occurrenceDate), 1));
};

const isRealDateInputValue = (value?: string) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const parsed = dayjs(value);
    return parsed.isValid() && parsed.format("YYYY-MM-DD") === value;
};

const getTimeInputValue = (value: string | undefined, fallback: string) => {
    if (!value || !/^\d{2}:\d{2}$/.test(value)) {
        return fallback;
    }
    const [hour, minute] = value.split(":").map(item => parseInt(item, 10));
    return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? value : fallback;
};

const buildDateValue = (draft: ICalendarEventDraft): IAVCellValue | undefined => {
    if (!isRealDateInputValue(draft.date)) {
        return undefined;
    }
    const startTime = getTimeInputValue(draft.startTime, "09:00");
    const endTime = getTimeInputValue(draft.endTime, "10:00");
    const start = draft.isAllDay ? dayjs(draft.date).startOf("day") : dayjs(`${draft.date}T${startTime}`);
    const endDate = draft.endDate && isRealDateInputValue(draft.endDate) && dayjs(draft.endDate).isAfter(dayjs(draft.date), "day") ? draft.endDate : draft.date;
    let end = draft.isAllDay ? dayjs(endDate).endOf("day") : dayjs(`${endDate}T${endTime}`);
    if (!draft.isAllDay && !end.isAfter(start)) {
        end = start.add(1, "hour");
    }
    return {
        type: "date",
        date: {
            content: start.valueOf(),
            isNotEmpty: true,
            content2: end.valueOf(),
            isNotEmpty2: true,
            hasEndDate: true,
            isNotTime: draft.isAllDay,
        },
    };
};

// Template cells are computed by the kernel (fillAttributeViewBaseValue replaces the
// stored value with the field's expression on every render), so calendar metadata is
// only ever written into text fields.
const buildTextLikeValue = (field: IAVColumn, value: string, oldValue?: IAVCellValue): IAVCellValue => {
    const base = oldValue ? clone(oldValue) : {type: "text", keyID: field.id} as IAVCellValue;
    base.type = "text";
    base.keyID = field.id;
    base.text = {content: value};
    delete base.template;
    return base;
};

const buildEmptyTextLikeValue = (field: IAVColumn) => buildTextLikeValue(field, "");

const buildSelectValue = (field: IAVColumn, value?: string, oldValue?: IAVCellValue): IAVCellValue | undefined => {
    const content = (value || "").trim();
    if (!content) {
        return oldValue ? {
            ...clone(oldValue),
            type: field.type,
            keyID: field.id,
            mSelect: [],
        } : undefined;
    }
    const option = field.options?.find(item => item.name === content);
    if (!option) {
        return undefined;
    }
    const selectValue = {
        content,
        color: option.color || "1",
    };
    const base = oldValue ? clone(oldValue) : {type: field.type, keyID: field.id} as IAVCellValue;
    base.type = field.type;
    base.keyID = field.id;
    base.mSelect = field.type === "mSelect" ? [selectValue] : [selectValue];
    return base;
};

const buildEmptySelectValue = (field: IAVColumn): IAVCellValue => ({
    type: field.type,
    keyID: field.id,
    mSelect: [],
} as IAVCellValue);

const buildBlockValue = (event: ICalendarNormalizedEvent, title: string): IAVCellValue | undefined => {
    const blockCell = getBlockCell(event.sourceCard);
    if (!blockCell?.value) {
        return undefined;
    }
    const value = clone(blockCell.value);
    value.type = "block";
    value.keyID = blockCell.value.keyID;
    value.block = {
        ...(value.block || {}),
        content: title,
    };
    return value;
};

const pushUpdate = (ops: ICalendarOperationSet, options: {
    avID: string;
    rowID: string;
    keyID?: string;
    oldValue?: IAVCellValue;
    newValue?: IAVCellValue;
}) => {
    if (!options.keyID || !options.newValue) {
        return;
    }
    if (options.oldValue && JSON.stringify(options.oldValue) === JSON.stringify(options.newValue)) {
        return;
    }
    ops.doOperations.push({
        action: "updateAttrViewCell",
        avID: options.avID,
        keyID: options.keyID,
        rowID: options.rowID,
        data: options.newValue,
    });
    if (options.oldValue) {
        ops.undoOperations.unshift({
            action: "updateAttrViewCell",
            avID: options.avID,
            keyID: options.keyID,
            rowID: options.rowID,
            data: options.oldValue,
        });
    }
};

const pushUpdated = (ops: ICalendarOperationSet, blockID: string, previousUpdated = "") => {
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    ops.doOperations.push({action: "doUpdateUpdated", id: blockID, data: newUpdated});
    ops.undoOperations.push({action: "doUpdateUpdated", id: blockID, data: previousUpdated});
};

export interface ICalendarWriteTarget {
    avID: string;
    blockID: string;
    viewID?: string;
}

/**
 * D3 read-back verification.
 *
 * /api/transactions always answers {code: 0}: kernel/model/transaction.go
 * flushTx() only logs `handle attribute view failed: ...` and pushes a generic
 * message when an operation inside the transaction is rejected, and
 * updateAttributeViewValue() even accepts cells addressed at rows that do not
 * exist. So the HTTP code proves nothing about the write.
 *
 * Option (a) of the fix was chosen: after the write we re-read the attribute
 * view once (the same endpoint renderCalendar uses) and assert the primary
 * effect of the operation set - inserted rows exist, removed rows are gone and
 * the date/text cells we wrote read back with the value we sent. Nothing else
 * is asserted, so it stays one cheap extra read per mutation.
 *
 * When the read itself cannot be trusted (request failed, the payload carries
 * no card list, or the view has filters/groups that may legitimately hide a
 * row) we do not invent a failure: a false "save failed" would revert the UI
 * for a write that actually landed.
 */
type ICalendarWriteCheck = (cards: IAVGalleryItem[], mayHideItems: boolean) => boolean;

const findCardByID = (cards: IAVGalleryItem[], rowID: string) => cards.find(card => card.id === rowID);

const getCardCellValue = (card: IAVGalleryItem, keyID: string) => card.values?.find(cell => cell.value?.keyID === keyID)?.value;

const getCardTextContent = (card: IAVGalleryItem, keyID: string) => {
    const value = getCardCellValue(card, keyID);
    return value?.text?.content ?? value?.template?.content ?? "";
};

const buildWriteChecks = (doOperations: IOperation[]): ICalendarWriteCheck[] => {
    const checks: ICalendarWriteCheck[] = [];
    const removedIDs = new Set<string>();
    doOperations.forEach(operation => {
        if (operation.action === "removeAttrViewBlock") {
            (operation.srcIDs || []).forEach(srcID => removedIDs.add(srcID));
        }
    });
    doOperations.forEach(operation => {
        if (operation.action === "insertAttrViewBlock") {
            (operation.srcs || []).forEach(src => {
                const itemID = src.itemID;
                if (!itemID || removedIDs.has(itemID)) {
                    return;
                }
                checks.push((cards, mayHideItems) => !!findCardByID(cards, itemID) || mayHideItems);
            });
            return;
        }
        if (operation.action === "removeAttrViewBlock") {
            (operation.srcIDs || []).forEach(srcID => {
                checks.push((cards) => !findCardByID(cards, srcID));
            });
            return;
        }
        if (operation.action !== "updateAttrViewCell" || !operation.rowID || !operation.keyID || removedIDs.has(operation.rowID)) {
            return;
        }
        const data = operation.data as IAVCellValue;
        const rowID = operation.rowID;
        const keyID = operation.keyID;
        if (data?.type === "date" && data.date) {
            const expected = data.date;
            checks.push((cards, mayHideItems) => {
                const card = findCardByID(cards, rowID);
                if (!card) {
                    return mayHideItems;
                }
                const date = getCardCellValue(card, keyID)?.date;
                return !!date && date.isNotEmpty === expected.isNotEmpty && date.content === expected.content;
            });
            return;
        }
        if (data?.type === "text" && data.text) {
            const expected = data.text.content || "";
            checks.push((cards, mayHideItems) => {
                const card = findCardByID(cards, rowID);
                if (!card) {
                    return mayHideItems;
                }
                return getCardTextContent(card, keyID) === expected;
            });
        }
    });
    return checks;
};

const readCalendarCards = async (target: ICalendarWriteTarget) => {
    const response = await fetchSyncPost("/api/av/renderAttributeView", {
        id: target.avID,
        blockID: target.blockID,
        viewID: target.viewID || "",
        pageSize: -1,
        createIfNotExist: false,
    });
    if (response?.code !== 0) {
        return undefined;
    }
    const view = response.data?.view as IAVCalendar;
    if (!view || !Array.isArray(view.cards)) {
        return undefined;
    }
    const cards = [...view.cards];
    (view.groups || []).forEach(group => {
        ((group as unknown as IAVCalendar).cards || []).forEach(card => cards.push(card));
    });
    return {
        cards,
        mayHideItems: (view.filters || []).length > 0 || (view.groups || []).length > 0,
    };
};

const verifyCalendarWrite = async (target: ICalendarWriteTarget, doOperations: IOperation[]) => {
    const checks = buildWriteChecks(doOperations);
    if (checks.length === 0) {
        return true;
    }
    const readBack = await readCalendarCards(target);
    if (!readBack) {
        return true;
    }
    return checks.every(check => check(readBack.cards, readBack.mayHideItems));
};

const verifyBoundCalendarItemUpdate = async (target: ICalendarWriteTarget, itemID: string, boundBlockID: string, primaryKey: string, fieldValues: { [keyID: string]: IAVCellValue }) => {
    const readBack = await readCalendarCards(target);
    if (!readBack) {
        return true;
    }
    const card = findCardByID(readBack.cards, itemID);
    if (!card) {
        return readBack.mayHideItems;
    }
    const block = card.values?.find(cell => cell.valueType === "block")?.value?.block;
    if (block?.id !== boundBlockID || block.content !== primaryKey) {
        return false;
    }
    const operations = buildCellOperations(target.avID, itemID, fieldValues);
    return buildWriteChecks(operations).every(check => check(readBack.cards, readBack.mayHideItems));
};

const executeCalendarOperations = async (protyle: IProtyle, ops: ICalendarOperationSet, target?: ICalendarWriteTarget) => {
    if (ops.doOperations.length === 0) {
        return false;
    }
    const response = await fetchSyncPost("/api/transactions", {
        session: protyle?.id || Constants.SIYUAN_APPID,
        app: Constants.SIYUAN_APPID,
        reqId: Date.now(),
        transactions: [{
            doOperations: ops.doOperations,
            undoOperations: ops.undoOperations,
        }],
    });
    if (response?.code !== 0) {
        return false;
    }
    if (target && !await verifyCalendarWrite(target, ops.doOperations)) {
        // The kernel dropped at least part of the transaction; never report a
        // success the persisted data does not back, and do not register an undo
        // step for a write that did not happen.
        return false;
    }
    if (protyle && ops.undoOperations.length > 0) {
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab && protyle.model) {
            protyle.model.headElement.classList.remove("item--unupdate");
        }
        protyle.updated = true;
        protyle.undo?.add(ops.doOperations, ops.undoOperations, protyle);
    }
    return true;
};

const addMetadataUpdate = (ops: ICalendarOperationSet, options: {
    avID: string;
    rowID: string;
    fields: IAVColumn[];
    fieldID?: string;
    value?: string;
    oldCell?: IAVCell;
    undoEmptyWhenMissing?: boolean;
}) => {
    if (!options.fieldID || options.value === undefined) {
        return;
    }
    const field = getFieldByID(options.fields, options.fieldID);
    if (!field || field.type !== "text") {
        return;
    }
    const oldValue = cloneCellValue(options.oldCell?.value) || (options.undoEmptyWhenMissing ? buildEmptyTextLikeValue(field) : undefined);
    const newValue = buildTextLikeValue(field, options.value, oldValue);
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.rowID,
        keyID: options.fieldID,
        oldValue,
        newValue,
    });
};

const addDraftFieldUpdates = (ops: ICalendarOperationSet, options: {
    avID: string;
    rowID: string;
    fields: IAVColumn[];
    values?: { [fieldID: string]: string };
    sourceCard?: IAVGalleryItem;
}) => {
    Object.entries(options.values || {}).forEach(([fieldID, value]) => {
        addMetadataUpdate(ops, {
            avID: options.avID,
            rowID: options.rowID,
            fields: options.fields,
            fieldID,
            value,
            oldCell: options.sourceCard ? getCellByFieldID(options.sourceCard, fieldID) : undefined,
            undoEmptyWhenMissing: !!options.sourceCard,
        });
    });
};

export const buildOccurrenceExceptionOperations = (options: {
    avID: string;
    blockID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    occurrenceDate: string;
    previousUpdated?: string;
}): ICalendarOperationSet => {
    const ops: ICalendarOperationSet = {doOperations: [], undoOperations: []};
    const oldCell = getCellByFieldID(options.event.sourceCard, options.mapping.exceptionFieldID);
    const existing = (options.event.recurrenceExceptions || []).filter(item => item !== options.occurrenceDate);
    existing.push(options.occurrenceDate);
    existing.sort();
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.exceptionFieldID,
        value: existing.join(","),
        oldCell,
        undoEmptyWhenMissing: true,
    });
    if (ops.doOperations.length > 0) {
        pushUpdated(ops, options.blockID, options.previousUpdated);
    }
    return ops;
};

interface ICalendarTruncateOptions {
    avID: string;
    blockID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    occurrenceDate: string;
    previousUpdated?: string;
}

interface ICalendarSplitOptions extends ICalendarTruncateOptions {
    dateFieldID: string;
    draft: ICalendarEventDraft;
}

/** Truncate the original series so it stops before the edited occurrence. */
const buildSplitTruncateOperations = (options: ICalendarTruncateOptions): ICalendarOperationSet => {
    const untilDate = dayjs(options.occurrenceDate).subtract(1, "day").format("YYYY-MM-DD");
    const truncatedRecurrence = recurrenceWithUntil(getEventRecurrenceRaw(options.event), untilDate);
    const truncateOps: ICalendarOperationSet = {doOperations: [], undoOperations: []};
    addMetadataUpdate(truncateOps, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.recurrenceFieldID,
        value: truncatedRecurrence,
        oldCell: getCellByFieldID(options.event.sourceCard, options.mapping.recurrenceFieldID),
        undoEmptyWhenMissing: true,
    });
    if (truncateOps.doOperations.length > 0) {
        pushUpdated(truncateOps, options.blockID, options.previousUpdated);
    }
    return truncateOps;
};

/** The draft of the follow-up series that starts at the edited occurrence. */
const buildSplitFutureDraft = (options: ICalendarSplitOptions): ICalendarEventDraft => {
    const recurrenceRaw = getEventRecurrenceRaw(options.event);
    return {
        ...options.draft,
        recurrenceRaw: recurrenceForSplitFuture(normalizeRecurrenceValue(options.draft.recurrenceRaw) || recurrenceRaw, options.event, options.occurrenceDate, recurrenceRaw),
        recurrenceExceptionRaw: "",
    };
};

export const buildSplitSeriesOperations = (options: ICalendarSplitOptions): ICalendarOperationSet => {
    if (!isRealDateInputValue(options.draft.date)) {
        return {doOperations: [], undoOperations: []};
    }
    const truncateOps = buildSplitTruncateOperations(options);
    const createOps = buildCreateEventOperations({
        avID: options.avID,
        blockID: options.blockID,
        dateFieldID: options.dateFieldID,
        fields: options.fields,
        mapping: options.mapping,
        draft: buildSplitFutureDraft(options),
        previousUpdated: options.previousUpdated,
    });
    return {
        doOperations: [...truncateOps.doOperations, ...createOps.doOperations],
        undoOperations: [...createOps.undoOperations, ...truncateOps.undoOperations],
    };
};

const addColorUpdate = (ops: ICalendarOperationSet, options: {
    avID: string;
    rowID: string;
    fields: IAVColumn[];
    fieldID?: string;
    value?: string;
    oldCell?: IAVCell;
    undoEmptyWhenMissing?: boolean;
}) => {
    if (!options.fieldID || options.value === undefined) {
        return;
    }
    const field = getFieldByID(options.fields, options.fieldID);
    if (!field || !["select", "mSelect"].includes(field.type)) {
        return;
    }
    const oldValue = cloneCellValue(options.oldCell?.value) || (options.undoEmptyWhenMissing ? buildEmptySelectValue(field) : undefined);
    const newValue = buildSelectValue(field, options.value, oldValue);
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.rowID,
        keyID: options.fieldID,
        oldValue,
        newValue,
    });
};

export const buildCreateEventOperations = (options: {
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    draft: ICalendarEventDraft;
    previousUpdated?: string;
}): ICalendarOperationSet => {
    const dateValue = buildDateValue(options.draft);
    if (!dateValue) {
        return {doOperations: [], undoOperations: []};
    }
    // ONE id only: AddAttributeViewBlock() in kernel/model/attribute_view.go
    // creates the item under srcs[].itemID and only reads srcs[].id as the bound
    // block id (ignored for detached rows). Minting a second id here would make
    // every updateAttrViewCell below address a row that does not exist, and the
    // kernel would silently store those values as orphans.
    const rowID = Lute.NewNodeID();
    const ops: ICalendarOperationSet = {doOperations: [], undoOperations: []};
    ops.doOperations.push({
        action: "insertAttrViewBlock",
        avID: options.avID,
        previousID: "",
        srcs: [{itemID: rowID, id: rowID, isDetached: true, content: options.draft.title}],
        blockID: options.blockID,
        context: {ignoreTip: "true"},
    });
    pushUpdate(ops, {
        avID: options.avID,
        rowID,
        keyID: options.dateFieldID,
        newValue: dateValue,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        fieldID: options.mapping.recurrenceFieldID,
        value: normalizeRecurrenceValue(options.draft.recurrenceRaw),
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        fieldID: options.mapping.exceptionFieldID,
        value: options.draft.recurrenceExceptionRaw,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        fieldID: options.mapping.locationFieldID,
        value: options.draft.location,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        fieldID: options.mapping.descriptionFieldID,
        value: options.draft.description,
    });
    addColorUpdate(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        fieldID: options.mapping.colorFieldID,
        value: options.draft.colorContent,
    });
    addDraftFieldUpdates(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        values: options.draft.fieldValues,
    });
    ops.undoOperations.push({action: "removeAttrViewBlock", srcIDs: [rowID], avID: options.avID});
    pushUpdated(ops, options.blockID, options.previousUpdated);
    return ops;
};

export const buildUpdateEventOperations = (options: {
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    draft: ICalendarEventDraft;
    previousUpdated?: string;
}): ICalendarOperationSet => {
    const dateValue = buildDateValue(options.draft);
    if (!dateValue) {
        return {doOperations: [], undoOperations: []};
    }
    const ops: ICalendarOperationSet = {doOperations: [], undoOperations: []};
    const blockCell = getBlockCell(options.event.sourceCard);
    // Only a DETACHED row stores its title in the block cell. Writing the block
    // cell of a BOUND row makes the kernel persist a per-AV static anchor override
    // (custom-sy-av-s-text-<avID>, kernel/model/attribute_view.go ~:6590-6601) that
    // shadows the real document title forever. For bound rows the document title
    // is authoritative and updateCalendarEvent renames the page instead.
    if (!getEventDocumentID(options.event)) {
        pushUpdate(ops, {
            avID: options.avID,
            rowID: options.event.id,
            keyID: blockCell?.value?.keyID,
            oldValue: cloneCellValue(blockCell?.value),
            newValue: buildBlockValue(options.event, options.draft.title),
        });
    }
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        keyID: options.dateFieldID,
        oldValue: cloneCellValue(options.event.dateCell?.value),
        newValue: dateValue,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.recurrenceFieldID,
        value: normalizeRecurrenceValue(options.draft.recurrenceRaw),
        oldCell: getCellByFieldID(options.event.sourceCard, options.mapping.recurrenceFieldID),
        undoEmptyWhenMissing: true,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.locationFieldID,
        value: options.draft.location,
        oldCell: getCellByFieldID(options.event.sourceCard, options.mapping.locationFieldID),
        undoEmptyWhenMissing: true,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.descriptionFieldID,
        value: options.draft.description,
        oldCell: getCellByFieldID(options.event.sourceCard, options.mapping.descriptionFieldID),
        undoEmptyWhenMissing: true,
    });
    addColorUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.colorFieldID,
        value: options.draft.colorContent,
        oldCell: getCellByFieldID(options.event.sourceCard, options.mapping.colorFieldID),
        undoEmptyWhenMissing: true,
    });
    addDraftFieldUpdates(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        values: options.draft.fieldValues,
        sourceCard: options.event.sourceCard,
    });
    if (ops.doOperations.length > 0) {
        pushUpdated(ops, options.blockID, options.previousUpdated);
    }
    return ops;
};

export const buildDeleteEventOperations = (options: {
    avID: string;
    blockID: string;
    event: ICalendarNormalizedEvent;
    previousUpdated?: string;
}): ICalendarOperationSet => {
    const ops: ICalendarOperationSet = {doOperations: [], undoOperations: []};
    const blockCell = getBlockCell(options.event.sourceCard);
    const blockValue = blockCell?.value;
    const cellSnapshots = options.event.sourceCard.values
        .map(cell => ({keyID: cell.value?.keyID, value: cloneCellValue(cell.value)}))
        .filter(item => item.keyID && item.value);
    // Boundness comes from the bound block id, NEVER from blockValue.isDetached:
    // kernel/av/value.go:40 marks IsDetached `omitempty`, so a bound row (false)
    // omits the field and `blockValue?.isDetached ?? true` used to answer
    // "detached" for every bound row - which restored bound rows as detached
    // duplicates on undo. See getBoundBlockID in ./model.
    const boundBlockID = getEventDocumentID(options.event);
    const isDetached = !boundBlockID;
    ops.doOperations.push({action: "removeAttrViewBlock", avID: options.avID, srcIDs: [options.event.id]});
    ops.undoOperations.push({
        action: "insertAttrViewBlock",
        avID: options.avID,
        blockID: options.blockID,
        previousID: "",
        srcs: [{
            // itemID is the ITEM id the kernel restores the row under, so it must
            // be the deleted event's own id - a freshly minted one would leave a
            // phantom duplicate row behind after every Ctrl+Z. srcs[].id is the
            // BOUND BLOCK id: keep the real block for bound rows, and fall back to
            // the item id for detached rows where the kernel ignores it anyway.
            itemID: options.event.id,
            id: boundBlockID || options.event.id,
            isDetached,
            content: blockValue?.block?.content || options.event.title || "",
        }],
    });
    cellSnapshots.forEach(item => {
        ops.undoOperations.push({
            action: "updateAttrViewCell",
            avID: options.avID,
            keyID: item.keyID,
            rowID: options.event.id,
            data: item.value,
        });
    });
    pushUpdated(ops, options.blockID, options.previousUpdated);
    return ops;
};

export const createCalendarEvent = async (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    draft: ICalendarEventDraft;
    previousUpdated?: string;
    viewID?: string;
}) => {
    return executeCalendarOperations(options.protyle, buildCreateEventOperations(options), options);
};

export interface ICalendarCreatedItem {
    itemID: string;
    /** The created document root id, or "" when the entry is a detached row. */
    blockID: string;
}

export interface ICalendarCreateOptions {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    draft: ICalendarEventDraft;
    viewID?: string;
    /** New-item template that resolves the notebook/path of the created page. */
    templateID?: string;
    previousID?: string;
    groupID?: string;
    previousUpdated?: string;
}

/**
 * Cell values for a NEW calendar entry, keyed by field id.
 *
 * Built with the SAME value builders the row-only path uses, so the payloads the
 * kernel receives through /api/av/createAttributeViewItem are shape-identical to
 * the ones /api/transactions already accepts.
 *
 * The title is not in here: for a bound row the kernel discards the caller's
 * block content and derives the primary key from the document
 * (getNodeAvBlockText, kernel/model/attribute_view.go ~:4673-4677), so the title
 * travels as the request's primaryKey and becomes the document name.
 */
const buildCalendarFieldValues = (options: {
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    draft: ICalendarEventDraft;
}): { [keyID: string]: IAVCellValue } | undefined => {
    const dateValue = buildDateValue(options.draft);
    if (!dateValue) {
        return undefined;
    }
    const fieldValues: { [keyID: string]: IAVCellValue } = {};
    fieldValues[options.dateFieldID] = {...dateValue, keyID: options.dateFieldID};
    const addTextValue = (fieldID?: string, value?: string) => {
        if (!fieldID || value === undefined) {
            return;
        }
        const field = getFieldByID(options.fields, fieldID);
        if (!field || field.type !== "text") {
            return;
        }
        fieldValues[fieldID] = buildTextLikeValue(field, value);
    };
    addTextValue(options.mapping.recurrenceFieldID, normalizeRecurrenceValue(options.draft.recurrenceRaw));
    addTextValue(options.mapping.exceptionFieldID, options.draft.recurrenceExceptionRaw);
    addTextValue(options.mapping.locationFieldID, options.draft.location);
    addTextValue(options.mapping.descriptionFieldID, options.draft.description);
    Object.entries(options.draft.fieldValues || {}).forEach(([fieldID, value]) => addTextValue(fieldID, value));
    const colorField = getFieldByID(options.fields, options.mapping.colorFieldID);
    if (colorField && ["select", "mSelect"].includes(colorField.type)) {
        const colorValue = buildSelectValue(colorField, options.draft.colorContent);
        if (colorValue) {
            fieldValues[colorField.id] = colorValue;
        }
    }
    return fieldValues;
};

const buildCellOperations = (avID: string, rowID: string, fieldValues: { [keyID: string]: IAVCellValue }): IOperation[] =>
    Object.keys(fieldValues).map(keyID => ({
        action: "updateAttrViewCell",
        avID,
        keyID,
        rowID,
        data: fieldValues[keyID],
    } as IOperation));

/**
 * The kernel writes fieldValues inside its own transaction, so this normally
 * verifies and does nothing. It exists because a calendar entry whose date cell
 * did not land is INVISIBLE in the calendar: if the read-back positively proves
 * the cells are missing we write them once, rather than leaving a page the user
 * can never find again. verifyCalendarWrite stays silent when the read cannot be
 * trusted, so this never fires on a write that actually landed.
 */
const reconcileCreatedItemFieldValues = async (protyle: IProtyle, target: ICalendarWriteTarget, itemID: string, fieldValues: { [keyID: string]: IAVCellValue }) => {
    const operations = buildCellOperations(target.avID, itemID, fieldValues);
    if (operations.length === 0 || await verifyCalendarWrite(target, operations)) {
        return;
    }
    await executeCalendarOperations(protyle, {doOperations: operations, undoOperations: []});
};

const createDetachedCalendarEventItem = async (options: ICalendarCreateOptions): Promise<ICalendarCreatedItem | null> => {
    const ops = buildCreateEventOperations(options);
    const itemID = (ops.doOperations[0]?.srcs || [])[0]?.itemID || "";
    if (!itemID) {
        return null;
    }
    return await executeCalendarOperations(options.protyle, ops, options) ? {itemID, blockID: ""} : null;
};

/**
 * Create a calendar entry as a real SiYuan document bound to a new AV item.
 *
 * This cannot be expressed as an operation set: only the kernel can create the
 * .sy file and bind it in one transaction, because Operation.Tree is `json:"-"`
 * (kernel/model/transaction.go:2041) and restoreCreatedDoc is therefore
 * kernel-only. So it is one POST to /api/av/createAttributeViewItem, which
 * inserts the row with srcs[{itemID, id: <new doc id>, isDetached: false}] and
 * writes the field values in the same kernel transaction.
 *
 * Returns null on failure, after showing the reason.
 */
export const createCalendarEventAsDocument = async (options: ICalendarCreateOptions): Promise<ICalendarCreatedItem | null> => {
    const fieldValues = buildCalendarFieldValues(options);
    if (!fieldValues) {
        showMessage(`${window.siyuan.languages.date || "Date"} ${window.siyuan.languages.invalid || "Invalid"}`);
        return null;
    }
    const response = await fetchSyncPost("/api/av/createAttributeViewItem", {
        avID: options.avID,
        blockID: options.blockID,
        viewID: options.viewID || "",
        templateID: options.templateID || "",
        previousID: options.previousID || "",
        groupID: options.groupID || "",
        primaryKey: options.draft.title,
        fieldValues,
        app: options.protyle?.app?.appId || Constants.SIYUAN_APPID,
        session: options.protyle?.id || "",
    });
    if (response?.code !== 0) {
        if (response?.data?.unavailableNotebook) {
            // The configured notebook is closed or gone. Never block the user on
            // it: keep the entry as a row so the save still lands, and say why the
            // page is missing.
            showMessage(window.siyuan.languages.newItemTemplateUnavailableNotebookTip ||
                "The notebook for new entries is unavailable, the entry was created without a page.", 6000, "error");
            return createDetachedCalendarEventItem(options);
        }
        showMessage(response?.msg || window.siyuan.languages.calendarCreateFailed || "Create failed.");
        return null;
    }
    const itemID = (response.data?.itemID || "") as string;
    if (!itemID) {
        showMessage(window.siyuan.languages.calendarCreateFailed || "Create failed.");
        return null;
    }
    const warnings = (response.data?.warnings || []) as string[];
    if (warnings.length > 0) {
        showMessage(warnings.join("<br>"));
    }
    await reconcileCreatedItemFieldValues(options.protyle, options, itemID, fieldValues);
    // The kernel answers BlockID == ItemID for a detached item (no document was
    // created); report that as "no page" instead of a document id that does not
    // resolve to anything openable.
    const documentID = (response.data?.blockID || "") as string;
    return {itemID, blockID: documentID === itemID ? "" : documentID};
};


/**
 * Deleting the page behind an entry. The caller exposes this as a separate,
 * explicit page-removal action because the calendar's undo stack cannot restore
 * a document.
 * Endpoint verified against kernel/api/router.go:150 ->
 * kernel/api/filetree.go:622 removeDocByID, which takes {id}.
 */
export const deleteCalendarEventDocument = async (documentID: string) => {
    const response = await fetchSyncPost("/api/filetree/removeDocByID", {id: documentID});
    if (response?.code !== 0) {
        showMessage(response?.msg || window.siyuan.languages.calendarDeletePageFailed || "Deleting the event page failed.");
        return false;
    }
    return true;
};

/** Undo an already committed operation set without registering a new undo step. */
const revertCalendarOperations = async (protyle: IProtyle, ops: ICalendarOperationSet) => {
    if (ops.undoOperations.length === 0) {
        return true;
    }
    return executeCalendarOperations(protyle, {doOperations: [...ops.undoOperations], undoOperations: []});
};

export const createCalendarEventReplacingOccurrence = async (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    draft: ICalendarEventDraft;
    occurrenceDate: string;
    previousUpdated?: string;
    viewID?: string;
    /** The view creates entries as documents, so the replacement needs a page too. */
    createAsDocument?: boolean;
    templateID?: string;
}) => {
    const exceptionOps = buildOccurrenceExceptionOperations({
        avID: options.avID,
        blockID: options.blockID,
        fields: options.fields,
        mapping: options.mapping,
        event: options.event,
        occurrenceDate: options.occurrenceDate,
        previousUpdated: options.previousUpdated,
    });
    const replacementDraft: ICalendarEventDraft = {
        ...options.draft,
        recurrenceRaw: "",
        recurrenceExceptionRaw: "",
    };
    if (exceptionOps.doOperations.length === 0 || !isRealDateInputValue(options.draft.date)) {
        return false;
    }
    if (!options.createAsDocument) {
        const createOps = buildCreateEventOperations({
            avID: options.avID,
            blockID: options.blockID,
            dateFieldID: options.dateFieldID,
            fields: options.fields,
            mapping: options.mapping,
            draft: replacementDraft,
            previousUpdated: options.previousUpdated,
        });
        if (createOps.doOperations.length === 0) {
            return false;
        }
        return executeCalendarOperations(options.protyle, {
            doOperations: [...exceptionOps.doOperations, ...createOps.doOperations],
            undoOperations: [...createOps.undoOperations, ...exceptionOps.undoOperations],
        }, options);
    }
    // A page cannot be created from inside an operation set, so the two halves are
    // sequenced instead. Hide the occurrence FIRST - that is a single, fully
    // reversible cell write - and only then create the replacement page. If the
    // page cannot be created the exception is put back, so the series is never
    // left with a hidden occurrence and no replacement, and no freshly created
    // document ever has to be destroyed to clean up.
    if (!await executeCalendarOperations(options.protyle, exceptionOps, options)) {
        return false;
    }
    const created = await createCalendarEventAsDocument({...options, draft: replacementDraft});
    if (!created) {
        if (!await revertCalendarOperations(options.protyle, exceptionOps)) {
            showMessage(window.siyuan.languages.calendarOccurrenceRollbackFailed ||
                "The occurrence stayed hidden and no replacement was created.");
        }
        return false;
    }
    return true;
};

export const updateCalendarEvent = async (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    draft: ICalendarEventDraft;
    previousUpdated?: string;
    viewID?: string;
}) => {
    if (!isRealDateInputValue(options.draft.date)) {
        return false;
    }
    const documentID = getEventDocumentID(options.event);
    const currentTitle = options.event.isTitleFallback ? "" : (options.event.title || "");
    const nextTitle = (options.draft.title || "").trim();
    if (documentID) {
        const fieldValues = buildCalendarFieldValues(options);
        if (!fieldValues) {
            return false;
        }
        const response = await fetchSyncPost("/api/av/updateAttributeViewItem", {
            avID: options.avID,
            blockID: options.blockID,
            viewID: options.viewID || "",
            itemID: options.event.id,
            boundBlockID: documentID,
            primaryKey: nextTitle || currentTitle,
            fieldValues,
            app: options.protyle?.app?.appId || Constants.SIYUAN_APPID,
            session: options.protyle?.id || Constants.SIYUAN_APPID,
        });
        if (response?.code !== 0) {
            showMessage(response?.msg || window.siyuan.languages.calendarUpdateFailed || "Updating the calendar event failed.");
            return false;
        }
        if (options.viewID && !await verifyBoundCalendarItemUpdate(options, options.event.id, documentID, nextTitle || currentTitle, fieldValues)) {
            showMessage(window.siyuan.languages.calendarUpdateFailed || "The calendar update could not be confirmed.");
            return false;
        }
        return true;
    }
    const ops = buildUpdateEventOperations(options);
    if (ops.doOperations.length > 0) {
        return executeCalendarOperations(options.protyle, ops, options);
    }
    return true;
};

export const updateCalendarEventThisAndFuture = async (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    draft: ICalendarEventDraft;
    occurrenceDate: string;
    previousUpdated?: string;
    viewID?: string;
    /** The view creates entries as documents, so the follow-up series needs a page too. */
    createAsDocument?: boolean;
    templateID?: string;
}) => {
    if (!isRealDateInputValue(options.draft.date)) {
        return false;
    }
    if (!options.createAsDocument) {
        const ops = buildSplitSeriesOperations(options);
        if (ops.doOperations.length > 0) {
            return executeCalendarOperations(options.protyle, ops, options);
        }
        return true;
    }
    // Same sequencing as the occurrence replacement: truncate the original series
    // first (one reversible cell write), then create the follow-up series page,
    // and put the original recurrence back if the page cannot be created.
    const truncateOps = buildSplitTruncateOperations(options);
    if (truncateOps.doOperations.length > 0 && !await executeCalendarOperations(options.protyle, truncateOps, options)) {
        return false;
    }
    const created = await createCalendarEventAsDocument({...options, draft: buildSplitFutureDraft(options)});
    if (!created) {
        if (!await revertCalendarOperations(options.protyle, truncateOps)) {
            showMessage(window.siyuan.languages.calendarSplitRollbackFailed ||
                "The series was cut short and no follow-up series was created.");
        }
        return false;
    }
    return true;
};

export const deleteCalendarEvent = async (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    event: ICalendarNormalizedEvent;
    previousUpdated?: string;
    viewID?: string;
}) => {
    return executeCalendarOperations(options.protyle, buildDeleteEventOperations(options), options);
};

export const deleteCalendarEventThisAndFuture = async (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    occurrenceDate: string;
    previousUpdated?: string;
    viewID?: string;
}) => {
    if (!options.mapping.recurrenceFieldID) {
        return false;
    }
    if (!dayjs(options.occurrenceDate).isAfter(options.event.start, "day")) {
        return deleteCalendarEvent(options);
    }
    const ops = buildSplitTruncateOperations(options);
    return ops.doOperations.length > 0 ? executeCalendarOperations(options.protyle, ops, options) : false;
};

export const deleteCalendarOccurrence = async (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    occurrenceDate: string;
    previousUpdated?: string;
    viewID?: string;
}) => {
    const ops = buildOccurrenceExceptionOperations(options);
    if (ops.doOperations.length > 0) {
        return executeCalendarOperations(options.protyle, ops, options);
    }
    return false;
};
