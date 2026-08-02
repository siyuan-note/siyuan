#!/usr/bin/env node
import fs from 'node:fs';

const render = fs.readFileSync('app/src/protyle/render/av/calendar/render.ts', 'utf8');
// The chip markup moved out of render.ts into event-chip.ts; the assertions that
// covered it moved with it rather than being dropped.
const eventChip = fs.readFileSync('app/src/protyle/render/av/calendar/event-chip.ts', 'utf8');
const contextMenu = fs.readFileSync('app/src/protyle/render/av/calendar/context-menu.ts', 'utf8');
const dialog = fs.readFileSync('app/src/protyle/render/av/calendar/event-dialog.ts', 'utf8');
const normalize = fs.readFileSync('app/src/protyle/render/av/calendar/normalize.ts', 'utf8');
const layout = fs.readFileSync('app/src/protyle/render/av/layout.ts', 'utf8');
const scss = fs.readFileSync('app/src/assets/scss/business/_av.scss', 'utf8');

const checks = [
  [normalize.includes('sourceCard: card'), 'normalize keeps sourceCard on events'],
  // The bound document id is derived from the block VALUE id, never from
  // value.isDetached (omitempty, so absent on bound rows) - see getBoundBlockID.
  [normalize.includes('blockID: getBoundBlockID(card)'), 'normalize keeps the bound document id on events'],
  [!eventChip.includes('calendar-open-source') && !eventChip.includes('>↗</span>'), 'event chips omit the redundant inline open-source affordance'],
  [render.includes('openCalendarEventSource'), 'renderer can open source from a bound Termin'],
  [render.includes('eventElement.addEventListener("click"') && render.includes('openEventSchedulingFor(calendarEvent)'), 'single Termin activation opens scheduling preview'],
  [render.includes('eventElement.addEventListener("dblclick"') && /if \(calendarEvent && getEventDocumentID\(calendarEvent\)\) \{\s*\n\s*openCalendarEventSource/.test(render), 'double Termin activation opens the bound page'],
  [dialog.includes('calendarSource') && dialog.includes('event-source'), 'dialog shows explicit source note/block context'],
  [dialog.includes('event-open-block') && dialog.includes('calendarOpenSource') && dialog.includes('av__calendar-event-source'), 'dialog source row is the obvious Open source action'],
  [scss.includes('&-source') && scss.includes('&-event-source'), 'dialog source note remains styled in calendar SCSS'],

  // Page-per-entry: a BOUND chip opens its page on double click through
  // upstream's openDatabaseRowByData. Plain activation opens scheduling preview.
  [render.includes('import {openDatabaseRowByData} from "../openDatabaseRow";'), 'calendar opens pages through the shared database-row opener'],
  [render.includes('openDatabaseRowByData(protyle, {') && render.includes('boundBlockID: documentID') && render.includes('isDetached: false'), 'bound entries open as a real database row/page'],
  [render.includes('eventOpenTimers') && render.includes('openEventSchedulingFor(calendarEvent)'), 'single-click scheduling is separated from double-click page opening'],
  [!eventChip.includes('av__calendar-schedule') && !eventChip.includes('calendar-open-dialog'), 'event chips hide permanent action affordances'],
  // The chip lost its inline buttons; the right-click menu is where those actions
  // went, and it must still reach the page and the scheduling dialog by name.
  [contextMenu.includes('data-type="calendar-open-source"') && contextMenu.includes('data-type="calendar-open-dialog"'), 'context menu keeps the open-page and scheduling entry points'],
  [render.includes('command.type === "calendar-open-source"') && render.includes('command.type === "calendar-open-dialog"'), 'renderer routes the menu open-page/scheduling commands'],
  [!scss.includes('&-schedule {'), 'retired scheduling affordance has no stale calendar SCSS'],
  [!/openFileById\(/.test(render) && !/openMobileFileById\(/.test(render), 'calendar no longer bypasses the database-row opener with a bare openFileById'],

  // The per-view "new entries" target that decides whether a page exists at all.
  [layout.includes('data-type="calendar-new-item-target"'), 'layout panel exposes the new-entry target'],
  [layout.includes('setAttrViewCalendarNewItemTarget') && /action: "setAttrViewCalendarNewItemTarget",[\s\S]{0,120}viewID/.test(layout), 'new-entry target setter is emitted per view'],
  [scss.includes('&-config-row') && scss.includes('&-new-item-target'), 'new-entry config row styled in calendar SCSS'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error('calendar source-link smoke failed:');
  for (const [, message] of failed) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`calendar source-link smoke passed: ${checks.length} source-link checks`);
