import {
    CALENDAR_FALLBACK_SCROLL_MINUTE,
    getNowOffsetPx,
    ICalendarTimeGeometry,
    minuteToOffsetPx,
} from "./time-geometry";

/**
 * The red "now" line.
 *
 * Deliberately not part of the grid HTML string: it owns a timer, and a timer
 * that is created by a render pass must also be destroyed by the next one. The
 * registry below keys the teardown on the AV block element, so re-rendering the
 * same calendar a hundred times leaves exactly one interval alive - and removing
 * the block from the DOM leaves none.
 *
 * It also owns the first-render scroll, because "scroll to now" and "draw now"
 * are the same piece of knowledge. The rule is: never fight the user. We only
 * scroll when the caller tells us there was no scroll position to restore.
 */

export const CALENDAR_NOW_INDICATOR_CLASS = "av__calendar-now-indicator";
/** One tick a minute is enough for a line whose smallest visible step is a minute. */
export const CALENDAR_NOW_TICK_MS = 30 * 1000;

export interface IMountNowIndicatorOptions {
    /** The AV block element; identifies the calendar across re-renders. */
    blockElement: HTMLElement;
    /** The scroll container produced by renderCalendarTimeGrid. */
    gridElement: HTMLElement | null;
    geometry: ICalendarTimeGeometry;
    /**
     * True when renderCalendar restored a previous scrollTop. When true we must
     * not auto-scroll: the user was looking at something.
     */
    hasRestoredScroll: boolean;
    /** Injectable clock so the behaviour is testable without waiting a minute. */
    now?: () => Date;
}

const teardowns = new WeakMap<HTMLElement, () => void>();

/** Stop and forget the indicator previously mounted on this block element. */
export const unmountCalendarNowIndicator = (blockElement: HTMLElement) => {
    const teardown = teardowns.get(blockElement);
    if (teardown) {
        teardowns.delete(blockElement);
        teardown();
    }
};

const buildIndicator = () => {
    const indicator = document.createElement("div");
    indicator.className = CALENDAR_NOW_INDICATOR_CLASS;
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerHTML = `<span class="av__calendar-now-dot"></span><span class="av__calendar-now-line"></span>`;
    return indicator;
};

/**
 * Draw the line in today's column and keep it ticking.
 *
 * Returns a teardown function; calling mount again for the same block element
 * runs the previous teardown first, so callers never have to.
 */
export const mountCalendarNowIndicator = (options: IMountNowIndicatorOptions) => {
    unmountCalendarNowIndicator(options.blockElement);
    const gridElement = options.gridElement;
    if (!gridElement) {
        return () => undefined as void;
    }
    const clock = options.now || (() => new Date());
    const geometry = options.geometry;
    const indicator = buildIndicator();

    const findTodayColumn = () => {
        const today = clock();
        const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        return gridElement.querySelector(`.av__calendar-time-day[data-date="${key}"]`) as HTMLElement | null;
    };

    const paint = () => {
        const column = findTodayColumn();
        const offset = getNowOffsetPx(clock(), geometry);
        if (!column || offset === null) {
            // Today is not on screen (or the clock is outside the drawn window):
            // no line at all, rather than a line on the wrong day.
            indicator.remove();
            return null;
        }
        if (indicator.parentElement !== column) {
            column.appendChild(indicator);
        }
        indicator.style.top = `${offset}px`;
        return offset;
    };

    paint();
    if (!options.hasRestoredScroll) {
        // First look at this calendar: show context before the earliest visible
        // timed event. With no timed events, start at 06:00 instead of midnight.
        const starts = Array.from(gridElement.querySelectorAll<HTMLElement>(".av__calendar-timed-event[data-start-minute]"))
            .map(element => parseInt(element.dataset.startMinute || "", 10))
            .filter(Number.isFinite);
        const firstInterestingMinute = starts.length > 0 ?
            Math.max(Math.min(...starts) - 60, geometry.dayStartMinute) :
            CALENDAR_FALLBACK_SCROLL_MINUTE;
        gridElement.scrollTop = Math.max(minuteToOffsetPx(firstInterestingMinute, geometry), 0);
    }

    const timer = window.setInterval(paint, CALENDAR_NOW_TICK_MS);
    const teardown = () => {
        window.clearInterval(timer);
        indicator.remove();
    };
    teardowns.set(options.blockElement, teardown);
    return teardown;
};
