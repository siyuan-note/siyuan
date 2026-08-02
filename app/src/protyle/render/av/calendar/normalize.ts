import * as dayjs from "dayjs";
import {expandRecurrences, parseRecurrence} from "./recurrence";
import {getBlockCell, getBoundBlockID, getCellByFieldID, getTextFromCell, ICalendarFieldMapping, ICalendarNormalizedEvent, ICalendarRange} from "./model";
import {getMappedMetadata} from "./mapped-fields";

const normalizeCard = (card: IAVGalleryItem, mapping: ICalendarFieldMapping): ICalendarNormalizedEvent | undefined => {
    const dateCell = getCellByFieldID(card, mapping.dateFieldID);
    const dateValue = dateCell?.value?.date;
    if (!dateValue?.isNotEmpty || !dateValue.content) {
        return undefined;
    }
    const blockCell = getBlockCell(card);
    const blockValue = blockCell?.value?.block;
    const metadata = getMappedMetadata(card, mapping);
    const fieldValues: { [fieldID: string]: string } = {};
    card.values.forEach(cell => {
        const fieldID = cell.value?.keyID;
        if (fieldID) {
            fieldValues[fieldID] = getTextFromCell(cell);
        }
    });
    const start = dayjs(dateValue.content);
    if (!start.isValid()) {
        return undefined;
    }
    const rawEnd = dateValue.hasEndDate && dateValue.content2 ? dayjs(dateValue.content2) : undefined;
    let end = rawEnd?.isValid() ? rawEnd : (dateValue.isNotTime === false ? start.add(1, "hour") : start.endOf("day"));
    if (end.isBefore(start)) {
        end = dateValue.isNotTime === false ? start.add(1, "hour") : start.endOf("day");
    }
    const realTitle = blockValue?.content || getTextFromCell(blockCell);
    return {
        id: card.id,
        // "" for a detached row: the kernel only fills the block value id when the
        // row is bound to a document (see getBoundBlockID). Never derive this from
        // value.isDetached - it is `omitempty` and therefore absent on bound rows.
        blockID: getBoundBlockID(card),
        title: realTitle || window.siyuan.languages.untitled,
        isTitleFallback: !realTitle,
        start,
        end,
        isAllDay: dateValue.isNotTime !== false,
        dateCell,
        recurrence: parseRecurrence(metadata.recurrence),
        recurrenceRaw: metadata.recurrence,
        recurrenceExceptionRaw: metadata.recurrenceException,
        recurrenceExceptions: parseRecurrenceExceptions(metadata.recurrenceException),
        location: metadata.location,
        description: metadata.description,
        color: metadata.color,
        colorContent: metadata.colorContent,
        fieldValues,
        sourceCard: card,
    };
};

const normalizeExceptionDate = (value: string) => {
    const isRealDate = (dateValue: string) => {
        const parsed = dayjs(dateValue);
        return parsed.isValid() && parsed.format("YYYY-MM-DD") === dateValue;
    };
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return isRealDate(value) ? value : "";
    }
    if (/^\d{8}$/.test(value)) {
        const dateValue = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
        return isRealDate(dateValue) ? dateValue : "";
    }
    const dateTimeMatch = value.match(/^(\d{4})(\d{2})(\d{2})T\d{6}Z?$/);
    if (dateTimeMatch) {
        const dateValue = `${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}`;
        return isRealDate(dateValue) ? dateValue : "";
    }
    return "";
};

const parseRecurrenceExceptions = (value = "") => {
    return Array.from(new Set(value.split(/[\s,;]+/).map(item => normalizeExceptionDate(item.trim())).filter(Boolean)));
};

export const normalizeCalendarEvents = (
    calendarData: IAVCalendar,
    mapping: ICalendarFieldMapping,
    range: ICalendarRange
): { events: ICalendarNormalizedEvent[]; baseEventsByID: Map<string, ICalendarNormalizedEvent> } => {
    if (!mapping.hasDateField) {
        return {events: [], baseEventsByID: new Map()};
    }
    // Grouped AVs deliberately clear the top-level cards after rendering and put
    // every row under view.groups[].cards. Reading only calendarData.cards makes
    // a grouped calendar look completely empty even though the rows were saved.
    const cards = [...(calendarData.cards || [])];
    (calendarData.groups || []).forEach(group => {
        ((group as unknown as IAVCalendar).cards || []).forEach(card => cards.push(card));
    });
    const uniqueCards = Array.from(new Map(cards.map(card => [card.id, card])).values());
    const baseEvents: ICalendarNormalizedEvent[] = [];
    uniqueCards.forEach(card => {
        const event = normalizeCard(card, mapping);
        if (event) {
            baseEvents.push(event);
        }
    });
    const baseEventsByID = new Map<string, ICalendarNormalizedEvent>();
    baseEvents.forEach(event => baseEventsByID.set(event.id, event));
    return {
        events: sortCalendarEvents(expandRecurrences(baseEvents, range)),
        baseEventsByID,
    };
};

export const eventOverlapsDay = (event: ICalendarNormalizedEvent, day: dayjs.Dayjs) => {
    const dayStart = day.startOf("day");
    const dayEnd = day.endOf("day");
    const eventEnd = event.end || event.start;
    return !eventEnd.isBefore(dayStart) && !event.start.isAfter(dayEnd);
};

export const sortCalendarEvents = (events: ICalendarNormalizedEvent[]) => {
    return [...events].sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) {
            return a.isAllDay ? -1 : 1;
        }
        const startDiff = a.start.valueOf() - b.start.valueOf();
        if (startDiff !== 0) {
            return startDiff;
        }
        const endDiff = (a.end?.valueOf() || a.start.valueOf()) - (b.end?.valueOf() || b.start.valueOf());
        if (endDiff !== 0) {
            return endDiff;
        }
        return a.title.localeCompare(b.title);
    });
};
