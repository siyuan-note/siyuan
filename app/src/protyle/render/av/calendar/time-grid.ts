import * as dayjs from "dayjs";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {ICalendarNormalizedEvent} from "./model";
import {eventOverlapsDay, sortCalendarEvents} from "./normalize";
import {
    CALENDAR_ALL_DAY_LANE_HEIGHT_PX,
    CALENDAR_DEFAULT_EVENT_MINUTES,
    CALENDAR_HEADER_HEIGHT_PX,
    getBusinessHoursPercent,
    getDayHeightPx,
    getEventMinuteRange,
    getHourMarks,
    ICalendarTimeGeometry,
    minutesToPx,
} from "./time-geometry";
import {IAllDayLaneItem, ITimedLayoutItem, packAllDayLanes, packTimedEventColumns} from "./layout-overlap";

/**
 * The Week/Day time grid.
 *
 * One scroll container, three sticky rows that all share the same column track:
 *
 *   .av__calendar-time-grid            scroll container, owns every geometry var
 *     .av__calendar-grid-header        sticky top   - day headers
 *     .av__calendar-allday-row         sticky below - one lane per stacked bar
 *     .av__calendar-grid-body          hour gutter (sticky left) + day columns
 *
 * Before this module the day headers were their own grid with their own gap, so
 * a header never sat above its column, and the timed layer was 48 CSS rows of
 * 30 minutes, so every event was rounded to the nearest half hour. Here the
 * headers, the all-day lane and the columns are all built from the same
 * `repeat(dayCount, minmax(dayMinWidth, 1fr))` track, and every timed chip is
 * absolutely positioned from time-geometry.ts - a 12:45-13:20 event draws at
 * 12:45 with its true height.
 *
 * Week and Day are the same renderer; Day just passes a one-element day list.
 */

export interface ICalendarTimeGridLabels {
    allDay: string;
    /** aria-label prefix for the empty-space create surface. */
    createEvent: string;
}

export interface ICalendarTimeGridOptions {
    days: dayjs.Dayjs[];
    events: ICalendarNormalizedEvent[];
    editable: boolean;
    geometry: ICalendarTimeGeometry;
    viewKind: "week" | "day" | "five-day";
    labels: ICalendarTimeGridLabels;
    /** Reveal every stacked all-day lane after the user activates +x more. */
    expandAllDay?: boolean;
    /** Locale-aware short header, e.g. "Tue". */
    formatWeekday: (day: dayjs.Dayjs) => string;
    /** Locale-aware full date, used for aria-labels. */
    formatFullDate: (day: dayjs.Dayjs) => string;
    /** render.ts owns the chip markup; the grid only owns where it sits. */
    renderEventChip: (event: ICalendarNormalizedEvent, day: dayjs.Dayjs, editable: boolean, surface: "timed" | "all-day") => string;
}

/** Grid classes/attributes other modules and the smokes may rely on. */
export const CALENDAR_TIME_GRID_CLASS = "av__calendar-time-grid";
export const CALENDAR_TIME_DAY_CLASS = "av__calendar-time-day";
export const CALENDAR_TIMED_EVENT_CLASS = "av__calendar-timed-event";
export const CALENDAR_TIME_CREATE_TYPE = "calendar-time-create";
export const CALENDAR_RESIZE_HANDLE_TYPE = "calendar-resize-handle";
export const CALENDAR_ALL_DAY_VISIBLE_LANES = 3;

const isWeekend = (day: dayjs.Dayjs) => day.day() === 0 || day.day() === 6;

const dayKey = (day: dayjs.Dayjs) => day.format("YYYY-MM-DD");

/**
 * A timed event spanning date boundaries is one continuous event. Drawing it in
 * every timed column makes it look like a daily recurrence, so it belongs in the
 * spanning lane alongside all-day events while retaining its exact timestamps.
 */
export const isMultiDayTimedEvent = (event: ICalendarNormalizedEvent) =>
    !event.isAllDay && !!event.end && !event.start.isSame(event.end, "day");

const belongsInAllDayLane = (event: ICalendarNormalizedEvent) =>
    event.isAllDay || isMultiDayTimedEvent(event);

