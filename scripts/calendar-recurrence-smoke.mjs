#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const appDir = path.join(root, "app");
const requireFromApp = createRequire(path.join(appDir, "package.json"));
const ts = requireFromApp("typescript");

const fail = (message) => {
  console.error(`calendar recurrence smoke failed: ${message}`);
  process.exit(1);
};

const tempDir = fs.mkdtempSync(path.join(appDir, ".calendar-smoke-"));
const sourceDir = path.join(root, "app/src/protyle/render/av/calendar");

const compile = (file) => {
  const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: false,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: file,
  });
  fs.writeFileSync(path.join(tempDir, file.replace(/\.ts$/, ".js")), result.outputText);
};

const timestamp = (value) => new Date(value).getTime();

const field = (id, type) => ({
  id,
  type,
  name: id,
  desc: "",
  width: "",
  icon: "",
  wrap: false,
  pin: false,
  hidden: false,
  numberFormat: "",
  template: "",
  calc: {},
});

const blockCell = (rowID, title) => ({
  id: `${rowID}-block`,
  valueType: "block",
  color: "",
  bgColor: "",
  value: {
    id: `${rowID}-block`,
    keyID: "block",
    type: "block",
    block: {id: `block-${rowID}`, content: title},
  },
});

const textCell = (rowID, keyID, content) => ({
  id: `${rowID}-${keyID}`,
  valueType: "text",
  color: "",
  bgColor: "",
  value: {
    id: `${rowID}-${keyID}`,
    keyID,
    type: "text",
    text: {content},
  },
});

const selectCell = (rowID, keyID, content, color) => ({
  id: `${rowID}-${keyID}`,
  valueType: "select",
  color: "",
  bgColor: "",
  value: {
    id: `${rowID}-${keyID}`,
    keyID,
    type: "select",
    mSelect: [{content, color}],
  },
});

const dateCell = (rowID, start, end, isAllDay = false) => ({
  id: `${rowID}-date`,
  valueType: "date",
  color: "",
  bgColor: "",
  value: {
    id: `${rowID}-date`,
    keyID: "date",
    type: "date",
    date: {
      content: timestamp(start),
      isNotEmpty: true,
      content2: timestamp(end),
      isNotEmpty2: true,
      hasEndDate: true,
      isNotTime: isAllDay,
    },
  },
});

const card = (rowID, title, start, end, values = {}) => ({
  id: rowID,
  values: [
    blockCell(rowID, title),
    dateCell(rowID, start, end, values.isAllDay),
    textCell(rowID, "recurrence", values.recurrence || ""),
    textCell(rowID, "exception", values.exception || ""),
    textCell(rowID, "location", values.location || ""),
    textCell(rowID, "description", values.description || ""),
    selectCell(rowID, "color", values.colorContent || "Work", values.color || "2"),
  ],
});

