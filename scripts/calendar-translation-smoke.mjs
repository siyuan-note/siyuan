#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const langsDir = path.join(root, "app/appearance/langs");
const localeFiles = fs.readdirSync(langsDir).filter(name => name.endsWith(".json")).sort();
const readLocale = name => JSON.parse(fs.readFileSync(path.join(langsDir, name), "utf8"));
const fail = message => {
  console.error(`calendar translation smoke failed: ${message}`);
  process.exit(1);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

const english = readLocale("en.json");
const recurrenceEditorKeys = [
  "calendarMapLocationHint",
  "calendarMapRecurrenceHint",
  "calendarRepeatEvery",
  "calendarDay",
  "calendarWeek",
  "calendarMonth",
  "calendarYear",
  "calendarRepeatOn",
  "calendarEnd",
  "calendarNever",
  "calendarOn",
  "calendarAfter",
  "calendarOccurrences",
];
const requiredKeys = [
  ...recurrenceEditorKeys,
  "calendarWeekNumber",
  "calendarFiveDayView",
  "calendarDeleteSeries",
  "calendarEditEvent",
  "calendarDeleteEvent",
  "calendarDeleteEventAndDocument",
];
const legitimateCognates = new Set([
  "fr.json:calendarOccurrences",
  "nl.json:calendarWeek",
]);

assert(localeFiles.length === 21, `expected 21 locale files, found ${localeFiles.length}`);
for (const name of localeFiles) {
  const locale = readLocale(name);
  for (const key of requiredKeys) {
    assert(typeof locale[key] === "string" && locale[key].trim(), `${name} missing ${key}`);
  }
  assert(locale.calendarWeekNumber.includes("${x}"), `${name} week-number label must preserve the placeholder`);
  if (name !== "de.json") {
    assert(locale.calendarWeekNumber !== "KW ${x}", `${name} must not reuse the German KW abbreviation`);
  }
  if (name !== "en.json") {
    for (const key of recurrenceEditorKeys) {
      if (locale[key] === english[key] && !legitimateCognates.has(`${name}:${key}`)) {
        fail(`${name} still uses the English ${key} value`);
      }
    }
  }
}

const german = readLocale("de.json");
assert(german.calendarEditEvent === "Termin bearbeiten", "German edit action must use Termin");
assert(german.calendarDeleteEvent === "Termin löschen", "German delete action must use Termin");
assert(german.calendarDeleteRecurring === "Termin löschen", "German recurring delete action must use Termin");
assert(german.calendarDeleteSeries === "Alle löschen", "German delete-all action must say Alle löschen");
assert(german.calendarThisAndFuture === "Diesen Termin und alle folgenden", "German future scope wording must stay explicit");
assert(german.calendarWeekNumber === "KW ${x}", "German week-number label must use KW");
for (const key of [
  "calendarRecurrenceScopeDeleteTitle",
  "calendarRecurrenceScopeEditTitle",
  "calendarRecurrenceScopeOccurrence",
  "calendarRecurrenceScopeOccurrenceDesc",
  "calendarRecurrenceScopeFutureDesc",
  "calendarRecurrenceScopeSeriesDesc",
  "calendarEditSeriesNotice",
]) {
  assert(!/Agenda|Serie|Ereignis|Element|Quelltermin|generiert/i.test(german[key]), `German ${key} uses mixed or technical terminology`);
}

console.log(`calendar translation smoke passed: ${localeFiles.length} locales, ${requiredKeys.length} required keys`);