/** Raw minute range of a timed event relative to one day column's midnight. */
const getRawMinuteRange = (event: ICalendarNormalizedEvent, day: dayjs.Dayjs) => {
    const dayStart = day.startOf("day");
    const start = event.start.diff(dayStart, "minute");
    const end = (event.end || event.start.add(CALENDAR_DEFAULT_EVENT_MINUTES, "minute")).diff(dayStart, "minute");
    return {start, end};
};

const renderTimedEvents = (options: ICalendarTimeGridOptions, day: dayjs.Dayjs) => {
    const geometry = options.geometry;
    const timedEvents = sortCalendarEvents(options.events.filter(event => !belongsInAllDayLane(event) && eventOverlapsDay(event, day)));
    const ranges = new Map<string, ReturnType<typeof getEventMinuteRange>>();
    const layoutItems: ITimedLayoutItem[] = [];
    timedEvents.forEach(event => {
        const key = event.occurrenceID || event.id;
        const raw = getRawMinuteRange(event, day);
        const range = getEventMinuteRange(raw.start, raw.end, geometry);
        ranges.set(key, range);
        layoutItems.push({key, startMinute: range.startMinute, endMinute: range.endMinute});
    });
    const boxes = new Map(packTimedEventColumns(layoutItems).map(box => [box.key, box]));
    const handles = options.editable ?
        {
            start: `<span class="av__calendar-resize-handle av__calendar-resize-handle--start" data-type="${CALENDAR_RESIZE_HANDLE_TYPE}" data-edge="start" aria-hidden="true"></span>`,
            end: `<span class="av__calendar-resize-handle av__calendar-resize-handle--end" data-type="${CALENDAR_RESIZE_HANDLE_TYPE}" data-edge="end" aria-hidden="true"></span>`,
        } :
        {start: "", end: ""};
    return timedEvents.map(event => {
        const key = event.occurrenceID || event.id;
        const range = ranges.get(key);
        const box = boxes.get(key);
        if (!range || !box) {
            return "";
        }
        const continuation = `${range.continuesBefore ? " av__calendar-timed-event--continues-before" : ""}${range.continuesAfter ? " av__calendar-timed-event--continues-after" : ""}`;
        // Pixel-exact: top/height come straight from the minute range, width/left
        // from the overlap packer. Nothing is snapped to a row.
        const style = `top:${range.topPx}px;height:${range.heightPx}px;left:${box.leftPercent}%;width:${box.widthPercent}%`;
        return `<div class="${CALENDAR_TIMED_EVENT_CLASS}${continuation}" data-id="${escapeAttr(event.baseEventID || event.id)}" data-occurrence="${escapeAttr(event.occurrenceID || "")}" data-date="${dayKey(day)}" data-start-minute="${range.startMinute}" data-end-minute="${range.endMinute}" data-column="${box.column}" data-column-count="${box.columnCount}" data-column-span="${box.columnSpan}" style="${style}">${handles.start}${options.renderEventChip(event, day, options.editable, "timed")}${handles.end}</div>`;
    }).join("");
};

const renderDayColumn = (options: ICalendarTimeGridOptions, day: dayjs.Dayjs, index: number) => {
    const heightPx = getDayHeightPx(options.geometry);
    const isToday = day.isSame(dayjs(), "day");
    const classes = [
        CALENDAR_TIME_DAY_CLASS,
        isToday ? "av__calendar-day--today" : "",
        isWeekend(day) ? "av__calendar-time-day--weekend" : "",
    ].filter(Boolean).join(" ");
    // Read-only / query-embed calendars simply never get the create surface, so
    // no gesture bound to it can reach them.
    const createSurface = options.editable ?
        `<div class="av__calendar-time-create" data-type="${CALENDAR_TIME_CREATE_TYPE}" data-date="${dayKey(day)}" data-day-index="${index}" role="button" tabindex="0" aria-label="${escapeAttr(`${options.labels.createEvent} ${options.formatFullDate(day)}`)}" style="height:${heightPx}px"></div>` :
        "";
    return `<div class="${classes}" data-date="${dayKey(day)}" data-day-index="${index}" data-type="calendar-drop-day"${isToday ? ' aria-current="date"' : ""} style="height:${heightPx}px">
            ${createSurface}
            <div class="av__calendar-timed-events">${renderTimedEvents(options, day)}</div>
        </div>`;
};

