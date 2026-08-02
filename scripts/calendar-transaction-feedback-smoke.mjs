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

const render = read('app/src/protyle/render/av/calendar/render.ts');
const dialog = read('app/src/protyle/render/av/calendar/event-dialog.ts');
const scss = read('app/src/assets/scss/business/_av.scss');

assertIncludes(render, 'withCalendarOperationFeedback', 'render feedback helper');
assertIncludes(render, 'calendarOperation', 'render operation state');
assertIncludes(render, 'aria-busy', 'render busy accessibility');
assertIncludes(render, 'av__calendar-event--pending', 'render pending chip class');
assertIncludes(render, 'calendarMoveFailed', 'drag/drop failure message');
assertIncludes(render, 'calendarResizeFailed', 'resize failure message');
assertIncludes(render, 'calendarEventRestored', 'rollback/restored message');
assertRegex(render, /catch \(error\)[\s\S]*rerender\(\)/, 'render failure rerender rollback');
assertRegex(render, /updateEventWithDraft = \([^)]*operationLabel: string[\s\S]*failureMessage: string/, 'operation-specific update feedback');
assertRegex(render, /duplicateEventToNextDay[\s\S]*calendarCreateFailed/, 'duplicate/create failure feedback');

assertIncludes(dialog, 'withCalendarDialogOperationFeedback', 'dialog feedback helper');
assertIncludes(dialog, 'calendarOperation', 'dialog operation state');
assertIncludes(dialog, 'aria-busy', 'dialog busy accessibility');
assertIncludes(dialog, 'calendarSaveFailed', 'dialog save failure message');
assertIncludes(dialog, 'calendarDeleteFailed', 'dialog delete failure message');
assertIncludes(dialog, 'calendarDuplicateFailed', 'dialog duplicate failure message');
assertRegex(dialog, /catch \(error\)[\s\S]*showMessage/, 'dialog catches transaction errors');
assertRegex(dialog, /event-delete[\s\S]*withCalendarDialogOperationFeedback/, 'delete uses pending feedback');
assertRegex(dialog, /event-duplicate[\s\S]*withCalendarDialogOperationFeedback/, 'duplicate uses pending feedback');

assertIncludes(scss, '&-event--pending', 'pending chip styling');
assertIncludes(scss, '&-dialog--pending', 'pending dialog styling');
assertIncludes(scss, 'pointer-events: none', 'pending prevents duplicate pointer interactions');

console.log('calendar transaction feedback smoke passed: render/dialog pending state and rollback feedback checks');
