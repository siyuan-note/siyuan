import * as dayjs from "dayjs";
import {Constants} from "../../../../constants";
import {Menu} from "../../../../plugin/Menu";
import {showMessage} from "../../../../dialog/message";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {fetchSyncPost} from "../../../../util/fetch";
import {hasClosestByAttribute, hasClosestByClassName} from "../../../util/hasClosest";
import {focusBlock} from "../../../util/selection";
import {transaction} from "../../../wysiwyg/transaction";
import {avRender, genTabHeaderHTML, updateSearch} from "../render";
import {renderGallery} from "../gallery/render";
import {renderKanban} from "../kanban/render";
import {bindAvSearch} from "../search";
import {beginAVRender, finishAVLocate, getAVLocateParams, isCurrentAVRender, prepareAVLocate} from "../locate";
import {openDatabaseRowByData} from "../openDatabaseRow";
import {getCalendarFieldMapping} from "./mapped-fields";
import {getBlockCell, getCellByFieldID, getEventDocumentID, ICalendarEventDraft, ICalendarNormalizedEvent, ICalendarRange} from "./model";
import {eventOverlapsDay, normalizeCalendarEvents, sortCalendarEvents} from "./normalize";
import {CalendarRecurrenceScope, getDisabledRecurrenceScopes, isRecurringSourceEvent, openEventDialog, openRecurrenceScopeDialog} from "./event-dialog";
import {createCalendarEvent, createCalendarEventAsDocument, createCalendarEventReplacingOccurrence, deleteCalendarEvent, deleteCalendarEventThisAndFuture, deleteCalendarOccurrence, ICalendarCreateOptions, updateCalendarEvent, updateCalendarEventThisAndFuture} from "./transactions";
import {
    CALENDAR_DEFAULT_EVENT_MINUTES,
    formatClockLabel,
    getCalendarTimeGeometry,
    getEventMinuteRange,
    ICalendarTimeGeometry,
    minuteToOffsetPx,
    offsetPxToMinute,
    parseClockMinutes,
    snapMinutes,
} from "./time-geometry";
import {CALENDAR_TIME_CREATE_TYPE, renderCalendarTimeGrid} from "./time-grid";
import {mountCalendarNowIndicator, unmountCalendarNowIndicator} from "./now-indicator";
import {abortActiveCalendarGesture, bindCalendarPointerInteractions, createCalendarGridAdapter, isCalendarGestureActive} from "./interactions";
// The chip markup, the right-click menu, the key map and the mini month are all
// owned by their own modules; this renderer only decides WHEN they appear and
// routes everything they report back through the same write paths a click uses.
import {buildOptimisticChip, renderCalendarEventChip} from "./event-chip";
import {bindCalendarEventContextMenu, closeCalendarEventMenu, ICalendarMenuCommand} from "./context-menu";
import {bindCalendarKeymap, CALENDAR_ARIA_KEYSHORTCUTS} from "./keymap";
import {bindCalendarMiniMonth, getCalendarMiniMonthEventDays, getMiniMonthDays} from "./mini-month";

interface IRenderCalendarOptions {
    protyle: IProtyle;
    blockElement: HTMLElement;
    cb?: (data: IAV) => void;
    renderAll: boolean;
    data?: IAV;
}

const startOfCalendarWeek = (date: dayjs.Dayjs, weekStart = 0) => {
    const offset = (date.day() - weekStart + 7) % 7;
    return date.subtract(offset, "day").startOf("day");
};

const endOfCalendarWeek = (date: dayjs.Dayjs, weekStart = 0) => startOfCalendarWeek(date, weekStart).add(6, "day").endOf("day");

export const getISOCalendarWeekNumber = (date: dayjs.Dayjs) => {
    const target = new Date(Date.UTC(date.year(), date.month(), date.date()));
    const weekday = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - weekday);
    const yearStart = Date.UTC(target.getUTCFullYear(), 0, 1);
    return Math.ceil((((target.getTime() - yearStart) / 86400000) + 1) / 7);
};

const CALENDAR_VIEW_MODES = [0, 1, 2, 3, 4, 5];

const getSafeViewMode = (viewMode?: number) => CALENDAR_VIEW_MODES.includes(viewMode || 0) ? viewMode || 0 : 0;

const getCalendarViewMode = (calendar: IAVCalendar, blockElement: HTMLElement) => {
    const localViewMode = blockElement.dataset.calendarViewMode;
    if (localViewMode && /^[0-5]$/.test(localViewMode)) {
        return parseInt(localViewMode, 10);
    }
    return getSafeViewMode(calendar.viewMode);
};

const getSafeWeekStart = (weekStart?: number) => weekStart === 1 ? 1 : 0;

/** "each entry is a page": new entries become real SiYuan documents. */
export const CALENDAR_NEW_ITEM_TARGET_DOCUMENT = "document";
export const CALENDAR_NEW_ITEM_TARGET_ROW = "row";

/** The persisted target, read through a cast (see getCalendarNewItemTarget). */
const getPersistedNewItemTarget = (calendar: IAVCalendar) =>
    calendar.newItemTarget || "";

/**
 * The view's new-entry target, as sent by the kernel alongside dateFieldID /
 * viewMode / weekStart (kernel/av/layout_calendar.go Calendar.NewItemTarget).
 *
 * The zero value "" is a view that existed before page-per-entry shipped, and it
 * must keep creating detached rows: only views created (or explicitly switched)
 * after the upgrade create documents, so nobody's existing data habits change
 * underneath them.
 *
 * The block-element override is what the config panel writes when the user flips
 * the setting: "setAttrViewCalendarNewItemTarget" is not in the refresh list of
 * app/src/protyle/wysiwyg/transaction.ts (not our file), so without it the very
 * next create would still use the value this render was fetched with. Same
 * mechanism as data-calendar-view-mode; renderCalendar drops it as soon as the
 * kernel confirms the value.
 *
 * Read through a cast because IAVCalendar in app/src/types/index.d.ts does not
 * declare the field yet - that file belongs to another agent in this change.
 */
export const getCalendarNewItemTarget = (calendar: IAVCalendar, blockElement?: HTMLElement) => {
    const localTarget = blockElement?.dataset.calendarNewItemTarget;
    if (localTarget === CALENDAR_NEW_ITEM_TARGET_DOCUMENT || localTarget === CALENDAR_NEW_ITEM_TARGET_ROW) {
        return localTarget;
    }
    return getPersistedNewItemTarget(calendar);
};

export const calendarCreatesDocuments = (calendar: IAVCalendar, blockElement?: HTMLElement) =>
    getCalendarNewItemTarget(calendar, blockElement) === CALENDAR_NEW_ITEM_TARGET_DOCUMENT;

const getVisibleRange = (anchor: dayjs.Dayjs, viewMode: number, weekStart = 0): ICalendarRange => {
    if (viewMode === 1) {
        return {start: startOfCalendarWeek(anchor, weekStart), end: endOfCalendarWeek(anchor, weekStart)};
    }
    if (viewMode === 2) {
        return {start: anchor.startOf("day"), end: anchor.endOf("day")};
    }
    if (viewMode === 3) {
        return {start: anchor.startOf("day"), end: anchor.add(29, "day").endOf("day")};
    }
    if (viewMode === 4) {
        return {start: anchor.startOf("year"), end: anchor.endOf("year")};
    }
    if (viewMode === 5) {
        return {start: anchor.startOf("day"), end: anchor.add(4, "day").endOf("day")};
    }
    return {start: startOfCalendarWeek(anchor.startOf("month"), weekStart), end: endOfCalendarWeek(anchor.endOf("month"), weekStart)};
};

const getAgendaRange = (anchor: dayjs.Dayjs, blockElement: HTMLElement): ICalendarRange => {
    const days = Math.max(parseInt(blockElement.dataset.calendarAgendaDays || "30", 10) || 30, 30);
    return {start: anchor.startOf("day"), end: anchor.add(days - 1, "day").endOf("day")};
};

const getViewModeLabel = (viewMode: number) => {
    const labels: Record<number, string> = {
        0: window.siyuan.languages.month || "Month",
        1: window.siyuan.languages.week || "Week",
        2: window.siyuan.languages.calendarDay || "Day",
        3: window.siyuan.languages.calendarSchedule || "Schedule",
        4: window.siyuan.languages.year || "Year",
        5: window.siyuan.languages.calendarFiveDayView || "5 Days",
    };
    return labels[viewMode] || labels[0];
};

const getCalendarLocale = () => window.siyuan.config.lang;

const formatCalendarDate = (date: dayjs.Dayjs, options: Intl.DateTimeFormatOptions) => {
    return new Intl.DateTimeFormat(getCalendarLocale(), options).format(date.toDate());
};

const getCalendarTitle = (anchor: dayjs.Dayjs, range: ICalendarRange, viewMode: number) => {
    if (viewMode === 1 || viewMode === 3 || viewMode === 5) {
        return `${formatCalendarDate(range.start, {year: "numeric", month: "short", day: "numeric"})} - ${formatCalendarDate(range.end, {year: "numeric", month: "short", day: "numeric"})}`;
    }
    if (viewMode === 2) {
        return formatCalendarDate(anchor, {year: "numeric", month: "short", day: "numeric"});
    }
    if (viewMode === 4) {
        return formatCalendarDate(anchor, {year: "numeric"});
    }
    return formatCalendarDate(anchor, {year: "numeric", month: "long"});
};

const getWeekdayLabels = (weekStart = 0) => {
    const formatter = new Intl.DateTimeFormat(getCalendarLocale(), {weekday: "short"});
    return [0, 1, 2, 3, 4, 5, 6].map(index => formatter.format(new Date(2020, 5, 7 + ((weekStart + index) % 7))));
};


/**
 * There is no slot constant here any more, on purpose.
 *
 * The grid used to be 48 CSS rows of 30 minutes and every time value in this
 * file was rounded onto that ruling, so a 12:45-13:20 event drew at 12:30-13:30.
 * All minute<->pixel arithmetic now lives in ./time-geometry.ts and the only
 * granularity the user ever meets is CALENDAR_SNAP_MINUTES (15), applied to the
 * value being written rather than to the drawing.
 * calendar-time-grid-smoke.mjs asserts that the old constant cannot come back.
 */
const getCalendarSearch = (blockElement: HTMLElement) => (blockElement.dataset.calendarSearch || "").trim();

const getCalendarFilter = (blockElement: HTMLElement) => {
    const filter = blockElement.dataset.calendarFilter || "all";
    return ["all", "timed", "all-day"].includes(filter) ? filter : "all";
};

const eventMatchesSearch = (event: ICalendarNormalizedEvent, query: string) => {
    if (!query) {
        return true;
    }
    const haystack = [
        event.title,
        event.start.format("YYYY-MM-DD"),
        event.start.format("HH:mm"),
        event.end?.format("YYYY-MM-DD"),
        event.end?.format("HH:mm"),
        event.location,
        event.description,
        event.colorContent,
        event.recurrenceRaw,
        event.recurrence?.freq,
    ].filter(Boolean).join("\n").toLowerCase();
    return query.toLowerCase().split(/\s+/).every(term => haystack.includes(term));
};

const eventMatchesCalendarFilter = (event: ICalendarNormalizedEvent, filter: string) => {
    if (filter === "timed") {
        return !event.isAllDay;
    }
    if (filter === "all-day") {
        return event.isAllDay;
    }
    return true;
};

