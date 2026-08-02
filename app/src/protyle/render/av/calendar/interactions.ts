import {ICalendarEventDraft, ICalendarNormalizedEvent} from "./model";
import {buildCalendarGhost, updateCalendarGhost} from "./event-chip";
import {
    buildAllDayResizeEndTransform,
    buildAllDayResizeStartTransform,
    buildAllDaySweepCreateDraft,
    buildMoveToDateTimeTransform,
    buildMoveToDateTransform,
    buildResizeEndTransform,
    buildResizeStartTransform,
    buildSweepCreateDraft,
    describeCalendarRange,
    getEventGridRange,
    ICalendarDraftTransform,
    ICalendarGridPoint,
    ICalendarGridRange,
    resolveCalendarGeometry,
} from "./drafts";
import {
    clampToDayMinutes,
    getCalendarTimeGeometry,
    ICalendarTimeGeometry,
    minuteToOffsetPx,
    offsetPxToMinute,
    parseClockMinutes,
} from "./time-geometry";
import {CALENDAR_RESIZE_HANDLE_TYPE, CALENDAR_TIME_DAY_CLASS, CALENDAR_TIME_GRID_CLASS} from "./time-grid";

/**
 * The pointer state machine for direct manipulation on the time grid.
 *
 * Three gestures, all on Pointer Events with pointer capture so a fast drag that
 * leaves the grid (or the window) does not lose the pointer:
 *   (a) sweep on empty grid  -> ghost block growing in snap steps -> quick create
 *   (b) drag a chip          -> previews on that chip, across days and times
 *   (c) grab a chip edge     -> previews that end on the existing chip
 *
 * Three things this module deliberately does NOT do:
 *   - It never writes. It emits a result and render.ts routes it through
 *     applyScopedEventDraft, so the recurrence-scope prompt, the pending state
 *     and the rollback on failure all keep working untouched.
 *   - It never handles clicks. A press that stays inside the movement threshold
 *     is left completely alone: no capture is taken, no default is prevented, so
 *     the existing click handlers (open page / open dialog / open quick create
 *     on an empty slot) fire exactly as they do today.
 *   - It does nothing at all on a read-only or query-embed calendar.
 */

/** Pointer travel, in CSS pixels, before a press stops being a click. */
const DRAG_THRESHOLD_PX = 4;

/**
 * Touch input needs the same drift allowance as the chip long-press menu. A
 * smaller threshold turns a normal finger tap into an accidental move before
 * the click handler can open the scheduling dialog.
 */
export const TOUCH_DRAG_THRESHOLD_PX = 8;

/** Where a chip edge stops being an edge, when the chip has no handle element. */
const EDGE_FALLBACK_PX = 6;

export interface ICalendarGridAdapter {
    /**
     * Snap/limit constants. The Grid agent's time-geometry record satisfies this
     * structurally; anything missing falls back to the shared defaults.
     */
    geometry?: Partial<ICalendarTimeGeometry>;
    /**
     * Which day column and minute-of-day sits under a viewport point, or null
     * when the point is not over the timed grid. All pixel math lives here, in
     * the grid's own module - this state machine only speaks (date, minute).
     */
    resolvePoint(clientX: number, clientY: number): ICalendarGridPoint | null;
    /** Positioned element the ghost is appended to, per lane. */
    getGhostLayer(lane: CalendarGhostLane): HTMLElement | null;
    /** Ghost placement for a range, in getGhostLayer("timed")-relative pixels. */
    getGhostRect(range: ICalendarGridRange): ICalendarGhostRect | null;
    /** Optional: which date sits under a point on the all-day rail. */
    resolveAllDayDate?(clientX: number, clientY: number): string | null;
    /** Optional: ghost placement for an all-day run, relative to its own lane. */
    getAllDayGhostRect?(startDate: string, endDate: string): ICalendarGhostRect | null;
}

export type CalendarGhostLane = "timed" | "all-day";