const renderAllDayRow = (options: ICalendarTimeGridOptions) => {
    const days = options.days;
    const allDayEvents = sortCalendarEvents(options.events.filter(event => belongsInAllDayLane(event) &&
        days.some(day => eventOverlapsDay(event, day))));
    const laneItems: IAllDayLaneItem[] = [];
    const eventByKey = new Map<string, ICalendarNormalizedEvent>();
    allDayEvents.forEach(event => {
        const key = event.occurrenceID || event.id;
        // A Tue-Thu event is ONE bar: find the first and last visible column it
        // touches instead of emitting a chip per day.
        const covered = days
            .map((day, index) => eventOverlapsDay(event, day) ? index : -1)
            .filter(index => index >= 0);
        if (covered.length === 0) {
            return;
        }
        eventByKey.set(key, event);
        laneItems.push({key, startIndex: covered[0], endIndex: covered[covered.length - 1]});
    });
    const {bars, laneCount} = packAllDayLanes(laneItems);
    const visibleLaneLimit = options.expandAllDay ? Math.max(laneCount, 1) : CALENDAR_ALL_DAY_VISIBLE_LANES;
    const visibleLaneCount = Math.max(Math.min(laneCount, visibleLaneLimit), 1);
    const hiddenByDay = days.map((unused, index) => bars.filter(bar => bar.lane >= CALENDAR_ALL_DAY_VISIBLE_LANES && bar.startIndex <= index && bar.startIndex + bar.spanCount > index).length);
    const hasHiddenLanes = !options.expandAllDay && hiddenByDay.some(count => count > 0);
    const renderedLaneCount = visibleLaneCount + (hasHiddenLanes ? 1 : 0);
    const cells = days.map((day, index) =>
        `<div class="av__calendar-allday-cell${day.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}${isWeekend(day) ? " av__calendar-time-day--weekend" : ""}" data-date="${dayKey(day)}" data-day-index="${index}" data-type="calendar-drop-day"${options.editable ? ` role="button" tabindex="0" aria-label="${escapeAttr(`${options.labels.createEvent} ${options.formatFullDate(day)} (${options.labels.allDay})`)}"` : ""} style="grid-column:${index + 1} / span 1;grid-row:1 / -1"></div>`).join("");
    const barHTML = bars.filter(bar => bar.lane < visibleLaneLimit).map(bar => {
        const event = eventByKey.get(bar.key);
        if (!event) {
            return "";
        }
        const barDay = days[bar.startIndex];
        return `<div class="av__calendar-allday-bar" data-id="${escapeAttr(event.baseEventID || event.id)}" data-occurrence="${escapeAttr(event.occurrenceID || "")}" data-date="${dayKey(barDay)}" data-day-index="${bar.startIndex}" data-span-count="${bar.spanCount}" data-lane="${bar.lane}" style="grid-column:${bar.startIndex + 1} / span ${bar.spanCount};grid-row:${bar.lane + 1}">${options.renderEventChip(event, barDay, options.editable, "all-day")}</div>`;
    }).join("");
    const moreHTML = hasHiddenLanes ? hiddenByDay.map((count, index) => count > 0 ?
        `<button class="av__calendar-allday-more" data-type="calendar-more" data-date="${dayKey(days[index])}" style="grid-column:${index + 1};grid-row:${renderedLaneCount}" aria-label="+${count} ${escapeAttr(window.siyuan.languages.calendarEvents || "Events")}">+${count} ${escapeHtml(window.siyuan.languages.more || "more")}</button>` : "").join("") : "";
    return {
        laneCount: renderedLaneCount,
        html: `<div class="av__calendar-allday-row">
        <div class="av__calendar-allday-gutter">${escapeHtml(options.labels.allDay)}</div>
        <div class="av__calendar-allday-lanes" style="grid-template-rows:repeat(${renderedLaneCount}, ${CALENDAR_ALL_DAY_LANE_HEIGHT_PX}px)">${cells}${barHTML}${moreHTML}</div>
    </div>`,
    };
};