const getCalendarSearchResultRange = (
    calendar: IAVCalendar,
    mapping: ReturnType<typeof getCalendarFieldMapping>,
    fallback: ICalendarRange,
): ICalendarRange => {
    let first: dayjs.Dayjs | undefined;
    let last: dayjs.Dayjs | undefined;
    calendar.cards?.forEach(card => {
        const date = getCellByFieldID(card, mapping.dateFieldID)?.value?.date;
        if (!date?.isNotEmpty || !date.content) {
            return;
        }
        const start = dayjs(date.content);
        if (!start.isValid()) {
            return;
        }
        const rawEnd = date.hasEndDate && date.content2 ? dayjs(date.content2) : start;
        const end = rawEnd.isValid() && !rawEnd.isBefore(start) ? rawEnd : start;
        first = !first || start.isBefore(first) ? start : first;
        last = !last || end.isAfter(last) ? end : last;
    });
    return first && last ? {start: first.startOf("day"), end: last.endOf("day")} : fallback;
};

const getNavDate = (anchor: dayjs.Dayjs, viewMode: number, direction: -1 | 1) => {
    if (viewMode === 0) {
        return anchor.add(direction, "month");
    }
    if (viewMode === 1) {
        return anchor.add(direction, "week");
    }
    if (viewMode === 3) {
        return anchor.add(direction * 30, "day");
    }
    if (viewMode === 4) {
        return anchor.add(direction, "year");
    }
    if (viewMode === 5) {
        return anchor.add(direction * 5, "day");
    }
    return anchor.add(direction, "day");
};

const getEventSeekRange = (anchor: dayjs.Dayjs): ICalendarRange => ({
    start: anchor.subtract(1, "year").startOf("day"),
    end: anchor.add(1, "year").endOf("day"),
});

/**
 * The chip anatomy (tooltip, recurrence marker, source/schedule affordances,
 * colour dot, read-only and draggable attributes) lives in ./event-chip.ts.
 * The inline -15m/+15m, -1d/+1d and Copy buttons it used to carry are gone: they
 * are in the right-click menu (./context-menu.ts) and on the drag edges, so the
 * chip is quiet enough to read at a glance.
 */

/**
 * Open the page behind a bound entry.
 *
 * Goes through upstream's openDatabaseRowByData (../openDatabaseRow.ts:83-151)
 * rather than a bare openFileById so the calendar behaves like every other
 * database surface: an already open tab for that document is reused instead of
 * spawning duplicates, and the database attribute panel is expanded so Date /
 * Location stay editable on the page itself.
 */
const openCalendarEventSource = (protyle: IProtyle, blockElement: HTMLElement, event: ICalendarNormalizedEvent) => {
    const documentID = getEventDocumentID(event);
    if (!documentID) {
        showMessage(window.siyuan.languages.calendarSourceMissing || "Calendar item has no source block");
        return;
    }
    openDatabaseRowByData(protyle, {
        avID: blockElement.getAttribute("data-av-id") || "",
        databaseBlockID: blockElement.getAttribute("data-node-id") || "",
        notebookID: protyle.notebookId,
        // The item id of the row, never the occurrence id: a generated occurrence
        // has no row of its own and shares the base item's document.
        itemID: event.baseEventID || event.id,
        valueID: getBlockCell(event.sourceCard)?.id || "",
        title: event.title,
        boundBlockID: documentID,
        isDetached: false,
    });
};

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");

/**
 * The geometry the currently rendered grid was built from. Reading it back out
 * of the DOM (rather than recomputing a default) keeps every listener and the
 * optimistic preview on exactly the same ruler as the markup.
 */
const getGridGeometry = (root: HTMLElement | null): ICalendarTimeGeometry => {
    const gridElement = root?.querySelector(".av__calendar-time-grid") as HTMLElement;
    return getCalendarTimeGeometry(parseInt(gridElement?.dataset.dayCount || "7", 10) || 7);
};

/**
 * Paint the entry the user just saved before the kernel has answered.
 *
 * Creating a page is much heavier than inserting a detached row (the kernel takes
 * createDocLock and flushes the transaction queue three times), so the quick
 * create popover closes at once and the chip appears immediately. The caller MUST
 * remove the returned node in both the success and the failure path, otherwise a
 * failed create leaves a phantom event on the grid.
 *
 * Returns null when the target day is not on screen (creating from the toolbar
 * while looking at another month, for example); the reconciling rerender is then
 * the only visible feedback, which is correct because there is nothing to paint.
 */
const paintOptimisticEvent = (calendarElement: HTMLElement, draft: ICalendarEventDraft): HTMLElement | null => {
    if (!calendarElement || !isDateKey(draft.date) || !draft.title) {
        return null;
    }
    // Read the geometry off the grid the chip is about to land on, so the
    // preview cannot be positioned with a different hour height than the render.
    const geometry = getGridGeometry(calendarElement);
    const chip = buildOptimisticChip(draft);
    if (!draft.isAllDay) {
        const timedLayer = calendarElement.querySelector(`.av__calendar-time-day[data-date="${draft.date}"] .av__calendar-timed-events`);
        if (timedLayer) {
            // Same geometry as a real chip, so the preview does not jump when the
            // kernel answers and the real render replaces it.
            const range = getEventMinuteRange(parseClockMinutes(draft.startTime), parseClockMinutes(draft.endTime), geometry);
            const wrapper = document.createElement("div");
            wrapper.className = "av__calendar-timed-event";
            wrapper.style.top = `${range.topPx}px`;
            wrapper.style.height = `${range.heightPx}px`;
            wrapper.style.left = "0%";
            wrapper.style.width = "100%";
            wrapper.appendChild(chip);
            timedLayer.appendChild(wrapper);
            return wrapper;
        }
    }
    const allDayCell = calendarElement.querySelector(`.av__calendar-allday-lanes .av__calendar-allday-cell[data-date="${draft.date}"]`);
    if (allDayCell?.parentElement) {
        const wrapper = document.createElement("div");
        wrapper.className = "av__calendar-allday-bar";
        wrapper.style.gridColumn = `${parseInt(allDayCell.getAttribute("data-day-index") || "0", 10) + 1} / span 1`;
        wrapper.appendChild(chip);
        allDayCell.parentElement.appendChild(wrapper);
        return wrapper;
    }
    const dayElement = calendarElement.querySelector(`[data-type="calendar-drop-day"][data-date="${draft.date}"]`);
    const container = dayElement?.querySelector(".av__calendar-all-day, .av__calendar-events, .av__calendar-list-events");
    if (!container) {
        return null;
    }
    container.appendChild(chip);
    return chip;
};

const CALENDAR_VIEW_MENU_ITEMS = [
    {mode: 2, accelerator: "D"},
    {mode: 1, accelerator: "W"},
    {mode: 0, accelerator: "M"},
    {mode: 4, accelerator: "Y"},
    {mode: 3, accelerator: "A"},
    {mode: 5, accelerator: "X"},
];

const renderModeSwitcher = (viewMode: number) => {
    return `<button class="b3-button b3-button--text av__calendar-view-trigger" data-type="calendar-view-menu" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeAttr(getViewModeLabel(viewMode))}">
        <span>${escapeHtml(getViewModeLabel(viewMode))}</span>
        <svg><use xlink:href="#iconDown"></use></svg>
    </button>`;
};

const renderCalendarFilter = (filter: string, panelID: string) => {
    const options = [
        {value: "all", label: window.siyuan.languages.all || "All"},
        {value: "timed", label: window.siyuan.languages.calendarTimed || "Timed"},
        {value: "all-day", label: window.siyuan.languages.allDay || "All day"},
    ];
    return `<div class="av__calendar-search-dropdown fn__none" data-type="calendar-search-dropdown" id="${escapeAttr(panelID)}" role="menu" aria-label="${window.siyuan.languages.filter || "Filter"}">
        ${options.map(item => `<button class="b3-menu__item${filter === item.value ? " b3-menu__item--selected" : ""}" data-type="calendar-filter-option" data-filter="${item.value}" role="menuitemradio" aria-checked="${filter === item.value}">
            <svg class="b3-menu__icon"><use xlink:href="#${filter === item.value ? "iconSelect" : ""}"></use></svg>
            <span class="b3-menu__label">${escapeHtml(item.label)}</span>
        </button>`).join("")}
    </div>`;
};

const renderDateFieldSetup = (calendar: IAVCalendar, editable = true) => {
    const dateFields = calendar.fields.filter(field => field.type === "date");
    if (dateFields.length === 0) {
        return `<div class="av__calendar av__calendar--empty">
    <div class="ft__on-surface">${window.siyuan.languages.calendarNeedDateField || window.siyuan.languages.dateField || "Calendar requires a date field"}</div>
    ${editable ? `<button class="b3-button b3-button--text av__calendar-setup" data-type="calendar-create-date-field">${window.siyuan.languages.calendarCreateDateField || window.siyuan.languages.newCol}</button>` : ""}
</div>`;
    }
    return `<div class="av__calendar av__calendar--empty">
    <label class="ft__on-surface" for="av-calendar-date-field">${window.siyuan.languages.calendarNeedDateField || window.siyuan.languages.dateField || "Calendar requires a date field"}</label>
    <select class="b3-select av__calendar-setup" id="av-calendar-date-field" data-type="calendar-empty-date-field"${editable ? "" : " disabled"}>
        <option value="">${window.siyuan.languages.select || ""}</option>
        ${dateFields.map(field => `<option value="${escapeAttr(field.id)}">${escapeHtml(field.name)}</option>`).join("")}
    </select>
    ${editable ? `<button class="b3-button b3-button--text av__calendar-setup" data-type="calendar-create-date-field">${window.siyuan.languages.calendarCreateDateField || window.siyuan.languages.newCol}</button>` : ""}
</div>`;
};

const MONTH_DAY_EVENT_LIMIT = 3;

const renderMonth = (anchor: dayjs.Dayjs, range: ICalendarRange, events: ICalendarNormalizedEvent[], weekStart = 0, editable = true) => {
    let html = `<div class="av__calendar-weekdays">${getWeekdayLabels(weekStart).map(day => `<div>${escapeHtml(day)}</div>`).join("")}</div><div class="av__calendar-month">`;
    let cursor = range.start;
    while (!cursor.isAfter(range.end, "day")) {
        const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, cursor)));
        const visibleEvents = dayEvents.slice(0, MONTH_DAY_EVENT_LIMIT);
        const hiddenCount = dayEvents.length - visibleEvents.length;
        const moreHTML = hiddenCount > 0 ?
            `<button class="av__calendar-more" data-type="calendar-more" data-date="${cursor.format("YYYY-MM-DD")}" aria-label="${escapeAttr(`+${hiddenCount} ${window.siyuan.languages.calendarEvents || "Events"}`)}">+${hiddenCount}</button>` : "";
        html += `<div class="av__calendar-day${cursor.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}${cursor.isSame(anchor, "day") ? " av__calendar-day--selected" : ""}${cursor.month() !== anchor.month() ? " av__calendar-day--muted" : ""}"${cursor.isSame(dayjs(), "day") ? ' aria-current="date"' : ""} data-date="${cursor.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
    <button class="av__calendar-daynum" data-type="calendar-new" data-date="${cursor.format("YYYY-MM-DD")}"${editable ? "" : " disabled"}>${cursor.date()}</button>
    <div class="av__calendar-events">${visibleEvents.map(event => renderCalendarEventChip({event, variant: "month", displayDate: cursor, editable})).join("")}${moreHTML}</div>
</div>`;
        cursor = cursor.add(1, "day");
    }
    return `${html}</div>`;
};


/**
 * Week and Day are the same grid with a different day list (see ./time-grid.ts).
 * All the geometry, the overlap packing and the sticky chrome live there; this
 * file only supplies the chip markup and the locale-aware labels.
 */