export interface ICalendarGhostRect {
    top: number;
    left: number;
    width: number;
    height: number;
}

export type CalendarGestureKind = "sweep" | "move" | "resize-start" | "resize-end";

export type ICalendarInteractionResult =
    | {
        type: "create";
        /** Prefilled with the swept range; hand straight to openQuickCreate. */
        draft: ICalendarEventDraft;
        /**
         * The day column the sweep started in - pass it as openQuickCreate's
         * `target`, exactly like the old time-slot button was passed.
         */
        anchorElement: HTMLElement;
        /**
         * Vertical offset of the swept block inside the timed ghost layer, for
         * openQuickCreate's `top` (--calendar-quick-create-top).
         */
        top: number;
        range: ICalendarGridRange | null;
    }
    | {
        type: "move" | "resize";
        /** Pass as the `action` argument of applyScopedEventDraft. */
        event: ICalendarNormalizedEvent;
        /** The chip that was grabbed; use it as the pending/rollback element. */
        eventElement: HTMLElement;
        /** Feed straight into applyScopedEventDraft's buildDraft parameter. */
        buildDraft: ICalendarDraftTransform;
        edge?: "start" | "end";
    };

export interface ICalendarInteractionOptions {
    calendarElement: HTMLElement;
    /** false on read-only / query-embed calendars: nothing is bound at all. */
    editable: boolean;
    adapter: ICalendarGridAdapter;
    /** Chip element -> the normalized event render.ts has in memory. */
    resolveEvent(element: HTMLElement): ICalendarNormalizedEvent | undefined;
    /** Called once per completed gesture. Never called for a plain click. */
    onResult(result: ICalendarInteractionResult): void;
}

interface IActiveGesture {
    kind: CalendarGestureKind;
    pointerId: number;
    captureElement: HTMLElement;
    startClientX: number;
    startClientY: number;
    started: boolean;
    aborted: boolean;
    /** Sweep only. */
    anchorPoint: ICalendarGridPoint | null;
    anchorAllDayDate: string | null;
    /** Move/resize only. */
    event: ICalendarNormalizedEvent | null;
    eventElement: HTMLElement | null;
    /** Where inside the chip the pointer grabbed it, in minutes. */
    grabOffsetMinutes: number;
    lastPoint: ICalendarGridPoint | null;
    lastAllDayDate: string | null;
    ghost: HTMLElement | null;
    liveRegion: HTMLElement | null;
    restoreDraggable: HTMLElement | null;
    previewElement: HTMLElement | null;
    previewStyle: string | null;
    options: ICalendarInteractionOptions;
    cleanup: () => void;
}

let activeGesture: IActiveGesture | null = null;

/**
 * Abort whatever gesture is in flight without writing anything.
 *
 * Exported because the context menu has to win over a drag: a long press, or a
 * right button pressed mid-drag, must open the menu on a calendar that is not
 * silently mid-move.
 */
export const abortActiveCalendarGesture = () => {
    if (!activeGesture) {
        return;
    }
    activeGesture.aborted = true;
    finishGesture(activeGesture, false);
};

/** True while a gesture has passed the movement threshold. */
export const isCalendarGestureActive = () => !!activeGesture && activeGesture.started;

const removeGhost = (gesture: IActiveGesture) => {
    gesture.ghost?.remove();
    gesture.ghost = null;
    gesture.liveRegion?.remove();
    gesture.liveRegion = null;
};

const restoreEventPreview = (gesture: IActiveGesture) => {
    if (!gesture.previewElement) {
        return;
    }
    if (gesture.previewStyle === null) {
        gesture.previewElement.removeAttribute("style");
    } else {
        gesture.previewElement.setAttribute("style", gesture.previewStyle);
    }
    gesture.previewElement = null;
    gesture.previewStyle = null;
};

