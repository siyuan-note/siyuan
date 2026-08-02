#!/usr/bin/env node
/**
 * Calendar quick-create regression smoke.
 *
 * The accepted wiring collects a draft (sweep gesture, timed-grid surface,
 * all-day lane, month/week/day "new" buttons) and hands it to
 * openFullCalendarCreate, which prefills the shared event dialog. The dialog
 * preserves the draft's all-day / time / title state, branches on the view's
 * new-entry target (page vs detached row), paints an optimistic pending chip
 * and removes it on both the success and the failure path.
 *
 * Static source assertions, same style as the other calendar-*-smoke scripts.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => {
  console.error(`calendar quick-create smoke failed: ${message}`);
  process.exit(1);
};

if (!exists("app/src/protyle/render/av/calendar/quick-create.ts")) {
  fail("missing quick-create.ts");
}

const quickCreate = read("app/src/protyle/render/av/calendar/quick-create.ts");
const render = read("app/src/protyle/render/av/calendar/render.ts");
const eventDialog = read("app/src/protyle/render/av/calendar/event-dialog.ts");
const scss = read("app/src/assets/scss/business/_av.scss");

// 1. The popover module keeps its draft-collection contract (title, all-day
//    toggle, Enter/Escape handling, save/more/cancel, inline error).
for (const term of [
  "export interface IQuickCreateOptions",
  "export const openQuickCreate",
  "av__calendar-quick-create",
  "data-type=\"calendar-quick-create-title\"",
  "data-type=\"calendar-quick-create-save\"",
  "data-type=\"calendar-quick-create-more\"",
  "data-type=\"calendar-quick-create-cancel\"",
  "data-type=\"calendar-quick-create-all-day\"",
  "titleInput.focus()",
  "event.key === \"Enter\"",
  "event.key === \"Escape\"",
  "onMoreOptions(getDraft())",
]) {
  if (!quickCreate.includes(term)) {
    fail(`quick-create.ts missing ${term}`);
  }
}

if (!/const getDraft = \(\) => \(\{[\s\S]*isAllDay: allDayInput\.checked[\s\S]*\}\)/.test(quickCreate)) {
  fail("quick-create draft must preserve current all-day toggle state");
}

// 2. Every create entry point funnels through openFullCalendarCreate, which
//    prefills the shared event dialog with the collected draft.
for (const term of [
  "const openFullCalendarCreate = (draft: ICalendarEventDraft) => {",
  "openCalendarEventDialog({",
  "draft,",
  "onSave: rerender",
]) {
  if (!render.includes(term)) {
    fail(`render.ts missing dialog-prefill quick-create wiring ${term}`);
  }
}
// The dialog must preserve the draft state (all-day, times, title, fields).
for (const term of [
  "draft?.isAllDay",
  "draft?.startTime",
  "draft?.endTime",
  "draft?.title",
  "draft?.fieldValues",
]) {
  if (!eventDialog.includes(term)) {
    fail(`event-dialog.ts missing draft prefill ${term}`);
  }
}

// 3. Timed-grid create: one surface per day column, anchored at the exact
//    clicked minute (snapped), reachable by pointer and keyboard.
for (const term of [
  "const startTimedQuickCreate = (surface: HTMLElement, startMinute: number) => {",
  "offsetPxToMinute(event.clientY - rect.top, gridGeometry)",
  "startTimedQuickCreate(surface, pointerMinute)",
  "startTimedQuickCreate(surface, 9 * 60)",
]) {
  if (!render.includes(term)) {
    fail(`render.ts missing timed-grid quick-create wiring ${term}`);
  }
}

// 4. All-day create: the all-day lane and the month/week/day "new" buttons
//    collect an all-day draft through the same funnel.
for (const term of [
  "const startAllDayCreate = (surface: HTMLElement) => {",
  "isAllDay: true",
  'data-type="calendar-new"',
]) {
  if (!render.includes(term)) {
    fail(`render.ts missing all-day quick-create wiring ${term}`);
  }
}
if ((render.match(/startAllDayCreate\(/g) || []).length < 2) {
  fail("all-day create must be reachable from both the lane and the new buttons");
}

// 5. The pointer gesture module's sweep hands its draft to the same funnel.
if (!render.includes("openFullCalendarCreate(result.draft)")) {
  fail("sweep gesture draft must go through openFullCalendarCreate");
}

// 6. Page-per-entry: quick create must branch on the view's new-entry target
//    and forward it to the dialog and to the create transaction.
for (const term of [
  "const createsDocuments = calendarCreatesDocuments(calendar, options.blockElement);",
  "createAsDocument: createsDocuments",
  "createCalendarEventAsDocument({...createOptions",
]) {
  if (!render.includes(term)) {
    fail(`render.ts missing page-per-entry branching ${term}`);
  }
}

// 7. Optimistic create: the pending chip is painted and cleared on BOTH the
//    success and the failure path (finally cleanup in the feedback wrapper).
for (const term of [
  "const paintOptimisticEvent = (calendarElement: HTMLElement, draft: ICalendarEventDraft)",
  "av__calendar-event--pending",
  "classList.remove(\"av__calendar-event--pending\")",
]) {
  if (!render.includes(term)) {
    fail(`render.ts missing optimistic quick-create wiring ${term}`);
  }
}

// 8. The day-cell dblclick guard must exclude the timed-grid create surface so
//    a sweep in the time grid does not also fire the day-cell create.
if (!/\[data-type='calendar-time-create'\]/.test(render)) {
  fail("drop-day dblclick guard must exclude calendar-time-create targets");
}

// 9. The quick-create popover chrome stays in the calendar stylesheet.
for (const term of [
  "&-quick-create",
  "&-quick-create-title",
  "&-quick-create-summary",
  "&-quick-create-actions",
  "&-quick-create-check",
  "top: var(--calendar-quick-create-top, 4px)",
]) {
  if (!scss.includes(term)) {
    fail(`_av.scss missing ${term}`);
  }
}

console.log("calendar quick-create smoke passed");