const renderTimeGridView = (days: dayjs.Dayjs[], events: ICalendarNormalizedEvent[], viewKind: "week" | "day" | "five-day", editable = true, expandAllDay = false) =>
    renderCalendarTimeGrid({
        days,
        events,
        editable,
        expandAllDay,
        geometry: getCalendarTimeGeometry(days.length),
        viewKind,
        labels: {
            allDay: window.siyuan.languages.allDay || "All day",
            createEvent: window.siyuan.languages.newEvent || window.siyuan.languages.newRow || "New",
        },
        formatWeekday: (day) => formatCalendarDate(day, {weekday: "short"}),
        formatFullDate: (day) => formatCalendarDate(day, {weekday: "long", year: "numeric", month: "short", day: "numeric"}),
        // The grid decides where a chip sits; the chip decides what it looks
        // like. An all-day entry is a filled bar in the sticky lane, a timed one
        // is a dot + time + title block in the column.
        renderEventChip: (event, day, chipEditable, surface) => renderCalendarEventChip({
            event,
            variant: surface,
            displayDate: day,
            editable: chipEditable,
        }),
    });

const renderWeek = (range: ICalendarRange, events: ICalendarNormalizedEvent[], editable = true, expandAllDay = false) => {
    const days: dayjs.Dayjs[] = [];
    let cursor = range.start.startOf("day");
    while (!cursor.isAfter(range.end, "day")) {
        days.push(cursor);
        cursor = cursor.add(1, "day");
    }
    return `<div class="av__calendar-week">${renderTimeGridView(days, events, "week", editable, expandAllDay)}</div>`;
};

const renderDay = (anchor: dayjs.Dayjs, events: ICalendarNormalizedEvent[], editable = true, expandAllDay = false) =>
    `<div class="av__calendar-week av__calendar-week--single">${renderTimeGridView([anchor.startOf("day")], events, "day", editable, expandAllDay)}</div>`;

const renderFiveDay = (range: ICalendarRange, events: ICalendarNormalizedEvent[], editable = true, expandAllDay = false) => {
    const days = Array.from({length: 5}, (unused, index) => range.start.add(index, "day"));
    return `<div class="av__calendar-week av__calendar-week--five-day">${renderTimeGridView(days, events, "five-day", editable, expandAllDay)}</div>`;
};

const getISOWeekNumber = (date: dayjs.Dayjs) => {
    const value = new Date(Date.UTC(date.year(), date.month(), date.date()));
    const weekday = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() + 4 - weekday);
    const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
    return Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

const getYearWeekdayLabels = (weekStart: number) => {
    let formatter: Intl.DateTimeFormat;
    try {
        formatter = new Intl.DateTimeFormat(getCalendarLocale(), {weekday: "narrow"});
    } catch (error) {
        formatter = new Intl.DateTimeFormat(undefined, {weekday: "narrow"});
    }
    return [0, 1, 2, 3, 4, 5, 6].map(index => formatter.format(new Date(2020, 5, 7 + ((weekStart + index) % 7))));
};

const renderYearMonth = (month: dayjs.Dayjs, anchor: dayjs.Dayjs, eventDays: Set<string>, weekStart: number, editable: boolean) => {
    const days = getMiniMonthDays(month, weekStart);
    const weeks = Array.from({length: 6}, (unused, index) => days.slice(index * 7, index * 7 + 7));
    return `<section class="av__calendar-year-month" data-month="${month.format("YYYY-MM")}">
        <h3>${escapeHtml(formatCalendarDate(month, {month: "long"}))}</h3>
        <div class="av__calendar-year-weekdays" aria-hidden="true"><span></span>${getYearWeekdayLabels(weekStart).map(label => `<span>${escapeHtml(label)}</span>`).join("")}</div>
        <div class="av__calendar-year-weeks">${weeks.map(week => `<div class="av__calendar-year-week">
            <span class="av__calendar-year-week-number" aria-label="${escapeAttr(`${window.siyuan.languages.week || "Week"} ${getISOWeekNumber(week[0])}`)}">${getISOWeekNumber(week[0])}</span>
            ${week.map(day => {
        const date = day.format("YYYY-MM-DD");
        const classes = ["av__calendar-year-day"];
        if (!day.isSame(month, "month")) {
            classes.push("av__calendar-year-day--outside");
        }
        const isOwnMonth = day.isSame(month, "month");
        const isToday = isOwnMonth && day.isSame(dayjs(), "day");
        if (isToday) {
            classes.push("av__calendar-year-day--today");
        }
        if (isOwnMonth && day.isSame(anchor, "day") && !isToday) {
            classes.push("av__calendar-year-day--selected");
        }
        if (eventDays.has(date)) {
            classes.push("av__calendar-year-day--has-events");
        }
        return `<button class="${classes.join(" ")}" data-type="calendar-new" data-date="${date}"${editable ? "" : " disabled"}${isToday ? ' aria-current="date"' : ""} aria-label="${escapeAttr(formatCalendarDate(day, {year: "numeric", month: "long", day: "numeric"}))}"><span>${day.date()}</span>${eventDays.has(date) ? '<i aria-hidden="true"></i>' : ""}</button>`;
    }).join("")}
        </div>`).join("")}</div>
    </section>`;
};

const renderYear = (anchor: dayjs.Dayjs, events: ICalendarNormalizedEvent[], weekStart = 0, editable = true) => {
    const eventDays = getCalendarMiniMonthEventDays(events);
    return `<div class="av__calendar-year">${Array.from({length: 12}, (unused, index) =>
        renderYearMonth(anchor.startOf("year").add(index, "month"), anchor, eventDays, weekStart, editable)).join("")}</div>`;
};

const renderList = (range: ICalendarRange, events: ICalendarNormalizedEvent[], hideEmpty = false, editable = true, progressive = false) => {
    let cursor = range.start.startOf("day");
    let html = '<div class="av__calendar-list">';
    let renderedDays = 0;
    const renderedMultiDay = new Set<string>();
    while (!cursor.isAfter(range.end, "day")) {
        const dayEvents = sortCalendarEvents(events.filter(event => {
            if (!eventOverlapsDay(event, cursor)) {
                return false;
            }
            const isMultiDay = !!event.end && !event.start.isSame(event.end, "day");
            const key = event.occurrenceID || event.id;
            if (isMultiDay && renderedMultiDay.has(key)) {
                return false;
            }
            if (isMultiDay) {
                renderedMultiDay.add(key);
            }
            return true;
        }));
        if (!hideEmpty || dayEvents.length > 0) {
            renderedDays++;
            html += `<div class="av__calendar-list-day${cursor.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}"${cursor.isSame(dayjs(), "day") ? ' aria-current="date"' : ""} data-date="${cursor.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
    <button class="av__calendar-list-title" data-type="calendar-new" data-date="${cursor.format("YYYY-MM-DD")}" aria-label="${escapeAttr(formatCalendarDate(cursor, {weekday: "long", year: "numeric", month: "long", day: "numeric"}))}"${editable ? "" : " disabled"}>${escapeHtml(formatCalendarDate(cursor, {weekday: "short", month: "short", day: "numeric"}))}</button>
    <div class="av__calendar-list-events">${dayEvents.length > 0 ? dayEvents.map(event => renderCalendarEventChip({event, variant: "list", displayDate: cursor, editable})).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
</div>`;
        }
        cursor = cursor.add(1, "day");
    }
    if (renderedDays === 0) {
        html += `<div class="av__calendar-no-results ft__on-surface">${window.siyuan.languages.calendarNoMatchingEvent || window.siyuan.languages.emptyContent}</div>`;
    }
    if (progressive) {
        html += `<button class="b3-button b3-button--text av__calendar-list-more" data-type="calendar-list-more">${escapeHtml(window.siyuan.languages.more || "More")}</button>`;
    }
    return `${html}</div>`;
};

// databaseQuery 是工具栏放大镜（av-search）里的关键字，已由内核过滤过条目；
// 日历自己的搜索框只在返回结果上再做一次本地细化，两者共用同一个清除入口与提示状态。
const getCalendarHTML = (data: IAV, blockElement: HTMLElement, editable = true, databaseQuery = "") => {
    const calendar = data.view as IAVCalendar;
    const viewMode = getCalendarViewMode(calendar, blockElement);
    const weekStart = getSafeWeekStart(calendar.weekStart);
    const mapping = getCalendarFieldMapping(calendar);
    if (!mapping.hasDateField) {
        return renderDateFieldSetup(calendar, editable);
    }
    const anchor = dayjs(blockElement.dataset.calendarDate || undefined);
    const safeAnchor = anchor.isValid() ? anchor : dayjs();
    const visibleRange = viewMode === 3 ? getAgendaRange(safeAnchor, blockElement) : getVisibleRange(safeAnchor, viewMode, weekStart);
    const search = getCalendarSearch(blockElement);
    const hasSearchQuery = !!search || !!databaseQuery.trim();
    const range = hasSearchQuery ? getCalendarSearchResultRange(calendar, mapping, visibleRange) : visibleRange;
    const normalized = normalizeCalendarEvents(calendar, mapping, range);
    const filter = getCalendarFilter(blockElement);
    const filteredEvents = normalized.events.filter(event => eventMatchesCalendarFilter(event, filter));
    const totalEventCount = normalized.events.length;
    const events = filteredEvents.filter(event => eventMatchesSearch(event, search));
    const hasLocalQuery = !!search || filter !== "all";
    const hasActiveQuery = !!search || filter !== "all" || !!databaseQuery;
    const expandAllDay = blockElement.dataset.calendarAllDayExpanded === "true";
    const searchFilterID = `calendar-search-filter-${blockElement.getAttribute("data-node-id") || blockElement.getAttribute("data-av-id") || "view"}`;
    const title = getCalendarTitle(safeAnchor, range, viewMode);
    const weekNumber = getISOCalendarWeekNumber(safeAnchor);
    const weekNumberLabel = (window.siyuan.languages.calendarWeekNumber || "Week ${x}").replace("${x}", String(weekNumber));
    let body = hasSearchQuery ? renderList(range, events, true, editable) : renderMonth(safeAnchor, range, events, weekStart, editable);
    if (!hasSearchQuery && viewMode === 1) {
        body = renderWeek(range, events, editable, expandAllDay);
    } else if (!hasSearchQuery && viewMode === 2) {
        body = renderDay(safeAnchor, events, editable, expandAllDay);
    } else if (!hasSearchQuery && viewMode === 3) {
        body = renderList(range, events, true, editable, true);
    } else if (!hasSearchQuery && viewMode === 4) {
        body = renderYear(safeAnchor, events, weekStart, editable);
    } else if (!hasSearchQuery && viewMode === 5) {
        body = renderFiveDay(range, events, editable, expandAllDay);
    }

    blockElement.dataset.baseEvents = JSON.stringify(Array.from(normalized.baseEventsByID.keys()));
    return `<div class="av__calendar" data-view-mode="${viewMode}" tabindex="0" role="region" aria-label="${escapeAttr(`${window.siyuan.languages.calendar || "Calendar"} ${title}`)}" aria-keyshortcuts="${CALENDAR_ARIA_KEYSHORTCUTS}">
    <div class="av__calendar-toolbar">
        <button class="block__icon block__icon--show" data-type="calendar-prev" aria-keyshortcuts="ArrowLeft"><svg><use xlink:href="#iconLeft"></use></svg></button>
        <button class="b3-button b3-button--text" data-type="calendar-today" aria-keyshortcuts="T">${window.siyuan.languages.today || "Today"}</button>
        <button class="block__icon block__icon--show" data-type="calendar-next" aria-keyshortcuts="ArrowRight"><svg><use xlink:href="#iconRight"></use></svg></button>
        <div class="av__calendar-title-control">
            <span class="av__calendar-title" aria-live="polite">${escapeHtml(title)}</span>
            <span class="av__calendar-week-number">${escapeHtml(weekNumberLabel)}</span>
        </div>
        <div class="av__calendar-search-control" data-type="calendar-search-control">
            <input class="b3-text-field av__calendar-search" data-type="calendar-search" role="combobox" aria-autocomplete="none" aria-controls="${escapeAttr(searchFilterID)}" aria-expanded="false" aria-keyshortcuts="/" placeholder="${window.siyuan.languages.calendarSearch || window.siyuan.languages.search || "Search"}" value="${escapeAttr(search)}">
            <button class="block__icon av__calendar-search-toggle" data-type="calendar-filter-toggle" aria-label="${window.siyuan.languages.filter || "Filter"}" aria-controls="${escapeAttr(searchFilterID)}" aria-expanded="false"><svg><use xlink:href="#iconDown"></use></svg></button>
            ${renderCalendarFilter(filter, searchFilterID)}
        </div>
        ${hasLocalQuery ? `<span class="av__calendar-search-count">${events.length}/${totalEventCount}</span>` : ""}${hasActiveQuery ? `<button class="block__icon block__icon--show" data-type="calendar-clear-search" aria-label="${window.siyuan.languages.clear || "Clear"}" aria-keyshortcuts="Escape"><svg><use xlink:href="#iconClose"></use></svg></button>` : ""}
        ${renderModeSwitcher(viewMode)}
        ${editable ? `<button class="fn__none" data-type="calendar-new" aria-keyshortcuts="N" data-date="${safeAnchor.format("YYYY-MM-DD")}">${window.siyuan.languages.newEvent || window.siyuan.languages.newRow}</button>` : ""}

    </div>
    <div class="av__calendar-body">
        <!-- The mini month is bound, not rendered here: mini-month.ts paints
             itself into this wrapper on the first bind and keeps its own paging
             cursor, so paging it never moves the main view. -->
        <aside class="av__calendar-sidebar" data-type="calendar-mini-month-wrapper"></aside>
        <div class="av__calendar-main">${body}</div>
    </div>
</div>`;
};