const placeTimedEventPreview = (gesture: IActiveGesture, rect: ICalendarGhostRect | null) => {
    const event = gesture.event;
    const eventElement = gesture.eventElement;
    if (!event || !eventElement || !rect) {
        return;
    }
    const previewElement = eventElement.closest(".av__calendar-timed-event") as HTMLElement;
    const sourceRect = gesture.options.adapter.getGhostRect(getEventGridRange(event));
    if (!previewElement || !sourceRect) {
        return;
    }
    if (!gesture.previewElement) {
        gesture.previewElement = previewElement;
        gesture.previewStyle = previewElement.getAttribute("style");
    }
    if (gesture.kind === "move") {
        previewElement.style.transform = `translate(${rect.left - sourceRect.left}px, ${rect.top - sourceRect.top}px)`;
        return;
    }
    const originalTop = parseFloat(/(?:^|;)\s*top:\s*(-?\d+(?:\.\d+)?)px/.exec(gesture.previewStyle || "")?.[1] || "0");
    previewElement.style.top = `${originalTop + rect.top - sourceRect.top}px`;
    previewElement.style.height = `${rect.height}px`;
};

const ensureLiveRegion = (gesture: IActiveGesture) => {
    if (gesture.liveRegion) {
        return gesture.liveRegion;
    }
    const region = document.createElement("div");
    region.className = "av__calendar-gesture-live";
    region.setAttribute("aria-live", "polite");
    gesture.options.calendarElement.appendChild(region);
    gesture.liveRegion = region;
    return region;
};

const setReadout = (gesture: IActiveGesture, text: string) => {
    ensureLiveRegion(gesture).textContent = text;
};

const placeGhost = (gesture: IActiveGesture, lane: CalendarGhostLane, rect: ICalendarGhostRect | null, label: string, title?: string) => {
    const layer = gesture.options.adapter.getGhostLayer(lane);
    if (!layer) {
        return;
    }
    if (!gesture.ghost) {
        gesture.ghost = buildCalendarGhost(label, title);
        gesture.ghost.dataset.gesture = gesture.kind;
        gesture.ghost.dataset.lane = lane;
        // Positioned inline so the ghost works even before the grid's stylesheet
        // grows a rule for it; the layer itself must be position:relative.
        gesture.ghost.style.position = "absolute";
        layer.appendChild(gesture.ghost);
    } else {
        updateCalendarGhost(gesture.ghost, label, title);
    }
    if (rect) {
        gesture.ghost.style.top = `${rect.top}px`;
        gesture.ghost.style.left = `${rect.left}px`;
        gesture.ghost.style.width = `${rect.width}px`;
        gesture.ghost.style.height = `${rect.height}px`;
    }
};

/**
 * Suppress the one click the browser fires after a real drag, so releasing a
 * moved chip does not also open its page.
 */
const swallowNextClick = () => {
    const swallow = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
    };
    window.addEventListener("click", swallow, true);
    window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
};

const finishGesture = (gesture: IActiveGesture, commit: boolean) => {
    gesture.cleanup();
    removeGhost(gesture);
    restoreEventPreview(gesture);
    gesture.eventElement?.classList.remove("av__calendar-event--dragging");
    gesture.options.calendarElement.classList.remove("av__calendar--gesturing");
    if (gesture.restoreDraggable) {
        gesture.restoreDraggable.setAttribute("draggable", "true");
        gesture.restoreDraggable = null;
    }
    try {
        if (gesture.captureElement.hasPointerCapture?.(gesture.pointerId)) {
            gesture.captureElement.releasePointerCapture(gesture.pointerId);
        }
    } catch {
        // Releasing a capture the browser already dropped is not an error here.
    }
    if (activeGesture === gesture) {
        activeGesture = null;
    }
    if (gesture.started) {
        swallowNextClick();
    }
    if (!commit || gesture.aborted || !gesture.started) {
        return;
    }
    emitResult(gesture);
};

const getAnchorElement = (element: HTMLElement, calendarElement: HTMLElement): HTMLElement => {
    const column = element.closest(".av__calendar-time-day, .av__calendar-week-day, .av__calendar-day-view, .av__calendar-day, .av__calendar-list-day") as HTMLElement;
    return column || element || calendarElement;
};

