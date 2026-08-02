#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => {
  console.error(`calendar audit failed: ${message}`);
  process.exit(1);
};

const requiredFiles = [
  "app/src/protyle/render/av/calendar/model.ts",
  "app/src/protyle/render/av/calendar/normalize.ts",
  "app/src/protyle/render/av/calendar/recurrence.ts",
  "app/src/protyle/render/av/calendar/ics.ts",
  "app/src/protyle/render/av/calendar/mapped-fields.ts",
  "app/src/protyle/render/av/calendar/recurrence-storage.ts",
  "app/src/protyle/render/av/calendar/transactions.ts",
  "app/src/protyle/render/av/calendar/render.ts",
  "app/src/protyle/render/av/calendar/event-dialog.ts",
  "app/src/protyle/render/av/layout.ts",
  // The Week/Day time grid moved out of render.ts (G1-G5). These files are part
  // of the audited frontend surface so the terms migrated below keep covering
  // real code instead of silently evaporating with the code that moved.
  "app/src/protyle/render/av/calendar/time-geometry.ts",
  "app/src/protyle/render/av/calendar/layout-overlap.ts",
  "app/src/protyle/render/av/calendar/time-grid.ts",
  "app/src/protyle/render/av/calendar/now-indicator.ts",
  // The chip markup, the right-click menu, the key map, the mini month and the
  // human-readable recurrence summary each moved into their own module. They are
  // part of the audited frontend surface for the same reason the grid modules
  // are: terms migrated out of render.ts have to keep covering real code.
  "app/src/protyle/render/av/calendar/event-chip.ts",
  "app/src/protyle/render/av/calendar/context-menu.ts",
  "app/src/protyle/render/av/calendar/keymap.ts",
  "app/src/protyle/render/av/calendar/mini-month.ts",
  "app/src/protyle/render/av/calendar/recurrence-summary.ts",
  "app/src/layout/dock/Calendar.ts",
  "app/src/layout/dock/index.ts",
  "app/src/layout/util.ts",
  "scripts/calendar-kernel-smoke.mjs",
  "scripts/calendar-recurrence-smoke.mjs",
  "scripts/calendar-ics-import-smoke.mjs",
  "scripts/calendar-transactions-smoke.mjs",
  "scripts/calendar-electron-launch-smoke.mjs",
  "scripts/calendar-electron-document-flow-smoke.mjs",
];

for (const file of requiredFiles) {
  if (!exists(file)) {
    fail(`missing required file ${file}`);
  }
}

const frontendCode = Object.fromEntries(requiredFiles.map((file) => [file, read(file)]));
for (const term of ["searchAttributeView", "renderAttributeView", "normalizeCalendarEvents", "LOCAL_CALENDAR_DOCK", "select-source"]) {
  if (!frontendCode["app/src/layout/dock/Calendar.ts"].includes(term)) {
    fail(`calendar dock missing ${term}`);
  }
}
for (const [file, term] of [["app/src/layout/dock/index.ts", 'case "calendar"'], ["app/src/layout/util.ts", "ensureCalendarDock"], ["app/src/layout/dock/Calendar.ts", "setStorageVal"]]) {
  if (!frontendCode[file].includes(term)) {
    fail(`calendar dock registry missing ${term}`);
  }
}
const joinedFrontendCode = requiredFiles
  .filter((file) => file.startsWith("app/src/"))
  .map((file) => frontendCode[file])
  .join("\n");

const expectedFeatureTerms = [
  "createCalendarEvent",
  "updateCalendarEvent",
  "deleteCalendarEvent",
  "createCalendarEventReplacingOccurrence",
  "updateCalendarEventThisAndFuture",
  "deleteCalendarOccurrence",
  "expandRecurrences",
  "parseRecurrence",
  "parseICSCalendar",
  "calendar-import-ics",
  "ensureCalendarRecurrenceStorage",
  "calendar-search",
  "calendar-filter",
  "calendar-clear-search",

  "tabindex=\"0\"",
  // Existing navigation/action shortcuts stay available while all six view
  // shortcuts are advertised on the calendar region.
  "\"ArrowLeft ArrowRight [ ] T N / Escape 1 2 3 4 5 6 D W M Y A X J K P C\"",
  "role=\"region\"",
  "calendar-view-menu",
  "calendar-drop-day",
  "dblclick",
  "calendar-resize",
  "calendar-duplicate-next-day",
  "event-open-block",
  "openEventBlock",
  "getEventTooltip",
  "data-days",
  // was computeTimedEventColumns in render.ts, now the pure packer in layout-overlap.ts
  "packTimedEventColumns",
  "packAllDayLanes",
  "getCalendarTimeGeometry",
  "renderCalendarTimeGrid",
  "mountCalendarNowIndicator",
  "av__calendar-now-indicator",
  "calendar-time-create",
  "calendar-resize-handle",
  "calendar-more",
  "isTitleFallback",
  "av__calendar-day--selected",
];

const missingFeatureTerms = expectedFeatureTerms.filter((term) => !joinedFrontendCode.includes(term));
if (missingFeatureTerms.length > 0) {
  fail(`missing feature terms: ${missingFeatureTerms.join(", ")}`);
}

