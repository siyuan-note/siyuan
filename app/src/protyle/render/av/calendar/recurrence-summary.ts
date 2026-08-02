import * as dayjs from "dayjs";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {ICalendarRecurrence} from "./model";
import {parseRecurrence} from "./recurrence";

/**
 * Human prose for a recurrence rule, plus the preset menu that replaces the raw
 * FREQ/INTERVAL/COUNT/UNTIL/BYDAY control row.
 *
 * HONESTY RULE: this module never describes a rule `recurrence.ts` cannot
 * expand, and never OFFERS one either.
 *   - The parser only understands FREQ, INTERVAL, COUNT, UNTIL and BYDAY, and
 *     only accepts BYDAY together with FREQ=WEEKLY. Anything else parses to
 *     `undefined`, which means the event does not repeat at all - so
 *     `describeRecurrence` returns "" rather than inventing a sentence.
 *   - There is no "monthly on the 2nd Tuesday" preset: BYSETPOS/BYMONTHDAY are
 *     unsupported by both recurrence.ts and transactions.ts, so offering it
 *     would silently drop the rule on save.
 *   - MONTHLY/YEARLY expansion walks with dayjs `.add()` from the previous
 *     occurrence, which clamps and then drifts (Jan 31 -> Feb 28 -> Mar 28).
 *     For a start date that cannot survive that (day > 28, or Feb 29) the
 *     summary deliberately drops the "on day N" clause instead of promising a
 *     date the expander will not produce.
 */

export type CalendarRecurrencePreset = "none" | "daily" | "weekly" | "weekday" | "yearly" | "custom";

export const CALENDAR_RECURRENCE_PRESETS: CalendarRecurrencePreset[] = ["none", "daily", "weekly", "weekday", "yearly", "custom"];

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_INDEX: { [key: string]: number } = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6};
const EVERY_WEEKDAY_RULE = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";

const getCalendarLocale = () => window.siyuan.config.lang;

const lang = (key: string, fallback: string) => window.siyuan?.languages?.[key] || fallback;

/**
 * Intl throws a RangeError on a malformed tag, and this runs while the event
 * dialog is being built - a bad `config.lang` must degrade to the runtime
 * default, never take the whole dialog down.
 */
const formatWithLocale = (locale: string, options: Intl.DateTimeFormatOptions, date: Date) => {
    try {
        return new Intl.DateTimeFormat(locale, options).format(date);
    } catch (error) {
        return new Intl.DateTimeFormat(undefined, options).format(date);
    }
};

const fill = (template: string, x: string | number, y?: string | number) =>
    template.replace("${x}", String(x)).replace("${y}", String(y ?? ""));

const toDay = (start: dayjs.Dayjs | string) => (typeof start === "string" ? dayjs(start) : start);

const getWeekdayName = (weekdayIndex: number, locale: string, style: "short" | "long" = "short") =>
    // 2020-06-07 is a Sunday, so index 0 is Sunday.
    formatWithLocale(locale, {weekday: style}, new Date(2020, 5, 7 + weekdayIndex));

const getMonthDayLabel = (date: dayjs.Dayjs, locale: string) =>
    formatWithLocale(locale, {month: "long", day: "numeric"}, date.toDate());

const getUntilLabel = (until: dayjs.Dayjs, start: dayjs.Dayjs, locale: string) =>
    formatWithLocale(locale, until.year() === start.year() ?
        {month: "short", day: "numeric"} :
        {year: "numeric", month: "short", day: "numeric"}, until.toDate());

/** The weekdays a WEEKLY rule actually fires on, in week order. */
const getWeeklyDayCodes = (recurrence: ICalendarRecurrence, start: dayjs.Dayjs): string[] => {
    if (recurrence.byDay?.length) {
        return [...recurrence.byDay].sort((a, b) => WEEKDAY_INDEX[a] - WEEKDAY_INDEX[b]);
    }
    return [WEEKDAY_CODES[start.day()]];
};

const isEveryWeekday = (codes: string[]) =>
    codes.length === 5 && ["MO", "TU", "WE", "TH", "FR"].every(code => codes.includes(code));

/** dayjs month arithmetic drifts off a day-31 (or Feb-29) start; see the header. */
const isStableMonthDay = (start: dayjs.Dayjs) => start.date() <= 28;
const isStableYearDay = (start: dayjs.Dayjs) => !(start.month() === 1 && start.date() === 29);

const describeBase = (recurrence: ICalendarRecurrence, start: dayjs.Dayjs, locale: string): string => {
    const interval = recurrence.interval && recurrence.interval > 0 ? recurrence.interval : 1;
    if (recurrence.freq === "DAILY") {
        return interval === 1 ?
            lang("calendarDaily", "Daily") :
            fill(lang("calendarRepeatEveryNDays", "Every ${x} days"), interval);
    }
    if (recurrence.freq === "WEEKLY") {
        const codes = getWeeklyDayCodes(recurrence, start);
        if (interval === 1 && isEveryWeekday(codes)) {
            return lang("calendarRepeatEveryWeekday", "Every weekday (Monday to Friday)");
        }
        const dayList = codes.map(code => getWeekdayName(WEEKDAY_INDEX[code], locale)).join(", ");
        return interval === 1 ?
            fill(lang("calendarRepeatWeeklyOn", "Weekly on ${x}"), dayList) :
            fill(lang("calendarRepeatEveryNWeeksOn", "Every ${x} weeks on ${y}"), interval, dayList);
    }
    if (recurrence.freq === "MONTHLY") {
        if (!isStableMonthDay(start)) {
            return interval === 1 ?
                lang("calendarMonthly", "Monthly") :
                fill(lang("calendarRepeatEveryNMonths", "Every ${x} months"), interval);
        }
        return interval === 1 ?
            fill(lang("calendarRepeatMonthlyOnDay", "Monthly on day ${x}"), start.date()) :
            fill(lang("calendarRepeatEveryNMonthsOnDay", "Every ${x} months on day ${y}"), interval, start.date());
    }
    if (!isStableYearDay(start)) {
        return interval === 1 ?
            lang("calendarYearly", "Yearly") :
            fill(lang("calendarRepeatEveryNYears", "Every ${x} years"), interval);
    }
    return interval === 1 ?
        fill(lang("calendarRepeatAnnuallyOn", "Annually on ${x}"), getMonthDayLabel(start, locale)) :
        fill(lang("calendarRepeatEveryNYearsOn", "Every ${x} years on ${y}"), interval, getMonthDayLabel(start, locale));
};

