import * as dayjs from "dayjs";
import {escapeAttr, escapeHtml} from "../../../../util/escape";

/**
 * The little month navigator that sits beside the main calendar.
 *
 * Deliberately dependency-free: it takes a plain state object and hands dates
 * back through callbacks, so it never imports render.ts (which imports it).
 * Paging the mini month with its own arrows repaints ONLY the mini month - the
 * main view does not move until a day is clicked. That is the whole point of
 * the control: look ahead without losing your place.
 */

export interface ICalendarMiniMonthState {
    /** Month the navigator is currently showing. Defaults to `anchor`. */
    cursor?: dayjs.Dayjs;
    /** The main calendar's anchor date - drawn as the selected day. */
    anchor: dayjs.Dayjs;
    /** The main calendar's visible range, inclusive on both ends. */
    range?: { start: dayjs.Dayjs; end: dayjs.Dayjs };
    /** 0 = Sunday, 1 = Monday. Same convention as the main grid. */
    weekStart?: number;
    /** BCP 47 tag; falls back to window.siyuan.config.lang. */
    locale?: string;
}

export interface ICalendarMiniMonthHandlers {
    /** A day was clicked: move the MAIN calendar there. */
    onSelectDate: (date: dayjs.Dayjs) => void;
    /** The mini month was paged. Optional - purely so the caller can persist it. */
    onPageMonth?: (cursor: dayjs.Dayjs) => void;
}

const getCalendarLocale = () => window.siyuan.config.lang;

const lang = (key: string, fallback: string) => window.siyuan?.languages?.[key] || fallback;

const getSafeWeekStart = (weekStart?: number) => weekStart === 1 ? 1 : 0;

const startOfMiniWeek = (date: dayjs.Dayjs, weekStart: number) => {
    const offset = (date.day() - weekStart + 7) % 7;
    return date.subtract(offset, "day").startOf("day");
};

/**
 * Intl throws a RangeError on a malformed tag; a bad `config.lang` must degrade
 * to the runtime default rather than blank the navigator.
 */
const getDateFormatter = (locale: string, options: Intl.DateTimeFormatOptions) => {
    try {
        return new Intl.DateTimeFormat(locale, options);
    } catch (error) {
        return new Intl.DateTimeFormat(undefined, options);
    }
};

const getMiniMonthTitle = (cursor: dayjs.Dayjs, locale: string) =>
    getDateFormatter(locale, {year: "numeric", month: "long"}).format(cursor.toDate());

const getMiniWeekdayLabels = (weekStart: number, locale: string) => {
    // 2020-06-07 is a Sunday, so index 0 is always Sunday before the rotation.
    const formatter = getDateFormatter(locale, {weekday: "narrow"});
    return [0, 1, 2, 3, 4, 5, 6].map(index => formatter.format(new Date(2020, 5, 7 + ((index + weekStart) % 7))));
};

/** The 6x7 day matrix the navigator draws. Exported for tests. */
export const getMiniMonthDays = (cursor: dayjs.Dayjs, weekStart = 0): dayjs.Dayjs[] => {
    const first = startOfMiniWeek(cursor.startOf("month"), getSafeWeekStart(weekStart));
    return Array.from({length: 42}, (unused, index) => first.add(index, "day"));
};

const isInRange = (day: dayjs.Dayjs, range?: ICalendarMiniMonthState["range"]) => {
    if (!range) {
        return false;
    }
    return !day.isBefore(range.start, "day") && !day.isAfter(range.end, "day");
};

