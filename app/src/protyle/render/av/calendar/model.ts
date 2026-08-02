import * as dayjs from "dayjs";

export interface ICalendarRange {
    start: dayjs.Dayjs;
    end: dayjs.Dayjs;
}

export interface ICalendarFieldMapping {
    dateFieldID: string;
    recurrenceFieldID?: string;
    exceptionFieldID?: string;
    locationFieldID?: string;
    descriptionFieldID?: string;
    colorFieldID?: string;
    hasDateField: boolean;
}

export interface ICalendarRecurrence {
    freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
    interval?: number;
    count?: number;
    until?: dayjs.Dayjs;
    byDay?: string[];
    raw?: string;
}

export interface ICalendarEventDraft {
    title: string;
    date: string;
    endDate?: string;
    isAllDay: boolean;
    startTime: string;
    endTime: string;
    recurrenceRaw?: string;
    recurrenceExceptionRaw?: string;
    location?: string;
    description?: string;
    color?: string;
    colorContent?: string;
    fieldValues?: { [fieldID: string]: string };
}

export interface ICalendarNormalizedEvent {
    id: string;
    blockID?: string;
    title: string;
    isTitleFallback?: boolean;
    start: dayjs.Dayjs;
    end?: dayjs.Dayjs;
    isAllDay: boolean;
    dateCell?: IAVCell;
    recurrence?: ICalendarRecurrence;
    recurrenceRaw?: string;
    recurrenceExceptionRaw?: string;
    recurrenceExceptions?: string[];
    location?: string;
    description?: string;
    color?: string;
    colorContent?: string;
    fieldValues?: { [fieldID: string]: string };
    sourceCard: IAVGalleryItem;
    isOccurrence?: boolean;
    occurrenceID?: string;
    baseEventID?: string;
}

export const getCellByFieldID = (card: IAVGalleryItem, fieldID?: string): IAVCell | undefined => {
    if (!fieldID) {
        return undefined;
    }
    return card.values.find(item => item.value?.keyID === fieldID || item.id === fieldID);
};

export const getBlockCell = (card: IAVGalleryItem): IAVCell | undefined => {
    return card.values.find(item => item.valueType === "block" || item.value?.type === "block");
};

/**
 * The bound document id of a row, or "" when the row is detached.
 *
 * Never read `value.isDetached` to answer this: kernel/av/value.go:40 declares
 * `IsDetached bool \`json:"isDetached,omitempty"\``, so a BOUND row (false) omits
 * the field entirely and `value.isDetached ?? true` reports "detached" for every
 * bound row. ValueBlock.ID is documented as "绑定的块 ID，非绑定块时为空" and
 * kernel/model/attribute_view.go:4710 only assigns it when !isDetached, so the
 * presence of the bound block id is the only trustworthy signal. The kernel
 * derives it the same way (attribute_view.go:2632
 * `blockValue.IsDetached || "" == blockValue.Block.ID`).
 */
export const getBoundBlockID = (card?: IAVGalleryItem): string => {
    if (!card) {
        return "";
    }
    return getBlockCell(card)?.value?.block?.id || "";
};

export const isDetachedCard = (card?: IAVGalleryItem): boolean => !getBoundBlockID(card);

/** The document a calendar event opens, or "" when the event is a detached row. */
export const getEventDocumentID = (event?: ICalendarNormalizedEvent): string => {
    if (!event) {
        return "";
    }
    return event.blockID || getBoundBlockID(event.sourceCard);
};

export const getTextFromCell = (cell?: IAVCell): string => {
    const value = cell?.value;
    if (!value) {
        return "";
    }
    return value.text?.content || value.template?.content || value.block?.content || value.url?.content || "";
};

export const cloneCellValue = (value?: IAVCellValue): IAVCellValue | undefined => {
    if (!value) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value));
};

export const getFieldByID = (fields: IAVColumn[], fieldID?: string): IAVColumn | undefined => {
    if (!fieldID) {
        return undefined;
    }
    return fields.find(field => field.id === fieldID);
};
