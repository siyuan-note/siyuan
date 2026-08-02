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
  console.error(`calendar transactions smoke failed: ${message}`);
  process.exit(1);
};

const tempDir = fs.mkdtempSync(path.join(appDir, ".calendar-tx-smoke-"));
const tempCalendarDir = path.join(tempDir, "src/protyle/render/av/calendar");
const tempTransactionDir = path.join(tempDir, "src/protyle/wysiwyg");
const tempUtilDir = path.join(tempDir, "src/util");
const tempDialogDir = path.join(tempDir, "src/dialog");
const tempConstantsDir = path.join(tempDir, "src");
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
  fs.writeFileSync(path.join(tempCalendarDir, file.replace(/\.ts$/, ".js")), result.outputText);
};

const assert = (condition, message) => {
  if (!condition) {
    fail(message);
  }
};

const timestamp = (value) => new Date(value).getTime();

const field = (id, type, extra = {}) => ({
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
  ...extra,
});

const cell = (rowID, keyID, type, value) => ({
  id: `${rowID}-${keyID}`,
  valueType: type,
  color: "",
  bgColor: "",
  value: {
    id: `${rowID}-${keyID}`,
    keyID,
    type,
    ...value,
  },
});

// kernel/av/value.go ValueBlock.ID is "绑定的块 ID，非绑定块时为空" and
// kernel/model/attribute_view.go only assigns it when !isDetached, so a DETACHED
// row carries an empty block id. IsDetached itself is `omitempty`, so a BOUND row
// never carries the flag at all - the fixtures mirror exactly that wire shape.
const makeEvent = (overrides = {}) => {
  const rowID = overrides.id || "row-event";
  const boundBlockID = overrides.boundBlockID || "";
  const start = overrides.start || requireFromApp("dayjs")("2026-05-24T09:00:00");
  const end = overrides.end || requireFromApp("dayjs")("2026-05-24T10:00:00");
  const sourceCard = {
    id: rowID,
    values: [
      boundBlockID ?
        cell(rowID, "block", "block", {block: {id: boundBlockID, content: "Original title"}}) :
        cell(rowID, "block", "block", {block: {id: "", content: "Original title"}, isDetached: true}),
      cell(rowID, "date", "date", {
        date: {
          content: start.valueOf(),
          isNotEmpty: true,
          content2: end.valueOf(),
          isNotEmpty2: true,
          hasEndDate: true,
          isNotTime: false,
        },
      }),
      cell(rowID, "recurrence", "text", {text: {content: "FREQ=WEEKLY;COUNT=5"}}),
      cell(rowID, "exception", "text", {text: {content: "2026-05-31"}}),
      cell(rowID, "location", "text", {text: {content: "Old room"}}),
      cell(rowID, "description", "text", {text: {content: "Old notes"}}),
      cell(rowID, "color", "select", {mSelect: [{content: "Focus", color: "1"}]}),
    ],
  };
  return {
    id: rowID,
    blockID: boundBlockID,
    title: "Original title",
    start,
    end,
    isAllDay: false,
    dateCell: sourceCard.values[1],
    recurrenceRaw: "FREQ=WEEKLY;COUNT=5",
    recurrence: {freq: "WEEKLY", count: 5},
    recurrenceExceptionRaw: "2026-05-31",
    recurrenceExceptions: ["2026-05-31"],
    location: "Old room",
    description: "Old notes",
    color: "1",
    colorContent: "Focus",
    sourceCard,
    ...overrides,
  };
};

const mapping = {
  dateFieldID: "date",
  recurrenceFieldID: "recurrence",
  exceptionFieldID: "exception",
  locationFieldID: "location",
  descriptionFieldID: "description",
  colorFieldID: "color",
  hasDateField: true,
};

const fields = [
  field("date", "date"),
  field("recurrence", "text"),
  field("exception", "text"),
  field("location", "text"),
  field("description", "text"),
  field("computed", "template"),
  field("color", "select", {options: [{name: "Focus", color: "1"}, {name: "Travel", color: "2"}]}),
];

const draft = {
  title: "Updated title",
  date: "2026-06-07",
  endDate: "2026-06-07",
  isAllDay: false,
  startTime: "11:30",
  endTime: "11:00",
  recurrenceRaw: "None",
  recurrenceExceptionRaw: "",
  location: "New room",
  description: "New notes",
  colorContent: "Travel",
};