const emitResult = (gesture: IActiveGesture) => {
    const {options} = gesture;
    const geometry = resolveCalendarGeometry(options.adapter.geometry);
    if (gesture.kind === "sweep") {
        const draft = gesture.anchorAllDayDate && gesture.lastAllDayDate ?
            buildAllDaySweepCreateDraft(gesture.anchorAllDayDate, gesture.lastAllDayDate) :
            (gesture.anchorPoint && gesture.lastPoint ? buildSweepCreateDraft(gesture.anchorPoint, gesture.lastPoint, geometry) : null);
        if (!draft) {
            return;
        }
        const anchorElement = getAnchorElement(gesture.captureElement, options.calendarElement);
        const range = gesture.anchorPoint && gesture.lastPoint ? normalizeRange(gesture.anchorPoint, gesture.lastPoint) : null;
        const rect = range ? options.adapter.getGhostRect(range) : null;
        options.onResult({
            type: "create",
            draft,
            anchorElement,
            top: rect ? rect.top : 0,
            range,
        });
        return;
    }
    const sourceEvent = gesture.event;
    const eventElement = gesture.eventElement;
    if (!sourceEvent || !eventElement) {
        return;
    }
    const buildDraft = buildTransformForGesture(gesture, geometry);
    if (!buildDraft) {
        return;
    }
    options.onResult({
        type: gesture.kind === "move" ? "move" : "resize",
        event: sourceEvent,
        eventElement,
        buildDraft,
        edge: gesture.kind === "resize-start" ? "start" : gesture.kind === "resize-end" ? "end" : undefined,
    });
};

const buildTransformForGesture = (gesture: IActiveGesture, geometry: ICalendarTimeGeometry): ICalendarDraftTransform | null => {
    const sourceEvent = gesture.event;
    if (!sourceEvent) {
        return null;
    }
    // All-day gestures live on the rail and only ever speak in whole dates.
    if (gesture.lastAllDayDate) {
        if (gesture.kind === "move") {
            return buildMoveToDateTransform(sourceEvent, gesture.lastAllDayDate, {
                displayDate: gesture.eventElement?.dataset.date,
            });
        }
        if (gesture.kind === "resize-start") {
            return buildAllDayResizeStartTransform(sourceEvent, gesture.lastAllDayDate);
        }
        return buildAllDayResizeEndTransform(sourceEvent, gesture.lastAllDayDate);
    }
    const point = gesture.lastPoint;
    if (!point) {
        return null;
    }
    if (gesture.kind === "move") {
        // The pointer holds the chip where it was grabbed, not by its top edge.
        const grabbed: ICalendarGridPoint = {date: point.date, minute: point.minute - gesture.grabOffsetMinutes};
        return buildMoveToDateTimeTransform(sourceEvent, grabbed, geometry);
    }
    if (gesture.kind === "resize-start") {
        return buildResizeStartTransform(sourceEvent, point, geometry);
    }
    return buildResizeEndTransform(sourceEvent, point, geometry);
};

const normalizeRange = (anchor: ICalendarGridPoint, current: ICalendarGridPoint): ICalendarGridRange => {
    const anchorKey = `${anchor.date}T${String(anchor.minute).padStart(4, "0")}`;
    const currentKey = `${current.date}T${String(current.minute).padStart(4, "0")}`;
    return currentKey < anchorKey ? {start: current, end: anchor} : {start: anchor, end: current};
};

const getGestureRange = (gesture: IActiveGesture, geometry: ICalendarTimeGeometry): ICalendarGridRange | null => {
    if (gesture.kind === "sweep") {
        return gesture.anchorPoint && gesture.lastPoint ? normalizeRange(gesture.anchorPoint, gesture.lastPoint) : null;
    }
    const sourceEvent = gesture.event;
    const point = gesture.lastPoint;
    if (!sourceEvent || !point) {
        return null;
    }
    const transform = buildTransformForGesture(gesture, geometry);
    if (!transform) {
        return getEventGridRange(sourceEvent);
    }
    const draft = transform(sourceEvent);
    return {
        start: {date: draft.date, minute: parseClockMinutes(draft.startTime)},
        end: {date: draft.endDate || draft.date, minute: parseClockMinutes(draft.endTime)},
    };
};