/**
 * Listeners that do NOT die with the markup they were bound to.
 *
 * A re-render replaces the calendar's innerHTML, so a listener on a chip or on
 * the calendar root goes away with it. The key map, the context menu and the
 * mini month also reach OUTSIDE that subtree (document-level pointer/keydown
 * listeners, a popover parented to <body>), so each of them hands back an
 * unbind that has to be called by the render that replaces them - otherwise
 * every re-render stacks another live listener on top of the last.
 */
const calendarTeardowns = new WeakMap<HTMLElement, Array<() => void>>();

const addCalendarTeardown = (blockElement: HTMLElement, teardown: () => void) => {
    const teardowns = calendarTeardowns.get(blockElement) || [];
    teardowns.push(teardown);
    calendarTeardowns.set(blockElement, teardowns);
};

const runCalendarTeardowns = (blockElement: HTMLElement) => {
    const teardowns = calendarTeardowns.get(blockElement);
    calendarTeardowns.delete(blockElement);
    teardowns?.forEach(teardown => {
        try {
            teardown();
        } catch (error) {
            console.error("calendar teardown failed", error);
        }
    });
};

const bindCalendarEvents = (options: IRenderCalendarOptions, data: IAV) => {
    // Before anything is bound: everything the PREVIOUS render left alive.
    runCalendarTeardowns(options.blockElement);
    const calendarElement = options.blockElement.querySelector(".av__calendar") as HTMLElement;
    const calendar = data.view as IAVCalendar;
    const viewMode = getCalendarViewMode(calendar, options.blockElement);
    const weekStart = getSafeWeekStart(calendar.weekStart);
    const editable = !options.protyle.disabled && !hasClosestByAttribute(options.blockElement, "data-type", "NodeBlockQueryEmbed");
    // "Each entry is a page" is a per-view setting; every creation site in this
    // renderer (time slot, day cell, toolbar button, dialog) branches on this one
    // value so they can never diverge.
    const createsDocuments = calendarCreatesDocuments(calendar, options.blockElement);
    // The grid the listeners below measure against. It must be the same record
    // the markup was built from, otherwise a click would resolve to a different
    // minute than the one the user pointed at.
    const gridElement = calendarElement?.querySelector(".av__calendar-time-grid") as HTMLElement;
    const gridGeometry = getGridGeometry(calendarElement);
    const rerender = (focusSearch = false, useCurrentData = false) => {
        options.blockElement.removeAttribute("data-render");
        renderCalendar({...options, data: useCurrentData ? data : undefined}).then(() => {
            if (!focusSearch) {
                return;
            }
            const searchInput = options.blockElement.querySelector('[data-type="calendar-search"]') as HTMLInputElement;
            searchInput?.focus();
            searchInput?.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }).catch((error) => {
            // 重绘抛错时 data-render 已被摘掉：不恢复标记的话日历会永久停在陈旧画面，
            // 而且用户看不到任何提示（这正是渲染类缺陷难以察觉的原因）。
            options.blockElement.setAttribute("data-render", "true");
            showMessage(window.siyuan.languages._kernel[258]);
            console.error("calendar rerender failed", error);
        });
    };
    const setCalendarAnchor = (date: dayjs.Dayjs) => {
        options.blockElement.dataset.calendarDate = date.format("YYYY-MM-DD");
        rerender();
    };
    const getCurrentAnchor = () => {
        const anchor = dayjs(options.blockElement.dataset.calendarDate || undefined);
        return anchor.isValid() ? anchor : dayjs();
    };
    const seekEvent = (direction: -1 | 1) => {
        const mapping = getCalendarFieldMapping(calendar);
        if (!mapping.hasDateField) {
            return;
        }
        const anchor = getCurrentAnchor();
        const search = getCalendarSearch(options.blockElement);
        const filter = getCalendarFilter(options.blockElement);
        const events = normalizeCalendarEvents(calendar, mapping, getEventSeekRange(anchor)).events
            .filter(event => eventMatchesCalendarFilter(event, filter))
            .filter(event => eventMatchesSearch(event, search))
            .filter(event => direction > 0 ? event.start.isAfter(anchor, "day") : event.start.isBefore(anchor, "day"));
        const target = direction > 0 ? sortCalendarEvents(events)[0] : sortCalendarEvents(events).reverse()[0];
        if (target) {
            setCalendarAnchor(target.start);
        } else {
            showMessage(window.siyuan.languages.calendarNoMatchingEvent || window.siyuan.languages.emptyContent || "No matching event");
        }
    };
    const withCalendarOperationFeedback = async (operationElement: HTMLElement | null, operationLabel: string, failureMessage: string, callback: () => Promise<boolean>) => {
        if (operationElement?.dataset.calendarOperation === "pending") {
            return false;
        }
        if (operationElement) {
            operationElement.dataset.calendarOperation = "pending";
            operationElement.setAttribute("aria-busy", "true");
            operationElement.classList.add("av__calendar-event--pending");
        }
        try {
            const saved = await callback();
            if (!saved) {
                showMessage(`${failureMessage || window.siyuan.languages._kernel[258]} ${window.siyuan.languages.calendarEventRestored || "Event restored."}`);
                rerender();
                return false;
            }
            return true;
        } catch (error) {
            showMessage(`${failureMessage} ${window.siyuan.languages.calendarEventRestored || "Event restored."}`);
            rerender();
            return false;
        } finally {
            if (operationElement) {
                delete operationElement.dataset.calendarOperation;
                operationElement.removeAttribute("aria-busy");
                operationElement.classList.remove("av__calendar-event--pending");
            }
        }
    };
    // Every dialog entry point in this renderer goes through here, so the
    // "new entries are pages" decision cannot be forgotten at one of them.
    const openCalendarEventDialog = (dialogOptions: {
        date: string;
        event?: ICalendarNormalizedEvent;
        seriesEvent?: ICalendarNormalizedEvent;
        draft?: Partial<ICalendarEventDraft>;
        readOnly?: boolean;
        onSave?: () => void;
        onDelete?: () => void;
    }) => {
        openEventDialog({
            protyle: options.protyle,
            blockElement: options.blockElement,
            data,
            createAsDocument: createsDocuments,
            templateID: data.defaultTemplateID || "",
            ...dialogOptions,
        });
    };
    const openFullCalendarCreate = (draft: ICalendarEventDraft) => {
        openCalendarEventDialog({
            date: draft.date,
            draft,
            onSave: rerender,
        });
    };
    const setCalendarViewMode = (mode: number) => {
        const persistedMode = getSafeViewMode(calendar.viewMode);
        const hasLocalOverride = !!options.blockElement.dataset.calendarViewMode;
        if (!CALENDAR_VIEW_MODES.includes(mode) || (mode === persistedMode && !hasLocalOverride && mode === viewMode)) {
            return;
        }
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!editable || !avID || !blockID) {
            options.blockElement.dataset.calendarViewMode = String(mode);
            rerender(false, true);
            return;
        }
        if (mode === persistedMode) {
            // Leaving a local peek for the persisted mode must not touch av.json.
            delete options.blockElement.dataset.calendarViewMode;
            calendar.viewMode = mode;
            rerender();
            return;
        }
        transaction(options.protyle, [{
            action: "setAttrViewCalendarViewMode",
            avID,
            blockID,
            data: mode,
            viewID: data.viewID,
        }], [{
            action: "setAttrViewCalendarViewMode",
            avID,
            blockID,
            data: persistedMode,
            viewID: data.viewID,
        }]);
        delete options.blockElement.dataset.calendarViewMode;
        calendar.viewMode = mode;
        rerender();
    };

    calendarElement?.querySelector('[data-type="calendar-prev"]')?.addEventListener("click", () => {
        setCalendarAnchor(getNavDate(getCurrentAnchor(), viewMode, -1));
    });
    calendarElement?.querySelector('[data-type="calendar-next"]')?.addEventListener("click", () => {
        setCalendarAnchor(getNavDate(getCurrentAnchor(), viewMode, 1));
    });
    calendarElement?.querySelector('[data-type="calendar-prev-event"]')?.addEventListener("click", () => seekEvent(-1));
    calendarElement?.querySelector('[data-type="calendar-next-event"]')?.addEventListener("click", () => seekEvent(1));
    calendarElement?.querySelector('[data-type="calendar-today"]')?.addEventListener("click", () => {
        setCalendarAnchor(dayjs());
    });

    const startAllDayCreate = (surface: HTMLElement) => {
        if (!editable) {
            return;
        }
        const date = surface.dataset.date || dayjs().format("YYYY-MM-DD");
        openFullCalendarCreate({
            title: "",
            date,
            endDate: date,
            isAllDay: true,
            startTime: "09:00",
            endTime: "09:30",
        });
    };

    calendarElement?.querySelectorAll('[data-type="calendar-drop-day"]').forEach(item => {
        item.addEventListener("click", (event: MouseEvent) => {
            if ((event.target as HTMLElement).closest(`.av__calendar-event, .av__calendar-quick-create, [data-type="${CALENDAR_TIME_CREATE_TYPE}"], button, input, select`)) {
                return;
            }
            const date = (item as HTMLElement).dataset.date;
            if (!date) {
                return;
            }
            if ((item as HTMLElement).classList.contains("av__calendar-allday-cell")) {
                event.preventDefault();
                event.stopPropagation();
                startAllDayCreate(item as HTMLElement);
                return;
            }
            if (viewMode === 0 && (item as HTMLElement).classList.contains("av__calendar-day")) {
                (item as HTMLElement).querySelector<HTMLElement>('[data-type="calendar-new"]')?.click();
                return;
            }
            if (options.blockElement.dataset.calendarDate === date) {
                return;
            }
            if ((item as HTMLElement).classList.contains("av__calendar-day--muted")) {
                // Adjacent-month cells navigate, so the visible month always
                // matches the stored anchor.
                setCalendarAnchor(dayjs(date));
                return;
            }
            // Select without re-rendering so the current view stays put; the
            // anchor is picked up by view switches and prev/next navigation.
            options.blockElement.dataset.calendarDate = date;

            calendarElement.querySelectorAll(".av__calendar-day--selected").forEach(selectedElement => selectedElement.classList.remove("av__calendar-day--selected"));
            (item as HTMLElement).classList.add("av__calendar-day--selected");
        });
        if ((item as HTMLElement).classList.contains("av__calendar-allday-cell")) {
            item.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                startAllDayCreate(item as HTMLElement);
            });
        }
    });
    calendarElement?.querySelectorAll('[data-type="calendar-more"]').forEach(item => {
        item.addEventListener("click", (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const date = (item as HTMLElement).dataset.date;
            if (!date) {
                return;
            }
            if ((item as HTMLElement).classList.contains("av__calendar-allday-more")) {
                options.blockElement.dataset.calendarAllDayExpanded = "true";
                rerender(false, true);
                return;
            }
            // Peek at the day locally without persisting the saved view mode.
            options.blockElement.dataset.calendarDate = date;
            options.blockElement.dataset.calendarViewMode = "2";
            rerender(false, true);
        });
    });
    calendarElement?.querySelector('[data-type="calendar-list-more"]')?.addEventListener("click", () => {
        const currentDays = Math.max(parseInt(options.blockElement.dataset.calendarAgendaDays || "30", 10) || 30, 30);
        options.blockElement.dataset.calendarAgendaDays = String(currentDays + 30);
        rerender(false, true);
    });
    // Creating in the timed grid: one create surface per day column instead of
    // 48 slot buttons. The minute comes from where the pointer actually is,
    // snapped to CALENDAR_SNAP_MINUTES, so a click at 12:47 creates 12:45 - not
    // "the half hour this click landed in".
    const startTimedQuickCreate = (surface: HTMLElement, startMinute: number) => {
        const date = surface.dataset.date || dayjs().format("YYYY-MM-DD");
        const start = snapMinutes(startMinute, gridGeometry);
        const end = Math.min(start + CALENDAR_DEFAULT_EVENT_MINUTES, gridGeometry.dayEndMinute);
        const draft: ICalendarEventDraft = {
            title: "",
            date,
            endDate: date,
            isAllDay: false,
            startTime: formatClockLabel(start),
            endTime: formatClockLabel(end),
        };
        openFullCalendarCreate(draft);
    };
    calendarElement?.querySelectorAll(`[data-type="${CALENDAR_TIME_CREATE_TYPE}"]`).forEach(item => {
        const surface = item as HTMLElement;
        surface.addEventListener("click", (event: MouseEvent) => {
            if (!editable) {
                return;
            }
            const rect = surface.getBoundingClientRect();
            // A keyboard "click" has no coordinates; land on the working morning.
            const pointerMinute = rect.height > 0 && (event.clientY || 0) > 0 ?
                offsetPxToMinute(event.clientY - rect.top, gridGeometry) :
                9 * 60;
            startTimedQuickCreate(surface, pointerMinute);
        });
        surface.addEventListener("keydown", (event: KeyboardEvent) => {
            if (!editable || (event.key !== "Enter" && event.key !== " ")) {
                return;
            }
            event.preventDefault();
            startTimedQuickCreate(surface, 9 * 60);
        });
    });
    // Call site reserved for the pointer gesture module (sweep-to-create,
    // drag-to-move, edge resize). It binds to the contract this renderer emits:
    // [data-type="calendar-time-create"] for empty space, .av__calendar-timed-event
    // (data-start-minute / data-end-minute) for chips and
    // [data-type="calendar-resize-handle"][data-edge] for the edges. Every write
    // it performs must go through applyScopedEventDraft below, never straight to
    // a transaction, and it must no-op when `editable` is false.
    calendarElement?.querySelectorAll('[data-type="calendar-new"]').forEach(item => {
        item.addEventListener("click", () => {
            if (!editable) {
                return;
            }
            const newElement = item as HTMLElement;
            const date = newElement.dataset.date || dayjs().format("YYYY-MM-DD");
            const draft: ICalendarEventDraft = {
                title: "",
                date,
                endDate: date,
                isAllDay: true,
                startTime: "09:00",
                endTime: "09:30",
            };
            openFullCalendarCreate(draft);
        });
    });
    calendarElement?.querySelectorAll('[data-type="calendar-drop-day"]').forEach(item => {
        item.addEventListener("dblclick", (event: MouseEvent) => {
            if (!editable || (event.target as HTMLElement).closest(".av__calendar-event, [data-type='calendar-new'], [data-type='calendar-time-create']")) {
                return;
            }
            openCalendarEventDialog({date: (item as HTMLElement).dataset.date || dayjs().format("YYYY-MM-DD"), onSave: rerender});
        });
    });
    const searchInput = calendarElement?.querySelector('[data-type="calendar-search"]') as HTMLInputElement;
    const searchControl = calendarElement?.querySelector('[data-type="calendar-search-control"]') as HTMLElement;
    const searchDropdown = searchControl?.querySelector('[data-type="calendar-search-dropdown"]') as HTMLElement;
    const filterToggle = searchControl?.querySelector('[data-type="calendar-filter-toggle"]') as HTMLElement;
    const setSearchDropdownOpen = (open: boolean) => {
        if (!searchDropdown) {
            return;
        }
        searchDropdown.classList.toggle("fn__none", !open);
        searchInput?.setAttribute("aria-expanded", String(open));
        filterToggle?.setAttribute("aria-expanded", String(open));
        if (open) {
            options.blockElement.dataset.calendarSearchDropdown = "true";
        } else {
            delete options.blockElement.dataset.calendarSearchDropdown;
        }
    };
    const openSearchDropdown = () => setSearchDropdownOpen(true);
    if (options.blockElement.dataset.calendarSearchDropdown === "true") {
        setSearchDropdownOpen(true);
    }
    searchInput?.addEventListener("click", openSearchDropdown);
    searchInput?.addEventListener("focus", openSearchDropdown);
    searchInput?.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || options.blockElement.dataset.calendarSearchDropdown !== "true") {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        setSearchDropdownOpen(false);
    });
    filterToggle?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setSearchDropdownOpen(searchDropdown?.classList.contains("fn__none") !== false);
    });
    searchControl?.querySelectorAll('[data-type="calendar-filter-option"]').forEach(item => {
        item.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const filter = (item as HTMLElement).dataset.filter || "all";
            if (filter === "all") {
                delete options.blockElement.dataset.calendarFilter;
            } else {
                options.blockElement.dataset.calendarFilter = filter;
            }
            setSearchDropdownOpen(false);
            // A programmatic or assistive click can leave the search input focused.
            // Blur it before rerendering so focus restoration cannot reopen the menu.
            searchInput?.blur();
            rerender(false, true);
        });
    });
    const closeSearchDropdownFromOutside = (event: PointerEvent) => {
        if (!searchControl?.contains(event.target as Node)) {
            setSearchDropdownOpen(false);
        }
    };
    document.addEventListener("pointerdown", closeSearchDropdownFromOutside);
    addCalendarTeardown(options.blockElement, () => document.removeEventListener("pointerdown", closeSearchDropdownFromOutside));
    let calendarSearchTimeout: number;
    searchInput?.addEventListener("input", () => {
        options.blockElement.dataset.calendarSearch = searchInput.value.trim();
        window.clearTimeout(calendarSearchTimeout);
        calendarSearchTimeout = window.setTimeout(() => rerender(true), Constants.TIMEOUT_INPUT);
    });
    addCalendarTeardown(options.blockElement, () => window.clearTimeout(calendarSearchTimeout));

    // 工具栏放大镜的关键字由内核过滤，清除时必须一并清掉并重新取数，
    // 否则用户点了“清除”仍看不到被内核过滤掉的条目。
    const clearDatabaseQuery = () => {
        const headerSearchElement = options.blockElement.querySelector('[data-type="av-search"]') as HTMLElement;
        if (!headerSearchElement?.textContent) {
            return false;
        }
        headerSearchElement.textContent = "";
        options.blockElement.querySelector(".av__views")?.classList.remove("av__views--show");
        return true;
    };

    calendarElement?.querySelector('[data-type="calendar-clear-search"]')?.addEventListener("click", () => {
        clearDatabaseQuery();
        delete options.blockElement.dataset.calendarSearch;
        delete options.blockElement.dataset.calendarFilter;
        // The current render may contain only the cards returned by the kernel
        // query. Fetch again so clearing restores the complete calendar.
        rerender(true);
    });
    /**
     * Back out, in the order a user expects: an in-flight drag/sweep first (it
     * is the most recent thing they started), then the search/filter. Returns
     * false when there was nothing to back out, so Escape keeps reaching the
     * app's own handling instead of being silently swallowed.
     */
    const backOutOfCalendar = () => {
        closeCalendarEventMenu();
        if (isCalendarGestureActive()) {
            abortActiveCalendarGesture();
            return true;
        }
        if (options.blockElement.dataset.calendarSearchDropdown === "true") {
            setSearchDropdownOpen(false);
            searchInput?.focus();
            return true;
        }
        const hasQuery = !!getCalendarSearch(options.blockElement) ||
            getCalendarFilter(options.blockElement) !== "all" ||
            !!(options.blockElement.querySelector('[data-type="av-search"]') as HTMLElement)?.textContent;
        if (!hasQuery) {
            return false;
        }
        clearDatabaseQuery();
        delete options.blockElement.dataset.calendarSearch;
        delete options.blockElement.dataset.calendarFilter;
        rerender();
        return true;
    };
    // The whole key map - the legacy 1-4 / arrows / [ ] / T / N / "/" / Escape
    // set plus Google Calendar's d w m x a j k p c ? - lives in keymap.ts. The
    // focus-scope bug this replaces: the old block bailed on BUTTON, and every
    // interactive element in the calendar is a button, so the shortcuts died the
    // moment anything was clicked. The unbind is registered so a re-render can
    // never stack a second listener on the same calendar.
    addCalendarTeardown(options.blockElement, bindCalendarKeymap(calendarElement, {
        setViewMode: (mode: number) => setCalendarViewMode(mode),
        goToRange: (direction) => setCalendarAnchor(getNavDate(getCurrentAnchor(), viewMode, direction)),
        goToToday: () => setCalendarAnchor(dayjs()),
        // The one shared create entry point: the same toolbar button a click
        // uses, so the keyboard can never diverge from the pointer (and it is
        // simply absent on a read-only calendar).
        createEvent: () => {
            if (!(editable && mapping.hasDateField)) {
                return;
            }
            (calendarElement.querySelector('[data-type="calendar-new"]:not(.av__calendar-daynum)') as HTMLElement)?.click();
        },
        focusSearch: () => (calendarElement.querySelector('[data-type="calendar-search"]') as HTMLInputElement)?.focus(),
        seekEvent: (direction) => seekEvent(direction),
        escape: backOutOfCalendar,
    }));

    const emptyDateFieldElement = calendarElement?.querySelector('[data-type="calendar-empty-date-field"]') as HTMLSelectElement;
    emptyDateFieldElement?.addEventListener("change", () => {
        if (!editable) {
            emptyDateFieldElement.value = "";
            return;
        }
        const current = emptyDateFieldElement.value;
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!current || !avID || !blockID) {
            return;
        }
        transaction(options.protyle, [{
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            data: current,
            viewID: data.viewID,
        }], [{
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            data: calendar.dateFieldID || "",
            viewID: data.viewID,
        }]);
        calendar.dateFieldID = current;
        rerender();
    });
    calendarElement?.querySelector('[data-type="calendar-create-date-field"]')?.addEventListener("click", () => {
        if (!editable) {
            return;
        }
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!avID || !blockID) {
            return;
        }
        const keyID = Lute.NewNodeID();
        const keyName = window.siyuan.languages.date || window.siyuan.languages.dateField || "Date";
        transaction(options.protyle, [{
            action: "addAttrViewCol",
            avID,
            id: keyID,
            name: keyName,
            type: "date",
        }, {
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            keyID,
            data: keyID,
            viewID: data.viewID,
        }], [{
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            keyID: calendar.dateFieldID || "",
            data: calendar.dateFieldID || "",
            viewID: data.viewID,
        }, {
            action: "removeAttrViewCol",
            avID,
            id: keyID,
        }]);
        rerender();
    });
    const viewMenuTrigger = calendarElement?.querySelector('[data-type="calendar-view-menu"]') as HTMLElement;
    viewMenuTrigger?.addEventListener("click", (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        window.siyuan.menus.menu.remove();
        const menu = new Menu("calendar-view-menu", () => viewMenuTrigger.setAttribute("aria-expanded", "false"));
        CALENDAR_VIEW_MENU_ITEMS.forEach(item => {
            menu.addItem({
                id: `calendar-view-${item.mode}`,
                icon: "",
                label: getViewModeLabel(item.mode),
                accelerator: item.accelerator,
                current: item.mode === viewMode,
                click: () => setCalendarViewMode(item.mode),
            });
        });
        const rect = viewMenuTrigger.getBoundingClientRect();
        viewMenuTrigger.setAttribute("aria-expanded", "true");
        menu.open({x: rect.left, y: rect.bottom});
    });
    const anchor = dayjs(options.blockElement.dataset.calendarDate || undefined);
    const range = getVisibleRange(anchor.isValid() ? anchor : dayjs(), viewMode, weekStart);
    const mapping = getCalendarFieldMapping(calendar);
    const normalizedForEvents = normalizeCalendarEvents(calendar, mapping, range);
    const baseEvents = normalizedForEvents.baseEventsByID;
    const renderedEvents = new Map<string, ICalendarNormalizedEvent>();
    normalizedForEvents.events.forEach(event => {
        renderedEvents.set(event.occurrenceID || event.id, event);
    });
    /**
     * The mini month beside the main view.
     *
     * Its dots are computed over the whole anchor MONTH, not over the visible
     * range: in Week or Day view the visible range is a handful of days, and a
     * navigator that only dots the week you are already looking at is useless for
     * the thing it exists for - seeing where the busy days are before you go
     * there. Paging the navigator repaints only itself; the main view moves only
     * when a day is clicked.
     */
    const miniMonthAnchor = getCurrentAnchor();
    const miniMonthRange = getVisibleRange(miniMonthAnchor, 0, weekStart);
    const miniMonthEvents = viewMode === 0 ?
        normalizedForEvents.events :
        normalizeCalendarEvents(calendar, mapping, miniMonthRange).events;
    addCalendarTeardown(options.blockElement, bindCalendarMiniMonth(
        calendarElement?.querySelector('[data-type="calendar-mini-month-wrapper"]') as HTMLElement,
        {
            anchor: miniMonthAnchor,
            range,
            weekStart,
            locale: getCalendarLocale(),
        },
        {onSelectDate: (date) => setCalendarAnchor(date)},
    ));
    const getEditableEvent = (sourceEvent: ICalendarNormalizedEvent) => {
        if (!sourceEvent.isOccurrence || mapping.exceptionFieldID) {
            return sourceEvent;
        }
        return baseEvents.get(sourceEvent.baseEventID || sourceEvent.id) || sourceEvent;
    };
    const updateEventWithDraft = (sourceEvent: ICalendarNormalizedEvent, draft: ICalendarEventDraft, operationElement: HTMLElement | null, operationLabel: string, failureMessage: string, scope: CalendarRecurrenceScope = "series") => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!avID || !blockID || !mapping.dateFieldID) {
            showMessage(`${failureMessage} ${window.siyuan.languages.calendarEventRestored || "Event restored."}`);
            rerender();
            return;
        }
        const transactionOptions = {
            protyle: options.protyle,
            avID,
            blockID,
            dateFieldID: mapping.dateFieldID,
            fields: calendar.fields,
            mapping,
            event: sourceEvent,
            draft,
            viewID: data.viewID,
            previousUpdated: options.blockElement.getAttribute("updated") || "",
        };
        withCalendarOperationFeedback(operationElement, operationLabel, failureMessage, async () => {
            const pageOptions = createsDocuments ? {
                createAsDocument: true,
                templateID: data.defaultTemplateID || "",
            } : {};
            const saved = await (scope === "occurrence" ? createCalendarEventReplacingOccurrence({
                ...transactionOptions,
                ...pageOptions,
                occurrenceDate: sourceEvent.start.format("YYYY-MM-DD"),
            }) : scope === "future" ? updateCalendarEventThisAndFuture({
                ...transactionOptions,
                ...pageOptions,
                occurrenceDate: sourceEvent.start.format("YYYY-MM-DD"),
            }) : updateCalendarEvent(transactionOptions));
            if (saved) {
                rerender();
            }
            return saved;
        });
    };
    // Direct manipulation (drag move, resize, schedule drop) of a recurring item
    // must ask the user for scope, exactly like dialog edits do (P0.6).
    const applyScopedEventDraft = (sourceEvent: ICalendarNormalizedEvent, buildDraft: (target: ICalendarNormalizedEvent) => ICalendarEventDraft, operationElement: HTMLElement | null, operationLabel: string, failureMessage: string, action: "move" | "resize") => {
        if (!sourceEvent.isOccurrence && !isRecurringSourceEvent(sourceEvent)) {
            updateEventWithDraft(sourceEvent, buildDraft(sourceEvent), operationElement, operationLabel, failureMessage);
            return;
        }
        openRecurrenceScopeDialog({
            action,
            disabledScopes: getDisabledRecurrenceScopes(mapping, "edit", sourceEvent),
            onSelect: (scope) => {
                if (scope === "series") {
                    const baseEvent = baseEvents.get(sourceEvent.baseEventID || sourceEvent.id) || sourceEvent;
                    updateEventWithDraft(baseEvent, buildDraft(baseEvent), operationElement, operationLabel, failureMessage, "series");
                    return;
                }
                updateEventWithDraft(sourceEvent, buildDraft(sourceEvent), operationElement, operationLabel, failureMessage, scope);
            },
        });
    };
    const buildDraftForDate = (sourceEvent: ICalendarNormalizedEvent, targetDate: string): ICalendarEventDraft => {
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
    const duplicateEventToNextDay = (sourceEvent: ICalendarNormalizedEvent, operationElement: HTMLElement | null) => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!avID || !blockID || !mapping.dateFieldID) {
            showMessage(window.siyuan.languages.calendarCreateFailed || "Create failed.");
            return;
        }
        const draft = buildDraftForDate(sourceEvent, sourceEvent.start.add(1, "day").format("YYYY-MM-DD"));
        draft.recurrenceRaw = "";
        draft.recurrenceExceptionRaw = "";
        withCalendarOperationFeedback(operationElement, window.siyuan.languages.saved || "Saved", window.siyuan.languages.calendarCreateFailed || "Create failed.", async () => {
            const createOptions: ICalendarCreateOptions = {
                protyle: options.protyle,
                avID,
                blockID,
                viewID: data.viewID,
                dateFieldID: mapping.dateFieldID,
                fields: calendar.fields,
                mapping,
                draft,
                previousUpdated: options.blockElement.getAttribute("updated") || "",
            };
            const saved = createsDocuments ?
                Boolean(await createCalendarEventAsDocument({...createOptions, templateID: data.defaultTemplateID || ""})) :
                await createCalendarEvent(createOptions);
            if (saved) {
                rerender();
            }
            return saved;
        });
    };
    /**
     * Change how LONG an entry lasts by moving its end: whole days for an all-day
     * entry, minutes for a timed one. This is exactly what the chip's inline
     * -1d/+1d and -15m/+15m buttons did. Those buttons are gone - the same change
     * is now a menu item (context-menu.ts emits data-type="calendar-resize" with
     * data-days / data-delta, the same contract) or a drag on the chip's edge -
     * but the write path is unchanged: applyScopedEventDraft, so a recurring
     * entry is still asked for scope and a rejected write still rolls back.
     */
    const applyCalendarDurationChange = (sourceEvent: ICalendarNormalizedEvent, change: {days?: number, delta?: number}, operationElement: HTMLElement | null) => {
        if (!editable) {
            return;
        }
        if (sourceEvent.isAllDay) {
            const deltaDays = change.days || 0;
            if (!deltaDays) {
                return;
            }
            const sourceEnd = (sourceEvent.end || sourceEvent.start.endOf("day")).add(deltaDays, "day");
            if (sourceEnd.isBefore(sourceEvent.start, "day")) {
                return;
            }
            const nextDurationDays = Math.max(sourceEnd.startOf("day").diff(sourceEvent.start.startOf("day"), "day"), 0);
            applyScopedEventDraft(sourceEvent, (target) => ({
                title: target.title,
                date: target.start.format("YYYY-MM-DD"),
                endDate: target.start.startOf("day").add(nextDurationDays, "day").format("YYYY-MM-DD"),
                isAllDay: true,
                startTime: target.start.format("HH:mm"),
                endTime: target.end ? target.end.format("HH:mm") : "23:59",
                recurrenceRaw: target.recurrenceRaw,
                location: target.location,
                description: target.description,
                colorContent: target.colorContent,
            }), operationElement, window.siyuan.languages.saved || "Saved", window.siyuan.languages.calendarResizeFailed || "Resize failed.", "resize");
            return;
        }
        const delta = change.delta || 0;
        const currentEnd = sourceEvent.end || sourceEvent.start.add(1, "hour");
        const nextEnd = currentEnd.add(delta, "minute");
        if (!delta || !nextEnd.isAfter(sourceEvent.start)) {
            return;
        }
        const nextDuration = nextEnd.diff(sourceEvent.start, "minute");
        applyScopedEventDraft(sourceEvent, (target) => {
            const targetEnd = target.start.add(nextDuration, "minute");
            return {
                title: target.title,
                date: target.start.format("YYYY-MM-DD"),
                endDate: targetEnd.format("YYYY-MM-DD"),
                isAllDay: false,
                startTime: target.start.format("HH:mm"),
                endTime: targetEnd.format("HH:mm"),
                recurrenceRaw: target.recurrenceRaw,
                location: target.location,
                description: target.description,
                colorContent: target.colorContent,
            };
        }, operationElement, window.siyuan.languages.saved || "Saved", window.siyuan.languages.calendarResizeFailed || "Resize failed.", "resize");
    };
    /**
     * Move the WHOLE entry, keeping its duration. The menu offers this in the
     * same steps a drag would give you (±15m, ±1d) for the times a drag is not
     * practical - a chip in a crowded month cell, or no pointer at all.
     */
    const shiftCalendarEvent = (sourceEvent: ICalendarNormalizedEvent, shift: {days?: number, minutes?: number}, operationElement: HTMLElement | null) => {
        if (!editable) {
            return;
        }
        const days = shift.days || 0;
        const minutes = shift.minutes || 0;
        if (!days && !minutes) {
            return;
        }
        applyScopedEventDraft(sourceEvent, (target) => {
            const targetStart = target.start.add(days, "day").add(minutes, "minute");
            const targetEnd = (target.end || target.start.add(CALENDAR_DEFAULT_EVENT_MINUTES, "minute")).add(days, "day").add(minutes, "minute");
            return {
                title: target.title,
                date: targetStart.format("YYYY-MM-DD"),
                endDate: targetEnd.format("YYYY-MM-DD"),
                isAllDay: target.isAllDay,
                startTime: targetStart.format("HH:mm"),
                endTime: targetEnd.format("HH:mm"),
                recurrenceRaw: target.recurrenceRaw,
                location: target.location,
                description: target.description,
                colorContent: target.colorContent,
            };
        }, operationElement, window.siyuan.languages.saved || "Saved", window.siyuan.languages.calendarMoveFailed || "Move failed.", "move");
    };
    /**
     * Remove an entry from the calendar. This is the row/occurrence removal the
     * dialog's Delete performs - never the page behind it, which stays a separate
     * confirm-gated action in the dialog because undo can restore a row but not a
     * document.
     */
    const deleteCalendarEventWithScope = (sourceEvent: ICalendarNormalizedEvent, operationElement: HTMLElement | null, scope: CalendarRecurrenceScope) => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        const failureMessage = window.siyuan.languages.calendarDeleteFailed || "Delete failed.";
        if (!avID || !blockID) {
            showMessage(`${failureMessage} ${window.siyuan.languages.calendarEventRestored || "Event restored."}`);
            return;
        }
        withCalendarOperationFeedback(operationElement, window.siyuan.languages.saved || "Saved", failureMessage, async () => {
            const removed = await (scope === "occurrence" && sourceEvent.isOccurrence && mapping.exceptionFieldID ?
                deleteCalendarOccurrence({
                    protyle: options.protyle,
                    avID,
                    blockID,
                    fields: calendar.fields,
                    mapping,
                    event: sourceEvent,
                    occurrenceDate: sourceEvent.start.format("YYYY-MM-DD"),
                    previousUpdated: options.blockElement.getAttribute("updated") || "",
                }) : scope === "future" && mapping.recurrenceFieldID ?
                deleteCalendarEventThisAndFuture({
                    protyle: options.protyle,
                    avID,
                    blockID,
                    fields: calendar.fields,
                    mapping,
                    event: sourceEvent,
                    occurrenceDate: sourceEvent.start.format("YYYY-MM-DD"),
                    previousUpdated: options.blockElement.getAttribute("updated") || "",
                }) :
                deleteCalendarEvent({
                    protyle: options.protyle,
                    avID,
                    blockID,
                    event: sourceEvent,
                    previousUpdated: options.blockElement.getAttribute("updated") || "",
                }));
            if (removed) {
                rerender();
            }
            return removed;
        });
    };
    // Deleting a recurring series without asking would be data loss, so the menu
    // uses the very same scope prompt the dialog's Delete uses.
    const requestCalendarEventDelete = (sourceEvent: ICalendarNormalizedEvent, operationElement: HTMLElement | null) => {
        if (!editable) {
            return;
        }
        if (!sourceEvent.isOccurrence && !isRecurringSourceEvent(sourceEvent)) {
            deleteCalendarEventWithScope(sourceEvent, operationElement, "series");
            return;
        }
        openRecurrenceScopeDialog({
            action: "delete",
            disabledScopes: getDisabledRecurrenceScopes(mapping, "delete", sourceEvent),
            onSelect: (scope) => {
                if (scope === "series") {
                    const baseEvent = baseEvents.get(sourceEvent.baseEventID || sourceEvent.id) || sourceEvent;
                    deleteCalendarEventWithScope(baseEvent, operationElement, "series");
                    return;
                }
                deleteCalendarEventWithScope(sourceEvent, operationElement, scope);
            },
        });
    };
    const resolveCalendarEvent = (element: HTMLElement | null) =>
        renderedEvents.get(element?.dataset.occurrence || "") || baseEvents.get(element?.dataset.id || "");
    const openEventSchedulingFor = (calendarEvent?: ICalendarNormalizedEvent) => {
        if (!calendarEvent) {
            return;
        }
        if (!editable) {
            openCalendarEventDialog({event: calendarEvent, date: calendarEvent.start.format("YYYY-MM-DD"), readOnly: true});
            return;
        }
        const eventForDialog = getEditableEvent(calendarEvent);
        const seriesEvent = baseEvents.get(calendarEvent.baseEventID || calendarEvent.id) || calendarEvent;
        openCalendarEventDialog({event: eventForDialog, seriesEvent, date: eventForDialog.start.format("YYYY-MM-DD"), onSave: rerender, onDelete: rerender});
    };
    /**
     * Right-click / long-press on a chip. The menu itself writes nothing: it
     * reports a command with the same data-type values the old inline buttons
     * carried, and everything is routed here into the same helpers a click, a
     * drag or the dialog would use. It is never bound at all on a read-only or
     * query-embed calendar.
     */
    const runCalendarMenuCommand = (command: ICalendarMenuCommand) => {
        if (!editable) {
            return;
        }
        const sourceEvent = resolveCalendarEvent(command.eventElement) || command.event;
        if (!sourceEvent) {
            return;
        }
        if (command.type === "calendar-open-source") {
            if (getEventDocumentID(sourceEvent)) {
                openCalendarEventSource(options.protyle, options.blockElement, sourceEvent);
            }
            return;
        }
        if (command.type === "calendar-open-dialog") {
            openEventSchedulingFor(sourceEvent);
            return;
        }
        if (command.type === "calendar-duplicate-next-day") {
            duplicateEventToNextDay(sourceEvent, command.eventElement);
            return;
        }
        if (command.type === "calendar-resize") {
            applyCalendarDurationChange(sourceEvent, {days: command.days, delta: command.delta}, command.eventElement);
            return;
        }
        if (command.type === "calendar-shift") {
            shiftCalendarEvent(sourceEvent, {days: command.days, minutes: command.minutes}, command.eventElement);
            return;
        }
        if (command.type === "calendar-delete") {
            requestCalendarEventDelete(sourceEvent, command.eventElement);
        }
    };
    addCalendarTeardown(options.blockElement, bindCalendarEventContextMenu({
        calendarElement,
        editable,
        resolveEvent: (element) => resolveCalendarEvent(element),
        onCommand: runCalendarMenuCommand,
    }));
    const eventOpenTimers = new Set<number>();
    addCalendarTeardown(options.blockElement, () => {
        eventOpenTimers.forEach(timer => window.clearTimeout(timer));
        eventOpenTimers.clear();
    });
    calendarElement?.querySelectorAll(".av__calendar-event").forEach(item => {
        const eventElement = item as HTMLElement;
        eventElement.addEventListener("click", (event: MouseEvent) => {
            event.preventDefault();
            const calendarEvent = resolveCalendarEvent(eventElement);
            calendarElement.querySelectorAll(".av__calendar-event--selected").forEach(selected => selected.classList.remove("av__calendar-event--selected"));
            eventElement.classList.add("av__calendar-event--selected");
            if (event.detail > 1) {
                return;
            }
            const timer = window.setTimeout(() => {
                eventOpenTimers.delete(timer);
                openEventSchedulingFor(calendarEvent);
            }, 220);
            eventOpenTimers.add(timer);
        });
        eventElement.addEventListener("dblclick", (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            eventOpenTimers.forEach(timer => window.clearTimeout(timer));
            eventOpenTimers.clear();
            const calendarEvent = resolveCalendarEvent(eventElement);
            if (calendarEvent && getEventDocumentID(calendarEvent)) {
                openCalendarEventSource(options.protyle, options.blockElement, calendarEvent);
                return;
            }
            openEventSchedulingFor(calendarEvent);
        });
    });
    calendarElement?.querySelectorAll(".av__calendar-event").forEach(item => {
        item.addEventListener("dragstart", (event: DragEvent) => {
            if (!editable) {
                event.preventDefault();
                return;
            }
            const eventElement = item as HTMLElement;
            event.dataTransfer?.setData("text/plain", JSON.stringify({
                id: eventElement.dataset.occurrence || eventElement.dataset.id || "",
                displayDate: eventElement.dataset.date || "",
            }));
            event.dataTransfer.effectAllowed = "move";
        });
    });
    calendarElement?.querySelectorAll('[data-type="calendar-drop-day"]').forEach(item => {
        item.addEventListener("dragover", (event: DragEvent) => {
            if (!editable) {
                return;
            }
            event.preventDefault();
            (item as HTMLElement).classList.add("av__calendar-day--dragover");
        });
        item.addEventListener("dragleave", () => {
            (item as HTMLElement).classList.remove("av__calendar-day--dragover");
        });
        item.addEventListener("drop", (event: DragEvent) => {
            event.preventDefault();
            (item as HTMLElement).classList.remove("av__calendar-day--dragover");
            if (!editable) {
                return;
            }
            const rawDragData = event.dataTransfer?.getData("text/plain") || "";
            const targetDate = (item as HTMLElement).dataset.date;
            let eventID = rawDragData;
            let displayDate = "";
            try {
                const parsed = JSON.parse(rawDragData);
                eventID = parsed.id || "";
                displayDate = parsed.displayDate || "";
            } catch {
                // Older drag payloads were plain event IDs.
            }
            const sourceEvent = renderedEvents.get(eventID) || baseEvents.get(eventID);
            if (!sourceEvent || !targetDate) {
                return;
            }
            const dragOffsetDays = displayDate ? Math.max(dayjs(displayDate).startOf("day").diff(sourceEvent.start.startOf("day"), "day"), 0) : 0;
            const draftDate = dayjs(targetDate).subtract(dragOffsetDays, "day").format("YYYY-MM-DD");
            const draggedEventElement = calendarElement?.querySelector(`.av__calendar-event[data-occurrence="${eventID}"], .av__calendar-event[data-id="${eventID}"]`) as HTMLElement;
            // Dropping into a day COLUMN also moves the event in time: the old
            // grid could only change the day, because the drop target was the
            // whole column and nothing read the pointer's minute.
            const timeColumn = (item as HTMLElement).classList.contains("av__calendar-time-day") ? item as HTMLElement : null;
            const dropRect = timeColumn?.getBoundingClientRect();
            const dropStartMinute = timeColumn && !sourceEvent.isAllDay && dropRect && dropRect.height > 0 && event.clientY > 0 ?
                snapMinutes(offsetPxToMinute(event.clientY - dropRect.top, gridGeometry), gridGeometry) :
                null;
            applyScopedEventDraft(sourceEvent, (target) => {
                const dayDelta = dayjs(draftDate).diff(sourceEvent.start.startOf("day"), "day");
                const targetDraftDate = target === sourceEvent ?
                    draftDate :
                    target.start.startOf("day").add(dayDelta, "day").format("YYYY-MM-DD");
                const draft = buildDraftForDate(target, targetDraftDate);
                if (target.isAllDay && target.end && !target.start.isSame(target.end, "day")) {
                    draft.endTime = target.end?.format("HH:mm") || "23:59";
                }
                if (dropStartMinute !== null && !target.isAllDay) {
                    // Preserve the duration; only the start moves.
                    const durationMinutes = Math.max((target.end || target.start.add(CALENDAR_DEFAULT_EVENT_MINUTES, "minute")).diff(target.start, "minute"), CALENDAR_DEFAULT_EVENT_MINUTES);
                    const nextStart = dayjs(targetDraftDate).startOf("day").add(dropStartMinute, "minute");
                    const nextEnd = nextStart.add(durationMinutes, "minute");
                    draft.startTime = nextStart.format("HH:mm");
                    draft.endTime = nextEnd.format("HH:mm");
                    draft.endDate = nextEnd.format("YYYY-MM-DD");
                }
                return draft;
            }, draggedEventElement, window.siyuan.languages.saved || "Saved", window.siyuan.languages.calendarMoveFailed || "Move failed.", "move");
        });
    });
    // Pointer gestures on the grid: sweep-to-create, drag-to-move (day AND time
    // together) and edge resize. interactions.ts owns the state machine and
    // never writes; every result it emits is routed through the same
    // applyScopedEventDraft / openQuickCreate paths a click uses, so the
    // recurrence-scope prompt, the pending state and the rollback on failure all
    // still apply. It binds nothing at all when `editable` is false.
    abortActiveCalendarGesture();
    bindCalendarPointerInteractions({
        calendarElement,
        editable,
        adapter: createCalendarGridAdapter(gridElement, gridGeometry),
        resolveEvent: (element) =>
            renderedEvents.get(element.dataset.occurrence || "") || baseEvents.get(element.dataset.id || ""),
        onResult: (result) => {
            if (!editable) {
                return;
            }
            if (result.type === "create") {
                openFullCalendarCreate(result.draft);
                return;
            }
            applyScopedEventDraft(
                result.event,
                result.buildDraft,
                result.eventElement,
                window.siyuan.languages.saved || "Saved",
                result.type === "move" ?
                    (window.siyuan.languages.calendarMoveFailed || "Move failed.") :
                    (window.siyuan.languages.calendarResizeFailed || "Resize failed."),
                result.type,
            );
        },
    });
};

