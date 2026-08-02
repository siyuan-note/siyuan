import {escapeHtml} from "../../../../util/escape";
import {getEventDocumentID, ICalendarNormalizedEvent} from "./model";
import {getOpenPageLabel, getOpenScheduleLabel} from "./event-chip";
import {abortActiveCalendarGesture} from "./interactions";

/**
 * The chip's right-click (and long-press) menu.
 *
 * This is where the actions that used to sit as permanent inline text buttons
 * inside every chip went. The chips are quiet now; the menu is where you go for
 * the things a drag cannot express.
 *
 * The menu items deliberately reuse the data-type values of the old inline
 * buttons - calendar-open-source, calendar-open-dialog,
 * calendar-duplicate-next-day, calendar-resize (+ data-delta / data-days) - so
 * render.ts's existing handlers and the assertions that drive them keep working
 * against the same contract, only from a different place in the DOM.
 *
 * Like every other direct-manipulation surface it writes nothing itself: it
 * reports a command and lets render.ts route it through applyScopedEventDraft /
 * withCalendarOperationFeedback, so recurring events still ask for scope and a
 * rejected write still rolls back.
 *
 * Nothing here is built on a read-only or query-embed calendar.
 */

export type CalendarMenuCommandType =
    | "calendar-open-source"
    | "calendar-open-dialog"
    | "calendar-duplicate-next-day"
    | "calendar-resize"
    | "calendar-shift"
    | "calendar-delete";

export interface ICalendarMenuCommand {
    type: CalendarMenuCommandType;
    /** calendar-resize on a timed event: minutes added to the END. */
    delta?: number;
    /** calendar-resize on an all-day event / calendar-shift: whole days. */
    days?: number;
    /** calendar-shift on a timed event: minutes the whole event moves by. */
    minutes?: number;
    event: ICalendarNormalizedEvent;
    eventElement: HTMLElement;
}

/**
 * How render.ts is expected to route each command. Written down here because
 * getting `calendar-delete` wrong is the one way this menu could lose data:
 *
 *   calendar-open-source        -> openCalendarEventSource
 *   calendar-open-dialog        -> openCalendarEventDialog (getEditableEvent first)
 *   calendar-duplicate-next-day -> duplicateEventToNextDay (buildDuplicateNextDayDraft)
 *   calendar-resize             -> applyScopedEventDraft(..., "resize") with
 *                                  buildTimedDurationTransform / buildAllDayDurationTransform
 *   calendar-shift              -> applyScopedEventDraft(..., "move") with buildShiftTransform
 *   calendar-delete             -> the SAME scope-aware delete the dialog uses:
 *                                  openRecurrenceScopeDialog(action "delete") for a
 *                                  recurring item, then deleteCalendarEvent /
 *                                  deleteCalendarOccurrence. Deleting a recurring
 *                                  series without asking for scope would be data
 *                                  loss, and a plain delete must still remove the
 *                                  row only - never the page behind it.
 */

export interface ICalendarEventMenuOptions {
    event: ICalendarNormalizedEvent;
    eventElement: HTMLElement;
    /** Viewport coordinates the menu opens at. */
    clientX: number;
    clientY: number;
    onCommand(command: ICalendarMenuCommand): void;
}

const MENU_CLASS = "av__calendar-menu";
const MENU_MARGIN = 6;

interface IMenuItem {
    label: string;
    attributes: string;
    separated?: boolean;
    danger?: boolean;
}

export const closeCalendarEventMenu = () => {
    document.querySelectorAll(`.${MENU_CLASS}`).forEach(item => item.remove());
};

const shiftLabel = (amount: string, forward: boolean) => {
    const move = window.siyuan.languages.move || "Move";
    return `${move} ${forward ? "+" : "−"}${amount}`;
};

/**
 * The duration items move the END of the event, which is exactly what the old
 * inline -15m/+15m and -1d/+1d buttons did. "Until" is the same word the event
 * dialog uses for the end of a recurrence, so the menu does not need a new
 * language key to say "this changes where the event stops".
 */
const durationLabel = (amount: string, longer: boolean) => {
    const until = window.siyuan.languages.calendarUntil || "Until";
    return `${until} ${longer ? "+" : "−"}${amount}`;
};

