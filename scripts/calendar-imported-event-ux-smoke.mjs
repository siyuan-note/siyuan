#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => {
  console.error(`calendar imported-event UX smoke failed: ${message}`);
  process.exit(1);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

const timeGrid = read("app/src/protyle/render/av/calendar/time-grid.ts");
const render = read("app/src/protyle/render/av/calendar/render.ts");
const eventChip = read("app/src/protyle/render/av/calendar/event-chip.ts");
const eventDialog = read("app/src/protyle/render/av/calendar/event-dialog.ts");
const interactions = read("app/src/protyle/render/av/calendar/interactions.ts");
const calendarDock = read("app/src/layout/dock/Calendar.ts");
const scss = read("app/src/assets/scss/business/_av.scss");
const german = JSON.parse(read("app/appearance/langs/de.json"));

assert(timeGrid.includes("isMultiDayTimedEvent"), "timed multi-day events need an explicit classification");
assert(timeGrid.includes("belongsInAllDayLane"), "multi-day timed events must render once in the spanning lane");
assert(timeGrid.includes("!belongsInAllDayLane(event)"), "multi-day timed events must not be repeated in every timed day column");
assert(timeGrid.includes("options.expandAllDay"), "+x more must be able to reveal all hidden all-day lanes");
assert(timeGrid.includes('surface: "timed" | "all-day"'), "the grid must tell chip rendering which surface it occupies");

assert(render.includes('classList.contains("av__calendar-allday-more")'), "+x more needs a dedicated all-day expansion path");
assert(render.includes('dataset.calendarAllDayExpanded = "true"'), "+x more must persist expansion through the rerender");
assert(render.includes('classList.contains("av__calendar-allday-cell")'), "empty all-day cells need a create action");
assert(render.includes("startAllDayCreate"), "all-day empty-space creation must use one explicit entry point");

assert(!eventChip.includes("const recurrenceMarker"), "recurrence O/R tags must not be rendered beside event names");
assert(!eventChip.includes("av__calendar-event-dot"), "event names must not render a leading colour dot");
assert(eventChip.includes("export const getEventTimeLabel"), "event chips need one shared single-day and multi-day time label");
assert(eventChip.includes('!event.start.isSame(end, "day")'), "multi-day timed labels must detect different endpoint days");
assert(eventChip.includes("formatCalendarDate(event.start, dateOptions)"), "multi-day timed labels must include the start date");
assert(eventChip.includes("formatCalendarDate(end, dateOptions)"), "multi-day timed labels must include the end date");
assert(!eventChip.includes("multiDayPrefix"), "multi-day dates must belong to the time range instead of being prefixed to the title");
assert(!eventChip.includes('event.isOccurrence ? "O" : "R"'), "event chips must not expose internal O/R tags");
assert(!scss.includes("&-recurring"), "unused recurrence-tag styling must be removed");

const timedStyle = scss.match(/&--timed \{([\s\S]*?)\n    \}/)?.[1] || "";
assert(timedStyle.includes("background-color: var(--calendar-event-fill, var(--b3-theme-primary));"),
  "timed events must use the same complete colour fill as all-day events");
assert(timedStyle.includes("color: var(--b3-theme-on-primary);"),
  "timed event text must retain contrast on the complete colour fill");
assert(!timedStyle.includes("inset 3px 0 0"), "timed events must not restore the left accent bar");