// 重渲染会整块替换 HTML，焦点元素随之消失。用这些属性拼一个可复原的选择器，
// 使新建/移动/缩放事件后焦点仍停在原来的事件或时间格上。
const CALENDAR_FOCUS_ATTRIBUTES = ["data-id", "data-occurrence", "data-date", "data-day-index", "data-mode"];

const isSelectorSafe = (value: string) => !!value && !/["\\]/.test(value);

const getFocusAttributeSelector = (element: HTMLElement) => {
    let selector = "";
    CALENDAR_FOCUS_ATTRIBUTES.forEach(attribute => {
        const value = element.getAttribute(attribute);
        if (isSelectorSafe(value)) {
            selector += `[${attribute}="${value}"]`;
        }
    });
    return selector;
};

const getCalendarFocusSelector = (blockElement: HTMLElement): {selector: string, fallback: string} => {
    const activeElement = document.activeElement as HTMLElement;
    if (!activeElement || !blockElement.contains(activeElement) || !hasClosestByClassName(activeElement, "av__calendar")) {
        return {selector: "", fallback: ""};
    }
    if (activeElement.classList.contains("av__calendar-event")) {
        const id = activeElement.getAttribute("data-id");
        return {
            selector: `.av__calendar-event${getFocusAttributeSelector(activeElement)}`,
            // 移动/缩放后事件可能落到别的日期格，此时按条目 ID 兜底
            fallback: isSelectorSafe(id) ? `.av__calendar-event[data-id="${id}"]` : "",
        };
    }
    const type = activeElement.getAttribute("data-type");
    if (!isSelectorSafe(type)) {
        return {selector: "", fallback: ""};
    }
    // 时间格等控件只有连同日期/时刻才能唯一定位，不做只按 data-type 的兜底
    return {selector: `[data-type="${type}"]${getFocusAttributeSelector(activeElement)}`, fallback: ""};
};

const restoreCalendarFocus = (blockElement: HTMLElement, focus: {selector: string, fallback: string}) => {
    if (!focus.selector) {
        return;
    }
    const targetElement = (blockElement.querySelector(focus.selector) ||
        (focus.fallback ? blockElement.querySelector(focus.fallback) : null)) as HTMLElement;
    if (!targetElement) {
        return;
    }
    // preventScroll：滚动位置已单独恢复，聚焦不能再把网格拉走
    targetElement.focus({preventScroll: true});
    if (targetElement instanceof HTMLInputElement && ["text", "search"].includes(targetElement.type)) {
        targetElement.setSelectionRange(targetElement.value.length, targetElement.value.length);
    }
};

// 定位请求（siyuan://blocks/<id>?avViewID=&avItemID=）指向的条目可能不在当前可见日期范围内，
// 先把锚定日期挪到该条目的开始日期，事件才会被渲染出来供 finishAVLocate 高亮。
const anchorCalendarOnLocateTarget = (data: IAV, blockElement: HTMLElement) => {
    const itemID = data.target?.itemID;
    if (!itemID) {
        return;
    }
    const calendar = data.view as IAVCalendar;
    const mapping = getCalendarFieldMapping(calendar);
    if (!mapping.hasDateField) {
        return;
    }
    const card = calendar.cards?.find(item => item.id === itemID);
    if (!card) {
        return;
    }
    const content = getCellByFieldID(card, mapping.dateFieldID)?.value?.date?.content;
    if (!content) {
        return;
    }
    const start = dayjs(content);
    if (start.isValid()) {
        blockElement.dataset.calendarDate = start.format("YYYY-MM-DD");
    }
};

export const renderCalendar = async (options: IRenderCalendarOptions) => {
    const e = options.blockElement;
    const renderToken = beginAVRender(e);
    const searchInputElement = e.querySelector('[data-type="av-search"]');
    const timeGridElement = e.querySelector(".av__calendar-time-grid") as HTMLElement;
    const resetData = {
        isSearching: !!searchInputElement && document.activeElement === searchInputElement,
        // Keep the header AV search and the Calendar-local search visually
        // independent. Either may drive the same kernel query, but typing in the
        // Calendar field must not make the header field appear populated.
        query: searchInputElement?.textContent || "",
        kernelQuery: (searchInputElement?.textContent || getCalendarSearch(e)).trim(),
        oldOffset: options.protyle.contentElement?.scrollTop,
        scrollLeft: (e.querySelector(".av__scroll") as HTMLElement)?.scrollLeft || 0,
        hadTimeGrid: !!timeGridElement,
        gridScrollTop: timeGridElement?.scrollTop || 0,
        gridScrollLeft: timeGridElement?.scrollLeft || 0,
        focusTarget: getCalendarFocusSelector(e),
        virtualData: {} as { [key: string]: IAVVirtualData },
    };
    let data = options.data;
    if (!data) {
        const created = options.protyle.options.history?.created;
        const snapshot = options.protyle.options.history?.snapshot;
        const locateParams = getAVLocateParams(e, !created && !snapshot);
        const response = await fetchSyncPost(created ? "/api/av/renderHistoryAttributeView" : (snapshot ? "/api/av/renderSnapshotAttributeView" : "/api/av/renderAttributeView"), {
            id: e.getAttribute("data-av-id"),
            created,
            snapshot,
            // 日历目前不分页：内核的日历渲染路径只回填 CardCount/PageSize 而不切片，
            // 所以整库条目都会被传回并归一化（payload 无上界），配置面板里的“条目数”
            // 设置对日历没有任何作用（应在 av/layout.ts 里对日历隐藏该行）。
            // 未来的正解是按可见日期范围在服务端分页，而不是在前端补虚拟滚动。
            pageSize: -1,
            viewID: locateParams?.viewID || e.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
            query: resetData.kernelQuery,
            blockID: e.getAttribute("data-node-id"),
            // 浏览历史/快照时不能创建数据
            createIfNotExist: !created && !snapshot && !options.protyle.block.action?.includes(Constants.CB_GET_AV_NO_CREATE),
            targetItemID: locateParams?.targetItemID || "",
            targetGroupID: locateParams?.targetGroupID || "",
        });
        data = response.data;
    }
    // 取数期间可能已有更新的渲染开始（或视图被切走），陈旧结果不能覆盖新结果
    if (!isCurrentAVRender(e, renderToken)) {
        return;
    }
    if (!data) {
        return;
    }
    prepareAVLocate(e, data, resetData);
    // data-av-type 可能是陈旧值（视图布局在别处被改过），此时必须转交给对应的渲染器
    if (data.viewType === "table") {
        e.setAttribute("data-av-type", data.viewType);
        await avRender(e, options.protyle, options.cb, options.renderAll, data);
        return;
    }
    if (data.viewType === "gallery") {
        e.setAttribute("data-av-type", data.viewType);
        await renderGallery({
            blockElement: e,
            protyle: options.protyle,
            cb: options.cb,
            renderAll: options.renderAll,
            data
        });
        return;
    }
    if (data.viewType === "kanban") {
        e.setAttribute("data-av-type", data.viewType);
        await renderKanban({
            blockElement: e,
            protyle: options.protyle,
            cb: options.cb,
            renderAll: options.renderAll,
            data
        });
        return;
    }
    e.setAttribute("data-av-type", "calendar");
    // The local new-entry target has served its purpose once the kernel reports
    // the same value; keeping it would silently outrank a change made elsewhere
    // (another view of the same database, another window).
    if (e.dataset.calendarNewItemTarget &&
        e.dataset.calendarNewItemTarget === (getPersistedNewItemTarget(data.view as IAVCalendar) || CALENDAR_NEW_ITEM_TARGET_ROW)) {
        delete e.dataset.calendarNewItemTarget;
    }
    anchorCalendarOnLocateTarget(data, e);
    const editable = !options.protyle.disabled && !hasClosestByAttribute(e, "data-type", "NodeBlockQueryEmbed");
    const body = `<div class="av__body" data-page-size="-1">${getCalendarHTML(data, e, editable, resetData.query)}</div>`;
    // 上一次渲染可能是别的布局（没有 av__scroll），此时必须整体重建容器
    const scrollElement = options.renderAll ? null : e.firstElementChild?.querySelector(".av__scroll");
    if (scrollElement) {
        scrollElement.innerHTML = body;
    } else {
        e.firstElementChild.outerHTML = `<div class="av__container">
    ${genTabHeaderHTML(data, resetData.isSearching || !!resetData.query, editable)}
    <div class="av__scroll">${body}</div>
</div>`;
    }
    // HTML 已在 DOM 中后才置 data-render，避免中途失败留下“已渲染”的空壳
    e.setAttribute("data-render", "true");
    // 模板新建的条目在日历日期字段上没有值（不可见），日历用工具栏里的新建入口替代
    e.querySelector('[data-type="av-add-template"]')?.remove();
    bindCalendarEvents(options, data);
    if (!scrollElement) {
        bindAvSearch({
            blockElement: e,
            query: resetData.query,
            isSearching: resetData.isSearching,
            onChange: () => updateSearch(e, options.protyle),
        });
    }
    if (typeof resetData.oldOffset === "number" && options.protyle.contentElement) {
        options.protyle.contentElement.scrollTop = resetData.oldOffset;
    }
    if (e.getAttribute("data-need-focus") === "true") {
        focusBlock(e);
        e.removeAttribute("data-need-focus");
    }
    const newScrollElement = e.querySelector(".av__scroll") as HTMLElement;
    if (newScrollElement && resetData.scrollLeft) {
        newScrollElement.scrollLeft = resetData.scrollLeft;
    }
    const newTimeGridElement = e.querySelector(".av__calendar-time-grid") as HTMLElement;
    if (newTimeGridElement) {
        newTimeGridElement.scrollTop = resetData.gridScrollTop;
        newTimeGridElement.scrollLeft = resetData.gridScrollLeft;
    }
    // The now line is mounted, never rendered: it owns an interval, so it has to
    // be torn down by the render that replaces it. mountCalendarNowIndicator
    // unmounts the previous one for this block element first, and it only
    // auto-scrolls when there was no scroll position to restore - never fight
    // the user's own scroll.
    if (newTimeGridElement) {
        mountCalendarNowIndicator({
            blockElement: e,
            gridElement: newTimeGridElement,
            geometry: getGridGeometry(e),
            hasRestoredScroll: resetData.hadTimeGrid,
        });
    } else {
        unmountCalendarNowIndicator(e);
    }
    restoreCalendarFocus(e, resetData.focusTarget);
    options.cb?.(data);
    finishAVLocate(e, options.protyle, data);
};
