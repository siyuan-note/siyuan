import * as dayjs from "dayjs";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {getEventDocumentID, ICalendarEventDraft, ICalendarNormalizedEvent} from "./model";

/**
 * Every piece of calendar chip HTML lives here.
 *
 * The chip used to carry permanent inline text buttons (-15m/+15m, -1d/+1d,
 * Copy). They are gone: those actions moved into the right-click menu
 * (context-menu.ts), and duration is now changed by dragging the chip's edges
 * (interactions.ts). What must NOT change is everything the rest of the app and
 * the smoke suite reads off a chip - the class list, the data attributes, the
 * tooltip/aria-label text, the pending class and the draggable/read-only
 * attributes. Those are reproduced here exactly as render.ts emitted them.
 */

export type CalendarChipVariant = "month" | "list" | "timed" | "all-day";

export const CALENDAR_CHIP_VARIANTS: CalendarChipVariant[] = ["month", "list", "timed", "all-day"];

/**
 * Same accessor as render.ts / event-dialog.ts / layout.ts: the calendar formats
 * dates with the UI language, which is already a BCP 47 tag.
 */
const getCalendarLocale = () => window.siyuan.config.lang;

export const formatCalendarDate = (date: dayjs.Dayjs, options: Intl.DateTimeFormatOptions) => {
    return new Intl.DateTimeFormat(getCalendarLocale(), options).format(date.toDate());
};

export const getOpenPageLabel = () => {
    return window.siyuan.languages.calendarOpenSource || "Open page";
};

export const getOpenScheduleLabel = () => {
    return window.siyuan.languages.calendarEditEvent || "Edit event";
};

export const getEventDateLabel = (event: ICalendarNormalizedEvent) => {
    if (event.isAllDay) {
        return event.end && !event.start.isSame(event.end, "day") ?
            `${formatCalendarDate(event.start, {year: "numeric", month: "short", day: "numeric"})} - ${formatCalendarDate(event.end, {year: "numeric", month: "short", day: "numeric"})}` :
            formatCalendarDate(event.start, {year: "numeric", month: "short", day: "numeric"});
    }
    const dateLabel = event.end && !event.start.isSame(event.end, "day") ?
        `${formatCalendarDate(event.start, {year: "numeric", month: "short", day: "numeric"})} ${event.start.format("HH:mm")} - ${formatCalendarDate(event.end, {year: "numeric", month: "short", day: "numeric"})} ${event.end.format("HH:mm")}` :
        `${formatCalendarDate(event.start, {year: "numeric", month: "short", day: "numeric"})} ${event.start.format("HH:mm")} - ${(event.end || event.start.add(1, "hour")).format("HH:mm")}`;
    return dateLabel;
};

export const getEventTimeLabel = (event: ICalendarNormalizedEvent) => {
    if (event.isAllDay) {
        return window.siyuan.languages.allDay || "All day";
    }
    const end = event.end || event.start.add(30, "minute");
    if (!event.start.isSame(end, "day")) {
        const dateOptions: Intl.DateTimeFormatOptions = {month: "short", day: "numeric"};
        if (!event.start.isSame(end, "year")) {
            dateOptions.year = "numeric";
        }
        return `${formatCalendarDate(event.start, dateOptions)} ${event.start.format("HH:mm")} – ${formatCalendarDate(end, dateOptions)} ${end.format("HH:mm")}`;
    }
    return `${event.start.format("HH:mm")}–${end.format("HH:mm")}`;
};

export const getEventTooltip = (event: ICalendarNormalizedEvent) => {
    return [
        event.title,
        getEventDateLabel(event),
        // Bound entries open their page on a plain click, so say so before the click.
        getEventDocumentID(event) ? getOpenPageLabel() : "",
        event.location ? `${window.siyuan.languages.calendarLocation || "Location"}: ${event.location}` : "",
        event.description ? `${window.siyuan.languages.calendarDescription || "Description"}: ${event.description}` : "",
        event.recurrenceRaw ? `${window.siyuan.languages.calendarRecurrence || "Recurrence"}: ${event.recurrenceRaw}` : "",
        event.isOccurrence ? window.siyuan.languages.calendarOccurrence || "Recurring occurrence" : "",
    ].filter(Boolean).join("\n");
};

export interface ICalendarChipOptions {
    event: ICalendarNormalizedEvent;
    /** Which surface the chip is drawn on. Decides shape, not behaviour. */
    variant: CalendarChipVariant;
    /** The day cell the chip is painted in; becomes data-date. */
    displayDate?: dayjs.Dayjs;
    /** false for read-only / query-embed calendars: no drag, no edge handles. */
    editable?: boolean;
    /** Extra classes for the caller's layout (never behavioural). */
    className?: string;
    /** Inline style the caller needs for absolute placement in the timed layer. */
    style?: string;
    /** All-day bars only: the run continues off the left/right edge of the view. */
    continuesBefore?: boolean;
    continuesAfter?: boolean;
}

/**
 * The colour a chip paints itself with, as the inline style render.ts produced.
 */
