/**
 * The single source of truth for the calendar time grid's minute <-> pixel math.
 *
 * Pure by contract: no DOM globals, no date library. Everything that positions
 * something inside the timed grid - the grid renderer, the now indicator, the
 * optimistic chip, drag/resize gestures - MUST go through the helpers here. The
 * old renderer did this arithmetic inline with a 30 minute CSS grid row, which
 * is exactly why a 12:45-13:20 event drew at 12:30-13:30: the grid could only
 * express row boundaries, so the geometry silently lied about the data.
 *
 * Minutes are always "minutes since midnight of the day the column represents",
 * so an event that starts the previous evening enters as a negative number and
 * one that ends after midnight enters as a number past 1440; clampToDayMinutes
 * is what turns those into something drawable.
 */

export const CALENDAR_MINUTES_PER_HOUR = 60;
export const CALENDAR_MINUTES_PER_DAY = 24 * CALENDAR_MINUTES_PER_HOUR;

/**
 * Everything the user can express with a gesture snaps to this. 15 is Google
 * Calendar's granularity and, unlike the old 30 minute row, it is a snap of the
 * *value* rather than of the drawing: a 12:45 event is stored as 12:45 and drawn
 * at 12:45.
 */
export const CALENDAR_SNAP_MINUTES = 15;
/** Shortest event a gesture may produce; also the shortest chip we will draw. */
export const CALENDAR_MINIMUM_EVENT_MINUTES = 15;
/**
 * Duration given to an event that has no end, and to a plain click on empty
 * grid. This is a *default length*, never a rounding step - the old renderer
 * used one 30 minute constant for both, which is how snapping crept in.
 */
export const CALENDAR_DEFAULT_EVENT_MINUTES = 30;
/** One hour of the grid, in CSS pixels. 48px = 24px per half hour ruling. */
export const CALENDAR_HOUR_HEIGHT_PX = 48;
/** The background ruling stays at half-hour spacing; only the maths changed. */
export const CALENDAR_RULING_MINUTES = 30;
export const CALENDAR_DAY_START_MINUTE = 0;
export const CALENDAR_DAY_END_MINUTE = CALENDAR_MINUTES_PER_DAY;
/** Unshaded working window; a pure default, never persisted (see G6). */
export const CALENDAR_BUSINESS_START_MINUTE = 9 * CALENDAR_MINUTES_PER_HOUR;
export const CALENDAR_BUSINESS_END_MINUTE = 18 * CALENDAR_MINUTES_PER_HOUR;
/** Hour gutter width; the sticky day headers share this track. */
export const CALENDAR_GUTTER_WIDTH_PX = 72;
export const CALENDAR_DAY_MIN_WIDTH_PX = 104;
export const CALENDAR_ALL_DAY_LANE_HEIGHT_PX = 22;
export const CALENDAR_HEADER_HEIGHT_PX = 34;
/** Where the grid scrolls to when "now" is not on screen at all. */
export const CALENDAR_FALLBACK_SCROLL_MINUTE = 6 * CALENDAR_MINUTES_PER_HOUR;

export interface ICalendarTimeGeometry {
    /** CSS pixels per hour. */
    hourHeight: number;
    /** How many day columns the grid draws (7 for week, 1 for day). */
    dayCount: number;
    /** Gesture granularity in minutes. */
    snapMinutes: number;
    /** Shortest drawable / creatable event, in minutes. */
    minimumEventMinutes: number;
    /** First minute of the visible day (0 = midnight). */
    dayStartMinute: number;
    /** Last minute of the visible day (1440 = midnight). */
    dayEndMinute: number;
    /** Spacing of the background ruling lines, in minutes. */
    rulingMinutes: number;
    businessStartMinute: number;
    businessEndMinute: number;
    gutterWidth: number;
    dayMinWidth: number;
}

