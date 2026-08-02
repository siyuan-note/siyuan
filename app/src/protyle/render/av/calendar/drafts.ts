import * as dayjs from "dayjs";
import {ICalendarEventDraft, ICalendarNormalizedEvent} from "./model";
import {
    CALENDAR_MINUTES_PER_DAY,
    formatClockLabel,
    getCalendarTimeGeometry,
    ICalendarTimeGeometry,
    snapMinutes,
} from "./time-geometry";

/**
 * Pure ICalendarEventDraft builders for every direct-manipulation gesture.
 *
 * Nothing in this file touches the DOM, reads window.siyuan or issues a
 * transaction: a builder turns (source event, gesture target, geometry) into a
 * draft *transform*, and the caller routes that transform through
 * applyScopedEventDraft in render.ts so the recurrence-scope prompt, the pending
 * state and the rollback-on-failure keep working exactly as before.
 *
 * Why a transform instead of a draft: applyScopedEventDraft may apply the same
 * gesture to a DIFFERENT event than the one the user grabbed. Grabbing a
 * generated occurrence and choosing "whole series" re-runs the builder against
 * the base event. So every gesture is expressed as "measure a delta on the
 * source, then apply that delta to whatever event the scope dialog picked" -
 * which is precisely what the inline handlers in render.ts did with their
 * `(target) => ({...})` closures.
 *
 * A builder returns null when the gesture is a no-op or would invert the event
 * (end before start). The caller MUST skip the write in that case, exactly like
 * the old `if (!nextEnd.isAfter(sourceEvent.start)) { return; }` early exits.
 */

/**
 * The snap step, the minimum duration and the day bounds all come from
 * time-geometry.ts, which is the single source of truth for the grid's
 * minute<->pixel math. These builders only ever read the minute-side fields of
 * that record, so a caller may hand in the real geometry, a partial override, or
 * nothing at all.
 */

/** A point on the timed grid: which day column, and which minute of that day. */
export interface ICalendarGridPoint {
    date: string;
    minute: number;
}

export interface ICalendarGridRange {
    start: ICalendarGridPoint;
    end: ICalendarGridPoint;
}

/**
 * Applies a measured gesture to whichever event the recurrence-scope dialog
 * selected. This is the exact shape applyScopedEventDraft already expects.
 */
export type ICalendarDraftTransform = (target: ICalendarNormalizedEvent) => ICalendarEventDraft;

/** Fill in a full geometry record from whatever (if anything) the caller has. */
export const resolveCalendarGeometry = (geometry?: Partial<ICalendarTimeGeometry>): ICalendarTimeGeometry =>
    getCalendarTimeGeometry(geometry?.dayCount, geometry || {});

/** Snap a raw minute-of-day onto the grid step and clamp it into the day. */
export const snapCalendarMinute = (minute: number, geometry?: Partial<ICalendarTimeGeometry>) => {
    const resolved = resolveCalendarGeometry(geometry);
    if (typeof minute !== "number" || !isFinite(minute)) {
        return resolved.dayStartMinute;
    }
    return snapMinutes(minute, resolved);
};

const toDayStart = (date: string) => {
    const parsed = dayjs(date);
    return parsed.isValid() ? parsed.startOf("day") : null;
};

/** The absolute instant a grid point stands for, or null for an unusable date. */
export const resolveGridPoint = (point: ICalendarGridPoint, geometry?: Partial<ICalendarTimeGeometry>) => {
    const dayStart = toDayStart(point?.date);
    if (!dayStart) {
        return null;
    }
    return dayStart.add(snapCalendarMinute(point.minute, geometry), "minute");
};

/**
 * The end used for timed duration math. Mirrors render.ts: an event without an
 * end is treated as one hour long.
 */
const getTimedEnd = (event: ICalendarNormalizedEvent) => event.end || event.start.add(1, "hour");

const carryEventMetadata = (event: ICalendarNormalizedEvent) => ({
    recurrenceRaw: event.recurrenceRaw,
    location: event.location,
    description: event.description,
    colorContent: event.colorContent,
});

const buildTimedDraft = (event: ICalendarNormalizedEvent, start: dayjs.Dayjs, end: dayjs.Dayjs): ICalendarEventDraft => ({
    title: event.title,
    date: start.format("YYYY-MM-DD"),
    endDate: end.format("YYYY-MM-DD"),
    isAllDay: false,
    startTime: start.format("HH:mm"),
    endTime: end.format("HH:mm"),
    ...carryEventMetadata(event),
});

