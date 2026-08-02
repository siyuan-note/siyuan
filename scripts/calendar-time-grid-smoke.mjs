#!/usr/bin/env node
/**
 * Time-grid smoke.
 *
 * Two halves:
 *   1. a grep smoke over the modules that now own the grid (time-geometry.ts,
 *      layout-overlap.ts, time-grid.ts, now-indicator.ts, render.ts, _av.scss),
 *      including NEGATIVE assertions so the 30-minute row snapping cannot come
 *      back into render.ts;
 *   2. a real behavioural check of the two pure modules - they have no imports
 *      and no DOM, so they can just be transpiled and executed. Grep alone
 *      cannot tell you that a 12:45-13:20 event lands on 12:45, or that a column
 *      actually expands into free space.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const appDir = path.join(root, "app");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => {
  console.error(`calendar time-grid smoke failed: ${message}`);
  process.exit(1);
};

const calendarDir = "app/src/protyle/render/av/calendar";
const geometrySource = read(`${calendarDir}/time-geometry.ts`);
const overlapSource = read(`${calendarDir}/layout-overlap.ts`);
const timeGrid = read(`${calendarDir}/time-grid.ts`);
const nowIndicator = read(`${calendarDir}/now-indicator.ts`);
const render = read(`${calendarDir}/render.ts`);
const scss = read("app/src/assets/scss/business/_av.scss");

const requireTerms = (label, text, terms) => {
  for (const term of terms) {
    if (!text.includes(term)) {
      fail(`${label} missing ${term}`);
    }
  }
};

const rejectTerms = (label, text, terms) => {
  for (const term of terms) {
    if (text.includes(term)) {
      fail(`${label} must no longer contain ${term}`);
    }
  }
};

// --- G1: time-geometry.ts is the single source of minute<->pixel truth --------
requireTerms("time-geometry.ts", geometrySource, [
  "export const CALENDAR_SNAP_MINUTES = 15",
  "export const CALENDAR_MINIMUM_EVENT_MINUTES = 15",
  "export const CALENDAR_HOUR_HEIGHT_PX = 48",
  "export const CALENDAR_RULING_MINUTES = 30",
  "export const CALENDAR_BUSINESS_START_MINUTE = 9 * CALENDAR_MINUTES_PER_HOUR",
  "export const CALENDAR_BUSINESS_END_MINUTE = 18 * CALENDAR_MINUTES_PER_HOUR",
  "export const getCalendarTimeGeometry",
  "export const minutesToPx",
  "export const pxToMinutes",
  "export const snapMinutes",
  "export const getNowOffsetPx",
  "export const getEventMinuteRange",
  "export const getBusinessHoursPercent",
  "export const getCenteredScrollTopPx",
  "dayStartMinute",
  "dayEndMinute",
]);
// Pure by contract: a DOM reference here would mean the maths had leaked back
// into the renderer's world and could no longer be tested on its own.
rejectTerms("time-geometry.ts", geometrySource, ["document.", "window.", "dayjs"]);

// --- G2: overlap packing, in exact minutes -----------------------------------
requireTerms("layout-overlap.ts", overlapSource, [
  "export const packTimedEventColumns",
  "export const packAllDayLanes",
  "export const CALENDAR_MINIMUM_EVENT_WIDTH_PERCENT = 20",
  "startMinute",
  "endMinute",
  "columnSpan",
  "leftPercent",
  "widthPercent",
  "laneCount",
  "spanCount",
]);
rejectTerms("layout-overlap.ts", overlapSource, ["document.", "window.", "grid-row", "dayjs"]);

// --- G3/G4/G6: the grid module owns the markup -------------------------------
requireTerms("time-grid.ts", timeGrid, [
  "av__calendar-time-grid",
  "av__calendar-grid-header",
  "av__calendar-allday-row",
  "av__calendar-allday-lanes",
  "av__calendar-allday-bar",
  "av__calendar-time-gutter",
  "av__calendar-time-columns",
  "av__calendar-time-day",
  "av__calendar-timed-event",
  "av__calendar-day-header",
  "data-view-kind",
  "data-day-count",
  "data-first-date",
  "data-snap-minutes",
  "data-start-minute",
  "data-end-minute",
  "data-day-index",
  "data-type=\"calendar-drop-day\"",
  "calendar-time-create",
  "calendar-resize-handle",
  "av__calendar-time-day--weekend",
  // Pixel-exact positioning: no grid rows, only real offsets.
  "top:${range.topPx}px;height:${range.heightPx}px;left:${box.leftPercent}%;width:${box.widthPercent}%",
  "--calendar-hour-height:",
  "--calendar-day-height:",
  "--calendar-business-start:",
  "--calendar-allday-lane-count:",
  "packTimedEventColumns",
  "packAllDayLanes",
  "getEventMinuteRange",
  "options.editable ?",
]);
// Lanes legitimately use grid-row (an all-day bar's stack position); minutes
// must never reach a grid row again.
rejectTerms("time-grid.ts", timeGrid, ["grid-row:${range", "grid-template-rows: repeat(48", "SLOT_MINUTES", "calendar-time-slot"]);

// --- G5: the now line ticks and cleans up ------------------------------------
requireTerms("now-indicator.ts", nowIndicator, [
  "av__calendar-now-indicator",
  "av__calendar-now-dot",
  "av__calendar-now-line",
  "export const mountCalendarNowIndicator",
  "export const unmountCalendarNowIndicator",
  "window.setInterval",
  "window.clearInterval",
  "hasRestoredScroll",
  "CALENDAR_FALLBACK_SCROLL_MINUTE",
  "Math.min(...starts) - 60",
  ".av__calendar-timed-event[data-start-minute]",
  "unmountCalendarNowIndicator(options.blockElement)",
  "teardowns.set(options.blockElement, teardown)",
]);

// --- render.ts delegates, and can never snap to 30 minutes again -------------
requireTerms("render.ts", render, [
  "renderCalendarTimeGrid",
  "getCalendarTimeGeometry",
  "mountCalendarNowIndicator",
  "unmountCalendarNowIndicator",
  "CALENDAR_TIME_CREATE_TYPE",
  "snapMinutes(",
  "offsetPxToMinute",
  "getEventMinuteRange",
  "hadTimeGrid: !!timeGridElement",
  "hasRestoredScroll: resetData.hadTimeGrid",
  "viewKind",
]);
rejectTerms("render.ts", render, [
  // The negative assertion the rebuild exists for.
  "SLOT_MINUTES",
  "buildTimeSlots",
  "formatSlotLabel",
  "calendar-time-slot",
  "computeTimedEventColumns",
  "clusterColumns",
  "getTimedEventGridRange",
  "grid-row:",
  "grid-template-rows",
  "av__calendar-week-headers",
]);

// --- styles -------------------------------------------------------------------
requireTerms("_av.scss", scss, [
  "&-time-grid",
  "--calendar-grid-columns",
  "&-grid-header",
  "&-allday-row",
  "&-allday-lanes",
  "&-time-gutter",
  "&-time-columns",
  "&-time-day",
  "&-time-create",
  "&-timed-event",
  "&-resize-handle",
  "&-now-indicator",
  "&-day-header",
  "position: sticky",
  "top: var(--calendar-header-height, 34px)",
  "--calendar-business-start",
  "--calendar-weekend-tint",
  "var(--calendar-ruling-height, 24px)",
  "overscroll-behavior: contain",
  "height: clamp(420px, calc(100vh - 230px), 760px)",
]);
rejectTerms("_av.scss", scss, [
  "grid-template-rows: repeat(48, minmax(24px, auto))",
  "grid-template-columns: 56px repeat(var(--calendar-day-count), minmax(104px, 1fr))",
  "&-time-slot ",
]);

// -----------------------------------------------------------------------------
// Behavioural half: the two pure modules, actually executed.
// -----------------------------------------------------------------------------
const requireFromApp = createRequire(path.join(appDir, "package.json"));
const ts = requireFromApp("typescript");
const loadPureModule = (source, fileName) => {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    fileName,
  });
  const module = {exports: {}};
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", transpiled.outputText)(module.exports, module);
  return module.exports;
};

const geometry = loadPureModule(geometrySource, "time-geometry.ts");
const overlap = loadPureModule(overlapSource, "layout-overlap.ts");

const assert = (condition, message) => {
  if (!condition) {
    fail(message);
  }
};

const grid = geometry.getCalendarTimeGeometry(7);
assert(grid.snapMinutes === 15, `snap is not 15 minutes: ${grid.snapMinutes}`);
assert(geometry.minutesToPx(60, grid) === 48, "one hour is not one hour height");
assert(geometry.pxToMinutes(48, grid) === 60, "pxToMinutes is not the inverse of minutesToPx");
assert(geometry.snapMinutes(767, grid) === 765, `12:47 must snap to 12:45, got ${geometry.snapMinutes(767, grid)}`);
assert(geometry.snapMinutes(773, grid) === 780, `12:53 must snap to 13:00, got ${geometry.snapMinutes(773, grid)}`);
assert(geometry.snapMinutesDown(773, grid) === 765 && geometry.snapMinutesUp(766, grid) === 780,
  "directional snapping (sweep edges) is wrong");

// The headline defect: 12:45-13:20 used to draw at 12:30-13:30.
const pixelExact = geometry.getEventMinuteRange(12 * 60 + 45, 13 * 60 + 20, grid);
assert(pixelExact.startMinute === 765, `12:45 event starts at minute ${pixelExact.startMinute}`);
assert(pixelExact.endMinute === 800, `12:45-13:20 event ends at minute ${pixelExact.endMinute}`);
assert(Math.abs(pixelExact.topPx - 612) < 0.001, `12:45 must draw at 612px, got ${pixelExact.topPx}`);
assert(Math.abs(pixelExact.heightPx - 28) < 0.001, `35 minutes must be 28px tall, got ${pixelExact.heightPx}`);

// A 5 minute event is still tall enough to hit.
const tiny = geometry.getEventMinuteRange(600, 605, grid);
assert(tiny.heightPx >= geometry.minutesToPx(15, grid), "minimum event height is not enforced");

const nowOffset = geometry.getNowOffsetPx(new Date(2026, 0, 1, 9, 30, 0), grid);
assert(Math.abs(nowOffset - 456) < 0.001, `09:30 now line must be at 456px, got ${nowOffset}`);

const business = geometry.getBusinessHoursPercent(grid);
assert(business.startPercent === 37.5 && business.endPercent === 75,
  `business hours must be 09:00-18:00, got ${business.startPercent}-${business.endPercent}`);

// A cluster must CLOSE when a gap appears: the 14:00 event is on its own.
const packed = overlap.packTimedEventColumns([
  {key: "a", startMinute: 540, endMinute: 600},
  {key: "b", startMinute: 570, endMinute: 630},
  {key: "c", startMinute: 840, endMinute: 900},
]);
const byKey = Object.fromEntries(packed.map((box) => [box.key, box]));
assert(byKey.a.widthPercent === 50 && byKey.a.leftPercent === 0, `overlapping a: ${JSON.stringify(byKey.a)}`);
assert(byKey.b.widthPercent === 50 && byKey.b.leftPercent === 50, `overlapping b: ${JSON.stringify(byKey.b)}`);
assert(byKey.c.widthPercent === 100 && byKey.c.columnCount === 1,
  `a gap must close the cluster, got ${JSON.stringify(byKey.c)}`);

// A column must EXPAND into free space instead of every member taking 1/N.
// "long" 09:00-12:00 forces three columns in the morning; "late" 10:30-11:00
// sits in column 1 and overlaps nothing in column 2, so it must absorb it
// (2/3 wide) instead of being pinned to the old 1/3.
const expanding = overlap.packTimedEventColumns([
  {key: "long", startMinute: 540, endMinute: 720},
  {key: "morningA", startMinute: 540, endMinute: 600},
  {key: "morningB", startMinute: 540, endMinute: 600},
  {key: "late", startMinute: 630, endMinute: 660},
]);
const expandingByKey = Object.fromEntries(expanding.map((box) => [box.key, box]));
const near = (value, expected) => Math.abs(value - expected) < 0.01;
assert(expandingByKey.long.columnCount === 3, `expected a 3 column cluster, got ${JSON.stringify(expandingByKey.long)}`);
assert(expandingByKey.late.columnSpan === 2 && near(expandingByKey.late.widthPercent, 66.667) &&
  near(expandingByKey.late.leftPercent, 33.333),
  `a free column to the right must be absorbed, got ${JSON.stringify(expandingByKey.late)}`);
assert(near(expandingByKey.long.widthPercent, 33.333) && expandingByKey.long.leftPercent === 0,
  `the fully overlapped event must stay 1/3 wide, got ${JSON.stringify(expandingByKey.long)}`);

// A five-way overlap stays clickable: nothing narrower than the minimum.
const fiveWay = overlap.packTimedEventColumns(
  [0, 1, 2, 3, 4].map((index) => ({key: `n${index}`, startMinute: 540 + index, endMinute: 600})));
assert(fiveWay.every((box) => box.widthPercent >= overlap.CALENDAR_MINIMUM_EVENT_WIDTH_PERCENT),
  "a five-way overlap fell below the minimum width");
assert(fiveWay.every((box) => box.leftPercent + box.widthPercent <= 100.001),
  "an overlap box overflowed its day column");
const eightWay = overlap.packTimedEventColumns(
  [0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({key: `m${index}`, startMinute: 540 + index, endMinute: 600})));
assert(eightWay.every((box) => box.widthPercent >= overlap.CALENDAR_MINIMUM_EVENT_WIDTH_PERCENT),
  "an eight-way overlap fell below the minimum width");

// A Tue-Thu all-day event is ONE bar spanning three columns.
const lanes = overlap.packAllDayLanes([
  {key: "tue-thu", startIndex: 2, endIndex: 4},
  {key: "wed", startIndex: 3, endIndex: 3},
  {key: "fri", startIndex: 5, endIndex: 5},
]);
const laneByKey = Object.fromEntries(lanes.bars.map((bar) => [bar.key, bar]));
assert(laneByKey["tue-thu"].spanCount === 3 && laneByKey["tue-thu"].lane === 0,
  `multi-day all-day event must be one 3-column bar, got ${JSON.stringify(laneByKey["tue-thu"])}`);
assert(laneByKey.wed.lane === 1, `an overlapping all-day bar must stack, got ${JSON.stringify(laneByKey.wed)}`);
assert(laneByKey.fri.lane === 0, `a non-overlapping all-day bar must reuse lane 0, got ${JSON.stringify(laneByKey.fri)}`);
assert(lanes.laneCount === 2, `lane count should be 2, got ${lanes.laneCount}`);

console.log("calendar time-grid smoke passed");
