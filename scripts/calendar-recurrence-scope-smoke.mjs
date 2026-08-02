#!/usr/bin/env node
import {readFileSync} from "node:fs";
import path from "node:path";

const root = process.cwd();
const eventDialog = readFileSync(path.join(root, "app/src/protyle/render/av/calendar/event-dialog.ts"), "utf8");
const scss = readFileSync(path.join(root, "app/src/assets/scss/business/_av.scss"), "utf8");

const fail = (message) => {
  console.error(`calendar recurrence scope smoke failed: ${message}`);
  process.exit(1);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

assert(eventDialog.includes("type CalendarRecurrenceScope"), "missing explicit recurrence scope type");
assert(eventDialog.includes("openRecurrenceScopeDialog"), "missing reusable recurrence scope dialog");
assert(eventDialog.includes("availableLabels"), "scope dialog must derive the actually available options");
assert(eventDialog.includes("labels.filter(item => !options.disabledScopes[item.scope])"), "unsupported recurrence scopes must be hidden instead of shown as technical disabled cards");
assert(eventDialog.includes('availableLabels.length === 1 && options.action !== "delete"'), "single non-destructive scope must run directly without an unnecessary dialog");
assert(eventDialog.includes('class="b3-button b3-button--remove" data-type="calendar-scope-${availableLabels[0].scope}"'), "single delete scope must render as one explicit destructive action");
assert(eventDialog.includes('scope: "occurrence"'), "missing occurrence scope option");
assert(eventDialog.includes('scope: "future"'), "missing this-and-future scope option");
assert(eventDialog.includes('scope: "series"'), "missing series scope option");
assert(eventDialog.includes('calendarDeleteSeries || "Delete all"'), "delete-all scope must use direct action wording");
assert(eventDialog.includes("getDisabledRecurrenceScopes"), "missing disabled scope matrix helper");
assert(eventDialog.includes("mapping.exceptionFieldID") && eventDialog.includes("calendarRecurrenceScopeOccurrenceDisabled"), "occurrence scope must require mapped exception field with visible reason");
assert(eventDialog.includes("mapping.recurrenceFieldID") && eventDialog.includes("calendarRecurrenceScopeFutureDisabled"), "future scope must require mapped recurrence field with visible reason");
assert(eventDialog.includes("deleteCalendarEventThisAndFuture"), "this-and-future delete must use a real truncation transaction");
assert(!eventDialog.includes("calendarRecurrenceScopeFutureDeleteDisabled ||"), "this-and-future delete must not be disabled as unsupported");
assert(eventDialog.includes("seriesEvent?: ICalendarNormalizedEvent") && eventDialog.includes("getWholeSeriesDraft"), "whole-series edits from an occurrence must keep a separate base-series identity");
assert(eventDialog.includes("options.seriesEvent || options.event") && eventDialog.includes("draftToUpdate"), "whole-series saves must target the base row and preserve its unchanged schedule");
assert(eventDialog.includes('calendarRecurrenceScopeSeries || window.siyuan.languages.all || "All"') && !eventDialog.includes('calendarRecurrenceScopeSeries || "All events"'), "scope fallback must use an already localized label");
assert(eventDialog.includes("runRecurringEventAction"), "recurring edit/delete must route through scope selection");
assert(eventDialog.includes("CalendarRecurrenceScope") && eventDialog.includes("saveEventWithScope"), "save flow must accept selected recurrence scope");
assert(eventDialog.includes("deleteEventWithScope"), "delete flow must accept selected recurrence scope");
assert(!/data-type=\"event-save-future\"/.test(eventDialog), "direct this-and-future action should not bypass scope dialog");

const runRecurringEventAction = eventDialog.match(/const runRecurringEventAction[\s\S]*?\n};/);
assert(runRecurringEventAction, "missing recurring action router implementation");
assert(runRecurringEventAction[0].includes("isRecurringSourceEvent"), "root/source recurring event path must be detected before edit/delete");
assert(!runRecurringEventAction[0].includes("if (!options.event?.isOccurrence) {\n        run(\"series\")"), "root/source recurring event must not silently run whole-series edit/delete");
assert(runRecurringEventAction[0].includes("openRecurrenceScopeDialog"), "recurring root/source edit/delete must open the recurrence scope dialog");
assert(eventDialog.includes("calendarRecurrenceScopeRootOccurrenceDisabled"), "root/source recurrence capability matrix must remain explicit in code");
assert(eventDialog.includes("future: isSourceEvent ?") && eventDialog.includes("calendarRecurrenceScopeRootFutureDisabled"), "root/source future scope must be hidden because it duplicates all");
assert(eventDialog.includes('(mapping.recurrenceFieldID ? ""'), "later occurrence future scope must be available when recurrence storage exists");

assert(scss.includes("&-scope") && scss.includes("&-scope-option"), "missing recurrence scope dialog styles");

console.log("calendar recurrence scope smoke passed: recurring edit/delete scope matrix present");