const updateGesture = (gesture: IActiveGesture, clientX: number, clientY: number) => {
    const {adapter} = gesture.options;
    const geometry = resolveCalendarGeometry(adapter.geometry);
    const anchorAllDayDate = gesture.anchorAllDayDate;
    const allDayDate = anchorAllDayDate ? (adapter.resolveAllDayDate?.(clientX, clientY) || gesture.lastAllDayDate) : null;
    if (anchorAllDayDate && allDayDate) {
        gesture.lastAllDayDate = allDayDate;
        const sweepsForward = anchorAllDayDate < allDayDate;
        const startDate = gesture.kind === "sweep" ? (sweepsForward ? anchorAllDayDate : allDayDate) : allDayDate;
        const endDate = gesture.kind === "sweep" ? (sweepsForward ? allDayDate : anchorAllDayDate) : allDayDate;
        const rect = adapter.getAllDayGhostRect?.(startDate, endDate) || null;
        const label = startDate === endDate ? startDate : `${startDate} – ${endDate}`;
        placeGhost(gesture, "all-day", rect, label, gesture.event?.title);
        setReadout(gesture, label);
        return;
    }
    const point = adapter.resolvePoint(clientX, clientY);
    if (point) {
        gesture.lastPoint = point;
    }
    const range = getGestureRange(gesture, geometry);
    if (!range) {
        return;
    }
    const label = describeCalendarRange(range, geometry);
    const rect = adapter.getGhostRect(range);
    if (gesture.kind === "sweep") {
        placeGhost(gesture, "timed", rect, label);
    } else {
        placeTimedEventPreview(gesture, rect);
    }
    setReadout(gesture, label);
};

const startGesture = (gesture: IActiveGesture) => {
    gesture.started = true;
    gesture.options.calendarElement.classList.add("av__calendar--gesturing");
    try {
        gesture.captureElement.setPointerCapture(gesture.pointerId);
    } catch {
        // Safari can refuse a capture for a pointer that already ended; the
        // document-level move/up listeners still drive the gesture.
    }
    if (gesture.eventElement) {
        gesture.eventElement.classList.add("av__calendar-event--dragging");
        // The chip is still draggable="true" for the legacy HTML5 drop path;
        // turn that off for the duration so the browser does not start a native
        // drag on top of the pointer gesture. Restored in finishGesture.
        if (gesture.eventElement.getAttribute("draggable") === "true") {
            gesture.eventElement.setAttribute("draggable", "false");
            gesture.restoreDraggable = gesture.eventElement;
        }
    }
};

const isInertTarget = (element: HTMLElement) =>
    !!element.closest('[data-type="calendar-open-source"], [data-type="calendar-open-dialog"], .av__calendar-quick-create, .av__calendar-menu, .av__calendar-toolbar, .av__calendar-event--pending, [data-calendar-operation="pending"]');

/**
 * Bind the three gestures. Returns a disposer; render.ts replaces its own HTML
 * on every rerender, so the listeners it puts on the (discarded) calendar
 * element go away with it, but the document-level ones must not leak.
 */
