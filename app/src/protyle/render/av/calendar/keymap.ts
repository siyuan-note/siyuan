

/**
 * The calendar key map.
 *
 * Two halves that must not be confused:
 *   - `resolveCalendarCommand` is PURE. It takes a plain `{key, ctrlKey, ...}`
 *     record (a KeyboardEvent satisfies it structurally) and returns a command
 *     name. No DOM, no window, no side effects - so it is unit-testable from a
 *     bare node script.
 *   - `bindCalendarKeymap` is the only part that touches the DOM. It owns the
 *     focus scope, `preventDefault`, and the dispatch into the renderer's
 *     handlers.
 *
 * Focus scope: the old renderer bailed whenever the keydown target was
 * INPUT|SELECT|TEXTAREA|BUTTON. Every interactive element in the calendar is a
 * button, so the shortcuts died the moment anything was clicked. The real rule
 * is `shouldIgnoreCalendarKey`: bail only while the user is typing into a text
 * field (input / textarea / contenteditable), while a listbox has focus (a
 * <select> uses letter keys to pick options), or while a modal dialog is open.
 * Focus being *inside the calendar* is guaranteed by the listener living on the
 * calendar element itself.
 */

export type CalendarCommand =
    | "view-month"
    | "view-week"
    | "view-day"
    | "view-schedule"
    | "view-year"
    | "view-five-day"
    | "next-range"
    | "prev-range"
    | "today"
    | "create"
    | "search"

    | "next-event"
    | "prev-event"
    | "escape";

/** Structural subset of KeyboardEvent the resolver needs. */
export interface ICalendarKeyEvent {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
}

export interface ICalendarKeymapOptions {
    /**
     * Google Calendar maps `n` to "next period" and `c` to "create". SiYuan's
     * calendar has always mapped `N` to "new event" and several checks assert
     * that alias, so `n` stays "create" by default and `j` carries "next
     * period". Flip this to get the pure Google mapping.
     */
    nextRangeOnN?: boolean;
}

/** view mode indices as used by render.ts: 0 month, 1 week, 2 day, 3 schedule, 4 year, 5 five days. */
export const CALENDAR_VIEW_MODE_COMMANDS: CalendarCommand[] = ["view-month", "view-week", "view-day", "view-schedule", "view-year", "view-five-day"];

export const CALENDAR_VIEW_MODE_BY_COMMAND: { [key: string]: number } = {
    "view-month": 0,
    "view-week": 1,
    "view-day": 2,
    "view-schedule": 3,
    "view-year": 4,
    "view-five-day": 5,
};

/**
 * Advertised on the calendar region. Keep the legacy prefix intact - it is the
 * string the audit greps for.
 */
export const CALENDAR_ARIA_KEYSHORTCUTS = "ArrowLeft ArrowRight [ ] T N / Escape 1 2 3 4 5 6 D W M Y A X J K P C";

export const resolveCalendarCommand = (event: ICalendarKeyEvent, options: ICalendarKeymapOptions = {}): CalendarCommand | undefined => {
    if (!event || typeof event.key !== "string" || !event.key) {
        return undefined;
    }
    // Chords belong to the app, never to the calendar.
    if (event.ctrlKey || event.metaKey || event.altKey) {
        return undefined;
    }
    if (event.key === "ArrowLeft") {
        return "prev-range";
    }
    if (event.key === "ArrowRight") {
        return "next-range";
    }
    if (event.key === "[") {
        return "prev-event";
    }
    if (event.key === "]") {
        return "next-event";
    }
    if (event.key === "/") {
        return "search";
    }

    if (event.key === "Escape") {
        return "escape";
    }
    if (/^[1-6]$/.test(event.key)) {
        return CALENDAR_VIEW_MODE_COMMANDS[parseInt(event.key, 10) - 1];
    }
    if (event.key.toLowerCase() === "t") {
        return "today";
    }
    if (event.key.toLowerCase() === "n") {
        return options.nextRangeOnN ? "next-range" : "create";
    }
    if (event.key.toLowerCase() === "c") {
        return "create";
    }
    if (event.key.toLowerCase() === "d") {
        return "view-day";
    }
    if (event.key.toLowerCase() === "w") {
        return "view-week";
    }
    if (event.key.toLowerCase() === "m") {
        return "view-month";
    }
    if (event.key.toLowerCase() === "a") {
        return "view-schedule";
    }
    if (event.key.toLowerCase() === "y") {
        return "view-year";
    }
    if (event.key.toLowerCase() === "x") {
        return "view-five-day";
    }
    if (event.key.toLowerCase() === "j") {
        return "next-range";
    }
    if (event.key.toLowerCase() === "k" || event.key.toLowerCase() === "p") {
        return "prev-range";
    }
    return undefined;
};