const buildMenuItems = (event: ICalendarNormalizedEvent): IMenuItem[] => {
    const items: IMenuItem[] = [];
    if (getEventDocumentID(event)) {
        items.push({label: getOpenPageLabel(), attributes: 'data-type="calendar-open-source"'});
    }
    items.push({label: getOpenScheduleLabel(), attributes: 'data-type="calendar-open-dialog"'});
    items.push({
        label: window.siyuan.languages.copy || "Copy",
        attributes: 'data-type="calendar-duplicate-next-day"',
        separated: true,
    });
    if (event.isAllDay) {
        items.push({label: durationLabel("1d", false), attributes: 'data-type="calendar-resize" data-days="-1"', separated: true});
        items.push({label: durationLabel("1d", true), attributes: 'data-type="calendar-resize" data-days="1"'});
        items.push({label: shiftLabel("1d", false), attributes: 'data-type="calendar-shift" data-days="-1"', separated: true});
        items.push({label: shiftLabel("1d", true), attributes: 'data-type="calendar-shift" data-days="1"'});
    } else {
        items.push({label: durationLabel("15m", false), attributes: 'data-type="calendar-resize" data-delta="-15"', separated: true});
        items.push({label: durationLabel("15m", true), attributes: 'data-type="calendar-resize" data-delta="15"'});
        items.push({label: shiftLabel("15m", false), attributes: 'data-type="calendar-shift" data-minutes="-15"', separated: true});
        items.push({label: shiftLabel("15m", true), attributes: 'data-type="calendar-shift" data-minutes="15"'});
        items.push({label: shiftLabel("1d", false), attributes: 'data-type="calendar-shift" data-days="-1"'});
        items.push({label: shiftLabel("1d", true), attributes: 'data-type="calendar-shift" data-days="1"'});
    }
    items.push({
        label: window.siyuan.languages.delete || "Delete",
        attributes: 'data-type="calendar-delete"',
        separated: true,
        danger: true,
    });
    return items;
};

const readCommand = (item: HTMLElement, options: ICalendarEventMenuOptions): ICalendarMenuCommand | null => {
    const type = item.dataset.type as CalendarMenuCommandType;
    if (!type) {
        return null;
    }
    const command: ICalendarMenuCommand = {type, event: options.event, eventElement: options.eventElement};
    if (item.dataset.delta) {
        command.delta = parseInt(item.dataset.delta, 10);
    }
    if (item.dataset.days) {
        command.days = parseInt(item.dataset.days, 10);
    }
    if (item.dataset.minutes) {
        command.minutes = parseInt(item.dataset.minutes, 10);
    }
    return command;
};

/**
 * Open the menu. Self-contained popover in the style of quick-create.ts: it
 * owns its own listeners, closes on Escape / outside press / scroll / resize,
 * and returns focus to the chip it came from.
 */
export const openCalendarEventMenu = (options: ICalendarEventMenuOptions): HTMLElement => {
    closeCalendarEventMenu();
    // A menu and a drag must never be live at the same time.
    abortActiveCalendarGesture();
    const items = buildMenuItems(options.event);
    const menu = document.createElement("div");
    menu.className = MENU_CLASS;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", options.event.title || window.siyuan.languages.calendar || "Calendar");
    menu.innerHTML = items.map((item, index) => `<button class="${MENU_CLASS}-item${item.separated ? ` ${MENU_CLASS}-item--separated` : ""}${item.danger ? ` ${MENU_CLASS}-item--danger` : ""}" role="menuitem" tabindex="${index === 0 ? "0" : "-1"}" ${item.attributes}>${escapeHtml(item.label)}</button>`).join("");
    // Positioned inline rather than by stylesheet: the menu is anchored to a
    // pointer, and it must land in the right place even before _av.scss grows a
    // rule for it.
    menu.style.position = "fixed";
    menu.style.zIndex = "310";
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const left = Math.max(MENU_MARGIN, Math.min(options.clientX, window.innerWidth - rect.width - MENU_MARGIN));
    const top = Math.max(MENU_MARGIN, Math.min(options.clientY, window.innerHeight - rect.height - MENU_MARGIN));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const menuItems = Array.from(menu.querySelectorAll(`.${MENU_CLASS}-item`)) as HTMLElement[];
    let disposed = false;
    const dispose = (restoreFocus: boolean) => {
        if (disposed) {
            return;
        }
        disposed = true;
        document.removeEventListener("pointerdown", onOutsidePointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("resize", onViewportChange, true);
        window.removeEventListener("scroll", onViewportChange, true);
        menu.remove();
        if (restoreFocus && options.eventElement?.isConnected) {
            options.eventElement.focus({preventScroll: true});
        }
    };
    const focusItem = (index: number) => {
        if (menuItems.length === 0) {
            return;
        }
        const next = (index + menuItems.length) % menuItems.length;
        menuItems.forEach((item, itemIndex) => item.setAttribute("tabindex", itemIndex === next ? "0" : "-1"));
        menuItems[next].focus();
    };
    function onOutsidePointerDown(event: PointerEvent) {
        if (!menu.contains(event.target as Node)) {
            dispose(false);
        }
    }
    function onViewportChange() {
        dispose(false);
    }
    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dispose(true);
            return;
        }
        const currentIndex = menuItems.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowDown") {
            event.preventDefault();
            focusItem(currentIndex + 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            focusItem(currentIndex - 1);
        } else if (event.key === "Home") {
            event.preventDefault();
            focusItem(0);
        } else if (event.key === "End") {
            event.preventDefault();
            focusItem(menuItems.length - 1);
        } else if (event.key === "Tab") {
            // A popover menu does not leak focus into the page behind it.
            event.preventDefault();
            focusItem(currentIndex + (event.shiftKey ? -1 : 1));
        }
    }
    menu.addEventListener("click", (event: MouseEvent) => {
        const item = (event.target as HTMLElement).closest(`.${MENU_CLASS}-item`) as HTMLElement;
        if (!item) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const command = readCommand(item, options);
        dispose(false);
        if (command) {
            options.onCommand(command);
        }
    });
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange, true);
    window.addEventListener("scroll", onViewportChange, true);
    focusItem(0);
    return menu;
};