export const renderCalendarMiniMonth = (state: ICalendarMiniMonthState): string => {
    const weekStart = getSafeWeekStart(state.weekStart);
    const locale = state.locale || getCalendarLocale();
    const cursor = (state.cursor || state.anchor).startOf("month");
    const today = dayjs();
    const days = getMiniMonthDays(cursor, weekStart);
    const dayFormatter = getDateFormatter(locale, {year: "numeric", month: "long", day: "numeric"});
    return `<div class="av__calendar-mini" data-type="calendar-mini-month" data-cursor="${cursor.format("YYYY-MM")}" role="group" aria-label="${escapeAttr(lang("calendarMiniMonth", "Month navigator"))}">
    <div class="av__calendar-mini-header">
        <button class="block__icon block__icon--show" data-type="calendar-mini-prev" aria-label="${escapeAttr(lang("calendarPreviousMonth", "Previous month"))}"><svg><use xlink:href="#iconLeft"></use></svg></button>
        <span class="av__calendar-mini-title" aria-live="polite">${escapeHtml(getMiniMonthTitle(cursor, locale))}</span>
        <button class="block__icon block__icon--show" data-type="calendar-mini-next" aria-label="${escapeAttr(lang("calendarNextMonth", "Next month"))}"><svg><use xlink:href="#iconRight"></use></svg></button>
    </div>
    <div class="av__calendar-mini-weekdays" aria-hidden="true">
        ${getMiniWeekdayLabels(weekStart, locale).map(label => `<span>${escapeHtml(label)}</span>`).join("")}
    </div>
    <div class="av__calendar-mini-grid">
        ${days.map(day => {
        const dateKey = day.format("YYYY-MM-DD");
        const isToday = day.isSame(today, "day");
        const isSelected = day.isSame(state.anchor, "day");
        const classes = ["av__calendar-mini-day"];
        if (!day.isSame(cursor, "month")) {
            classes.push("av__calendar-mini-day--outside");
        }
        if (isInRange(day, state.range)) {
            classes.push("av__calendar-mini-day--in-range");
        }
        if (isSelected) {
            classes.push("av__calendar-mini-day--selected");
        }
        if (isToday) {
            classes.push("av__calendar-mini-day--today");
        }
        return `<button class="${classes.join(" ")}" data-type="calendar-mini-day" data-date="${dateKey}"${isToday ? ' aria-current="date"' : ""}${isSelected ? ' aria-pressed="true"' : ""} aria-label="${escapeAttr(dayFormatter.format(day.toDate()))}">
            <span class="av__calendar-mini-day-number">${day.date()}</span>
        </button>`;
    }).join("")}
    </div>
</div>`;
};

/**
 * Binds a rendered mini month. Paging repaints `container` in place and only
 * notifies the caller; a day click calls `onSelectDate` and nothing else.
 * Returns an unbind function.
 */
export const bindCalendarMiniMonth = (
    container: HTMLElement | null,
    state: ICalendarMiniMonthState,
    handlers: ICalendarMiniMonthHandlers,
): (() => void) => {
    if (!container) {
        return () => undefined;
    }
    const workingState: ICalendarMiniMonthState = {...state, cursor: (state.cursor || state.anchor).startOf("month")};
    const onClick = (event: MouseEvent) => {
        const target = (event.target as HTMLElement)?.closest("[data-type]") as HTMLElement;
        const type = target?.dataset.type;
        if (!type || !container.contains(target)) {
            return;
        }
        if (type === "calendar-mini-prev" || type === "calendar-mini-next") {
            event.preventDefault();
            workingState.cursor = workingState.cursor.add(type === "calendar-mini-next" ? 1 : -1, "month");
            repaint();
            handlers.onPageMonth?.(workingState.cursor);
            return;
        }
        if (type === "calendar-mini-day" && target.dataset.date) {
            event.preventDefault();
            handlers.onSelectDate(dayjs(target.dataset.date));
        }
    };
    const repaint = () => {
        container.innerHTML = renderCalendarMiniMonth(workingState);
    };
    if (!container.querySelector('[data-type="calendar-mini-month"]')) {
        repaint();
    }
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
};

/** Collect the "has events" keys from anything with a `start` date. */
export const getCalendarMiniMonthEventDays = (events: Array<{ start: dayjs.Dayjs; end?: dayjs.Dayjs }>): Set<string> => {
    const days = new Set<string>();
    events.forEach(event => {
        let cursor = event.start.startOf("day");
        const last = (event.end || event.start).startOf("day");
        // A runaway multi-year event must not spin here; a month grid only ever
        // shows 42 cells anyway.
        for (let index = 0; index < 400 && !cursor.isAfter(last, "day"); index++) {
            days.add(cursor.format("YYYY-MM-DD"));
            cursor = cursor.add(1, "day");
        }
    });
    return days;
};