try {
  for (const file of ["model.ts", "mapped-fields.ts", "recurrence.ts", "normalize.ts"]) {
    compile(file);
  }

  global.window = {siyuan: {languages: {untitled: "Untitled"}}};

  const dayjs = requireFromApp("dayjs");
  const {getCalendarFieldMapping} = await import(path.join(tempDir, "mapped-fields.js"));
  const {normalizeCalendarEvents} = await import(path.join(tempDir, "normalize.js"));
  const {shouldResetCustomWeekdays} = await import(path.join(tempDir, "recurrence.js"));

  if (!shouldResetCustomWeekdays("weekly", "custom") || shouldResetCustomWeekdays("custom", "custom") || shouldResetCustomWeekdays("weekly", "daily")) {
    fail("preset-to-custom weekday reset decision is incorrect");
  }

  const calendar = {
    dateFieldID: "date",
    viewMode: 0,
    weekStart: 0,
    fields: [
      field("date", "date"),
      field("recurrence", "text"),
      field("exception", "text"),
      field("location", "text"),
      field("description", "text"),
      field("color", "select"),
    ],
    fieldMapping: {
      recurrenceFieldID: "recurrence",
      exceptionFieldID: "exception",
      locationFieldID: "location",
      descriptionFieldID: "description",
      colorFieldID: "color",
    },
    groups: [{
      cards: [card("CC-FFrien", "CC-FFrien", "2026-07-24T00:00:00", "2026-10-12T23:59:59", {isAllDay: true})],
    }],
    cards: [
      card("weekly", "Weekly smoke", "2026-05-24T09:00:00", "2026-05-24T10:00:00", {
        recurrence: "FREQ=WEEKLY;COUNT=3",
        exception: "2026-05-31",
        location: "Desk",
        description: "Metadata path",
        color: "3",
        colorContent: "Deep work",
      }),
      card("none", "None smoke", "2026-05-25T12:00:00", "2026-05-25T13:00:00", {
        recurrence: "None",
      }),
      card("byday", "BYDAY smoke", "2026-05-25T15:00:00", "2026-05-25T16:00:00", {
        recurrence: "FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE",
        exception: "2026-05-27",
      }),
      card("byday-base", "BYDAY base smoke", "2026-05-26T15:00:00", "2026-05-26T16:00:00", {
        recurrence: "FREQ=WEEKLY;COUNT=2;BYDAY=TH",
      }),
      card("month-end", "Month end smoke", "2026-01-31T09:00:00", "2026-01-31T10:00:00", {
        recurrence: "FREQ=MONTHLY;COUNT=4",
      }),
      card("leap-day", "Leap day smoke", "2024-02-29T09:00:00", "2024-02-29T10:00:00", {
        recurrence: "FREQ=YEARLY;COUNT=5",
      }),
    ],
  };

  const mapping = getCalendarFieldMapping(calendar);
  if (!mapping.hasDateField || mapping.recurrenceFieldID !== "recurrence" || mapping.colorFieldID !== "color") {
    fail("field mapping did not preserve expected calendar metadata fields");
  }

  const range = {start: dayjs("2026-05-24"), end: dayjs("2026-06-14").endOf("day")};
  const {events, baseEventsByID} = normalizeCalendarEvents(calendar, mapping, range);
  const weekly = events.filter((event) => event.id === "weekly").map((event) => event.start.format("YYYY-MM-DD"));
  const byday = events.filter((event) => event.id === "byday").map((event) => event.start.format("YYYY-MM-DD"));
  const bydayBase = events.filter((event) => event.id === "byday-base").map((event) => event.start.format("YYYY-MM-DD"));
  const none = events.filter((event) => event.id === "none");

  if (weekly.join(",") !== "2026-05-24,2026-06-07") {
    fail(`weekly recurrence dates were ${weekly.join(",")}`);
  }
  if (byday.join(",") !== "2026-05-25,2026-06-01,2026-06-03") {
    fail(`weekly BYDAY recurrence dates were ${byday.join(",")}`);
  }
  if (bydayBase.join(",") !== "2026-05-28,2026-06-04") {
    fail(`weekly BYDAY recurrence retained an obsolete DTSTART weekday: ${bydayBase.join(",")}`);
  }
  if (none.length !== 1 || none[0].recurrence || none[0].start.format("YYYY-MM-DD") !== "2026-05-25") {
    fail("None recurrence should normalize as a single non-recurring event");
  }

  const edgeRange = {start: dayjs("2024-01-01"), end: dayjs("2028-12-31").endOf("day")};
  const edgeEvents = normalizeCalendarEvents(calendar, mapping, edgeRange).events;
  const monthEnd = edgeEvents.filter((event) => event.id === "month-end").map((event) => event.start.format("YYYY-MM-DD"));
  const leapDay = edgeEvents.filter((event) => event.id === "leap-day").map((event) => event.start.format("YYYY-MM-DD"));
  if (monthEnd.join(",") !== "2026-01-31,2026-02-28,2026-03-31,2026-04-30") {
    fail(`month-end recurrence drifted: ${monthEnd.join(",")}`);
  }
  if (leapDay.join(",") !== "2024-02-29,2025-02-28,2026-02-28,2027-02-28,2028-02-29") {
    fail(`leap-day recurrence drifted: ${leapDay.join(",")}`);
  }

  const recurringOccurrence = events.find((event) => event.id === "weekly" && event.start.format("YYYY-MM-DD") === "2026-06-07");
  if (!recurringOccurrence?.isOccurrence || recurringOccurrence.occurrenceID !== "weekly:20260607") {
    fail("expanded weekly occurrence did not carry occurrence metadata");
  }
  if (recurringOccurrence.location !== "Desk" || recurringOccurrence.description !== "Metadata path" ||
    recurringOccurrence.color !== "3" || recurringOccurrence.colorContent !== "Deep work") {
    fail("expanded recurrence did not preserve mapped metadata");
  }

  const weeklyBase = baseEventsByID.get("weekly");
  if (!weeklyBase || weeklyBase.recurrenceExceptions?.join(",") !== "2026-05-31") {
    fail("base event did not retain parsed recurrence exceptions");
  }

  const autumnRange = {start: dayjs("2026-09-01"), end: dayjs("2026-09-30").endOf("day")};
  const grouped = normalizeCalendarEvents(calendar, mapping, autumnRange).events.find(event => event.id === "CC-FFrien");
  if (!grouped || grouped.start.format("YYYY-MM-DD") !== "2026-07-24" || grouped.end?.format("YYYY-MM-DD") !== "2026-10-12") {
    fail("grouped multi-day CC-FFrien event was not visible across its saved date range");
  }

  console.log(`calendar recurrence smoke passed: ${events.length} normalized events plus grouped multi-day visibility`);
} finally {
  fs.rmSync(tempDir, {recursive: true, force: true, maxRetries: 3});
}