/**
 * True while a keystroke belongs to something other than the calendar.
 * `ownerDocument` is injectable so this can be exercised without a real DOM.
 */
export const shouldIgnoreCalendarKey = (target: EventTarget | null, ownerDocument?: Document): boolean => {
    if (isCalendarModalOpen(ownerDocument)) {
        return true;
    }
    const element = target as HTMLElement;
    if (!element || typeof element.tagName !== "string") {
        return false;
    }
    if (element.isContentEditable) {
        return true;
    }
    // SELECT is here deliberately: a listbox consumes letter keys to jump to an
    // option, so "d" inside the filter dropdown must not switch to Day view.
    return ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName);
};

const isCalendarModalOpen = (ownerDocument?: Document): boolean => {
    if (typeof window !== "undefined" && window.siyuan?.dialogs?.length > 0) {
        return true;
    }
    const doc = ownerDocument || (typeof document === "undefined" ? undefined : document);
    return !!doc?.querySelector(".b3-dialog--open");
};

export interface ICalendarKeymapHandlers {
    /** 0 month, 1 week, 2 day, 3 schedule, 4 year, 5 five days. */
    setViewMode: (mode: number) => void;
    /** Page the main view by one visible range. */
    goToRange: (direction: 1 | -1) => void;
    goToToday: () => void;
    /** Must no-op on read-only / query-embed calendars. */
    createEvent: () => void;
    focusSearch: () => void;
    /** Jump to the previous/next event outside the visible range. */
    seekEvent: (direction: 1 | -1) => void;
    /**
     * Back out. Abort an in-flight pointer gesture FIRST, then clear the
     * search/filter. Return true when something was actually backed out so the
     * key is only swallowed when it did something.
     */
    escape: () => boolean;

}

/**
 * Binds the map to a calendar root. Returns an unbind function; call it from
 * the renderer's teardown so a re-render never stacks listeners.
 */
export const bindCalendarKeymap = (
    element: HTMLElement | null,
    handlers: ICalendarKeymapHandlers,
    options: ICalendarKeymapOptions = {},
): (() => void) => {
    if (!element) {
        return () => undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.isComposing || shouldIgnoreCalendarKey(event.target, element.ownerDocument)) {
            return;
        }
        const command = resolveCalendarCommand(event, options);
        if (!command) {
            return;
        }
        if (!runCalendarCommand(command, handlers)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    };
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
};

/** Dispatch one command. Returns false when the command declined to act. */
export const runCalendarCommand = (command: CalendarCommand, handlers: ICalendarKeymapHandlers): boolean => {
    if (command in CALENDAR_VIEW_MODE_BY_COMMAND) {
        handlers.setViewMode(CALENDAR_VIEW_MODE_BY_COMMAND[command]);
        return true;
    }
    if (command === "next-range") {
        handlers.goToRange(1);
        return true;
    }
    if (command === "prev-range") {
        handlers.goToRange(-1);
        return true;
    }
    if (command === "today") {
        handlers.goToToday();
        return true;
    }
    if (command === "create") {
        handlers.createEvent();
        return true;
    }
    if (command === "search") {
        handlers.focusSearch();
        return true;
    }
    if (command === "next-event") {
        handlers.seekEvent(1);
        return true;
    }
    if (command === "prev-event") {
        handlers.seekEvent(-1);
        return true;
    }

    // Escape only swallows the key when it really backed something out;
    // otherwise the app's own Escape handling must still run.
    return handlers.escape();
};