assert(eventDialog.includes('calendarRecurrenceScopeSeries || window.siyuan.languages.all || "All"'), "edit scope needs a localized non-destructive all-events label");
assert(eventDialog.includes('class="av__calendar-dialog-endpoint"'), "event editor must group each date with its matching time");
assert(eventDialog.includes('id="av-event-schedule"'), "event editor needs one endpoint-based schedule group");
assert(eventDialog.includes("av__calendar-dialog-schedule--all-day"), "all-day mode must hide time fields without separating endpoint dates");
assert(!eventDialog.includes('id="av-event-time-row"'), "event editor must not restore a detached time-only row");
assert(!eventDialog.includes('data-type="event-title-hint"'), "bound event titles must not repeat the rename-document hint below an existing title");
assert(eventDialog.includes('window.siyuan.languages.calendarRecurrence || "Recurrence"'), "recurrence row label must use the noun translation");
assert(!eventDialog.includes("getRenamesPageHint"), "the title field must use the ordinary Title label instead of a concatenated rename instruction");
assert(!eventDialog.includes("getDeletePageLabel"), "destructive labels must be translated as complete phrases, never concatenated word fragments");
assert(eventDialog.includes("calendarDeleteEvent"), "plain delete must name the calendar event it removes");
assert(eventDialog.includes("calendarDeleteEventAndDocument"), "page deletion must state that it removes both the event and linked document");
assert(eventDialog.includes('calendarEditEvent || "Edit event"'), "editing dialog title must name the event being edited");
assert(eventDialog.includes('window.siyuan.languages.calendarStart || "Start"'), "the first endpoint row must be labelled Start, not generic Date");
assert(eventDialog.includes('window.siyuan.languages.calendarEnd || "End"'), "the second endpoint row must be labelled End");
assert(eventDialog.includes('class="b3-button b3-button--text b3-form__space av__calendar-event-source"'), "the source row itself must be the Open source action");
assert(eventDialog.includes("av__calendar-dialog-footer-secondary"), "secondary and destructive actions need a deliberate footer row");
assert(eventDialog.includes("av__calendar-dialog-footer-primary"), "Cancel and Save need a stable primary footer row");
assert(eventDialog.includes('width: "560px"'), "desktop editor must be wide enough to keep explicit destructive actions on one row");
assert(scss.includes("grid-template-columns: 18px max-content minmax(96px, 1fr) max-content"), "recurrence end rows need an explicit column for the occurrences suffix");
assert(german.calendarRepeatEvery === "Intervall", "German custom recurrence row must use a noun label");
assert(german.calendarRepeatUntilSuffix === " bis ${x}" && german.calendarRepeatCountSuffix === " ${x}-mal", "German recurrence suffixes must not insert an unnecessary comma");
assert(eventDialog.includes('let rememberedTimedStart = allDayCheckbox.checked ? "09:00"'), "all-day events need a sane timed-start default when converted");
assert(eventDialog.includes('let rememberedTimedEnd = allDayCheckbox.checked ? "10:00"'), "all-day events need a sane timed-end default when converted");
assert(eventDialog.includes('event.key === "Enter" && !event.isComposing'), "IME composition Enter must not submit the editor");
assert(eventDialog.includes("let previousPreset = presetSelect?.value"), "preset-to-custom transitions must track the previous recurrence preset");
assert(eventDialog.includes("shouldResetCustomWeekdays(previousPreset, preset)"), "entering Custom from a preset must reset preset-derived weekdays");
assert(eventDialog.includes("checkbox.checked = false"), "preset-derived weekday checkboxes must be cleared before custom weekday selection");
assert(eventDialog.includes("getCompactWeekdayLabel(day.label)") && !eventDialog.includes("day.label.slice(0, 1)"), "CJK weekday buttons must not collapse every label to 周／週");
assert(eventDialog.includes('label.replace(/^(?:星期|週|周)/u, "")'), "compact Chinese weekday labels must remove the shared prefix");
assert(render.includes("getISOCalendarWeekNumber"), "calendar toolbar must calculate an ISO calendar week number");
assert(render.includes('class="av__calendar-week-number"'), "calendar week number must render after the date title");
assert(render.includes('calendarFiveDayView || "5 Days"') && !render.includes('german ? "5 Tage" : "5 Days"'), "five-day view label must come from locale data");
assert(scss.includes("flex: 0 1 192px") && scss.includes("max-width: 192px"), "search control must use the measured half-width target");
assert(/&-time-columns\s*\{[\s\S]*?position:\s*relative;/.test(scss), "timed gesture ghosts need the columns layer as their containing block");
assert(/&-timed-event\s*\{[\s\S]*?box-sizing:\s*border-box;/.test(scss), "timed event padding must stay inside its packed column width");
assert(/&-ghost\s*\{[\s\S]*?box-sizing:\s*border-box;/.test(scss), "gesture ghost border and padding must stay inside the measured day width");
assert(/&-time-day\s*\{[\s\S]*?linear-gradient\(to right,[\s\S]*?surface-lighter[\s\S]*?transparent 1px\)/.test(scss), "day separators must be painted without consuming event width");
assert(eventChip.includes('calendarEditEvent || "Edit event"'), "right-click editor action must use the unified event terminology");
assert(render.includes("seriesEvent = baseEvents.get") && render.includes("seriesEvent,"), "opening a generated occurrence must pass its base series event into the editor");
const saveEventSource = eventDialog.slice(eventDialog.indexOf("const saveEvent = async"), eventDialog.indexOf("const saveFutureEvent = async"));
assert(saveEventSource.indexOf("showInvalidDraftMessage") < saveEventSource.indexOf("ensureRecurrenceStorage"), "validation must run before recurrence storage can mutate the AV schema");
assert(eventDialog.includes('options.action === "delete" ?'), "delete and edit series labels must be distinct");
assert(eventDialog.includes("preset !== \"custom\""), "recurrence preset must override hidden custom controls");
assert(eventDialog.includes("getRecurrencePresetRule(preset)"), "Does not repeat must save an empty recurrence rule");
assert(calendarDock.includes('type TCalendarDockView = "day" | "month" | "agenda"'), "calendar dock must expose Day, Month, and Schedule views");
assert(calendarDock.includes('data-type="calendar-dock-view"'), "calendar dock needs an explicit view switch control");
assert(calendarDock.includes('label: lang("calendarSchedule", "Schedule")') && !calendarDock.includes('label: lang("calendarScheduleView", "Schedule")'), "dock Schedule must not reuse the database view label");
assert(calendarDock.includes("renderCalendarMiniMonth"), "Month dock view must reuse the calendar mini-month navigator");
assert(calendarDock.includes('data-type="calendar-open-event"'), "dock event rows must be actionable");
assert(calendarDock.includes("getEventDocumentID(item.event)"), "dock event clicks must resolve the bound source document");
assert(calendarDock.includes("openFileById({app: this.app"), "dock event clicks must open the source page");
assert(calendarDock.includes("getSafeCalendarColor(event.color)"), "dock event colours must be sanitized before entering an inline style");
assert(calendarDock.includes("this.eventOccursOn(item, this.anchor)"), "Day and Month dock views must include events spanning the selected date");
assert(calendarDock.includes("void this.refresh();") && calendarDock.includes('case "select-source"'), "changing dock sources must reload selected calendar data");
assert(calendarDock.includes('class="av__calendar-dock-event-title"'), "dock events need a dedicated title element that can wrap independently");
assert(calendarDock.includes('eventEnd.isBefore(monthStart, "day")') && calendarDock.includes('item.event.start.isAfter(monthEnd, "day")'), "Schedule must exclude calendar-grid spillover events outside the displayed month");
assert(calendarDock.includes('if (view === "agenda")') && calendarDock.includes('this.anchor = dayjs();') && calendarDock.includes('this.agendaScrollDate = this.anchor.format("YYYY-MM-DD")'), "switching to Schedule must return to today's month and queue a today scroll");
assert(calendarDock.includes('data-calendar-agenda-scroll-target="true"') && calendarDock.includes('av__calendar-dock-agenda-today') && calendarDock.includes('content.scrollTop = Math.max(0, target.offsetTop - content.offsetTop)'), "Schedule must render a today marker and scroll to it after rendering");
assert(calendarDock.includes('window.siyuan.languages.today || "Today"'), "Schedule today marker must use SiYuan's existing localized Today label");
assert(scss.includes(".av__calendar-dock-views") && scss.includes("grid-template-columns: repeat(3"), "dock view switch must render as three stable options");
assert(/\.av__calendar-dock-event[\s\S]*?-webkit-line-clamp:\s*unset;[\s\S]*?overflow:\s*visible;[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?text-overflow:\s*clip;/.test(scss), "dock event titles must wrap without a misleading ellipsis");
assert(/\.av__calendar-dock-mini[\s\S]*?\.av__calendar-mini-day[\s\S]*?aspect-ratio:\s*1 \/ 1;[\s\S]*?height:\s*24px;[\s\S]*?width:\s*24px;/.test(scss), "dock selected-day indicator must stay a 24px circle");
assert(interactions.includes("export const TOUCH_DRAG_THRESHOLD_PX = 8"), "touch taps need the same drift allowance as Calendar long press");
assert(interactions.includes('moveEvent.pointerType === "touch" ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX'), "touch and mouse gestures must use distinct measured thresholds");
assert(scss.includes("@media (max-width: 750px)") && scss.includes("min-height: 42px"), "mobile Calendar toolbar must follow SiYuan's existing narrow-screen control size");
assert(scss.includes("@media (pointer: coarse)") && scss.includes("touch-action: none"), "coarse-pointer event drag and resize must not be cancelled by native scrolling");
assert(scss.includes("height: 21px") && scss.includes("top: -10px") && scss.includes("bottom: -10px"), "mobile resize handles need a measured half-toolbar hit area around each edge");

const langDir = path.join(root, "app/appearance/langs");
for (const file of fs.readdirSync(langDir).filter((item) => item.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(langDir, file), "utf8"));
  assert(typeof data.calendarRecurrenceScopeSeries === "string" && data.calendarRecurrenceScopeSeries.length > 0,
    `${file} missing calendarRecurrenceScopeSeries`);
}

console.log("calendar imported-event UX smoke passed");