const renderHeaderRow = (options: ICalendarTimeGridOptions) => {
    const headers = options.days.map((day, index) => {
        const isToday = day.isSame(dayjs(), "day");
        const classes = [
            "av__calendar-day-header",
            isToday ? "av__calendar-day--today" : "",
            isWeekend(day) ? "av__calendar-time-day--weekend" : "",
        ].filter(Boolean).join(" ");
        return `<div class="${classes}" data-date="${dayKey(day)}" data-day-index="${index}" data-type="calendar-drop-day"${isToday ? ' aria-current="date"' : ""}>
            <button class="av__calendar-day-header-button" data-type="calendar-new" data-date="${dayKey(day)}" aria-label="${escapeAttr(options.formatFullDate(day))}"${options.editable ? "" : " disabled"}><span class="av__calendar-day-header-weekday">${escapeHtml(options.formatWeekday(day))}</span><span class="av__calendar-day-header-number">${day.date()}</span></button>
        </div>`;
    }).join("");
    return `<div class="av__calendar-grid-header">
        <div class="av__calendar-grid-corner"></div>
        ${headers}
    </div>`;
};

const renderGutter = (options: ICalendarTimeGridOptions) => {
    const marks = getHourMarks(options.geometry);
    return `<div class="av__calendar-time-gutter" style="height:${getDayHeightPx(options.geometry)}px">${marks.map(mark =>
        `<div class="av__calendar-time-label" data-minute="${mark.minute}" style="top:${mark.offsetPx}px"><span>${escapeHtml(mark.label)}</span></div>`).join("")}</div>`;
};

/**
 * Render the whole Week/Day grid as one HTML string.
 *
 * The now indicator is deliberately NOT part of this markup: it is mounted (and
 * torn down) by now-indicator.ts so its ticker cannot outlive a re-render.
 */
export const renderCalendarTimeGrid = (options: ICalendarTimeGridOptions) => {
    const geometry = options.geometry;
    const days = options.days;
    const business = getBusinessHoursPercent(geometry);
    const allDay = renderAllDayRow(options);
    const gridStyle = [
        `--calendar-day-count:${days.length}`,
        `--calendar-hour-height:${geometry.hourHeight}px`,
        `--calendar-day-height:${getDayHeightPx(geometry)}px`,
        `--calendar-ruling-height:${minutesToPx(geometry.rulingMinutes, geometry)}px`,
        `--calendar-gutter-width:${geometry.gutterWidth}px`,
        `--calendar-day-min-width:${geometry.dayMinWidth}px`,
        `--calendar-header-height:${CALENDAR_HEADER_HEIGHT_PX}px`,
        `--calendar-allday-lane-count:${allDay.laneCount}`,
        `--calendar-allday-height:${allDay.laneCount * CALENDAR_ALL_DAY_LANE_HEIGHT_PX}px`,
        `--calendar-business-start:${business.startPercent}%`,
        `--calendar-business-end:${business.endPercent}%`,
    ].join(";");
    return `<div class="${CALENDAR_TIME_GRID_CLASS}" data-view-kind="${options.viewKind}" data-day-count="${days.length}" data-first-date="${dayKey(days[0])}" data-last-date="${dayKey(days[days.length - 1])}" data-hour-height="${geometry.hourHeight}" data-snap-minutes="${geometry.snapMinutes}" data-day-start-minute="${geometry.dayStartMinute}" data-day-end-minute="${geometry.dayEndMinute}" style="${gridStyle}">
    ${renderHeaderRow(options)}
    ${allDay.html}
    <div class="av__calendar-grid-body">
        ${renderGutter(options)}
        <div class="av__calendar-time-columns" style="height:${getDayHeightPx(geometry)}px">${days.map((day, index) => renderDayColumn(options, day, index)).join("")}</div>
    </div>
</div>`;
};