const DEFAULT_GEOMETRY: ICalendarTimeGeometry = {
    hourHeight: CALENDAR_HOUR_HEIGHT_PX,
    dayCount: 7,
    snapMinutes: CALENDAR_SNAP_MINUTES,
    minimumEventMinutes: CALENDAR_MINIMUM_EVENT_MINUTES,
    dayStartMinute: CALENDAR_DAY_START_MINUTE,
    dayEndMinute: CALENDAR_DAY_END_MINUTE,
    rulingMinutes: CALENDAR_RULING_MINUTES,
    businessStartMinute: CALENDAR_BUSINESS_START_MINUTE,
    businessEndMinute: CALENDAR_BUSINESS_END_MINUTE,
    gutterWidth: CALENDAR_GUTTER_WIDTH_PX,
    dayMinWidth: CALENDAR_DAY_MIN_WIDTH_PX,
};

/**
 * The geometry record every caller should start from. Overrides exist so a test
 * can pin a different hour height, not so the product grows a setting.
 */
export const getCalendarTimeGeometry = (dayCount = 7, overrides: Partial<ICalendarTimeGeometry> = {}): ICalendarTimeGeometry => {
    const geometry = {
        ...DEFAULT_GEOMETRY,
        dayCount: Math.max(Math.round(dayCount) || 1, 1),
        ...overrides,
    };
    if (geometry.dayEndMinute <= geometry.dayStartMinute) {
        geometry.dayStartMinute = CALENDAR_DAY_START_MINUTE;
        geometry.dayEndMinute = CALENDAR_DAY_END_MINUTE;
    }
    return geometry;
};

/** How many minutes of a day the grid actually shows. */
export const getVisibleDayMinutes = (geometry: ICalendarTimeGeometry) => geometry.dayEndMinute - geometry.dayStartMinute;

export const minutesToPx = (minutes: number, geometry: ICalendarTimeGeometry) =>
    (minutes / CALENDAR_MINUTES_PER_HOUR) * geometry.hourHeight;

export const pxToMinutes = (px: number, geometry: ICalendarTimeGeometry) =>
    (px / geometry.hourHeight) * CALENDAR_MINUTES_PER_HOUR;

/** Full pixel height of one day column. */
export const getDayHeightPx = (geometry: ICalendarTimeGeometry) => minutesToPx(getVisibleDayMinutes(geometry), geometry);

/** Pixel offset of an absolute day-minute from the top of the column. */
export const minuteToOffsetPx = (minute: number, geometry: ICalendarTimeGeometry) =>
    minutesToPx(minute - geometry.dayStartMinute, geometry);

/** Inverse of minuteToOffsetPx: what did the user point at? */
export const offsetPxToMinute = (offsetPx: number, geometry: ICalendarTimeGeometry) =>
    geometry.dayStartMinute + pxToMinutes(offsetPx, geometry);

export const clampToDayMinutes = (minute: number, geometry: ICalendarTimeGeometry) =>
    Math.min(Math.max(minute, geometry.dayStartMinute), geometry.dayEndMinute);

/** Round a minute value onto the snap grid (15 minutes), clamped to the day. */
export const snapMinutes = (minute: number, geometry: ICalendarTimeGeometry) => {
    const snap = Math.max(geometry.snapMinutes, 1);
    return clampToDayMinutes(Math.round(minute / snap) * snap, geometry);
};

/** Snap that never moves past the pointer, for a range's leading edge. */
export const snapMinutesDown = (minute: number, geometry: ICalendarTimeGeometry) => {
    const snap = Math.max(geometry.snapMinutes, 1);
    return clampToDayMinutes(Math.floor(minute / snap) * snap, geometry);
};

/** Snap that never falls short of the pointer, for a range's trailing edge. */
export const snapMinutesUp = (minute: number, geometry: ICalendarTimeGeometry) => {
    const snap = Math.max(geometry.snapMinutes, 1);
    return clampToDayMinutes(Math.ceil(minute / snap) * snap, geometry);
};

export interface ICalendarMinuteRange {
    startMinute: number;
    endMinute: number;
    topPx: number;
    heightPx: number;
    /** True when the event actually begins before this column's first minute. */
    continuesBefore: boolean;
    /** True when the event actually ends after this column's last minute. */
    continuesAfter: boolean;
}

/**
 * Turn a raw start/end minute pair into something drawable on one day column.
 *
 * This is where "a 12:45-13:20 event draws at exactly 12:45 with its true
 * height" is enforced: nothing is rounded to a row, only clamped to the visible
 * day and floored at minimumEventMinutes so a 5 minute event stays clickable.
 */
