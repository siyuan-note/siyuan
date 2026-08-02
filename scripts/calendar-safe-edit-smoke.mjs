#!/usr/bin/env node
import fs from 'node:fs';

const dialog = fs.readFileSync('app/src/protyle/render/av/calendar/event-dialog.ts', 'utf8');
const baseDialog = fs.readFileSync('app/src/dialog/index.ts', 'utf8');

const checks = [
  [!dialog.includes('getDraftFingerprint'), 'cancel does not fingerprint unsaved changes'],
  [!dialog.includes('initialDraftFingerprint'), 'cancel does not store a dirty baseline'],
  [!dialog.includes('isEventDialogDirty'), 'cancel has no dirty check'],
  [!dialog.includes('closeEventDialogSafely'), 'cancel has no confirmation wrapper'],
  [!/event-cancel[^\n]*closeEventDialogSafely/.test(dialog), 'Abbrechen never routes through confirmation'],
  [/event-cancel[^\n]*dialog\.destroy\(\)/.test(dialog), 'Abbrechen destroys the dialog directly'],
  [((dialog.includes('saveButton.disabled = true') && dialog.includes('saveButton.disabled = false')) || (dialog.includes('actionButton.disabled = true') && dialog.includes('actionButton.disabled = false'))), 'save disables while pending and restores on failure'],
  [dialog.includes('options.onSave?.()') && dialog.includes('dialog.destroy()'), 'successful save still closes dialog and rerenders'],
  [dialog.includes('disableClose: true'), 'base scrim and close icon cannot destroy event dialog directly'],
  [dialog.includes('bindGuardedEventDialogClose'), 'installs guarded close behavior for Escape/close controls'],
  [dialog.includes('event.key !== "Escape"') && dialog.includes('addEventListener("keydown"') && dialog.includes('true'), 'Escape is captured before global dialog destroy'],
  [dialog.includes('event.stopPropagation()') && dialog.includes('event.preventDefault()'), 'guarded Escape prevents global silent destroy'],
  [dialog.includes('data-type="event-close"') && dialog.includes('[data-type="event-close"]'), 'event dialog owns visible X close control'],
  [dialog.includes('[data-type="event-close"') && /event-close[^\n]*dialog\.destroy\(\)/.test(dialog), 'owned X closes directly without confirmation'],
  [dialog.includes('destroyCallback') && dialog.includes('removeEventListener("keydown"'), 'Escape guard is removed when dialog is destroyed'],
  [baseDialog.includes('disableClose') && baseDialog.includes('this.destroy();'), 'base dialog normally destroys on scrim/close, proving event dialog must opt out'],
  // Removing the page stays a separate explicit action, but clicking that action
  // must execute directly instead of opening a second confirmation dialog.
  [dialog.includes('data-type="event-delete-page"'), 'removing the page is a separate explicit action, not the default delete'],
  [!dialog.includes('confirmDialog'), 'calendar actions do not open a second confirmation dialog'],
  [/event-delete-page[^\n]*withCalendarDialogOperationFeedback\([\s\S]*?deleteEventWithPage/.test(dialog), 'page removal executes directly from its explicit button'],
  [/const deleteEventWithPage[\s\S]*?if \(!await deleteEvent\([\s\S]*?deleteCalendarEventDocument/.test(dialog), 'page removal only runs after the row removal succeeded'],
  [!/deleteCalendarEventDocument/.test(dialog.match(/const deleteEvent = async[\s\S]*?\n};/)?.[0] || 'deleteCalendarEventDocument'), 'the plain delete removes the row only and never touches the page'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error('calendar safe-edit smoke failed:');
  for (const [, message] of failed) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`calendar safe-edit smoke passed: ${checks.length} guarded dirty-close/pending checks`);