const languageCodeFiles = [
  "app/src/protyle/render/av/calendar/render.ts",
  "app/src/protyle/render/av/calendar/event-dialog.ts",
  // Everything that moved out of render.ts and still names calendar* keys. The
  // keys have to keep existing in every bundled language, or the UI that moved
  // would start showing English fallbacks in a translated build.
  "app/src/protyle/render/av/calendar/event-chip.ts",
  "app/src/protyle/render/av/calendar/context-menu.ts",
  "app/src/protyle/render/av/calendar/keymap.ts",
  "app/src/protyle/render/av/calendar/mini-month.ts",
  "app/src/protyle/render/av/calendar/recurrence-summary.ts",
  "app/src/protyle/render/av/calendar/quick-create.ts",
  "app/src/protyle/render/av/layout.ts",
];
const calendarLanguageKeys = new Set();
for (const file of languageCodeFiles) {
  const text = read(file);
  // Two access shapes: the direct `window.siyuan.languages.calendarX` and the
  // `lang("calendarX", "fallback")` helper the newer modules use. Only matching
  // the first would let a whole module's keys go unchecked.
  for (const match of text.matchAll(/window\.siyuan\.languages\.([A-Za-z0-9_]+)/g)) {
    if (match[1].startsWith("calendar")) {
      calendarLanguageKeys.add(match[1]);
    }
  }
  for (const match of text.matchAll(/\blang\("([A-Za-z0-9_]+)"/g)) {
    if (match[1].startsWith("calendar")) {
      calendarLanguageKeys.add(match[1]);
    }
  }
}

const langDir = path.join(root, "app/appearance/langs");
for (const file of fs.readdirSync(langDir).filter((item) => item.endsWith(".json")).sort()) {
  const langPath = path.join(langDir, file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(langPath, "utf8"));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
  }
  const missing = [...calendarLanguageKeys].filter((key) => !(key in data));
  if (missing.length > 0) {
    fail(`${file} missing language keys: ${missing.join(", ")}`);
  }
  if (!data._attrView || data._attrView.calendar !== data.calendar) {
    fail(`${file} missing _attrView.calendar backend layout label`);
  }
}

const renderEntry = read("app/src/protyle/render/av/render.ts");
if (!renderEntry.includes("renderCalendar") || !renderEntry.includes('data.viewType === "calendar"')) {
  fail("AV render entry does not dispatch calendar rendering");
}