const buildAllDayDraft = (event: ICalendarNormalizedEvent, startDay: dayjs.Dayjs, endDay: dayjs.Dayjs): ICalendarEventDraft => ({
    title: event.title,
    date: startDay.format("YYYY-MM-DD"),
    endDate: endDay.format("YYYY-MM-DD"),
    isAllDay: true,
    startTime: event.start.format("HH:mm"),
    endTime: event.end ? event.end.format("HH:mm") : "23:59",
    ...carryEventMetadata(event),
});

/**
 * Move an event to another DATE, keeping its clock times and its length in days.
 *
 * Lifted verbatim from render.ts so the day-only drop keeps behaving identically
 * (multi-day all-day items keep their span, an event without an end is treated
 * as one hour long).
 */
export const buildDraftForDate = (sourceEvent: ICalendarNormalizedEvent, targetDate: string): ICalendarEventDraft => {
    const durationDays = Math.max((sourceEvent.end || sourceEvent.start).startOf("day").diff(sourceEvent.start.startOf("day"), "day"), 0);
    return {
        title: sourceEvent.title,
        date: targetDate,
        endDate: dayjs(targetDate).add(durationDays, "day").format("YYYY-MM-DD"),
        isAllDay: sourceEvent.isAllDay,
        startTime: sourceEvent.start.format("HH:mm"),
        endTime: sourceEvent.end ? sourceEvent.end.format("HH:mm") : sourceEvent.start.add(1, "hour").format("HH:mm"),
        recurrenceRaw: sourceEvent.recurrenceRaw,
        location: sourceEvent.location,
        description: sourceEvent.description,
        colorContent: sourceEvent.colorContent,
    };
};

/**
 * How many days into a multi-day event the user grabbed it.
 *
 * A Tue-Thu bar dropped on Friday from its Wednesday cell must start on
 * Thursday, not on Friday. `displayDate` is the chip's data-date.
 */
export const getDragOffsetDays = (sourceEvent: ICalendarNormalizedEvent, displayDate?: string) => {
    if (!displayDate) {
        return 0;
    }
    const grabbed = toDayStart(displayDate);
    if (!grabbed) {
        return 0;
    }
    const dragOffsetDays = Math.max(grabbed.diff(sourceEvent.start.startOf("day"), "day"), 0);
    return dragOffsetDays;
};

/**
 * Gesture: move to a date (month cell, all-day rail, day column header).
 *
 * Same math the HTML5 drop handler used, including the multi-day all-day end
 * time fix-up, so nothing about day-only moves changes.
 */
export const buildMoveToDateTransform = (
    sourceEvent: ICalendarNormalizedEvent,
    targetDate: string,
    options?: {displayDate?: string},
): ICalendarDraftTransform | null => {
    const targetDay = toDayStart(targetDate);
    if (!targetDay) {
        return null;
    }
    const dragOffsetDays = getDragOffsetDays(sourceEvent, options?.displayDate);
    const draftDate = targetDay.subtract(dragOffsetDays, "day").format("YYYY-MM-DD");
    if (draftDate === sourceEvent.start.format("YYYY-MM-DD")) {
        return null;
    }
    return (target) => {
        const dayDelta = dayjs(draftDate).diff(sourceEvent.start.startOf("day"), "day");
        const targetDraftDate = target === sourceEvent ?
            draftDate :
            target.start.startOf("day").add(dayDelta, "day").format("YYYY-MM-DD");
        const draft = buildDraftForDate(target, targetDraftDate);
        if (target.isAllDay && target.end && !target.start.isSame(target.end, "day")) {
            draft.endTime = target.end?.format("HH:mm") || "23:59";
        }
        return draft;
    };
};

/**
 * Gesture: move across days AND times at once (drag on the timed grid).
 *
 * The source lands exactly on the snapped point the pointer is over; any other
 * event the scope dialog picks is shifted by the same signed minute delta, so a
 * series keeps its internal spacing instead of being collapsed onto one time.
 * Duration is preserved per event (never below the geometry minimum).
 *
 * An all-day event is NOT silently converted to a timed one unless the caller
 * asks for it: without `convertAllDay` the gesture degrades to a day-only move,
 * which is the conservative reading of dropping a bar onto a column.
 */