export const bindCalendarPointerInteractions = (options: ICalendarInteractionOptions): (() => void) => {
    const {calendarElement, adapter} = options;
    if (!calendarElement || !options.editable) {
        // Read-only and query-embed calendars get no gesture surface at all.
        return () => undefined;
    }

    const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || activeGesture) {
            return;
        }
        const target = event.target as HTMLElement;
        if (!target || isInertTarget(target)) {
            return;
        }
        const handle = target.closest(`[data-type="${CALENDAR_RESIZE_HANDLE_TYPE}"]`) as HTMLElement;
        // The grid renders the edge handles as SIBLINGS of the chip inside the
        // positioned wrapper, so a press on a handle has to walk out to the
        // wrapper to find the chip it belongs to.
        const chip = (handle ?
            handle.closest(".av__calendar-timed-event, .av__calendar-allday-bar")?.querySelector(".av__calendar-event") :
            target.closest(".av__calendar-event")) as HTMLElement;
        // The all-day rail is its own lane above the columns; anything grabbed
        // there speaks in whole dates, never in minutes.
        const allDayRail = target.closest(".av__calendar-allday-row, .av__calendar-allday-lanes, .av__calendar-all-day") as HTMLElement;
        const anchorAllDayDate = allDayRail && adapter.resolveAllDayDate ?
            adapter.resolveAllDayDate(event.clientX, event.clientY) : null;
        const anchorPoint = anchorAllDayDate ? null : adapter.resolvePoint(event.clientX, event.clientY);
        if (!anchorPoint && !anchorAllDayDate) {
            return;
        }
        if (handle && !chip) {
            // An orphaned handle must never fall through to "sweep a new event".
            return;
        }
        let kind: CalendarGestureKind = "sweep";
        let sourceEvent: ICalendarNormalizedEvent | undefined;
        let grabOffsetMinutes = 0;
        if (chip) {
            sourceEvent = options.resolveEvent(chip);
            if (!sourceEvent) {
                return;
            }
            const edge = handle?.dataset.edge || detectFallbackEdge(chip, event);
            kind = edge === "start" ? "resize-start" : edge === "end" ? "resize-end" : "move";
            if (kind === "move" && anchorPoint) {
                const eventRange = getEventGridRange(sourceEvent);
                grabOffsetMinutes = anchorPoint.date === eventRange.start.date ?
                    anchorPoint.minute - eventRange.start.minute : 0;
            }
        }

        const documentListeners: Array<[string, EventListener]> = [];
        const addDocumentListener = (type: string, listener: EventListener, capture = false) => {
            document.addEventListener(type, listener, capture);
            documentListeners.push([type, listener]);
        };

        const gesture: IActiveGesture = {
            kind,
            pointerId: event.pointerId,
            captureElement: (chip || target) as HTMLElement,
            startClientX: event.clientX,
            startClientY: event.clientY,
            started: false,
            aborted: false,
            anchorPoint,
            anchorAllDayDate,
            event: sourceEvent || null,
            eventElement: chip || null,
            grabOffsetMinutes,
            lastPoint: anchorPoint,
            lastAllDayDate: anchorAllDayDate,
            ghost: null,
            liveRegion: null,
            restoreDraggable: null,
            previewElement: null,
            previewStyle: null,
            options,
            cleanup: () => {
                documentListeners.forEach(([type, listener]) => {
                    document.removeEventListener(type, listener, true);
                    document.removeEventListener(type, listener, false);
                });
                window.removeEventListener("blur", onWindowBlur);
            },
        };

        const onMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== gesture.pointerId) {
                return;
            }
            if (!gesture.started) {
                const travelled = Math.hypot(moveEvent.clientX - gesture.startClientX, moveEvent.clientY - gesture.startClientY);
                const threshold = moveEvent.pointerType === "touch" ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
                if (travelled < threshold) {
                    return;
                }
                startGesture(gesture);
            }
            // Past the threshold the grid owns the pointer: no text selection,
            // no scroll chaining, no native drag image.
            moveEvent.preventDefault();
            updateGesture(gesture, moveEvent.clientX, moveEvent.clientY);
        };
        const onUp = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== gesture.pointerId) {
                return;
            }
            finishGesture(gesture, true);
        };
        const onCancel = (cancelEvent: PointerEvent) => {
            if (cancelEvent.pointerId !== gesture.pointerId) {
                return;
            }
            gesture.aborted = true;
            finishGesture(gesture, false);
        };
        const onKeyDown = (keyEvent: KeyboardEvent) => {
            if (keyEvent.key !== "Escape") {
                return;
            }
            // Escape mid-gesture throws the gesture away without a write, and
            // must not also reach the calendar's own Escape (clear search).
            keyEvent.preventDefault();
            keyEvent.stopPropagation();
            gesture.aborted = true;
            finishGesture(gesture, false);
        };
        const onDragStart = (dragEvent: Event) => {
            if (gesture.started) {
                dragEvent.preventDefault();
            }
        };
        const onContextMenu = () => {
            gesture.aborted = true;
            finishGesture(gesture, false);
        };
        function onWindowBlur() {
            gesture.aborted = true;
            finishGesture(gesture, false);
        }

        addDocumentListener("pointermove", onMove as EventListener);
        addDocumentListener("pointerup", onUp as EventListener);
        addDocumentListener("pointercancel", onCancel as EventListener);
        addDocumentListener("keydown", onKeyDown as EventListener, true);
        addDocumentListener("dragstart", onDragStart, true);
        addDocumentListener("contextmenu", onContextMenu as EventListener, true);
        window.addEventListener("blur", onWindowBlur);
        activeGesture = gesture;
    };

    calendarElement.addEventListener("pointerdown", onPointerDown);
    return () => {
        calendarElement.removeEventListener("pointerdown", onPointerDown);
        if (activeGesture && activeGesture.options.calendarElement === calendarElement) {
            abortActiveCalendarGesture();
        }
    };
};