const calendarRender = read("app/src/protyle/render/av/calendar/render.ts");
if (/if \(sourceEvent\.isOccurrence\)\s*{\s*draft\.recurrenceRaw = ""/.test(calendarRender)) {
  fail("quick-copy should always clear recurrence data, not only copied occurrences");
}
for (const term of [
  "hasClosestByAttribute(options.blockElement, \"data-type\", \"NodeBlockQueryEmbed\")",
  "hasClosestByAttribute(e, \"data-type\", \"NodeBlockQueryEmbed\")",
  // draggable / av__calendar-event--readonly moved into event-chip.ts with the
  // chip markup and are asserted against that file below (calendarEventChip).
  "${editable ? \"\" : \" disabled\"}",
  "window.siyuan.languages._kernel[258]",
]) {
  if (!calendarRender.includes(term)) {
    fail(`calendar render missing read-only/error guard term: ${term}`);
  }
}

for (const term of [
  "renderDateFieldSetup",
  "calendar-empty-date-field",
  "calendar-create-date-field",
  "setAttrViewCalendarDateField",
  "addAttrViewCol",
  "renderMonth",
  "renderWeek",
  "renderDay",
  "renderList",
  "getAgendaRange",
  "calendar-list-more",
  "dataset.calendarAgendaDays",
  "anchor.add(29, \"day\")",
  // The week/day "today" markers moved into time-grid.ts with the grid itself;
  // they are asserted against that file below (calendarTimeGrid).
  "av__calendar-list-day${cursor.isSame(dayjs(), \"day\") ? \" av__calendar-day--today\" : \"\"}",

  "data-date=\"${cursor.format(\"YYYY-MM-DD\")}\" data-type=\"calendar-drop-day\"",
  "getSafeViewMode",
  "getCalendarViewMode",
  "blockElement.dataset.calendarViewMode",
  "getVisibleRange",
  "getCalendarTitle",
  "getEventSeekRange",
  "seekEvent",
  "normalizeCalendarEvents(calendar, mapping, getEventSeekRange(anchor)).events",
  "event.start.isAfter(anchor, \"day\")",
  "event.start.isBefore(anchor, \"day\")",
  "showMessage(window.siyuan.languages.calendarNoMatchingEvent",
  // getEventDateLabel / the tooltip attributes / the recurrence marker moved
  // into event-chip.ts with the chip markup (calendarEventChip block below).
  "setCalendarAnchor",
  "getCurrentAnchor",
  "setCalendarViewMode",
  "options.blockElement.dataset.calendarViewMode = String(mode)",
  "delete options.blockElement.dataset.calendarViewMode",
  "data-type=\"calendar-view-menu\"",
  "aria-haspopup=\"menu\"",
  "CALENDAR_VIEW_MENU_ITEMS",
  "accelerator: \"D\"",
  "accelerator: \"W\"",
  "accelerator: \"M\"",
  "accelerator: \"Y\"",
  "accelerator: \"A\"",
  "accelerator: \"X\"",
  "aria-keyshortcuts=\"ArrowLeft\"",
  "aria-keyshortcuts=\"ArrowRight\"",
  "aria-keyshortcuts=\"T\"",
  "aria-keyshortcuts=\"N\"",
  "aria-keyshortcuts=\"/\"",
  "aria-keyshortcuts=\"Escape\"",
  "aria-label=\"${escapeAttr(`${window.siyuan.languages.calendar || \"Calendar\"} ${title}`)}\"",

  // The keydown block itself moved into keymap.ts; what render.ts still owns is
  // the binding and the handler wiring. Every key literal that used to be
  // asserted here is asserted against keymap.ts below (calendarKeymap).
  "bindCalendarKeymap(calendarElement, {",
  "setViewMode: (mode: number) => setCalendarViewMode(mode)",
  "goToRange: (direction) => setCalendarAnchor(getNavDate(getCurrentAnchor(), viewMode, direction))",
  "goToToday: () => setCalendarAnchor(dayjs())",
  "seekEvent: (direction) => seekEvent(direction)",
  "escape: backOutOfCalendar",
  "isCalendarGestureActive()",
  "abortActiveCalendarGesture()",
  "addCalendarTeardown",
  "runCalendarTeardowns(options.blockElement)",
  "eventMatchesSearch",
  "getCalendarSearch",
  "getCalendarFilter",
  "eventMatchesCalendarFilter",
  "const filteredEvents = normalized.events.filter(event => eventMatchesCalendarFilter(event, filter))",
  "const totalEventCount = normalized.events.length",
  "const hasActiveQuery = !!search || filter !== \"all\"",
  "renderCalendarFilter(filter, searchFilterID)",
  "data-type=\"calendar-search-dropdown\"",
  "data-type=\"calendar-filter-option\"",
  "role=\"menuitemradio\"",
  "searchInput?.addEventListener(\"click\", openSearchDropdown)",
  "setSearchDropdownOpen(false)",
  "options.blockElement.dataset.calendarFilter = filter",
  "delete options.blockElement.dataset.calendarFilter",
  "av__calendar-search-count",
  "const totalEventCount = normalized.events.length",
  "delete options.blockElement.dataset.calendarSearch",
  "getCalendarSearchResultRange",
  "const hasSearchQuery = !!search || !!databaseQuery.trim()",
  "hasSearchQuery ? renderList(range, events, true, editable)",
  "window.setTimeout(() => rerender(true), Constants.TIMEOUT_INPUT)",
  "calendarSearch",
  "getSafeWeekStart",
  "startOfCalendarWeek",
  "weekStart",
  "dragOffsetDays",
  "deltaDays",
  "displayDate",
  "buildDraftForDate",
  "duplicateEventToNextDay",
  "draft.recurrenceRaw = \"\"",
  "draft.recurrenceExceptionRaw = \"\"",
  // The Copy label moved with the action into context-menu.ts (asserted below).
  // Duplication must await whichever creation route the view selects.
  "const saved = createsDocuments ?",
  "createCalendarEventAsDocument({...createOptions",
  "await createCalendarEvent(createOptions)",
  "getEditableEvent",
  "readOnly: true",
  ".av__calendar-event, [data-type='calendar-new']",
  // The chip's inline buttons became menu commands; render.ts must still route
  // every one of them through the guarded write paths.
  "renderCalendarEventChip({",
  "bindCalendarEventContextMenu({",
  "runCalendarMenuCommand",
  "command.type === \"calendar-duplicate-next-day\"",
  "command.type === \"calendar-resize\"",
  "command.type === \"calendar-shift\"",
  "command.type === \"calendar-delete\"",
  "applyCalendarDurationChange",
  "shiftCalendarEvent",
  "requestCalendarEventDelete",
  "deleteCalendarEventWithScope",
  "getDisabledRecurrenceScopes(mapping, \"delete\", sourceEvent)",
  "action: \"delete\",",
  // The mini month stays bound and anchored on a click; event-day collection is
  // reserved for the Year view, not rendered as dots in the left navigator.
  "bindCalendarMiniMonth(",
  "getCalendarMiniMonthEventDays(events)",
  "onSelectDate: (date) => setCalendarAnchor(date)",
  "calendar-mini-month-wrapper",
  "av__calendar-sidebar",
  "av__calendar-main",
]) {
  if (!calendarRender.includes(term)) {
    fail(`calendar render flow missing ${term}`);
  }
}

// --- Week/Day time grid (migrated out of render.ts) --------------------------
// Everything here used to be asserted against render.ts; it moved wholesale into
// the four grid modules, so the assertions moved with it rather than being
// deleted. Grid *behaviour* is verified by scripts/calendar-time-grid-smoke.mjs.
const calendarTimeGeometry = read("app/src/protyle/render/av/calendar/time-geometry.ts");
for (const term of [
  "CALENDAR_SNAP_MINUTES = 15",
  "CALENDAR_MINIMUM_EVENT_MINUTES = 15",
  "CALENDAR_BUSINESS_START_MINUTE",
  "CALENDAR_BUSINESS_END_MINUTE",
  "minutesToPx",
  "pxToMinutes",
  "snapMinutes",
  "getNowOffsetPx",
  "getEventMinuteRange",
]) {
  if (!calendarTimeGeometry.includes(term)) {
    fail(`calendar time geometry missing ${term}`);
  }
}

const calendarLayoutOverlap = read("app/src/protyle/render/av/calendar/layout-overlap.ts");
for (const term of [
  "packTimedEventColumns",
  "packAllDayLanes",
  "CALENDAR_MINIMUM_EVENT_WIDTH_PERCENT",
  "columnSpan",
  "leftPercent",
  "widthPercent",
]) {
  if (!calendarLayoutOverlap.includes(term)) {
    fail(`calendar overlap packing missing ${term}`);
  }
}

const calendarTimeGrid = read("app/src/protyle/render/av/calendar/time-grid.ts");
for (const term of [
  "renderCalendarTimeGrid",
  "av__calendar-time-grid",
  "av__calendar-grid-header",
  "av__calendar-allday-row",
  "av__calendar-allday-bar",
  "av__calendar-time-gutter",
  "av__calendar-time-day",
  "av__calendar-timed-event",
  "av__calendar-day-header",
  "data-type=\"calendar-drop-day\"",
  "calendar-time-create",
  "calendar-resize-handle",
  "data-view-kind",
  "data-start-minute",
  // migrated from render.ts: the week/day "today" and read-only markers
  "const isToday = day.isSame(dayjs(), \"day\")",
  "isToday ? \"av__calendar-day--today\" : \"\"",
  "isToday ? ' aria-current=\"date\"' : \"\"",
  "options.editable ? \"\" : \" disabled\"",
  // read-only calendars get no create surface at all
  "options.editable ?",
]) {
  if (!calendarTimeGrid.includes(term)) {
    fail(`calendar time grid missing ${term}`);
  }
}

const calendarNowIndicator = read("app/src/protyle/render/av/calendar/now-indicator.ts");
for (const term of [
  "mountCalendarNowIndicator",
  "unmountCalendarNowIndicator",
  "av__calendar-now-indicator",
  "window.clearInterval",
  "hasRestoredScroll",
]) {
  if (!calendarNowIndicator.includes(term)) {
    fail(`calendar now indicator missing ${term}`);
  }
}

// --- Chip anatomy (migrated out of render.ts's eventButtonHTML) --------------
// The chip lost its permanent inline buttons. Everything else it carried has to
// survive byte-for-byte, because the whole app and the smoke suite read the
// calendar off these attributes.
const calendarInteractions = read("app/src/protyle/render/av/calendar/interactions.ts");
for (const term of [
  "placeTimedEventPreview",
  "restoreEventPreview",
  'if (gesture.kind === \"sweep\")',
  "placeGhost(gesture, \"timed\", rect, label)",
  "placeTimedEventPreview(gesture, rect)",
]) {
  if (!calendarInteractions.includes(term)) {
    fail(`calendar interaction preview missing ${term}`);
  }
}

const calendarEventChip = read("app/src/protyle/render/av/calendar/event-chip.ts");
for (const term of [
  "renderCalendarEventChip",
  "CalendarChipVariant",
  "\"month\", \"list\", \"timed\", \"all-day\"",
  "getEventTooltip",
  "getEventDateLabel",
  "title=\"${escapeAttr(eventTooltip)}\"",
  "aria-label=\"${escapeAttr(eventTooltip)}\"",
  "window.siyuan.languages.calendarOccurrence || \"Recurring occurrence\"",
  "draggable=\"${editable ? \"true\" : \"false\"}\"",
  "av__calendar-event--readonly",
  "av__calendar-event--page",
  "av__calendar-event-title",
  "av__calendar-event-time",
  "av__calendar-event-meta",
  "data-duration-minutes",
  "buildOptimisticChip",
  "av__calendar-event--pending",
  "buildCalendarGhost",
]) {
  if (!calendarEventChip.includes(term)) {
    fail(`calendar event chip missing ${term}`);
  }
}
// The chip must NOT grow permanent inline controls again: that is the defect
// this module exists to fix.
for (const term of [">-15m<", ">+15m<", ">-1d<", ">+1d<", "av__calendar-resize\" data-type"]) {
  if (calendarEventChip.includes(term)) {
    fail(`calendar event chip must no longer carry inline text buttons: ${term}`);
  }
}
for (const term of ["av__calendar-schedule", "calendar-open-dialog"]) {
  if (calendarEventChip.includes(term)) {
    fail(`calendar event chip must hide permanent action affordances: ${term}`);
  }
}
for (const term of ["const recurrenceMarker", 'event.isOccurrence ? "O" : "R"', "av__calendar-recurring"]) {
  if (calendarEventChip.includes(term)) {
    fail(`calendar event chip must not expose internal recurrence tags: ${term}`);
  }
}
if (calendarEventChip.includes("av__calendar-event-dot")) {
  fail("calendar event chip must not render a leading colour dot beside event names");
}

// --- Chip context menu (where those inline buttons went) ---------------------
const calendarContextMenu = read("app/src/protyle/render/av/calendar/context-menu.ts");
for (const term of [
  "bindCalendarEventContextMenu",
  "openCalendarEventMenu",
  "closeCalendarEventMenu",
  "av__calendar-menu",
  "setAttribute(\"role\", \"menu\")",
  "role=\"menuitem\"",
  // Same data-type contract the inline buttons used, so the renderer's handlers
  // and the assertions that drive them keep working from the new place.
  "data-type=\"calendar-open-source\"",
  "data-type=\"calendar-open-dialog\"",
  "data-type=\"calendar-duplicate-next-day\"",
  "data-type=\"calendar-resize\" data-days=\"-1\"",
  "data-type=\"calendar-resize\" data-days=\"1\"",
  "data-type=\"calendar-resize\" data-delta=\"-15\"",
  "data-type=\"calendar-resize\" data-delta=\"15\"",
  "data-type=\"calendar-shift\"",
  "data-type=\"calendar-delete\"",
  "window.siyuan.languages.copy || \"Copy\"",
  "window.siyuan.languages.delete || \"Delete\"",
  // Read-only / query-embed calendars never get a menu at all.
  "if (!calendarElement || !options.editable)",
  "contextmenu",
  "LONG_PRESS_MS",
  "abortActiveCalendarGesture()",
  "event.key === \"Escape\"",
]) {
  if (!calendarContextMenu.includes(term)) {
    fail(`calendar context menu missing ${term}`);
  }
}

// --- Key map (migrated out of render.ts's keydown block) ---------------------
// Every key literal below used to be asserted against render.ts. The block moved
// wholesale into keymap.ts, so the assertions moved with it instead of being
// deleted; the Google keys are additions on top.
const calendarKeymap = read("app/src/protyle/render/av/calendar/keymap.ts");
for (const term of [
  "bindCalendarKeymap",
  "resolveCalendarCommand",
  "shouldIgnoreCalendarKey",
  "element.addEventListener(\"keydown\"",
  "element.removeEventListener(\"keydown\"",
  "event.key === \"ArrowLeft\"",
  "event.key === \"ArrowRight\"",
  "event.key === \"[\"",
  "event.key === \"]\"",
  "event.key.toLowerCase() === \"t\"",
  "event.key.toLowerCase() === \"n\"",
  "event.key === \"/\"",
  "event.key === \"Escape\"",
  "/^[1-6]$/.test(event.key)",
  "CALENDAR_VIEW_MODE_BY_COMMAND[command]",
  // Google Calendar's map, added alongside the legacy one.
  "event.key.toLowerCase() === \"d\"",
  "event.key.toLowerCase() === \"w\"",
  "event.key.toLowerCase() === \"m\"",
  "event.key.toLowerCase() === \"x\"",
  "event.key.toLowerCase() === \"j\"",
  "event.key.toLowerCase() === \"c\"",
  "CALENDAR_ARIA_KEYSHORTCUTS",
  "\"ArrowLeft ArrowRight [ ] T N / Escape 1 2 3 4 5 6 D W M Y A X J K P C\"",
  // The focus-scope fix: BUTTON is gone from the bail list, so a click no longer
  // kills every shortcut.
  "[\"INPUT\", \"SELECT\", \"TEXTAREA\"].includes(element.tagName)",
  "isContentEditable",
  "isCalendarModalOpen",

]) {
  if (!calendarKeymap.includes(term)) {
    fail(`calendar keymap missing ${term}`);
  }
}
if (calendarKeymap.includes("\"BUTTON\"")) {
  fail("calendar keymap must not bail on BUTTON again: every calendar control is a button");
}

// --- Mini month navigator ----------------------------------------------------
const calendarMiniMonth = read("app/src/protyle/render/av/calendar/mini-month.ts");
for (const term of [
  "renderCalendarMiniMonth",
  "bindCalendarMiniMonth",
  "getCalendarMiniMonthEventDays",
  "getMiniMonthDays",
  "av__calendar-mini",
  "av__calendar-mini-header",
  "av__calendar-mini-title",
  "av__calendar-mini-weekdays",
  "av__calendar-mini-grid",
  "av__calendar-mini-day",
  "av__calendar-mini-day--outside",
  "av__calendar-mini-day--in-range",
  "av__calendar-mini-day--selected",
  "av__calendar-mini-day--today",
  "av__calendar-mini-day-number",
  "calendar-mini-prev",
  "calendar-mini-next",
  "calendar-mini-day",
  // Paging repaints only the navigator; only a day click moves the main view.
  "handlers.onSelectDate(dayjs(target.dataset.date))",
  "container.removeEventListener(\"click\", onClick)",
]) {
  if (!calendarMiniMonth.includes(term)) {
    fail(`calendar mini month missing ${term}`);
  }
}

// --- Human-readable recurrence summary (wired into the event dialog) ---------
const calendarRecurrenceSummary = read("app/src/protyle/render/av/calendar/recurrence-summary.ts");
for (const term of [
  "describeRecurrence",
  "detectRecurrencePreset",
  "getRecurrencePresetRule",
  "renderRecurrencePresetOptions",
  "isAdvancedRecurrence",
  "calendarDoesNotRepeat",
  "calendarRepeatWeeklyOn",
  "calendarRepeatUntilSuffix",
  "calendarRepeatCountSuffix",
]) {
  if (!calendarRecurrenceSummary.includes(term)) {
    fail(`calendar recurrence summary missing ${term}`);
  }
}
for (const term of ["describeRecurrence", "renderRecurrencePresetOptions", "detectRecurrencePreset"]) {
  if (!read("app/src/protyle/render/av/calendar/event-dialog.ts").includes(term)) {
    fail(`event dialog must use the human-readable recurrence summary: ${term}`);
  }
}

const eventDialog = read("app/src/protyle/render/av/calendar/event-dialog.ts");
if (/recurrenceRaw:\s*options\.event\?\.isOccurrence\s*\?/.test(eventDialog)) {
  fail("dialog duplicate should always clear recurrence data");
}
for (const term of [
  "showInvalidDraftMessage",
  "window.siyuan.languages.calendarNeedDateField",
  "window.siyuan.languages.invalid",
  "recurrenceRaw: \"\"",
  "recurrenceExceptionRaw: \"\"",
  "const editsSeries = !!event?.isOccurrence && !mapping.exceptionFieldID",
  "window.siyuan.languages.calendarEditSeriesNotice",
  "event?.blockID ? `<button type=\"button\" class=\"b3-button b3-button--text b3-form__space av__calendar-event-source\" data-type=\"event-open-block\"",
  "readOnly?: boolean",
  "const readOnly = !!options.readOnly",
  "isEditing && !readOnly",
  "if (options.readOnly)",
  "openFileById({",
  "openMobileFileById(options.protyle.app, blockID, [Constants.CB_GET_FOCUS])",
  "dialog.destroy();",
]) {
  if (!eventDialog.includes(term)) {
    fail(`event dialog missing validation feedback term: ${term}`);
  }
}

const recurrenceCode = read("app/src/protyle/render/av/calendar/recurrence.ts");
for (const term of [
  "str === \"NONE\"",
  "const supportedKeys = [\"FREQ\", \"INTERVAL\", \"COUNT\", \"UNTIL\", \"BYDAY\"]",
  "seenKeys.has(key)",
  "parseDateStrict",
  "until.endOf(\"day\")",
  "new Set(byDay).size !== byDay.length",
  "result.byDay?.length && result.freq !== \"WEEKLY\"",
  "event.recurrence.count && index >= event.recurrence.count",
  "event.recurrence.until && occurrenceStart.isAfter(event.recurrence.until)",
  "event.recurrenceExceptions?.includes(date.format(\"YYYY-MM-DD\"))",
]) {
  if (!recurrenceCode.includes(term)) {
    fail(`recurrence support missing ${term}`);
  }
}

const normalizeCode = read("app/src/protyle/render/av/calendar/normalize.ts");
for (const term of [
  "parseRecurrenceExceptions",
  "normalizeExceptionDate",
  "Array.from(new Set",
  "dateTimeMatch",
  "end.isBefore(start)",
]) {
  if (!normalizeCode.includes(term)) {
    fail(`calendar normalization missing ${term}`);
  }
}

const transactionsCode = read("app/src/protyle/render/av/calendar/transactions.ts");
for (const term of [
  "isRealDateInputValue(options.draft.date)",
  "getTimeInputValue",
  "end = start.add(1, \"hour\")",
  "JSON.stringify(options.oldValue) === JSON.stringify(options.newValue)",
  "undoEmptyWhenMissing",
  "buildOccurrenceExceptionOperations",
  "existing.sort()",
  "recurrenceWithUntil",
  "recurrenceForSplitFuture",
  "buildCreateEventOperations",
  "buildUpdateEventOperations",
  "buildDeleteEventOperations",
  "createCalendarEventReplacingOccurrence",
  "[...exceptionOps.doOperations, ...createOps.doOperations]",
  "[...createOps.undoOperations, ...exceptionOps.undoOperations]",
  "return true;",
]) {
  if (!transactionsCode.includes(term)) {
    fail(`calendar transactions missing ${term}`);
  }
}

const layoutCode = read("app/src/protyle/render/av/layout.ts");
for (const term of ["setAttrViewCalendarDateField", "setAttrViewCalendarWeekStart"]) {
  if (!layoutCode.includes(term)) {
    fail(`layout menu missing ${term}`);
  }
}
for (const term of [
  "calendar-visible-field",
  "calendar-add-visible-field",
  "calendar-new-field-name",
  "setAttrViewColHidden",
  "addAttrViewCol",
]) {
  if (!layoutCode.includes(term)) {
    fail(`calendar layout missing configurable field control: ${term}`);
  }
}
const eventDialogCode = read("app/src/protyle/render/av/calendar/event-dialog.ts");
for (const term of ["ensureRecurrenceStorage", "calendar-recurrence-end", "calendar-field-value"]) {
  if (!eventDialogCode.includes(term)) {
    fail(`calendar dialog missing direct recurrence or dynamic field support: ${term}`);
  }
}
const recurrenceStorageCode = read("app/src/protyle/render/av/calendar/recurrence-storage.ts");
for (const term of ["__calendar_recurrence", "__calendar_recurrence_exceptions", "renderAttributeView"]) {
  if (!recurrenceStorageCode.includes(term)) {
    fail(`calendar recurrence storage missing persisted read-back support: ${term}`);
  }
}

const mappedFieldsCode = read("app/src/protyle/render/av/calendar/mapped-fields.ts");
for (const term of [
  "getMappedFieldID",
  "allowedTypes.includes(field.type)",
  "const recurrenceFieldID = takeTextField",
  "getMappedFieldID(calendarData, persisted.colorFieldID, [\"select\", \"mSelect\"])",
  "const hasDateField = !!persistedDateFieldID && calendarData.fields.some(field => field.id === persistedDateFieldID && field.type === \"date\")",
]) {
  if (!mappedFieldsCode.includes(term)) {
    fail(`mapped field guard missing ${term}`);
  }
}

const transactionDispatcher = read("kernel/model/transaction.go");
for (const term of [
  "setAttrViewCalendarDateField",
  "setAttrViewCalendarViewMode",
  "setAttrViewCalendarWeekStart",
  "setAttrViewCalendarFieldMapping",
]) {
  if (!transactionDispatcher.includes(term)) {
    fail(`transaction dispatcher missing ${term}`);
  }
}

const backendCalendar = read("kernel/model/attribute_view.go");
for (const term of [
  "calendarDateFieldFromOperationData",
  "calendarViewModeFromOperationData",
  "calendarWeekStartFromOperationData",
  "calendarFieldMappingFromOperationData",
  "validateCalendarFieldMappingUnique",
  "validateCalendarMappingField",
  "av.KeyTypeSelect, av.KeyTypeMSelect",
  "removeCalendarFieldReferences",
]) {
  if (!backendCalendar.includes(term)) {
    fail(`backend calendar support missing ${term}`);
  }
}

const backendTests = read("kernel/model/attribute_view_calendar_test.go");
for (const term of [
  "TestCalendarDateFieldFromOperationData",
  "TestCalendarWeekStartFromOperationData",
  "TestCalendarViewModeFromOperationData",
  "TestCalendarFieldMappingFromOperationDataMergesExisting",
  "TestRemoveCalendarFieldReferences",
  "duplicate text metadata fields should be rejected",
  "color mapping may reuse text metadata field IDs",
  "empty update should clear only requested mapping",
]) {
  if (!backendTests.includes(term)) {
    fail(`backend calendar test missing ${term}`);
  }
}

const avStyles = read("app/src/assets/scss/business/_av.scss");
for (const term of [
  ".av__calendar",
  "min-width: 320px",
  "&:focus-visible",
  "outline: 2px solid var(--b3-theme-primary)",
  "&-toolbar",
  "flex-wrap: wrap",
  "&-jump",
  "flex: 1 1 180px",
  "&-search-count",
  "&-search-control",
  "&-search-toggle",
  "&-search-dropdown",
  "&-month",
  "&-event",
  "&--readonly",
  "&-resize",
  "&-recurrence",
  "&-week",
  // &-day-view is gone: Week and Day are one renderer, so the day view is the
  // same sticky grid. Its chrome is what the style now has to prove exists.
  "&-day-header",
  "&-grid-header",
  "&-allday-row",
  "&-time-gutter",
  "&-time-create",
  "&-now-indicator",
  "&-list",
  // Chip anatomy after the inline buttons were removed.
  "&--timed",
  "&--all-day",
  "&--month,",
  // The right-click menu the inline buttons became.
  "&-menu {",
  "&-menu-item",
  "&--separated",
  "&--danger",
  // The "?" shortcut sheet.
  "&-shortcuts",
  "&-shortcuts-section",
  "&-shortcuts-title",
  "&-shortcuts-row",
  "&-shortcuts-keys",
  "&-shortcuts-label",
  "kbd {",
  // The mini month and the sidebar it lives in.
  "&-mini {",
  "&-mini-header",
  "&-mini-title",
  "&-mini-weekdays",
  "&-mini-grid",
  "&-mini-day",
  "&--outside",
  "&--in-range",
  "&--selected",
  "&--today",
  "&-mini-day-number",
  "&-sidebar",
  "&-main",
  // The mini calendar remains visible beside the main calendar.
  "container-type: inline-size",
  "&-sidebar",
  "display: block",
]) {
  if (!avStyles.includes(term)) {
    fail(`calendar styles missing ${term}`);
  }
}
if (avStyles.includes("&-event-dot")) {
  fail("calendar styles must not restore the leading event-name dot");
}

const kernelSmoke = read("scripts/calendar-kernel-smoke.mjs");
for (const term of [
  "go\", [\"build\", \"-tags\", \"fts5\"",
  "\"/api/notebook/createNotebook\"",
  "\"/api/filetree/createDocWithMd\"",
  "\"/api/av/changeAttrViewLayout\"",
  "\"setAttrViewCalendarDateField\"",
  "\"setAttrViewCalendarFieldMapping\"",
  "recurrenceFieldID",
  "exceptionFieldID",
  "locationFieldID",
  "descriptionFieldID",
  "colorFieldID",
  "selectCellValue",
  "calendar kernel smoke passed",
  "SIYUAN_CALENDAR_KEEP_SMOKE_WORKSPACE",
]) {
  if (!kernelSmoke.includes(term)) {
    fail(`calendar kernel smoke missing ${term}`);
  }
}

const report = read("CALENDAR_REBUILD_REPORT.md");
for (const term of [
  "Completion Evidence / Manual Acceptance",
  "Switching the AV renderer to Calendar without crashing.",
  "Read-only/query-embed mutation guards, while still allowing event inspection and local view-mode switching.",
  "Isolated launch smoke also passed without touching the real note vault:",
  "CGO_ENABLED=1 go build -tags fts5 -o SiYuan-Kernel .",
  "node scripts/calendar-kernel-smoke.mjs",
  "node scripts/calendar-electron-document-flow-smoke.mjs",
  "Backend `_attrView.calendar` language coverage is checked for every bundled language JSON file.",
  "Calendar API setup and mapped metadata path.",
  "Open an isolated workspace or explicit throwaway user workspace; do not use a personal data directory.",
  "After automated checks, only the short manual acceptance list above remains recommended for visual confidence.",
]) {
  if (!report.includes(term)) {
    fail(`rebuild report missing completion evidence term: ${term}`);
  }
}

const recurrenceSmoke = read("scripts/calendar-recurrence-smoke.mjs");
for (const term of [
  "normalizeCalendarEvents(calendar, mapping, range)",
  "getCalendarFieldMapping(calendar)",
  "FREQ=WEEKLY;COUNT=3",
  "FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE",
  "recurrence: \"None\"",
  "weekly recurrence dates",
  "weekly BYDAY recurrence dates",
  "expanded recurrence did not preserve mapped metadata",
  "base event did not retain parsed recurrence exceptions",
]) {
  if (!recurrenceSmoke.includes(term)) {
    fail(`calendar recurrence smoke missing ${term}`);
  }
}

const transactionsSmoke = read("scripts/calendar-transactions-smoke.mjs");
for (const term of [
  "createCalendarEvent({...baseOptions, draft})",
  "updateCalendarEvent({...baseOptions, event, draft})",
  "deleteCalendarEvent({",
  "deleteCalendarOccurrence({",
  "createCalendarEventReplacingOccurrence({",
  "updateCalendarEventThisAndFuture({",
  "create should clamp invalid end time",
  "delete occurrence should merge and sort exceptions",
  "replacement should not copy recurrence rules into the one-off event",
  "split should reduce COUNT for the new future series",
  "delete undo should restore metadata cells",
]) {
  if (!transactionsSmoke.includes(term)) {
    fail(`calendar transactions smoke missing ${term}`);
  }
}

const electronLaunchSmoke = read("scripts/calendar-electron-launch-smoke.mjs");
for (const term of [
  "\"--workspace\", workspace",
  "\"--port\", String(kernelPort)",
  "`--workspace=${workspace}`",
  "`--remote-debugging-port=${debugPort}`",
  "\"--no-sandbox\"",
  "desktopBuildDir",
  "fs.symlinkSync(desktopBuildDir, appBuildDir, \"dir\")",
  "workspace.json",
  "waitForKernelBoot(baseURL)",
  "waitForElectronDebug(debugPort)",
  "waitForAppShell(debugPort)",
  "compileCalendarRenderHarness",
  "compileCalendarDialogHarness",
  "runCalendarRenderSmoke(debugPort, renderHarness.renderModule)",
  "runCalendarDialogSmoke(debugPort, dialogHarness.dialogModule)",
  "renderModule.renderCalendar",
  "dialogModule.openEventDialog",
  "Calendar UI render smoke event",
  "Calendar none smoke event",
  "Dialog smoke event",
  "__calendarRenderTxCalls",
  "__calendarRenderDialogs",
  "toolbarNewDate",
  "dayNewDate",
  "duplicateDraft",
  "resizeDraft",
  "dragDraft",
  "persistedModeOperation",
  "setupOperationAction",
  "createFieldOperations",
  "calendar-scope-future",
  "futureDraft",
  "delete-occurrence",
  "av-event-recurrence-raw",
  "FREQ=WEEKLY;INTERVAL=2;COUNT=3;BYDAY=MO,WE",
  "search.dispatchEvent(new Event('input'",
  "new KeyboardEvent('keydown', {key: '[', bubbles: true})",
  "new KeyboardEvent('keydown', {key: ']', bubbles: true})",
  "calendar-clear-search",
  "readOnlyDraggable",
  "readOnlyLocalMode",
  "readOnlyRenderedMode",
  // The inline chip buttons became menu items; the same behavioural guarantees
  // are now driven through the menu instead of being dropped.
  "runChipMenuCommand",
  "av__calendar-menu",
  "new MouseEvent('contextmenu'",
  "chipInlineButtonCount",
  "shiftDraft",
  "menuDeleteEventID",
  "readOnlyHasContextMenu",
  // Mini month + key map coverage.
  "calendar-mini-month-wrapper",
  "miniMonthAnchorAfterClick",
  "miniMonthPagingLeftMainView",
  "modeAfterKeyW",
  "modeAfterKeyInSearch",
  "shortcutSheetCommands",
  "weekMode",
  "scheduleMode",
  "renderedEvents=${renderState.eventCount}",
  "dialogSaves=${dialogState.saves}",
  "hasOpenFileByURL",
  "hasSiYuanTarget",
  "stopProcessGroup(electron)",
  "SIYUAN_CALENDAR_KEEP_SMOKE_WORKSPACE",
  "calendar electron launch smoke passed",
]) {
  if (!electronLaunchSmoke.includes(term)) {
    fail(`calendar electron launch smoke missing ${term}`);
  }
}

const electronDocumentFlowSmoke = read("scripts/calendar-electron-document-flow-smoke.mjs");
for (const term of [
  "createCalendarFixture(baseURL)",
  "\"/api/filetree/createDocWithMd\"",
  "\"/api/av/changeAttrViewLayout\"",
  "\"/api/attr/setBlockAttrs\"",
  "\"custom-sy-av-view\"",
  "window.openFileByURL",
  "siyuan://blocks/${fixture.docID}",
  "siyuan://blocks/${fixture.avBlockID}?focus=1",
  "__calendarDocFlowFetches",
  "__calendarDocFlowErrors",
  ".av__calendar-event",
  "Calendar document flow event",
  "calendar electron document flow smoke passed",
]) {
  if (!electronDocumentFlowSmoke.includes(term)) {
    fail(`calendar electron document flow smoke missing ${term}`);
  }
}

for (const [file, term] of [
  ["app/src/protyle/render/av/layout.ts", "calendarStaleMapping"],
  ["app/src/protyle/render/av/calendar/mapped-fields.ts", "dateFieldID: hasDateField ?"],
  ["app/src/protyle/render/av/calendar/render.ts", "editable && mapping.hasDateField"],
]) {
  if (!read(file).includes(term)) {
    fail(`${file} missing mapping-robustness guard: ${term}`);
  }
}

for (const [file, term] of [
  ["app/src/protyle/render/av/calendar/render.ts", "const getCalendarLocale = () => window.siyuan.config.lang;"],
  ["app/src/protyle/render/av/calendar/event-dialog.ts", "const getCalendarLocale = () => window.siyuan.config.lang;"],
  ["app/src/protyle/render/av/layout.ts", "const getCalendarLocale = () => window.siyuan.config.lang;"],
]) {
  if (!read(file).includes(term)) {
    fail(`${file} missing BCP 47 calendar locale accessor`);
  }
}

console.log(`calendar audit passed: ${requiredFiles.filter((file) => file.startsWith("app/src/")).length} frontend files, ${calendarLanguageKeys.size} language keys, ${expectedFeatureTerms.length} feature terms, kernel/recurrence/transactions/electron render+dialog/document smoke scripts`);