const getChipColorStyle = (event: ICalendarNormalizedEvent, variant: CalendarChipVariant) => {
    if (!event.color) {
        return "";
    }
    const background = `var(--b3-font-background${escapeAttr(event.color)})`;
    const foreground = `var(--b3-font-color${escapeAttr(event.color)})`;
    return `--calendar-event-accent:${foreground};--calendar-event-fill:${background};`;
};

/**
 * One chip, in one of four shapes.
 *
 * Month, list and timed surfaces use the same semantic parts but arrange them
 * differently: month is compact time + title, agenda gets separate time/title
 * columns, and a timed block puts title before time. The accessible name remains
 * the complete tooltip, independently of how much a short block can display.
 */
export const renderCalendarEventChip = (options: ICalendarChipOptions) => {
    const {event, variant} = options;
    const editable = options.editable !== false;
    const inlineStyle = `${getChipColorStyle(event, variant)}${options.style || ""}`;
    const colorStyle = inlineStyle ? ` style="${inlineStyle}"` : "";
    const eventTooltip = getEventTooltip(event);
    const documentID = getEventDocumentID(event);

    const variantClass = ` av__calendar-event--${variant === "all-day" ? "all-day" : variant}`;
    const continuationClass = `${options.continuesBefore ? " av__calendar-event--continues-before" : ""}${options.continuesAfter ? " av__calendar-event--continues-after" : ""}`;
    const durationMinutes = event.isAllDay ? 24 * 60 : Math.max((event.end || event.start.add(30, "minute")).diff(event.start, "minute"), 0);
    const densityClass = durationMinutes < 45 ? " av__calendar-event--short" : durationMinutes >= 90 ? " av__calendar-event--tall" : "";
    const timeRange = getEventTimeLabel(event);
    const secondary = event.location ? `<span class="av__calendar-event-meta">${escapeHtml(event.location)}</span>` : "";
    const content = variant === "month" ?
        `${event.isAllDay ? "" : `<span class="av__calendar-event-time">${escapeHtml(timeRange)}</span>`}<span class="av__calendar-event-title">${escapeHtml(event.title)}</span>` :
        variant === "list" ?
            `<span class="av__calendar-event-time">${escapeHtml(timeRange)}</span><span class="av__calendar-event-title">${escapeHtml(event.title)}</span>${secondary}` :
            variant === "all-day" ?
                `<span class="av__calendar-event-title">${escapeHtml(event.title)}</span>${event.isAllDay ? "" : `<span class="av__calendar-event-time">${escapeHtml(timeRange)}</span>`}` :
                `<span class="av__calendar-event-content"><span class="av__calendar-event-title">${escapeHtml(event.title)}</span>${event.isAllDay ? "" : `<span class="av__calendar-event-time">${escapeHtml(timeRange)}</span>`}${secondary}</span>`;
    return `<button class="av__calendar-event${variantClass}${densityClass}${continuationClass}${editable ? "" : " av__calendar-event--readonly"}${documentID ? " av__calendar-event--page" : ""}${options.className ? ` ${options.className}` : ""}" draggable="${editable ? "true" : "false"}" data-id="${escapeAttr(event.baseEventID || event.id)}" data-occurrence="${escapeAttr(event.occurrenceID || "")}" data-page="${escapeAttr(documentID)}" data-date="${options.displayDate?.format("YYYY-MM-DD") || event.start.format("YYYY-MM-DD")}" data-variant="${variant}" data-all-day="${event.isAllDay ? "true" : "false"}" data-time="${escapeAttr(event.isAllDay ? "" : event.start.format("HH:mm"))}" data-duration-minutes="${durationMinutes}" title="${escapeAttr(eventTooltip)}" aria-label="${escapeAttr(eventTooltip)}"${colorStyle}>
    ${content}
</button>`;
};

/**
 * The chip painted for an entry the user just saved, before the kernel answers.
 *
 * Not a <button>: it has no listeners bound to it (it never went through a
 * render pass), so it must not look or behave clickable.
 */
export const buildOptimisticChip = (draft: ICalendarEventDraft) => {
    const label = `${draft.isAllDay ? "" : `${draft.startTime} `}${draft.title}`;
    const chip = document.createElement("div");
    chip.className = "av__calendar-event av__calendar-event--pending";
    chip.setAttribute("aria-busy", "true");
    chip.setAttribute("title", label);
    chip.innerHTML = `<span class="av__calendar-event-text">${escapeHtml(label)}</span>`;
    return chip;
};

/**
 * The block an empty-grid sweep paints while a new range grows. Existing timed
 * events preview on their own wrapper instead of rendering a second block.
 */
export const buildCalendarGhost = (label: string, title?: string) => {
    const ghost = document.createElement("div");
    ghost.className = "av__calendar-ghost";
    ghost.dataset.type = "calendar-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.innerHTML = `<span class="av__calendar-ghost-label"></span><span class="av__calendar-ghost-title"></span>`;
    updateCalendarGhost(ghost, label, title);
    return ghost;
};

export const updateCalendarGhost = (ghost: HTMLElement, label: string, title?: string) => {
    const labelElement = ghost.querySelector(".av__calendar-ghost-label") as HTMLElement;
    const titleElement = ghost.querySelector(".av__calendar-ghost-title") as HTMLElement;
    if (labelElement) {
        labelElement.textContent = label;
    }
    if (titleElement) {
        titleElement.textContent = title || "";
    }
};