export const getEventMinuteRange = (rawStartMinute: number, rawEndMinute: number, geometry: ICalendarTimeGeometry): ICalendarMinuteRange => {
    const continuesBefore = rawStartMinute < geometry.dayStartMinute;
    const continuesAfter = rawEndMinute > geometry.dayEndMinute;
    const startMinute = clampToDayMinutes(rawStartMinute, geometry);
    const clampedEnd = clampToDayMinutes(rawEndMinute, geometry);
    const endMinute = Math.min(
        Math.max(clampedEnd, startMinute + geometry.minimumEventMinutes),
        geometry.dayEndMinute,
    );
    const topPx = minuteToOffsetPx(startMinute, geometry);
    return {
        startMinute,
        endMinute,
        topPx,
        heightPx: Math.max(minutesToPx(endMinute - startMinute, geometry), minutesToPx(geometry.minimumEventMinutes, geometry)),
        continuesBefore,
        continuesAfter,
    };
};

/** Minutes since midnight for a wall clock instant. */
export const getMinutesOfDay = (now: Date) => now.getHours() * CALENDAR_MINUTES_PER_HOUR + now.getMinutes() + now.getSeconds() / 60;

/**
 * Pixel offset of the red "now" line inside a day column, or null when the
 * current time falls outside the drawn part of the day.
 */
export const getNowOffsetPx = (now: Date, geometry: ICalendarTimeGeometry): number | null => {
    const minute = getMinutesOfDay(now);
    if (minute < geometry.dayStartMinute || minute > geometry.dayEndMinute) {
        return null;
    }
    return minuteToOffsetPx(minute, geometry);
};

/** "HH:mm" for a minute-of-day value. */
export const formatClockLabel = (minutes: number) => {
    const total = Math.max(Math.round(minutes), 0) % (CALENDAR_MINUTES_PER_DAY + 1);
    const hour = Math.floor(total / CALENDAR_MINUTES_PER_HOUR);
    const minute = total % CALENDAR_MINUTES_PER_HOUR;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

/** Parse "HH:mm" into minutes since midnight; anything unparsable is 0. */
export const parseClockMinutes = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value || "");
    if (!match) {
        return 0;
    }
    return Math.min(Math.max(parseInt(match[1], 10) * CALENDAR_MINUTES_PER_HOUR + parseInt(match[2], 10), 0), CALENDAR_MINUTES_PER_DAY);
};

/** The hour marks the sticky gutter labels. */
export const getHourMarks = (geometry: ICalendarTimeGeometry) => {
    const marks: { minute: number, label: string, offsetPx: number }[] = [];
    for (let minute = geometry.dayStartMinute; minute < geometry.dayEndMinute; minute += CALENDAR_MINUTES_PER_HOUR) {
        marks.push({minute, label: formatClockLabel(minute), offsetPx: minuteToOffsetPx(minute, geometry)});
    }
    return marks;
};

/**
 * Business hours expressed as percentages of the column, so the shading can be
 * a single CSS gradient instead of extra DOM (G6).
 */
export const getBusinessHoursPercent = (geometry: ICalendarTimeGeometry) => {
    const visible = getVisibleDayMinutes(geometry) || 1;
    const toPercent = (minute: number) => Math.min(Math.max(((minute - geometry.dayStartMinute) / visible) * 100, 0), 100);
    return {
        startPercent: toPercent(geometry.businessStartMinute),
        endPercent: toPercent(geometry.businessEndMinute),
    };
};

/**
 * Where the grid should be scrolled so `minute` sits roughly in the middle of a
 * viewport `viewportHeightPx` tall. Never negative, never past the bottom.
 */
export const getCenteredScrollTopPx = (minute: number, viewportHeightPx: number, geometry: ICalendarTimeGeometry) => {
    const target = minuteToOffsetPx(clampToDayMinutes(minute, geometry), geometry) - viewportHeightPx / 2;
    return Math.min(Math.max(target, 0), Math.max(getDayHeightPx(geometry) - viewportHeightPx, 0));
};
