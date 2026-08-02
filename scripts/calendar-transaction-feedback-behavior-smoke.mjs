#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assertIncludes = (content, needle, label) => {
  if (!content.includes(needle)) {
    throw new Error(`${label}: missing ${needle}`);
  }
};
const assertRegex = (content, regex, label) => {
  if (!regex.test(content)) {
    throw new Error(`${label}: missing pattern ${regex}`);
  }
};
const assertNotRegex = (content, regex, label) => {
  if (regex.test(content)) {
    throw new Error(`${label}: forbidden pattern ${regex}`);
  }
};

const transactions = read('app/src/protyle/render/av/calendar/transactions.ts');
const render = read('app/src/protyle/render/av/calendar/render.ts');
const dialog = read('app/src/protyle/render/av/calendar/event-dialog.ts');

assertIncludes(transactions, 'fetchSyncPost("/api/transactions"', 'calendar transaction awaits backend');
assertIncludes(transactions, 'executeCalendarOperations', 'shared transaction executor');
assertRegex(transactions, /const response = await fetchSyncPost\("\/api\/transactions"[\s\S]*if \(response\?\.code !== 0\)[\s\S]*return true;/, 'backend success result drives truth');
assertNotRegex(transactions, /transaction\(options\.protyle[\s\S]*return true;/, 'calendar helpers must not claim sync transaction success');
assertRegex(transactions, /export const createCalendarEvent = async/, 'create helper async');
assertRegex(transactions, /export const updateCalendarEvent = async/, 'update helper async');
assertRegex(transactions, /export const deleteCalendarEvent = async/, 'delete helper async');

assertRegex(render, /withCalendarOperationFeedback = async[\s\S]*await callback\(\)/, 'render feedback awaits operation');
assertRegex(render, /const saved = await \(scope === \"occurrence\"[\s\S]*updateCalendarEvent/, 'drag resize/move await backend truth');
assertRegex(render, /const saved = createsDocuments \?[\s\S]*createCalendarEventAsDocument[\s\S]*await createCalendarEvent\(createOptions\)/, 'create/duplicate awaits the selected backend path');
assertRegex(render, /const draggedEventElement = calendarElement\?\.querySelector\(`\.av__calendar-event\[data-(?:occurrence|id)=/, 'drop finds dragged event element');
assertRegex(render, /applyScopedEventDraft\(sourceEvent, \(target\) => \{[\s\S]*?draggedEventElement/, 'drop passes operation element for pending guard');
assertRegex(render, /operationElement\?\.dataset\.calendarOperation === "pending"/, 'render duplicate pending guard');
assertNotRegex(render, /showMessage\(operationLabel\)/, 'render must not show saved/submitted success before verified rerender');

assertRegex(dialog, /const withPendingSave = \(dialog: Dialog, saveType: string, callback: \(\) => Promise<boolean>\)/, 'dialog pending save async');
assertRegex(dialog, /const withCalendarDialogOperationFeedback = async[\s\S]*await callback\(\)/, 'dialog feedback awaits operation');
assertRegex(dialog, /const saveEvent = async/, 'saveEvent async');
assertRegex(dialog, /await updateCalendarEvent/, 'save awaits update backend truth');
assertRegex(dialog, /if \(!await (?:createCalendarEvent|updateCalendarEvent|createCalendarEventReplacingOccurrence|updateCalendarEventThisAndFuture|deleteCalendarEvent|deleteCalendarOccurrence)\([\s\S]*return false;[\s\S]*dialog\.destroy\(\)/, 'dialog closes only after awaited true result');
assertNotRegex(dialog, /dialog\.destroy\(\);\n\s*options\.onSave\?\.\(\);\n\s*return true;\n\s*}\);/, 'dialog must not unconditionally close inside sync helper branch');

console.log('calendar transaction feedback behavior smoke passed: backend truth awaited, drop pending guard covered');
