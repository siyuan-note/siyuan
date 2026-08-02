import * as dayjs from "dayjs";
import {ICalendarNormalizedEvent, ICalendarRange, ICalendarRecurrence} from "./model";

const isValidFreq = (value: string) => ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value);
const weekdayMap: { [key: string]: number } = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6};
const supportedKeys = ["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY"];

export const shouldResetCustomWeekdays = (previousPreset?: string, nextPreset?: string) =>
    nextPreset === "custom" && previousPreset !== "custom";

const parseDateStrict = (value: string, format: string) => {
    const date = dayjs(value);
    return date.isValid() && date.format(format) === value ? date : undefined;
};

const parseUntil = (value: string) => {
    if (/^\d{8}$/.test(value)) {
        return parseDateStrict(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, "YYYY-MM-DD");
    }
    const dateTimeMatch = value.match(/^(\d{4})(\d{2})(\d{2})T\d{6}Z?$/);
    if (dateTimeMatch) {
        return parseDateStrict(`${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}`, "YYYY-MM-DD");
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return parseDateStrict(value, "YYYY-MM-DD");
    }
    return undefined;
};

export const parseRecurrence = (value: unknown): ICalendarRecurrence | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    const raw = value.trim();
    if (!raw) {
        return undefined;
    }
    const str = raw.toUpperCase();
    if (str === "NONE") {
        return undefined;
    }
    if (isValidFreq(str)) {
        return {freq: str as ICalendarRecurrence["freq"]};
    }
    const result: Partial<ICalendarRecurrence> = {raw};
    let isMalformed = false;
    const seenKeys = new Set<string>();
    str.split(";").filter(Boolean).forEach(part => {
        const separatorIndex = part.indexOf("=");
        const key = separatorIndex > -1 ? part.slice(0, separatorIndex) : "";
        const val = separatorIndex > -1 ? part.slice(separatorIndex + 1) : "";
        if (!key || !val || !supportedKeys.includes(key) || seenKeys.has(key)) {
            isMalformed = true;
            return;
        }
        seenKeys.add(key);
        if (key === "FREQ" && isValidFreq(val)) {
            result.freq = val as ICalendarRecurrence["freq"];
        } else if (key === "INTERVAL") {
            const interval = /^\d+$/.test(val) ? parseInt(val, 10) : 0;
            if (interval > 0) {
                result.interval = interval;
            } else {
                isMalformed = true;
            }
        } else if (key === "COUNT") {
            const count = /^\d+$/.test(val) ? parseInt(val, 10) : 0;
            if (count > 0) {
                result.count = count;
            } else {
                isMalformed = true;
            }
        } else if (key === "UNTIL") {
            const until = parseUntil(val);
            if (until) {
                result.until = until.endOf("day");
            } else {
                isMalformed = true;
            }
        } else if (key === "BYDAY") {
            const values = val.split(",");
            const byDay = values.filter(day => weekdayMap[day] !== undefined).sort((a, b) => weekdayMap[a] - weekdayMap[b]);
            if (byDay.length > 0) {
                result.byDay = byDay;
            }
            if (byDay.length !== values.length || new Set(byDay).size !== byDay.length) {
                isMalformed = true;
            }
        } else {
            isMalformed = true;
        }
    });
    if (result.byDay?.length && result.freq !== "WEEKLY") {
        isMalformed = true;
    }
    return result.freq && !isMalformed ? result as ICalendarRecurrence : undefined;
};

const getRecurringStartAtIndex = (start: dayjs.Dayjs, recurrence: ICalendarRecurrence, index: number) => {
    const interval = recurrence.interval || 1;
    if (recurrence.freq === "DAILY") {
        return start.add(index * interval, "day");
    }
    if (recurrence.freq === "WEEKLY") {
        return start.add(index * interval, "week");
    }
    if (recurrence.freq === "MONTHLY") {
        return start.add(index * interval, "month");
    }
    return start.add(index * interval, "year");
};

const getExpansionStart = (range: ICalendarRange, duration: number) => range.start.subtract(Math.max(duration, 0), "millisecond");