export const buildMoveToDateTimeTransform = (
    sourceEvent: ICalendarNormalizedEvent,
    point: ICalendarGridPoint,
    geometry?: Partial<ICalendarTimeGeometry>,
    options?: {convertAllDay?: boolean, defaultDurationMinutes?: number},
): ICalendarDraftTransform | null => {
    const resolved = resolveCalendarGeometry(geometry);
    const desiredStart = resolveGridPoint(point, resolved);
    if (!desiredStart) {
        return null;
    }
    if (sourceEvent.isAllDay && !options?.convertAllDay) {
        return buildMoveToDateTransform(sourceEvent, point.date);
    }
    const minuteDelta = desiredStart.diff(sourceEvent.start, "minute");
    if (minuteDelta === 0 && !sourceEvent.isAllDay) {
        return null;
    }
    const fallbackDuration = Math.max(options?.defaultDurationMinutes || 60, resolved.minimumEventMinutes);
    return (target) => {
        const nextStart = target === sourceEvent ? desiredStart : target.start.add(minuteDelta, "minute");
        const duration = target.isAllDay ?
            fallbackDuration :
            Math.max(getTimedEnd(target).diff(target.start, "minute"), resolved.minimumEventMinutes);
        return buildTimedDraft(target, nextStart, nextStart.add(duration, "minute"));
    };
};

/**
 * Gesture: drag the BOTTOM edge of a timed chip.
 *
 * Keeps the start fixed and measures a new duration, then applies that duration
 * to whichever event the scope dialog picked - identical in shape to the legacy
 * "+15m" button, which is why a series resize still behaves the same.
 */
export const buildResizeEndTransform = (
    sourceEvent: ICalendarNormalizedEvent,
    point: ICalendarGridPoint,
    geometry?: Partial<ICalendarTimeGeometry>,
): ICalendarDraftTransform | null => {
    if (sourceEvent.isAllDay) {
        return null;
    }
    const resolved = resolveCalendarGeometry(geometry);
    const desiredEnd = resolveGridPoint(point, resolved);
    if (!desiredEnd) {
        return null;
    }
    const nextDuration = Math.max(desiredEnd.diff(sourceEvent.start, "minute"), resolved.minimumEventMinutes);
    if (nextDuration === getTimedEnd(sourceEvent).diff(sourceEvent.start, "minute")) {
        return null;
    }
    return (target) => buildTimedDraft(target, target.start, target.start.add(nextDuration, "minute"));
};

/**
 * Gesture: drag the TOP edge of a timed chip.
 *
 * Keeps the end fixed and moves the start, clamped so the event can never
 * become shorter than the geometry minimum or end before it starts.
 */
export const buildResizeStartTransform = (
    sourceEvent: ICalendarNormalizedEvent,
    point: ICalendarGridPoint,
    geometry?: Partial<ICalendarTimeGeometry>,
): ICalendarDraftTransform | null => {
    if (sourceEvent.isAllDay) {
        return null;
    }
    const resolved = resolveCalendarGeometry(geometry);
    const requestedStart = resolveGridPoint(point, resolved);
    if (!requestedStart) {
        return null;
    }
    const sourceEnd = getTimedEnd(sourceEvent);
    const latestStart = sourceEnd.subtract(resolved.minimumEventMinutes, "minute");
    const desiredStart = requestedStart.isAfter(latestStart) ? latestStart : requestedStart;
    const startDelta = desiredStart.diff(sourceEvent.start, "minute");
    if (startDelta === 0) {
        return null;
    }
    return (target) => {
        const targetEnd = getTimedEnd(target);
        const targetLatestStart = targetEnd.subtract(resolved.minimumEventMinutes, "minute");
        const requested = target === sourceEvent ? desiredStart : target.start.add(startDelta, "minute");
        const nextStart = requested.isAfter(targetLatestStart) ? targetLatestStart : requested;
        return buildTimedDraft(target, nextStart, targetEnd);
    };
};

/**
 * Legacy "-15m / +15m": grow or shrink the END of a timed event by a delta.
 *
 * Kept because the context menu still offers it (and the smokes still drive it),
 * lifted verbatim from render.ts including the "never invert" early exit.
 */
export const buildTimedDurationTransform = (
    sourceEvent: ICalendarNormalizedEvent,
    deltaMinutes: number,
): ICalendarDraftTransform | null => {
    if (!deltaMinutes || sourceEvent.isAllDay) {
        return null;
    }
    const currentEnd = sourceEvent.end || sourceEvent.start.add(1, "hour");
    const nextEnd = currentEnd.add(deltaMinutes, "minute");
    if (!nextEnd.isAfter(sourceEvent.start)) {
        return null;
    }
    const nextDuration = nextEnd.diff(sourceEvent.start, "minute");
    return (target) => {
        const targetEnd = target.start.add(nextDuration, "minute");
        return buildTimedDraft(target, target.start, targetEnd);
    };
};