/**
 * Which end of a chip a press landed on when the chip has no handle element
 * (month and list chips do not get handles, so this returns "" for them).
 */
const detectFallbackEdge = (chip: HTMLElement, event: PointerEvent): "" | "start" | "end" => {
    const variant = chip.dataset.variant;
    if (variant !== "timed" && variant !== "all-day") {
        return "";
    }
    const rect = chip.getBoundingClientRect();
    if (variant === "all-day") {
        if (event.clientX - rect.left <= EDGE_FALLBACK_PX) {
            return "start";
        }
        return rect.right - event.clientX <= EDGE_FALLBACK_PX ? "end" : "";
    }
    if (event.clientY - rect.top <= EDGE_FALLBACK_PX) {
        return "start";
    }
    return rect.bottom - event.clientY <= EDGE_FALLBACK_PX ? "end" : "";
};

/**
 * A hit-testing adapter for the grid time-grid.ts actually renders.
 *
 * It reads only the DOM contract that module exports as public
 * (.av__calendar-time-columns / .av__calendar-time-day[data-date] /
 * .av__calendar-allday-lanes / .av__calendar-allday-cell[data-date]), so the
 * pixel math stays on the grid side of the fence and the state machine above
 * keeps speaking nothing but (date, minute). Replace it wholesale if the grid
 * ever grows its own hit-tester - `ICalendarGridAdapter` is the only contract
 * the state machine cares about.
 *
 * resolvePoint is deliberately strict: it answers null for anything outside the
 * columns, so a press on the toolbar or the header can never start a sweep. A
 * drag that leaves the grid keeps the last point that WAS inside, which is what
 * makes dragging past the bottom of the last column feel like it holds.
 */