const getAlignedRecurringStart = (event: ICalendarNormalizedEvent, expansionStart: dayjs.Dayjs) => {
    if (!event.recurrence || event.recurrence.count || !event.start.isBefore(expansionStart)) {
        return {occurrenceStart: event.start, index: 0};
    }
    const interval = event.recurrence.interval || 1;
    const unit = event.recurrence.freq === "DAILY" ? "day" : (event.recurrence.freq === "WEEKLY" ? "week" : (event.recurrence.freq === "MONTHLY" ? "month" : "year"));
    const diff = Math.max(expansionStart.diff(event.start, unit), 0);
    let index = Math.max(Math.floor(diff / interval), 0);
    let occurrenceStart = getRecurringStartAtIndex(event.start, event.recurrence, index);
    while (occurrenceStart.isBefore(expansionStart)) {
        index++;
        occurrenceStart = getRecurringStartAtIndex(event.start, event.recurrence, index);
    }
    return {occurrenceStart, index};
};

const getAlignedRecurringWeekStart = (event: ICalendarNormalizedEvent, expansionStart: dayjs.Dayjs) => {
    let weekCursor = event.start.startOf("week");
    if (event.recurrence?.count || !weekCursor.isBefore(expansionStart, "week")) {
        return weekCursor;
    }
    const interval = event.recurrence?.interval || 1;
    const diff = Math.max(expansionStart.startOf("week").diff(event.start.startOf("week"), "week"), 0);
    const skipped = Math.max(Math.floor(diff / interval), 0);
    weekCursor = weekCursor.add(skipped * interval, "week");
    while (weekCursor.isBefore(expansionStart, "week")) {
        weekCursor = weekCursor.add(interval, "week");
    }
    return weekCursor;
};

export const expandRecurrences = (events: ICalendarNormalizedEvent[], range: ICalendarRange): ICalendarNormalizedEvent[] => {
    const expanded: ICalendarNormalizedEvent[] = [];
    events.forEach(event => {
        const isException = (date: dayjs.Dayjs) => event.recurrenceExceptions?.includes(date.format("YYYY-MM-DD"));
        if (!event.recurrence) {
            if (!event.end?.isBefore(range.start, "day") && !event.start.isAfter(range.end, "day")) {
                expanded.push(event);
            }
            return;
        }
        const duration = event.end ? event.end.diff(event.start) : 0;
        const expansionStart = getExpansionStart(range, duration);
        if (event.recurrence.freq === "WEEKLY" && event.recurrence.byDay?.length > 0) {
            let weekCursor = getAlignedRecurringWeekStart(event, expansionStart);
            let index = 0;
            while (!weekCursor.isAfter(range.end, "day")) {
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
                        if (event.recurrence.count && index >= event.recurrence.count) {
                            break;
                        }
                        if (event.recurrence.until && occurrenceStart.isAfter(event.recurrence.until)) {
                            break;
                        }
                        if (!isException(occurrenceStart) &&
                            !occurrenceStart.isAfter(range.end, "day") &&
                            !(event.end ? occurrenceStart.add(duration, "millisecond").isBefore(range.start, "day") : occurrenceStart.isBefore(range.start, "day"))) {
                            expanded.push({
                                ...event,
                                start: occurrenceStart,
                                end: event.end ? occurrenceStart.add(duration, "millisecond") : undefined,
                                isOccurrence: index > 0 || !occurrenceStart.isSame(event.start),
                                occurrenceID: `${event.id}:${occurrenceStart.format("YYYYMMDD")}`,
                                baseEventID: event.id,
                            });
                        }
                        index++;
                    }
                }
                if (event.recurrence.count && index >= event.recurrence.count) {
                    break;
                }
                weekCursor = weekCursor.add(1, "week");
            }
            return;
        }
        let {occurrenceStart, index} = getAlignedRecurringStart(event, expansionStart);
        while (!occurrenceStart.isAfter(range.end, "day")) {
            if (event.recurrence.count && index >= event.recurrence.count) {
                break;
            }
            if (event.recurrence.until && occurrenceStart.isAfter(event.recurrence.until)) {
                break;
            }
            if (!isException(occurrenceStart) &&
                !(event.end ? occurrenceStart.add(duration, "millisecond").isBefore(range.start, "day") : occurrenceStart.isBefore(range.start, "day"))) {
                expanded.push({
                    ...event,
                    start: occurrenceStart,
                    end: event.end ? occurrenceStart.add(duration, "millisecond") : undefined,
                    isOccurrence: index > 0,
                    occurrenceID: `${event.id}:${occurrenceStart.format("YYYYMMDD")}`,
                    baseEventID: event.id,
                });
            }
            index++;
            occurrenceStart = getRecurringStartAtIndex(event.start, event.recurrence, index);
        }
    });
    return expanded.sort((a, b) => a.start.valueOf() - b.start.valueOf());
};