/**
 * Legacy "-1d / +1d": grow or shrink an all-day item by whole days.
 *
 * Lifted verbatim from render.ts, including the `data-days` inversion guard.
 */
export const buildAllDayDurationTransform = (
    sourceEvent: ICalendarNormalizedEvent,
    deltaDays: number,
): ICalendarDraftTransform | null => {
    if (!deltaDays || !sourceEvent.isAllDay) {
        return null;
    }
    const sourceEnd = (sourceEvent.end || sourceEvent.start.endOf("day")).add(deltaDays, "day");
    if (sourceEnd.isBefore(sourceEvent.start, "day")) {
        return null;
    }
    const nextDurationDays = Math.max(sourceEnd.startOf("day").diff(sourceEvent.start.startOf("day"), "day"), 0);
    return (target) => buildAllDayDraft(target, target.start.startOf("day"), target.start.startOf("day").add(nextDurationDays, "day"));
};

/** Gesture: drag the RIGHT edge of an all-day bar onto an absolute date. */
export const buildAllDayResizeEndTransform = (
    sourceEvent: ICalendarNormalizedEvent,
    targetDate: string,
): ICalendarDraftTransform | null => {
    if (!sourceEvent.isAllDay) {
        return null;
    }
    const requestedEnd = toDayStart(targetDate);
    if (!requestedEnd) {
        return null;
    }
    const sourceStartDay = sourceEvent.start.startOf("day");
    const desiredEnd = requestedEnd.isBefore(sourceStartDay, "day") ? sourceStartDay : requestedEnd;
    const nextDurationDays = Math.max(desiredEnd.diff(sourceStartDay, "day"), 0);
    const currentDurationDays = Math.max((sourceEvent.end || sourceEvent.start).startOf("day").diff(sourceStartDay, "day"), 0);
    if (nextDurationDays === currentDurationDays) {
        return null;
    }
    return (target) => buildAllDayDraft(target, target.start.startOf("day"), target.start.startOf("day").add(nextDurationDays, "day"));
};

/** Gesture: drag the LEFT edge of an all-day bar onto an absolute date. */
export const buildAllDayResizeStartTransform = (
    sourceEvent: ICalendarNormalizedEvent,
    targetDate: string,
): ICalendarDraftTransform | null => {
    if (!sourceEvent.isAllDay) {
        return null;
    }
    const requestedStart = toDayStart(targetDate);
    if (!requestedStart) {
        return null;
    }
    const sourceEndDay = (sourceEvent.end || sourceEvent.start).startOf("day");
    const desiredStart = requestedStart.isAfter(sourceEndDay, "day") ? sourceEndDay : requestedStart;
    const startDeltaDays = desiredStart.diff(sourceEvent.start.startOf("day"), "day");
    if (startDeltaDays === 0) {
        return null;
    }
    return (target) => {
        const targetEndDay = (target.end || target.start).startOf("day");
        const requested = target === sourceEvent ? desiredStart : target.start.startOf("day").add(startDeltaDays, "day");
        const nextStart = requested.isAfter(targetEndDay, "day") ? targetEndDay : requested;
        return buildAllDayDraft(target, nextStart, targetEndDay);
    };
};

/**
 * Context-menu "shift": move the whole event without changing its length.
 *
 * `days` shifts an event of either kind; `minutes` only applies to timed events
 * (an all-day item has no clock time to shift).
 */
export const buildShiftTransform = (
    sourceEvent: ICalendarNormalizedEvent,
    delta: {minutes?: number, days?: number},
): ICalendarDraftTransform | null => {
    const days = delta.days || 0;
    const minutes = delta.minutes || 0;
    if (!days && !minutes) {
        return null;
    }
    if (minutes && sourceEvent.isAllDay) {
        return null;
    }
    if (days && !minutes) {
        return (target) => {
            const draft = buildDraftForDate(target, target.start.startOf("day").add(days, "day").format("YYYY-MM-DD"));
            if (target.isAllDay && target.end && !target.start.isSame(target.end, "day")) {
                draft.endTime = target.end?.format("HH:mm") || "23:59";
            }
            return draft;
        };
    }
    const totalMinutes = minutes + days * CALENDAR_MINUTES_PER_DAY;
    return (target) => {
        const nextStart = target.start.add(totalMinutes, "minute");
        const duration = getTimedEnd(target).diff(target.start, "minute");
        return buildTimedDraft(target, nextStart, nextStart.add(duration, "minute"));
    };
};