/**
 * Human prose for `raw`, or "" when the event does not repeat OR when the rule
 * is one the expander cannot honour (an "advanced" rule kept verbatim).
 */
export const describeRecurrence = (raw: unknown, start: dayjs.Dayjs | string, locale?: string): string => {
    const recurrence = parseRecurrence(raw);
    if (!recurrence) {
        return "";
    }
    const startDate = toDay(start);
    if (!startDate?.isValid()) {
        return "";
    }
    const resolvedLocale = locale || getCalendarLocale();
    let summary = describeBase(recurrence, startDate, resolvedLocale);
    if (recurrence.until) {
        summary += fill(lang("calendarRepeatUntilSuffix", ", until ${x}"), getUntilLabel(recurrence.until, startDate, resolvedLocale));
    }
    if (recurrence.count) {
        summary += fill(lang("calendarRepeatCountSuffix", ", ${x} times"), recurrence.count);
    }
    return summary;
};

/**
 * True when `raw` is non-empty but the parser refuses it, i.e. the rule is kept
 * verbatim and will NOT expand. The dialog shows its read-only escape hatch for
 * exactly this case.
 */
export const isAdvancedRecurrence = (raw: unknown): boolean => {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value || value.toUpperCase() === "NONE") {
        return false;
    }
    return !parseRecurrence(value);
};

/**
 * The rule string a preset stores. Every one of these round-trips through
 * `parseRecurrence` unchanged - that is asserted by the preset round-trip check.
 */
export const getRecurrencePresetRule = (preset: CalendarRecurrencePreset): string => {
    if (preset === "daily") {
        return "FREQ=DAILY";
    }
    if (preset === "weekly") {
        // No BYDAY needed: without it the expander steps a whole week from the
        // start date, which is the start weekday by construction.
        return "FREQ=WEEKLY";
    }
    if (preset === "weekday") {
        return EVERY_WEEKDAY_RULE;
    }
    if (preset === "yearly") {
        return "FREQ=YEARLY";
    }
    // "none" stores nothing; "custom" is driven by the detailed controls.
    return "";
};

/** Which preset an existing rule corresponds to. Anything richer is "custom". */
export const detectRecurrencePreset = (raw: unknown, start: dayjs.Dayjs | string): CalendarRecurrencePreset => {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value || value.toUpperCase() === "NONE") {
        return "none";
    }
    const recurrence = parseRecurrence(value);
    if (!recurrence) {
        return "custom";
    }
    if (recurrence.count || recurrence.until || (recurrence.interval && recurrence.interval > 1)) {
        return "custom";
    }
    if (recurrence.freq === "DAILY") {
        return "daily";
    }
    if (recurrence.freq === "YEARLY") {
        return "yearly";
    }
    if (recurrence.freq === "WEEKLY") {
        const codes = getWeeklyDayCodes(recurrence, toDay(start));
        if (isEveryWeekday(codes)) {
            return "weekday";
        }
        const startDate = toDay(start);
        if (codes.length === 1 && startDate?.isValid() && codes[0] === WEEKDAY_CODES[startDate.day()]) {
            return "weekly";
        }
        return "custom";
    }
    // MONTHLY has no honest preset (see the header note on BYMONTHDAY).
    return "custom";
};

export const getRecurrencePresetLabel = (preset: CalendarRecurrencePreset, start: dayjs.Dayjs | string, locale?: string): string => {
    const resolvedLocale = locale || getCalendarLocale();
    const startDate = toDay(start);
    if (preset === "none") {
        return lang("calendarDoesNotRepeat", "Does not repeat");
    }
    if (preset === "daily") {
        return lang("calendarDaily", "Daily");
    }
    if (preset === "weekly") {
        return startDate?.isValid() ?
            fill(lang("calendarRepeatWeeklyOn", "Weekly on ${x}"), getWeekdayName(startDate.day(), resolvedLocale, "long")) :
            lang("calendarWeekly", "Weekly");
    }
    if (preset === "weekday") {
        return lang("calendarRepeatEveryWeekday", "Every weekday (Monday to Friday)");
    }
    if (preset === "yearly") {
        return startDate?.isValid() && isStableYearDay(startDate) ?
            fill(lang("calendarRepeatAnnuallyOn", "Annually on ${x}"), getMonthDayLabel(startDate, resolvedLocale)) :
            lang("calendarYearly", "Yearly");
    }
    return lang("calendarRepeatCustom", "Custom…");
};

/** <option> markup for the preset menu. */
export const renderRecurrencePresetOptions = (selected: CalendarRecurrencePreset, start: dayjs.Dayjs | string, locale?: string): string =>
    CALENDAR_RECURRENCE_PRESETS.map(preset =>
        `<option value="${escapeAttr(preset)}"${preset === selected ? " selected" : ""}>${escapeHtml(getRecurrencePresetLabel(preset, start, locale))}</option>`
    ).join("");