export const createCalendarGridAdapter = (
    timeGridElement: HTMLElement | null,
    geometry?: Partial<ICalendarTimeGeometry>,
): ICalendarGridAdapter => {
    const grid = timeGridElement?.classList.contains(CALENDAR_TIME_GRID_CLASS) ?
        timeGridElement :
        (timeGridElement?.querySelector(`.${CALENDAR_TIME_GRID_CLASS}`) as HTMLElement) || timeGridElement;
    const resolved = getCalendarTimeGeometry(geometry?.dayCount, geometry || {});
    const columnsLayer = () => grid?.querySelector(".av__calendar-time-columns") as HTMLElement;
    const allDayLayer = () => grid?.querySelector(".av__calendar-allday-lanes") as HTMLElement;
    const columnFor = (date: string) => grid?.querySelector(`.${CALENDAR_TIME_DAY_CLASS}[data-date="${date}"]`) as HTMLElement;
    const allDayCellFor = (date: string) => grid?.querySelector(`.av__calendar-allday-cell[data-date="${date}"]`) as HTMLElement;

    const relativeRect = (element: HTMLElement, layer: HTMLElement) => {
        const elementRect = element.getBoundingClientRect();
        const layerRect = layer.getBoundingClientRect();
        return {
            left: elementRect.left - layerRect.left,
            top: elementRect.top - layerRect.top,
            width: elementRect.width,
            height: elementRect.height,
        };
    };

    return {
        geometry: resolved,
        resolvePoint(clientX: number, clientY: number) {
            const layer = columnsLayer();
            if (!layer) {
                return null;
            }
            const layerRect = layer.getBoundingClientRect();
            if (clientY < layerRect.top || clientY > layerRect.bottom || clientX < layerRect.left || clientX > layerRect.right) {
                return null;
            }
            const columns = Array.from(layer.querySelectorAll(`.${CALENDAR_TIME_DAY_CLASS}`)) as HTMLElement[];
            if (columns.length === 0) {
                return null;
            }
            const column = columns.find(item => {
                const rect = item.getBoundingClientRect();
                return clientX >= rect.left && clientX <= rect.right;
            }) || columns[columns.length - 1];
            const date = column.dataset.date;
            if (!date) {
                return null;
            }
            const columnRect = column.getBoundingClientRect();
            const minute = offsetPxToMinute(clientY - columnRect.top, resolved);
            return {date, minute: clampToDayMinutes(minute, resolved)};
        },
        resolveAllDayDate(clientX: number, clientY: number) {
            const layer = allDayLayer();
            if (!layer) {
                return null;
            }
            const cells = Array.from(layer.querySelectorAll(".av__calendar-allday-cell")) as HTMLElement[];
            if (cells.length === 0) {
                return null;
            }
            const layerRect = layer.getBoundingClientRect();
            if (clientX < layerRect.left || clientX > layerRect.right) {
                return null;
            }
            const cell = cells.find(item => {
                const rect = item.getBoundingClientRect();
                return clientX >= rect.left && clientX <= rect.right;
            }) || cells[cells.length - 1];
            // The vertical test is intentionally loose: the rail is only a couple
            // of lanes tall, and a bar being dragged sideways must not fall out of
            // it because the pointer drifted a few pixels.
            return cell.dataset.date || null;
        },
        getGhostLayer(lane: CalendarGhostLane) {
            return lane === "all-day" ? allDayLayer() : columnsLayer();
        },
        getGhostRect(range: ICalendarGridRange) {
            const layer = columnsLayer();
            const column = columnFor(range.start.date);
            if (!layer || !column) {
                return null;
            }
            const box = relativeRect(column, layer);
            const startMinute = clampToDayMinutes(range.start.minute, resolved);
            const sameDay = range.end.date === range.start.date;
            const endMinute = clampToDayMinutes(sameDay ? range.end.minute : resolved.dayEndMinute, resolved);
            const top = minuteToOffsetPx(startMinute, resolved);
            const height = Math.max(minuteToOffsetPx(endMinute, resolved) - top, minuteToOffsetPx(resolved.minimumEventMinutes, resolved));
            return {top: box.top + top, left: box.left, width: box.width, height};
        },
        getAllDayGhostRect(startDate: string, endDate: string) {
            const layer = allDayLayer();
            const startCell = allDayCellFor(startDate);
            const endCell = allDayCellFor(endDate) || startCell;
            if (!layer || !startCell) {
                return null;
            }
            const startBox = relativeRect(startCell, layer);
            const endBox = relativeRect(endCell, layer);
            return {
                top: startBox.top,
                left: Math.min(startBox.left, endBox.left),
                width: Math.abs(endBox.left - startBox.left) + endBox.width,
                height: startBox.height,
            };
        },
    };
};