/**
 * Context-menu "Duplicate to next day".
 *
 * A copy is a NEW one-off entry, so it must never inherit the recurrence rule or
 * the exception list of the event it was copied from.
 */
export const buildDuplicateNextDayDraft = (sourceEvent: ICalendarNormalizedEvent): ICalendarEventDraft => {
    const draft = buildDraftForDate(sourceEvent, sourceEvent.start.add(1, "day").format("YYYY-MM-DD"));
    draft.recurrenceRaw = "";
    draft.recurrenceExceptionRaw = "";
    return draft;
};

/**
 * Gesture: sweep an empty range on the timed grid.
 *
 * Both ends are snapped; the range is normalised so sweeping upwards works, and
 * a degenerate sweep is widened to the minimum duration so the quick-create
 * popover is always prefilled with a range the kernel will accept.
 */
export const buildSweepCreateDraft = (
    anchor: ICalendarGridPoint,
    current: ICalendarGridPoint,
    geometry?: Partial<ICalendarTimeGeometry>,
): ICalendarEventDraft | null => {
    const resolved = resolveCalendarGeometry(geometry);
    const anchorTime = resolveGridPoint(anchor, resolved);
    const currentTime = resolveGridPoint(current, resolved);
    if (!anchorTime || !currentTime) {
        return null;
    }
    const start = currentTime.isBefore(anchorTime) ? currentTime : anchorTime;
    let end = currentTime.isBefore(anchorTime) ? anchorTime : currentTime;
    if (end.diff(start, "minute") < resolved.minimumEventMinutes) {
        end = start.add(resolved.minimumEventMinutes, "minute");
    }
    return {
        title: "",
        date: start.format("YYYY-MM-DD"),
        endDate: end.format("YYYY-MM-DD"),
        isAllDay: false,
        startTime: start.format("HH:mm"),
        endTime: end.format("HH:mm"),
    };
};

/** Sweep across the all-day rail: one all-day draft spanning both dates. */
export const buildAllDaySweepCreateDraft = (anchorDate: string, currentDate: string): ICalendarEventDraft | null => {
    const anchorDay = toDayStart(anchorDate);
    const currentDay = toDayStart(currentDate);
    if (!anchorDay || !currentDay) {
        return null;
    }
    const start = currentDay.isBefore(anchorDay) ? currentDay : anchorDay;
    const end = currentDay.isBefore(anchorDay) ? anchorDay : currentDay;
    return {
        title: "",
        date: start.format("YYYY-MM-DD"),
        endDate: end.format("YYYY-MM-DD"),
        isAllDay: true,
        startTime: "09:00",
        endTime: "09:30",
    };
};

/**
 * The live readout shown while a gesture is in flight ("09:15 – 10:30").
 * Pure string math so it can be unit-tested with the builders.
 */
export const describeCalendarRange = (
    range: ICalendarGridRange,
    geometry?: Partial<ICalendarTimeGeometry>,
): string => {
    const resolved = resolveCalendarGeometry(geometry);
    const start = resolveGridPoint(range.start, resolved);
    const end = resolveGridPoint(range.end, resolved);
    if (!start || !end) {
        return "";
    }
    const ordered = end.isBefore(start) ? {start: end, end: start} : {start, end};
    const startLabel = ordered.start.format("HH:mm");
    const endMinutes = ordered.end.diff(ordered.end.startOf("day"), "minute");
    const endLabel = ordered.end.isSame(ordered.start, "day") ?
        formatClockLabel(endMinutes) :
        `${ordered.end.format("MM-DD")} ${formatClockLabel(endMinutes)}`;
    return `${startLabel} – ${endLabel}`;
};

/** The grid range an event currently occupies, for ghost placement. */
export const getEventGridRange = (event: ICalendarNormalizedEvent): ICalendarGridRange => {
    const end = getTimedEnd(event);
    const startDay = event.start.startOf("day");
    return {
        start: {date: startDay.format("YYYY-MM-DD"), minute: event.start.diff(startDay, "minute")},
        end: {date: end.startOf("day").format("YYYY-MM-DD"), minute: end.diff(end.startOf("day"), "minute")},
    };
};