export interface ICalendarContextMenuOptions {
    calendarElement: HTMLElement;
    /** false on read-only / query-embed calendars: no menu is bound at all. */
    editable: boolean;
    resolveEvent(element: HTMLElement): ICalendarNormalizedEvent | undefined;
    onCommand(command: ICalendarMenuCommand): void;
}

/** How long a touch has to rest on a chip before it counts as a right-click. */
const LONG_PRESS_MS = 500;

/** How far that touch may drift before it is a drag instead. */
const LONG_PRESS_MOVE_PX = 8;

/**
 * Bind right-click and long-press on chips. Returns a disposer.
 */
export const bindCalendarEventContextMenu = (options: ICalendarContextMenuOptions): (() => void) => {
    const {calendarElement} = options;
    if (!calendarElement || !options.editable) {
        return () => undefined;
    }
    let longPressTimer = 0;
    let longPressPointer = -1;
    let longPressX = 0;
    let longPressY = 0;
    const cancelLongPress = () => {
        if (longPressTimer) {
            window.clearTimeout(longPressTimer);
            longPressTimer = 0;
        }
        longPressPointer = -1;
    };
    const openFor = (chip: HTMLElement, clientX: number, clientY: number) => {
        const event = options.resolveEvent(chip);
        if (!event) {
            return;
        }
        openCalendarEventMenu({
            event,
            eventElement: chip,
            clientX,
            clientY,
            onCommand: options.onCommand,
        });
    };
    const onContextMenu = (event: MouseEvent) => {
        const chip = (event.target as HTMLElement)?.closest(".av__calendar-event") as HTMLElement;
        if (!chip || chip.classList.contains("av__calendar-event--pending")) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        cancelLongPress();
        openFor(chip, event.clientX, event.clientY);
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
            return;
        }
        const chip = (event.target as HTMLElement)?.closest(".av__calendar-event") as HTMLElement;
        if (!chip || chip.classList.contains("av__calendar-event--pending")) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const rect = chip.getBoundingClientRect();
        openFor(chip, rect.left + Math.min(rect.width / 2, 24), rect.top + Math.min(rect.height, 24));
    };
    const onPointerDown = (event: PointerEvent) => {
        if (event.pointerType === "mouse") {
            return;
        }
        const chip = (event.target as HTMLElement)?.closest(".av__calendar-event") as HTMLElement;
        if (!chip || chip.classList.contains("av__calendar-event--pending")) {
            return;
        }
        cancelLongPress();
        longPressPointer = event.pointerId;
        longPressX = event.clientX;
        longPressY = event.clientY;
        longPressTimer = window.setTimeout(() => {
            longPressTimer = 0;
            openFor(chip, longPressX, longPressY);
        }, LONG_PRESS_MS);
    };
    const onPointerMove = (event: PointerEvent) => {
        if (!longPressTimer || event.pointerId !== longPressPointer) {
            return;
        }
        if (Math.hypot(event.clientX - longPressX, event.clientY - longPressY) > LONG_PRESS_MOVE_PX) {
            cancelLongPress();
        }
    };
    calendarElement.addEventListener("contextmenu", onContextMenu);
    calendarElement.addEventListener("keydown", onKeyDown);
    calendarElement.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", cancelLongPress);
    document.addEventListener("pointercancel", cancelLongPress);
    return () => {
        cancelLongPress();
        calendarElement.removeEventListener("contextmenu", onContextMenu);
        calendarElement.removeEventListener("keydown", onKeyDown);
        calendarElement.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", cancelLongPress);
        document.removeEventListener("pointercancel", cancelLongPress);
        closeCalendarEventMenu();
    };
};