try {
  fs.mkdirSync(tempCalendarDir, {recursive: true});
  fs.mkdirSync(tempTransactionDir, {recursive: true});
  fs.mkdirSync(tempUtilDir, {recursive: true});
  fs.mkdirSync(tempDialogDir, {recursive: true});
  fs.writeFileSync(path.join(tempDialogDir, "message.js"), `
const messages = [];
exports.showMessage = (message) => { messages.push(String(message)); };
exports.__calendarMessages = messages;
`);
  fs.writeFileSync(path.join(tempConstantsDir, "constants.js"), `
exports.Constants = {SIYUAN_APPID: "calendar-smoke-app"};
`);
  // transactions.ts re-reads the attribute view after every write (see the D3
  // read-back verification), so the stub has to answer that endpoint too. By
  // default it returns a view with no card list, which the frontend treats as
  // "cannot be verified" and therefore does not turn into a false failure.
  fs.writeFileSync(path.join(tempUtilDir, "fetch.js"), `
const calls = [];
const apiCalls = [];
const responses = {};
let renderView = {};
exports.__setRenderView = (view) => { renderView = view; };
// Non-transaction endpoints (createAttributeViewItem, renameDocByID,
// removeDocByID) answer {code: 0} unless the test installs a handler.
exports.__setResponse = (url, handler) => { responses[url] = handler; };
exports.__apiCalls = apiCalls;
exports.fetchSyncPost = async (url, body) => {
  if (url === "/api/av/renderAttributeView") {
    return {code: 0, data: {view: renderView}};
  }
  if (url !== "/api/transactions") {
    apiCalls.push({url, body});
    const handler = responses[url];
    return handler ? handler(body) : {code: 0, data: {}};
  }
  const tx = body.transactions[0];
  calls.push({
    doOperations: tx.doOperations,
    undoOperations: tx.undoOperations,
    reqId: body.reqId,
  });
  return {code: 0, data: [{doOperations: tx.doOperations}]};
};
exports.__calendarTransactionCalls = calls;
`);
  for (const file of ["model.ts", "transactions.ts"]) {
    compile(file);
  }

  let nodeCounter = 0;
  global.Lute = {NewNodeID: () => `20260524000000-smoke${String(++nodeCounter).padStart(2, "0")}`};
  global.window = {siyuan: {config: {fileTree: {openFilesUseCurrentTab: false}}, languages: {}}};

  const transactionsModule = await import(path.join(tempCalendarDir, "transactions.js"));
  const fetchStub = await import(path.join(tempUtilDir, "fetch.js"));
  const messageStub = await import(path.join(tempDialogDir, "message.js"));
  const calls = fetchStub.__calendarTransactionCalls;
  const apiCalls = fetchStub.__apiCalls;
  const messages = messageStub.__calendarMessages;
  const baseOptions = {
    protyle: {id: "calendar-smoke-protyle", undo: {add: () => undefined}},
    avID: "av-smoke",
    blockID: "block-smoke",
    dateFieldID: "date",
    fields,
    mapping,
    previousUpdated: "20260523000000",
  };

  assert(await transactionsModule.createCalendarEvent({...baseOptions, draft: {...draft, date: "2026-02-31"}}) === false,
    "create should reject impossible dates");
  assert(calls.length === 0, "invalid create should not call transaction");

  assert(await transactionsModule.createCalendarEvent({...baseOptions, draft}) === true, "valid create should succeed");
  const createCall = calls.pop();
  assert(createCall.doOperations[0].action === "insertAttrViewBlock", "create should insert an AV block first");
  assert(createCall.doOperations.some((op) => op.action === "updateAttrViewCell" && op.keyID === "date" &&
    op.data.date.content === timestamp("2026-06-07T11:30:00") &&
    op.data.date.content2 === timestamp("2026-06-07T12:30:00")), "create should clamp invalid end time to one hour after start");
  assert(createCall.doOperations.some((op) => op.keyID === "recurrence" && op.data.text?.content === ""),
    "create should normalize recurrence None to an empty recurrence cell");
  assert(createCall.doOperations.some((op) => op.keyID === "description" && op.data.text?.content === "New notes"),
    "create should write mapped text descriptions");
  // Template cells are computed by the kernel, so the calendar must never emit a
  // template payload — a write into one is always discarded on the next render.
  assert(!createCall.doOperations.some((op) => op.data?.type === "template"),
    "create must not write into computed template fields");
  assert(createCall.doOperations.some((op) => op.keyID === "color" && op.data.mSelect?.[0]?.content === "Travel" && op.data.mSelect?.[0]?.color === "2"),
    "create should write mapped select color values");
  assert(createCall.undoOperations.some((op) => op.action === "removeAttrViewBlock"), "create should be undoable by removing the inserted row");
  // The kernel creates the item under srcs[].itemID and ignores srcs[].id for a
  // detached row, so both must be the row ID every following cell targets.
  const createInsertSrc = createCall.doOperations[0].srcs[0];
  const createCellRowIDs = new Set(createCall.doOperations.filter((op) => op.action === "updateAttrViewCell").map((op) => op.rowID));
  assert(createCall.doOperations[0].srcs.length === 1, "create should insert exactly one row");
  assert(createInsertSrc.itemID === createInsertSrc.id,
    `create should mint ONE id for the new row, got itemID=${createInsertSrc.itemID} id=${createInsertSrc.id}`);
  assert(createCellRowIDs.size === 1 && createCellRowIDs.has(createInsertSrc.itemID),
    `create cells must target the inserted itemID, got ${[...createCellRowIDs].join(",")} for itemID=${createInsertSrc.itemID}`);
  assert(createCall.undoOperations.some((op) => op.action === "removeAttrViewBlock" && op.srcIDs?.[0] === createInsertSrc.itemID),
    "create undo should remove the inserted itemID");

  const event = makeEvent();
  assert(await transactionsModule.updateCalendarEvent({...baseOptions, event, draft: {...draft, date: "invalid"}}) === false,
    "update should reject invalid dates");
  assert(calls.length === 0, "invalid update should not call transaction");

  assert(await transactionsModule.updateCalendarEvent({...baseOptions, event, draft}) === true, "valid update should succeed");
  const updateCall = calls.pop();
  assert(updateCall.doOperations.some((op) => op.keyID === "block" && op.data.block?.content === "Updated title"),
    "update should rename the source block cell");
  assert(updateCall.doOperations.some((op) => op.keyID === "date" && op.data.date.content2 === timestamp("2026-06-07T12:30:00")),
    "update should clamp invalid end time");
  assert(updateCall.undoOperations.some((op) => op.keyID === "date" && op.data.date.content === timestamp("2026-05-24T09:00:00")),
    "update should retain undo snapshot for the old date value");

  assert(await transactionsModule.deleteCalendarOccurrence({
    protyle: {id: "calendar-smoke-protyle", undo: {add: () => undefined}},
    avID: "av-smoke",
    blockID: "block-smoke",
    fields,
    mapping,
    event,
    occurrenceDate: "2026-06-07",
    previousUpdated: "20260523000000",
  }) === true, "delete occurrence should write an exception");
  const occurrenceDeleteCall = calls.pop();
  assert(occurrenceDeleteCall.doOperations.some((op) => op.keyID === "exception" && op.data.text?.content === "2026-05-31,2026-06-07"),
    "delete occurrence should merge and sort exceptions");

  const occurrence = makeEvent({
    isOccurrence: true,
    occurrenceID: "row-event:20260607",
    baseEventID: "row-event",
    start: requireFromApp("dayjs")("2026-06-07T09:00:00"),
    end: requireFromApp("dayjs")("2026-06-07T10:00:00"),
  });
  assert(await transactionsModule.createCalendarEventReplacingOccurrence({
    ...baseOptions,
    event: occurrence,
    draft: {...draft, recurrenceRaw: "FREQ=DAILY;COUNT=9", recurrenceExceptionRaw: "2026-06-08"},
    occurrenceDate: "2026-06-07",
  }) === true, "replacing one occurrence should succeed");
  const replaceCall = calls.pop();
  assert(replaceCall.doOperations[0].keyID === "exception", "replacement should first hide the original occurrence");
  assert(replaceCall.doOperations.some((op) => op.action === "insertAttrViewBlock"), "replacement should create a new one-off row");
  assert(!replaceCall.doOperations.some((op) => op.keyID === "recurrence" && op.data.text?.content === "FREQ=DAILY;COUNT=9"),
    "replacement should not copy recurrence rules into the one-off event");
  assert(!replaceCall.doOperations.some((op) => op.keyID === "exception" && op.rowID !== event.id && op.data.text?.content),
    "replacement should not copy exception values into the one-off event");

  assert(await transactionsModule.updateCalendarEventThisAndFuture({
    ...baseOptions,
    event,
    draft: {...draft, recurrenceRaw: "FREQ=WEEKLY;COUNT=5"},
    occurrenceDate: "2026-06-07",
  }) === true, "this-and-future split should succeed");
  const splitCall = calls.pop();
  assert(splitCall.doOperations.some((op) => op.rowID === event.id && op.keyID === "recurrence" &&
    op.data.text?.content === "FREQ=WEEKLY;COUNT=5;UNTIL=2026-06-06"), "split should truncate the original series before the edited occurrence");
  assert(splitCall.doOperations.some((op) => op.action === "insertAttrViewBlock"), "split should create the future series row");
  assert(splitCall.doOperations.some((op) => op.rowID !== event.id && op.keyID === "recurrence" &&
    op.data.text?.content === "FREQ=WEEKLY;COUNT=3"), "split should reduce COUNT for the new future series");

  const reorderedEvent = {
    ...event,
    recurrenceRaw: "FREQ=WEEKLY;BYDAY=MO;COUNT=5",
    recurrence: {freq: "WEEKLY", count: 5, byDay: ["MO"]},
  };
  assert(await transactionsModule.updateCalendarEventThisAndFuture({
    ...baseOptions,
    event: reorderedEvent,
    draft: {...draft, recurrenceRaw: "FREQ=WEEKLY;COUNT=5;BYDAY=MO"},
    occurrenceDate: "2026-06-07",
  }) === true, "this-and-future split should ignore equivalent RRULE part ordering");
  const reorderedSplitCall = calls.pop();
  assert(reorderedSplitCall.doOperations.some((op) => op.rowID !== event.id && op.keyID === "recurrence" &&
    op.data.text?.content === "FREQ=WEEKLY;COUNT=3;BYDAY=MO"), "equivalent reordered RRULE should still reduce COUNT");

  assert(await transactionsModule.deleteCalendarEventThisAndFuture({
    protyle: baseOptions.protyle,
    avID: baseOptions.avID,
    blockID: baseOptions.blockID,
    fields,
    mapping,
    event,
    occurrenceDate: "2026-06-07",
  }) === true, "this-and-future delete should truncate the original series");
  const deleteFutureCall = calls.pop();
  assert(deleteFutureCall.doOperations.some((op) => op.rowID === event.id && op.keyID === "recurrence" &&
    op.data.text?.content === "FREQ=WEEKLY;COUNT=5;UNTIL=2026-06-06"), "this-and-future delete should stop before the selected occurrence");
  assert(!deleteFutureCall.doOperations.some((op) => op.action === "insertAttrViewBlock"), "this-and-future delete must not create a follow-up series");

  assert(await transactionsModule.deleteCalendarEvent({
    protyle: {id: "calendar-smoke-protyle", undo: {add: () => undefined}},
    avID: "av-smoke",
    blockID: "block-smoke",
    event,
    previousUpdated: "20260523000000",
  }) === true, "delete event should succeed");
  const deleteCall = calls.pop();
  assert(Number.isFinite(deleteCall.reqId), "delete transaction must include reqId");
  assert(deleteCall.doOperations.some((op) => op.action === "removeAttrViewBlock" && op.srcIDs?.[0] === event.id),
    "delete should remove the calendar row");
  assert(deleteCall.undoOperations.some((op) => op.action === "insertAttrViewBlock" && op.srcs?.[0]?.id === event.id),
    "delete undo should restore the event row");
  assert(deleteCall.undoOperations.some((op) => op.action === "updateAttrViewCell" && op.keyID === "recurrence"),
    "delete undo should restore metadata cells");
  const deleteUndoSrc = deleteCall.undoOperations.find((op) => op.action === "insertAttrViewBlock").srcs[0];
  assert(deleteUndoSrc.itemID === event.id,
    `delete undo must restore the row under its own item ID, got itemID=${deleteUndoSrc.itemID} instead of ${event.id}`);
  assert(new Set(deleteCall.undoOperations.filter((op) => op.action === "updateAttrViewCell").map((op) => op.rowID)).size === 1,
    "delete undo cells should all target the restored row");

  // ---------------------------------------------------------------------------
  // Page-per-entry: bound rows, document-backed creates, title rename, rollback.
  // ---------------------------------------------------------------------------
  assert(apiCalls.length === 0, "row-only paths must not call any document API");

  const documentID = "20260524000000-docroot";
  const boundEvent = makeEvent({boundBlockID: documentID});
  // kernel/av/value.go:40 marks IsDetached `omitempty`, so the wire payload of a
  // BOUND row carries no isDetached at all: boundness may only be derived from
  // the bound block id.
  assert(boundEvent.sourceCard.values[0].value.isDetached === undefined,
    "bound fixture must mirror the kernel wire shape (isDetached omitted on bound rows)");

  assert(await transactionsModule.deleteCalendarEvent({
    protyle: {id: "calendar-smoke-protyle", undo: {add: () => undefined}},
    avID: "av-smoke",
    blockID: "block-smoke",
    event: boundEvent,
    previousUpdated: "20260523000000",
  }) === true, "deleting a bound event should succeed");
  const boundDeleteCall = calls.pop();
  const boundUndoSrc = boundDeleteCall.undoOperations.find((op) => op.action === "insertAttrViewBlock").srcs[0];
  assert(boundUndoSrc.isDetached === false,
    "delete undo of a BOUND row must restore it bound - reading the omitempty isDetached flag used to detach every restored row");
  assert(boundUndoSrc.id === documentID, "delete undo must rebind the restored row to its document");
  assert(boundUndoSrc.itemID === boundEvent.id, "delete undo must restore the row under its own item id");

  assert(await transactionsModule.updateCalendarEvent({...baseOptions, event: boundEvent, draft}) === true,
    "updating a bound event should succeed");
  assert(calls.length === 0,
    "a bound update must not split the save into a separate /api/transactions write");
  const atomicUpdateCall = apiCalls.pop();
  assert(atomicUpdateCall?.url === "/api/av/updateAttributeViewItem",
    "a bound update must use the kernel atomic item endpoint");
  assert(atomicUpdateCall.body.itemID === boundEvent.id && atomicUpdateCall.body.boundBlockID === documentID,
    "the atomic update must identify both the AV item and its bound document");
  assert(atomicUpdateCall.body.primaryKey === "Updated title",
    "the document title must travel inside the same atomic request as the fields");
  assert(atomicUpdateCall.body.fieldValues.date?.date?.content === timestamp("2026-06-07T11:30:00"),
    "the atomic request must contain the updated date field");
  assert(!Object.prototype.hasOwnProperty.call(atomicUpdateCall.body.fieldValues, "block"),
    "a bound update must never persist a static block-cell title override");
  assert(apiCalls.length === 0, "a bound update should perform exactly one write request");

  fetchStub.__setResponse("/api/av/updateAttributeViewItem", () => ({code: -1, msg: "field update failed"}));
  assert(await transactionsModule.updateCalendarEvent({...baseOptions, event: boundEvent, draft}) === false,
    "a failed atomic update must fail the save");
  assert(calls.length === 0, "a failed atomic update must not fall back to a second transaction");
  assert(apiCalls.pop()?.url === "/api/av/updateAttributeViewItem",
    "failure must still be reported by the one atomic endpoint");
  fetchStub.__setResponse("/api/av/updateAttributeViewItem", undefined);

  assert(await transactionsModule.updateCalendarEvent({...baseOptions, event, draft}) === true, "detached update should still succeed");
  calls.pop();
  assert(apiCalls.length === 0, "a detached row has no page, so it must never rename a document");

  const setCreateItemResponse = (data, code = 0) => fetchStub.__setResponse("/api/av/createAttributeViewItem", () => ({code, data}));

  setCreateItemResponse({itemID: "20260524000000-item01", blockID: "20260524000000-doc01", isDetached: false});
  const createdDocument = await transactionsModule.createCalendarEventAsDocument({
    ...baseOptions,
    viewID: "view-smoke",
    templateID: "template-smoke",
    draft,
  });
  assert(createdDocument?.itemID === "20260524000000-item01" && createdDocument?.blockID === "20260524000000-doc01",
    "document create must report the new item and the document it is bound to");
  const createDocumentCall = apiCalls.pop();
  assert(createDocumentCall.url === "/api/av/createAttributeViewItem", "document create must go through the kernel-only endpoint");
  assert(createDocumentCall.body.primaryKey === "Updated title", "the draft title travels as primaryKey and becomes the document title");
  assert(createDocumentCall.body.viewID === "view-smoke" && createDocumentCall.body.templateID === "template-smoke",
    "document create must pass the view and the new-item template that resolve the page location");
  const documentFieldValues = createDocumentCall.body.fieldValues;
  // Identical payload shapes to the row-only path: the kernel already accepts these.
  assert(documentFieldValues.date.date.content === timestamp("2026-06-07T11:30:00") &&
    documentFieldValues.date.date.content2 === timestamp("2026-06-07T12:30:00"),
    "document create must send the same clamped date value the row-only path sends");
  assert(documentFieldValues.recurrence.text.content === "", "document create must normalize recurrence None to an empty cell");
  assert(documentFieldValues.description.text.content === "New notes", "document create must send mapped text metadata");
  assert(documentFieldValues.color.mSelect?.[0]?.content === "Travel" && documentFieldValues.color.mSelect?.[0]?.color === "2",
    "document create must send mapped select colors");
  assert(!Object.values(documentFieldValues).some((value) => value.type === "template"),
    "document create must not write into computed template fields");
  assert(!documentFieldValues.block, "the title is the document name, never a block cell value");
  assert(calls.length === 0, "document create must not also run a frontend transaction");

  setCreateItemResponse({itemID: "20260524000000-item02", blockID: "20260524000000-item02", isDetached: true});
  const createdWithoutPage = await transactionsModule.createCalendarEventAsDocument({...baseOptions, viewID: "view-smoke", draft});
  assert(createdWithoutPage?.blockID === "",
    "the kernel answers blockID == itemID when no document was created; that must not be reported as an openable page");
  apiCalls.pop();

  const messagesBeforeFallback = messages.length;
  fetchStub.__setResponse("/api/av/createAttributeViewItem", () => ({code: 1, data: {unavailableNotebook: true}}));
  const fallbackItem = await transactionsModule.createCalendarEventAsDocument({...baseOptions, viewID: "view-smoke", draft});
  assert(fallbackItem?.blockID === "", "an unavailable notebook must fall back to a row-only entry instead of blocking the save");
  const fallbackCall = calls.pop();
  assert(fallbackCall.doOperations[0].action === "insertAttrViewBlock" && fallbackCall.doOperations[0].srcs[0].isDetached === true,
    "the unavailable-notebook fallback must insert a detached row");
  assert(fallbackCall.doOperations[0].srcs[0].itemID === fallbackItem.itemID, "the fallback must report the row it actually created");
  assert(messages.length > messagesBeforeFallback, "the fallback must tell the user why the entry has no page");
  apiCalls.pop();

  // An entry whose date cell did not land is INVISIBLE in the calendar, so a
  // read-back that positively proves the cells are missing is repaired once.
  setCreateItemResponse({itemID: "20260524000000-item03", blockID: "20260524000000-doc03"});
  fetchStub.__setRenderView({cards: [{id: "20260524000000-item03", values: []}]});
  assert((await transactionsModule.createCalendarEventAsDocument({...baseOptions, viewID: "view-smoke", draft}))?.itemID === "20260524000000-item03",
    "document create should succeed even when the cells need repairing");
  const repairCall = calls.pop();
  assert(repairCall.doOperations.every((op) => op.action === "updateAttrViewCell" && op.rowID === "20260524000000-item03"),
    "the repair must only write cells of the created item");
  assert(repairCall.doOperations.some((op) => op.keyID === "date" && op.data.date.content === timestamp("2026-06-07T11:30:00")),
    "the repair must restore the date cell the calendar renders from");
  fetchStub.__setRenderView({});
  apiCalls.pop();

  setCreateItemResponse({itemID: "20260524000000-item04", blockID: "20260524000000-doc04"});
  assert(await transactionsModule.createCalendarEventReplacingOccurrence({
    ...baseOptions,
    event: occurrence,
    draft: {...draft, recurrenceRaw: "FREQ=DAILY;COUNT=9", recurrenceExceptionRaw: "2026-06-08"},
    occurrenceDate: "2026-06-07",
    createAsDocument: true,
  }) === true, "replacing one occurrence with a page-backed entry should succeed");
  const documentExceptionCall = calls.pop();
  assert(documentExceptionCall.doOperations[0].keyID === "exception", "the occurrence must be hidden before the replacement page is created");
  assert(!documentExceptionCall.doOperations.some((op) => op.action === "insertAttrViewBlock"),
    "the replacement row is created by the kernel, never by the operation set");
  const replacementCreateCall = apiCalls.pop();
  assert(replacementCreateCall.url === "/api/av/createAttributeViewItem", "the replacement occurrence must get a page too");
  assert(replacementCreateCall.body.fieldValues.recurrence.text.content === "",
    "the page-backed replacement must not inherit the recurrence rule");

  fetchStub.__setResponse("/api/av/createAttributeViewItem", () => ({code: -1, msg: "no notebook"}));
  assert(await transactionsModule.createCalendarEventReplacingOccurrence({
    ...baseOptions,
    event: occurrence,
    draft,
    occurrenceDate: "2026-06-07",
    createAsDocument: true,
  }) === false, "a failed replacement page must fail the edit");
  const replacementRollbackCall = calls.pop();
  assert(replacementRollbackCall.doOperations.some((op) => op.keyID === "exception" && op.data.text?.content === "2026-05-31"),
    "a failed replacement must put the hidden occurrence back, never leave the series with a hole");
  assert(replacementRollbackCall.undoOperations.length === 0, "the rollback must not register itself as an undo step");
  calls.pop();
  apiCalls.pop();

  setCreateItemResponse({itemID: "20260524000000-item05", blockID: "20260524000000-doc05"});
  assert(await transactionsModule.updateCalendarEventThisAndFuture({
    ...baseOptions,
    event,
    draft: {...draft, recurrenceRaw: "FREQ=WEEKLY;COUNT=5"},
    occurrenceDate: "2026-06-07",
    createAsDocument: true,
  }) === true, "page-backed this-and-future split should succeed");
  const documentSplitCall = calls.pop();
  assert(documentSplitCall.doOperations.some((op) => op.rowID === event.id && op.keyID === "recurrence" &&
    op.data.text?.content === "FREQ=WEEKLY;COUNT=5;UNTIL=2026-06-06"), "the split must still truncate the original series");
  assert(!documentSplitCall.doOperations.some((op) => op.action === "insertAttrViewBlock"),
    "the follow-up series row is created by the kernel, never by the operation set");
  const splitCreateCall = apiCalls.pop();
  assert(splitCreateCall.body.fieldValues.recurrence.text.content === "FREQ=WEEKLY;COUNT=3",
    "the page-backed follow-up series must keep the reduced COUNT");

  fetchStub.__setResponse("/api/av/createAttributeViewItem", () => ({code: -1, msg: "no notebook"}));
  assert(await transactionsModule.updateCalendarEventThisAndFuture({
    ...baseOptions,
    event,
    draft: {...draft, recurrenceRaw: "FREQ=WEEKLY;COUNT=5"},
    occurrenceDate: "2026-06-07",
    createAsDocument: true,
  }) === false, "a failed follow-up series page must fail the split");
  const splitRollbackCall = calls.pop();
  assert(splitRollbackCall.doOperations.some((op) => op.keyID === "recurrence" && op.data.text?.content === "FREQ=WEEKLY;COUNT=5"),
    "a failed follow-up series must restore the original recurrence rule");
  calls.pop();
  apiCalls.pop();
  fetchStub.__setResponse("/api/av/createAttributeViewItem", undefined);

  assert(await transactionsModule.deleteCalendarEventDocument(documentID) === true, "page removal should report success");
  const removeDocumentCall = apiCalls.pop();
  assert(removeDocumentCall.url === "/api/filetree/removeDocByID" && removeDocumentCall.body.id === documentID,
    "page removal must call removeDocByID with the document id");
  fetchStub.__setResponse("/api/filetree/removeDocByID", () => ({code: -1, msg: "locked"}));
  assert(await transactionsModule.deleteCalendarEventDocument(documentID) === false, "a failed page removal must be reported");
  apiCalls.pop();
  fetchStub.__setResponse("/api/filetree/removeDocByID", undefined);

  assert(calls.length === 0 && apiCalls.length === 0, "page-per-entry checks must not leak pending calls");

  // /api/transactions always answers code 0, so transactions.ts re-reads the
  // attribute view and must report failure when the write did not land.
  fetchStub.__setRenderView({cards: []});
  assert(await transactionsModule.createCalendarEvent({...baseOptions, draft}) === false,
    "create must report failure when the read-back shows the row was never created");
  calls.pop();
  fetchStub.__setRenderView({});

  console.log("calendar transactions smoke passed: create/update/delete/occurrence replacement/split operations, single-id rows, read-back verification, page-per-entry create/rename/rollback");
} finally {
  fs.rmSync(tempDir, {recursive: true, force: true, maxRetries: 3});
}
