#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const appDir = path.join(root, "app");
const sourceFile = path.join(appDir, "src/protyle/render/av/calendar/ics.ts");
const requireFromApp = createRequire(path.join(appDir, "package.json"));
const ts = requireFromApp("typescript");
const tempDir = fs.mkdtempSync(path.join(appDir, ".calendar-ics-smoke-"));

const fail = (message) => {
  console.error(`calendar ICS import smoke failed: ${message}`);
  process.exitCode = 1;
};

try {
  if (!fs.existsSync(sourceFile)) {
    fail("missing app/src/protyle/render/av/calendar/ics.ts");
  } else {
    const result = ts.transpileModule(fs.readFileSync(sourceFile, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: "ics.ts",
    });
    const outputFile = path.join(tempDir, "ics.js");
    fs.writeFileSync(outputFile, result.outputText);
    const {decodeICSBytes, parseICSCalendar} = requireFromApp(outputFile);
    const input = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:all-day@example.test",
      "DTSTART;VALUE=DATE:20260803",
      "DTEND;VALUE=DATE:20260806",
      "SUMMARY:Summer\\, planning",
      "DESCRIPTION:First line\\nsecond line that is",
      " folded",
      "LOCATION:Room\\; A",
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4;WKST=MO",
      "EXDATE;VALUE=DATE:20260817,20260831",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:timed@example.test",
      "DTSTART:20260731T070000Z",
      "DURATION:PT90M",
      "SUMMARY:UTC meeting",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:windows-tz@example.test",
      "DTSTART;TZID=W. Europe Standard Time:20260804T090000",
      "DTEND;TZID=W. Europe Standard Time:20260804T100000",
      "SUMMARY:Windows timezone meeting",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:cancelled@example.test",
      "STATUS:CANCELLED",
      "DTSTART;VALUE=DATE:20260809",
      "SUMMARY:Do not import",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseICSCalendar(input);
    if (events.length !== 3) fail(`expected 3 events, got ${events.length}`);
    const allDay = events.find(event => event.draft.title === "Summer, planning")?.draft;
    if (allDay?.title !== "Summer, planning") fail("escaped summary was not decoded");
    if (allDay?.date !== "2026-08-03" || allDay?.endDate !== "2026-08-05" || !allDay?.isAllDay) {
      fail(`all-day range was not converted from exclusive DTEND: ${JSON.stringify(allDay)}`);
    }
    if (allDay?.description !== "First line\nsecond line that isfolded") fail("folded/escaped description was not decoded");
    if (allDay?.location !== "Room; A") fail("escaped location was not decoded");
    if (allDay?.recurrenceRaw !== "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4") fail(`unsupported RRULE keys were not filtered: ${allDay?.recurrenceRaw}`);
    if (allDay?.recurrenceExceptionRaw !== "2026-08-17,2026-08-31") fail(`EXDATE values were not normalized: ${allDay?.recurrenceExceptionRaw}`);
    const timed = events.find(event => event.draft.title === "UTC meeting")?.draft;
    if (timed?.date !== "2026-07-31" || timed?.startTime !== "09:00" || timed?.endTime !== "10:30" || timed?.isAllDay) {
      fail(`UTC/DURATION event was not converted in Europe/Berlin: ${JSON.stringify(timed)}`);
    }
    if (events[0]?.draft.title !== "UTC meeting" || events[1]?.draft.title !== "Summer, planning") {
      fail(`ICS events were not sorted by start date: ${events.map(event => event.draft.title).join(", ")}`);
    }
    const windowsTimezone = events.find(event => event.draft.title === "Windows timezone meeting")?.draft;
    if (windowsTimezone?.date !== "2026-08-04" || windowsTimezone.startTime !== "09:00" || windowsTimezone.endTime !== "10:00") {
      fail(`Windows timezone ID was not resolved: ${JSON.stringify(windowsTimezone)}`);
    }
    const latin1Source = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "DTSTART:20260801T100000",
      "DTEND:20260801T110000",
      "SUMMARY:Event Två",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const latin1Bytes = Buffer.from(latin1Source, "latin1");
    const latin1Events = parseICSCalendar(decodeICSBytes(latin1Bytes));
    if (latin1Events[0]?.draft.title !== "Event Två") fail(`legacy Latin-1 ICS was not decoded: ${latin1Events[0]?.draft.title}`);
    if (events[0]?.draft.date > events[1]?.draft.date) fail("ICS events were not sorted by start date");
    const layoutSource = fs.readFileSync(path.join(appDir, "src/protyle/render/av/layout.ts"), "utf8");
    for (const contract of [
      'data-type="calendar-import-ics"',
      'accept=".ics,text/calendar"',
      "parseICSCalendar",
      "decodeICSBytes",
      "createCalendarEventAsDocument",
      "createCalendarEvent(createOptions)",
      "ensureCalendarRecurrenceStorage",
    ]) {
      if (!layoutSource.includes(contract)) fail(`Calendar settings/import path missing ${contract}`);
    }
    const storageSource = fs.readFileSync(path.join(appDir, "src/protyle/render/av/calendar/recurrence-storage.ts"), "utf8");
    if (!storageSource.includes('fetchSyncPost("/api/av/renderAttributeView"')) {
      fail("recurrence storage does not read back the committed mapping");
    }
    if (!process.exitCode) {
      console.log("calendar ICS import smoke passed: parser, settings control, page/row create, and recurrence read-back contracts");
    }
  }
} finally {
  fs.rmSync(tempDir, {recursive: true, force: true});
}
