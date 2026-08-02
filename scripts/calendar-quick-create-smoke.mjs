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
  console.error(`calendar quick-create smoke failed: ${message}`);
  process.exit(1);
};

if (!exists("app/src/protyle/render/av/calendar/quick-create.ts")) {
  fail("missing quick-create.ts");
}

const quickCreate = read("app/src/protyle/render/av/calendar/quick-create.ts");
const render = read("app/src/protyle/render/av/calendar/render.ts");
const scss = read("app/src/assets/scss/business/_av.scss");

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

if (!/allDayInput\.addEventListener\("change"[\s\S]*summaryElement\.textContent = getDateTimeSummary\(getDraft\(\)\)/.test(quickCreate)) {
  fail("quick-create all-day toggle must refresh visible date/time summary");
}

for (const term of [
  "import {openQuickCreate} from \"./quick-create\";",
  "openQuickCreate({",
  "onSave: async (savedDraft) => {",
  "createCalendarEvent(createOptions)",
  "onMoreOptions: (moreDraft) => openCalendarEventDialog({",
  "isAllDay: true",
]) {
  if (!render.includes(term)) {
    fail(`render.ts missing quick-create wiring ${term}`);
  }
}

// Page-per-entry: both quick-create entry points must go through the SAME
// helper, so the time slot and the day cell can never disagree about whether a
// new entry becomes a document.
if (!render.includes("const startCalendarQuickCreate = (") ||
  (render.match(/ startCalendarQuickCreate\(/g) || []).length < 2) {
  fail("both quick-create sites must call the shared startCalendarQuickCreate helper");
}
if (!render.includes("const createsDocuments = calendarCreatesDocuments(calendar, options.blockElement);") ||
  !render.includes("if (createsDocuments) {")) {
  fail("quick-create must branch on the view's new-entry target");
}
if (!/createAsDocument: createsDocuments/.test(render)) {
  fail("dialog entry points must forward the view's new-entry target");
}

// Optimistic create: the popover closes at once, the chip is painted, and the
// chip is removed on BOTH the success and the failure path (no phantom chip).
if (/if \(createsDocuments\) \{[\s\S]{0,400}await createCalendarEventAsDocument/.test(render)) {
  fail("page create must not be awaited inside the quick-create popover");
}
for (const term of [
  "const paintOptimisticEvent = (calendarElement: HTMLElement, draft: ICalendarEventDraft)",
  "av__calendar-event--pending",
  "createEventDocumentOptimistically",
  "createCalendarEventAsDocument(createOptions).then(created => {",
]) {
  if (!render.includes(term)) {
    fail(`render.ts missing optimistic quick-create wiring ${term}`);
  }
}
if ((render.match(/pendingChip\?\.remove\(\);/g) || []).length < 2) {
  fail("optimistic chip must be removed on both the success and the failure path");
}

// The 30-minute slot buttons became one continuous create surface; the day-cell
// dblclick guard must still exclude it so a sweep in the time grid does not also
// fire the day-cell create.
if (!/\[data-type='calendar-time-create'\]/.test(render)) {
  fail("drop-day dblclick guard must exclude calendar-time-create targets");
}

// Position is now minute-exact rather than snapped to a slot element.
if (!render.includes("startCalendarQuickCreate(surface, surface.offsetTop + minuteToOffsetPx(start, gridGeometry), draft)")) {
  fail("time-grid quick-create must anchor the popover at the exact clicked minute");
}

if (!/calendar-new"\]'\)[\s\S]{0,900}startCalendarQuickCreate/.test(render)) {
  fail("month/week/day new buttons should use quick-create for all-day drafts");
}

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
