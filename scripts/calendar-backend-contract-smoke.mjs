#!/usr/bin/env node
/**
 * Calendar backend contract smoke.
 *
 * Unlike scripts/calendar-transactions-smoke.mjs (which asserts on stubbed
 * payloads) and unlike the Electron smokes (which replace
 * app/src/protyle/wysiwyg/transaction.js with a recording stub), this smoke
 * drives the REAL transpiled frontend transaction builders against a REAL
 * isolated SiYuan kernel over the REAL HTTP API, then reads the attribute view
 * back to prove the data actually changed.
 *
 * Why the read-back and the log scan are mandatory:
 *   /api/transactions ALWAYS answers {code: 0}. Per-operation failures are only
 *   reported by kernel/model/transaction.go flushTx() as
 *   `handle attribute view failed: ...` in <workspace>/temp/siyuan.log plus a
 *   generic pushed message. So a code-0 response proves nothing; only the log
 *   and the persisted state do.
 *
 * Isolation / safety:
 *   - random free port (never 6806), temp workspace, temp notebook
 *   - kernel binary built with the fts5 tag into a cache dir under $TMPDIR
 *
 * Env:
 *   SIYUAN_CALENDAR_CONTRACT_KEEP_WORKSPACE=1  keep the temp workspace
 *   SIYUAN_CALENDAR_CONTRACT_KERNEL_BIN=/path  reuse a prebuilt kernel binary
 */
import {spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const kernelDir = path.join(root, "kernel");
const appDir = path.join(root, "app");
const calendarSourceDir = path.join(appDir, "src/protyle/render/av/calendar");
const requireFromApp = createRequire(path.join(appDir, "package.json"));
const ts = requireFromApp("typescript");
const dayjs = requireFromApp("dayjs");
const expectedKernelVersion = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).version;

// ---------------------------------------------------------------------------
// defect ledger: every contract violation is recorded, the run keeps going so
// one broken operation does not hide the next one.
// ---------------------------------------------------------------------------
const defects = [];
const opsCovered = new Set();

const recordDefect = (title, evidence, extra = {}) => {
  const defect = {title, evidence: String(evidence), ...extra};
  defects.push(defect);
  console.error(`\n  DEFECT  ${title}\n          ${String(evidence).split("\n").join("\n          ")}\n`);
  return defect;
};

const fail = (message) => {
  throw new Error(message);
};

const assertOrDefect = (condition, title, evidence, extra = {}) => {
  if (!condition) {
    recordDefect(title, evidence, extra);
    return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// kernel lifecycle (same pattern as scripts/calendar-kernel-smoke.mjs)
// ---------------------------------------------------------------------------
let nodeIDCounter = 0;
const nodeID = () => {
  const now = new Date();
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  // Monotonic suffix so two IDs minted in the same second never collide.
  nodeIDCounter += 1;
  const random = `${Math.random().toString(36).slice(2, 5)}${nodeIDCounter.toString(36)}`.padEnd(7, "0").slice(0, 7);
  return `${stamp}-${random}`;
};

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let baseURL = "";

const postJSON = async (endpoint, body = {}) => {
  const response = await fetch(`${baseURL}${endpoint}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    fail(`${endpoint} returned HTTP ${response.status}`);
  }
  return response.json();
};

const postJSONOk = async (endpoint, body = {}) => {
  const data = await postJSON(endpoint, body);
  if (data.code !== 0) {
    fail(`${endpoint} failed: ${data.msg || JSON.stringify(data)}`);
  }
  return data.data;
};

const waitForBoot = async () => {
  let lastError = "";
  for (let i = 0; i < 240; i++) {
    try {
      const version = await postJSONOk("/api/system/version");
      const progress = await postJSONOk("/api/system/bootProgress");
      if (version === expectedKernelVersion && progress?.progress >= 100) {
        return;
      }
      lastError = `version=${version} progress=${progress?.progress}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(500);
  }
  fail(`kernel did not finish booting: ${lastError}`);
};

// ---------------------------------------------------------------------------
// kernel log tailing: the only place per-operation failures surface
// ---------------------------------------------------------------------------
let logPath = "";
let logOffset = 0;

const readLogDelta = () => {
  if (!logPath || !fs.existsSync(logPath)) {
    return "";
  }
  const size = fs.statSync(logPath).size;
  if (size < logOffset) {
    logOffset = 0;
  }
  if (size === logOffset) {
    return "";
  }
  const fd = fs.openSync(logPath, "r");
  try {
    const length = size - logOffset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, logOffset);
    logOffset = size;
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
};

const resetLogCursor = () => {
  readLogDelta();
};

// Boot-time noise that is unrelated to the calendar contract.
const IGNORED_LOG_PATTERNS = [
  /failed to open the file/i,
  /sync is not enabled/i,
  /get community/i,
  /checking new version/i,
  /cannot get the latest version/i,
  /no such host/i,
  /connection refused/i,
  /i\/o timeout/i,
  /context deadline exceeded/i,
  /dial tcp/i,
];

const collectKernelErrors = (delta) => {
  const lines = delta.split("\n");
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^E \d|^F \d|\[ERROR]|\[FATAL]|PANIC/.test(line)) {
      continue;
    }
    if (IGNORED_LOG_PATTERNS.some(pattern => pattern.test(line))) {
      continue;
    }
    // A PANIC RECOVERED entry is followed by its short stack; keep it, that is
    // the only place the offending kernel line number shows up.
    const block = [line.trim()];
    if (/PANIC/.test(line)) {
      for (let j = i + 1; j < Math.min(i + 9, lines.length); j++) {
        if (/^[EWIF] \d{4}\//.test(lines[j])) {
          break;
        }
        if (lines[j].trim()) {
          block.push(lines[j].trim());
        }
      }
    }
    errors.push(block.join("\n"));
  }
  return errors;
};

/** POST an operation set and return {response, kernelErrors}. */
const performTransactions = async (doOperations, undoOperations = []) => {
  resetLogCursor();
  const response = await postJSON("/api/transactions", {
    app: "calendar-contract-smoke",
    session: "calendar-contract-smoke",
    transactions: [{doOperations, undoOperations}],
    reqId: Date.now(),
  });
  // FlushTxQueue()/WaitForCommit() run before the HTTP response, but the
  // logging write is not part of that barrier, so give it a beat.
  await sleep(250);
  doOperations.forEach(op => op.action && opsCovered.add(op.action));
  return {response, kernelErrors: collectKernelErrors(readLogDelta())};
};

/**
 * Run an operation set as a contract step: code must be 0 AND the kernel log
 * must stay clean. Returns true when the step was clean.
 */
const runOps = async (label, doOperations, undoOperations = []) => {
  const {response, kernelErrors} = await performTransactions(doOperations, undoOperations);
  let clean = assertOrDefect(response.code === 0, `${label}: /api/transactions returned a non-zero code`,
    `code=${response.code} msg=${response.msg}`);
  if (kernelErrors.length > 0) {
    recordDefect(`${label}: kernel logged an error while the HTTP response was code 0`,
      kernelErrors.join("\n"), {actions: doOperations.map(op => op.action)});
    clean = false;
  }
  return clean;
};

// ---------------------------------------------------------------------------
// read-back helpers
// ---------------------------------------------------------------------------
let avID = "";
let avBlockID = "";
let calendarViewID = "";

const renderAV = async (viewID = calendarViewID) => postJSONOk("/api/av/renderAttributeView", {
  id: avID,
  blockID: avBlockID,
  viewID,
  pageSize: -1,
  createIfNotExist: false,
});

const cardByID = (data, itemID) => (data.view.cards || []).find(card => card.id === itemID);

const cellValue = (card, keyID) => card?.values?.find(cell => cell.value?.keyID === keyID)?.value;

const textOf = (card, keyID) => {
  const value = cellValue(card, keyID);
  return value?.text?.content ?? value?.template?.content ?? "";
};

/** Every item ID the AV knows about, across all key values (catches orphans). */
const readAvJSON = () => {
  const file = path.join(workspace, "data", "storage", "av", `${avID}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const orphanItemIDs = () => {
  const av = readAvJSON();
  const known = new Set();
  (av.keyValues || []).forEach(kv => {
    if (kv.key?.type === "block") {
      (kv.values || []).forEach(value => known.add(value.blockID));
    }
  });
  const orphans = new Set();
  (av.keyValues || []).forEach(kv => {
    if (kv.key?.type === "block") {
      return;
    }
    (kv.values || []).forEach(value => {
      if (!known.has(value.blockID)) {
        orphans.add(`${kv.key.name}:${value.blockID}`);
      }
    });
  });
  return [...orphans];
};

// ---------------------------------------------------------------------------
// pushed-transaction capture: the ONLY place the kernel's undo unit is visible
//
// POST /api/av/createAttributeViewItem answers with {itemID, blockID} but the
// Transaction it built (restoreCreatedDoc + insertAttrViewBlock + the cell
// writes, with the matching undoOperations) is pushed over the websocket, and
// that pushed transaction IS what the frontend puts on the undo stack. So the
// "one undoable unit" claim can only be proven by reading it off /ws.
// insertAttrViewBlock contains "attrview", so shouldBroadcastAttrViewTransactions()
// upgrades the push to PushModeBroadcast and our own session receives it too.
// ---------------------------------------------------------------------------
const PUSH_APP = "calendar-contract-smoke";
const PUSH_SESSION = "calendar-contract-smoke-ws";
let pushSocket = null;
const pushedTransactions = [];

const connectPushSocket = async () => {
  const url = `${baseURL.replace(/^http/, "ws")}/ws?app=${PUSH_APP}&id=${PUSH_SESSION}&type=main`;
  const socket = new WebSocket(url);
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch {
      return;
    }
    if (message?.cmd === "transactions" && Array.isArray(message.data)) {
      pushedTransactions.push(...message.data);
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket connect timed out")), 8000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, {once: true});
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket connect failed"));
    }, {once: true});
  });
  pushSocket = socket;
};

/** Wait for the pushed transaction that carries `itemID`, or undefined. */
const waitForPushedTransaction = async (itemID, timeoutMs = 5000) => {
  const matches = (tx) => (tx?.doOperations || []).some(op =>
    (op.srcs || []).some(src => src.itemID === itemID) || op.rowID === itemID ||
    (op.srcIDs || []).includes(itemID));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = pushedTransactions.filter(matches);
    if (found.length > 0) {
      return found;
    }
    await sleep(100);
  }
  return [];
};

/** Recursively locate a .sy file under the workspace data dir. */
const findSyFile = (dir, docID) => {
  let entries;
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return "";
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findSyFile(full, docID);
      if (found) {
        return found;
      }
    } else if (entry.name === `${docID}.sy`) {
      return full;
    }
  }
  return "";
};

/** Root IAL of a created document, read straight off disk (index-lag proof). */
const readDocIAL = (docID) => {
  const file = findSyFile(path.join(workspace, "data"), docID);
  if (!file) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).Properties || {};
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// transpile the real frontend modules
// ---------------------------------------------------------------------------
let tempDir = "";
let workspace = "";
let buildCacheDir = "";

const transpileFrontend = async () => {
  tempDir = fs.mkdtempSync(path.join(appDir, ".calendar-contract-smoke-"));
  const calendarDir = path.join(tempDir, "src/protyle/render/av/calendar");
  const utilDir = path.join(tempDir, "src/util");
  const dialogDir = path.join(tempDir, "src/dialog");
  fs.mkdirSync(calendarDir, {recursive: true});
  fs.mkdirSync(utilDir, {recursive: true});
  fs.mkdirSync(dialogDir, {recursive: true});
  fs.writeFileSync(path.join(tempDir, "src/constants.js"),
    'exports.Constants = {SIYUAN_APPID: "calendar-contract-smoke"};\n');

  // showMessage() is how the transaction helpers surface a failure reason to the
  // user; record the calls so a "returned null/false" defect can name the reason.
  fs.writeFileSync(path.join(dialogDir, "message.js"), `
const messages = [];
exports.__calendarMessages = messages;
exports.showMessage = (text, timeout, type) => { messages.push({text, timeout, type}); return ""; };
exports.hideMessage = () => undefined;
`);

  // The real fetchSyncPost, pointed at the real kernel. Every transaction the
  // frontend performs is recorded so its undoOperations can be replayed later.
  fs.writeFileSync(path.join(utilDir, "fetch.js"), `
const calls = [];
exports.__calendarCalls = calls;
exports.__setTransport = (fn) => { exports.__transport = fn; };
exports.fetchSyncPost = async (url, body) => {
  const result = await exports.__transport(url, body);
  if (url === "/api/transactions") {
    const tx = body.transactions[0];
    calls.push({
      doOperations: tx.doOperations,
      undoOperations: tx.undoOperations,
      response: result.response,
      kernelErrors: result.kernelErrors,
    });
    return result.response;
  }
  return result;
};
`);

  for (const file of ["model.ts", "recurrence.ts", "mapped-fields.ts", "normalize.ts", "transactions.ts"]) {
    const source = fs.readFileSync(path.join(calendarSourceDir, file), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: false,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: file,
    }).outputText;
    fs.writeFileSync(path.join(calendarDir, file.replace(/\.ts$/, ".js")), output);
  }

  global.Lute = {NewNodeID: () => nodeID()};
  global.window = {
    siyuan: {
      languages: {untitled: "Untitled"},
      config: {lang: "en_US", fileTree: {openFilesUseCurrentTab: false}},
    },
  };

  const fetchModule = await import(path.join(utilDir, "fetch.js"));
  fetchModule.__setTransport(async (url, body) => {
    if (url !== "/api/transactions") {
      return postJSON(url, body);
    }
    const tx = body.transactions[0];
    const {response, kernelErrors} = await performTransactions(tx.doOperations, tx.undoOperations);
    return {response, kernelErrors};
  });

  return {
    transactions: await import(path.join(calendarDir, "transactions.js")),
    normalize: await import(path.join(calendarDir, "normalize.js")),
    mappedFields: await import(path.join(calendarDir, "mapped-fields.js")),
    calls: fetchModule.__calendarCalls,
  };
};

// ---------------------------------------------------------------------------
// field IDs used throughout the run
// ---------------------------------------------------------------------------
const keys = {
  date: nodeID(),
  recurrence: nodeID(),
  exception: nodeID(),
  location: nodeID(),
  description: nodeID(),
  color: nodeID(),
  templateProbe: nodeID(),
};

const range = () => ({
  start: dayjs("2026-01-01").startOf("day"),
  end: dayjs("2027-12-31").endOf("day"),
});

const main = async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-calendar-contract-workspace-"));
  buildCacheDir = path.join(os.tmpdir(), "siyuan-calendar-contract-kernel");
  fs.mkdirSync(buildCacheDir, {recursive: true});
  const kernelBinary = process.env.SIYUAN_CALENDAR_CONTRACT_KERNEL_BIN || path.join(buildCacheDir, "SiYuan-Kernel");
  const port = await getFreePort();
  baseURL = `http://127.0.0.1:${port}`;
  logPath = path.join(workspace, "temp", "siyuan.log");
  let kernel;

  try {
    if (!process.env.SIYUAN_CALENDAR_CONTRACT_KERNEL_BIN) {
      console.log("building fts5 kernel...");
      const build = spawnSync("go", ["build", "-tags", "fts5", "-o", kernelBinary, "."], {
        cwd: kernelDir,
        env: {...process.env, CGO_ENABLED: "1"},
        stdio: "inherit",
      });
      if (build.status !== 0) {
        fail(`kernel build failed with code ${build.status}`);
      }
    }

    kernel = spawn(kernelBinary, [
      "serve",
      "--port", String(port),
      "--wd", appDir,
      "--workspace", workspace,
      "--mode", "dev",
      "--lang", "en_US",
    ], {cwd: root, stdio: ["ignore", "pipe", "pipe"]});
    const kernelOutput = [];
    kernel.stdout.on("data", (chunk) => kernelOutput.push(chunk.toString()));
    kernel.stderr.on("data", (chunk) => kernelOutput.push(chunk.toString()));
    kernel.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`kernel exited with ${code}:\n${kernelOutput.slice(-40).join("")}`);
      }
    });

    await waitForBoot();
    resetLogCursor();
    try {
      await connectPushSocket();
    } catch (error) {
      recordDefect("could not attach to the kernel push socket", error.message);
    }

    // -- real notebook + document + attribute view -------------------------
    const notebookData = await postJSONOk("/api/notebook/createNotebook", {
      name: `Calendar Contract ${Date.now()}`,
    });
    const notebookID = notebookData.notebook.id || notebookData.notebook.ID;
    const docData = await postJSONOk("/api/filetree/createDocWithMd", {
      notebook: notebookID,
      path: "/Calendar Contract",
      markdown: "# Calendar Contract\n",
      id: nodeID(),
    });
    const docID = typeof docData === "string" ? docData : (docData.id || docData.ID);

    avID = nodeID();
    avBlockID = nodeID();
    await postJSONOk("/api/block/appendBlock", {
      parentID: docID,
      dataType: "dom",
      data: `<div class="av" data-node-id="${avBlockID}" data-av-id="${avID}" data-type="NodeAttributeView" data-av-type="table"></div>`,
    });
    await postJSONOk("/api/av/renderAttributeView", {
      id: avID, blockID: avBlockID, pageSize: -1, createIfNotExist: true,
    });

    console.log("\n== step: addAttrViewCol / updateAttrViewColOptions ==");
    await runOps("addAttrViewCol", [
      {action: "addAttrViewCol", avID, id: keys.date, name: "Date", type: "date"},
      {action: "addAttrViewCol", avID, id: keys.recurrence, name: "Recurrence", type: "text"},
      {action: "addAttrViewCol", avID, id: keys.exception, name: "Exceptions", type: "text"},
      {action: "addAttrViewCol", avID, id: keys.location, name: "Location", type: "text"},
      {action: "addAttrViewCol", avID, id: keys.description, name: "Description", type: "text"},
      {action: "addAttrViewCol", avID, id: keys.templateProbe, name: "Computed", type: "template"},
      {action: "addAttrViewCol", avID, id: keys.color, name: "Color", type: "select"},
      {
        action: "updateAttrViewColOptions", avID, id: keys.color,
        data: [{name: "Focus", color: "1"}, {name: "Travel", color: "2"}],
      },
    ]);

    console.log("\n== step: changeAttrViewLayout -> calendar ==");
    const calendarData = await postJSONOk("/api/av/changeAttrViewLayout", {
      blockID: avBlockID, avID, layoutType: "calendar",
    });
    assertOrDefect(calendarData.viewType === "calendar",
      "changeAttrViewLayout did not switch the view to calendar",
      `viewType=${calendarData.viewType}`);
    calendarViewID = calendarData.viewID;

    console.log("\n== step: setAttrViewCalendarDateField / WeekStart / ViewMode / FieldMapping ==");
    // Shapes copied verbatim from app/src/protyle/render/av/layout.ts and
    // app/src/protyle/render/av/calendar/render.ts.
    await runOps("setAttrViewCalendarDateField", [{
      action: "setAttrViewCalendarDateField", avID, blockID: avBlockID,
      keyID: keys.date, data: keys.date, viewID: calendarViewID,
    }], [{
      action: "setAttrViewCalendarDateField", avID, blockID: avBlockID,
      keyID: "", data: "", viewID: calendarViewID,
    }]);
    await runOps("setAttrViewCalendarWeekStart", [{
      action: "setAttrViewCalendarWeekStart", avID, blockID: avBlockID, data: 1, viewID: calendarViewID,
    }], [{
      action: "setAttrViewCalendarWeekStart", avID, blockID: avBlockID, data: 0, viewID: calendarViewID,
    }]);
    await runOps("setAttrViewCalendarViewMode", [{
      action: "setAttrViewCalendarViewMode", avID, blockID: avBlockID, data: 1, viewID: calendarViewID,
    }], [{
      action: "setAttrViewCalendarViewMode", avID, blockID: avBlockID, data: 0, viewID: calendarViewID,
    }]);
    for (const [fieldName, keyID] of [
      ["recurrenceFieldID", keys.recurrence],
      ["exceptionFieldID", keys.exception],
      ["locationFieldID", keys.location],
      ["descriptionFieldID", keys.description],
      ["colorFieldID", keys.color],
    ]) {
      // layout.ts sends ONE key per change, exactly like this.
      await runOps(`setAttrViewCalendarFieldMapping(${fieldName})`, [{
        action: "setAttrViewCalendarFieldMapping", avID, blockID: avBlockID,
        data: {[fieldName]: keyID}, viewID: calendarViewID,
      }], [{
        action: "setAttrViewCalendarFieldMapping", avID, blockID: avBlockID,
        data: {[fieldName]: ""}, viewID: calendarViewID,
      }]);
    }

    let data = await renderAV();
    assertOrDefect(data.view.dateFieldID === keys.date,
      "setAttrViewCalendarDateField did not persist", `dateFieldID=${data.view.dateFieldID}`);
    assertOrDefect(data.view.weekStart === 1,
      "setAttrViewCalendarWeekStart did not persist", `weekStart=${data.view.weekStart}`);
    assertOrDefect(data.view.viewMode === 1,
      "setAttrViewCalendarViewMode did not persist", `viewMode=${data.view.viewMode}`);
    for (const [fieldName, keyID] of Object.entries({
      recurrenceFieldID: keys.recurrence,
      exceptionFieldID: keys.exception,
      locationFieldID: keys.location,
      descriptionFieldID: keys.description,
      colorFieldID: keys.color,
    })) {
      assertOrDefect(data.view.fieldMapping?.[fieldName] === keyID,
        `setAttrViewCalendarFieldMapping did not persist ${fieldName}`,
        `got=${data.view.fieldMapping?.[fieldName]} want=${keyID}`);
    }

    console.log("\n== step: layout toggles reachable from a calendar view ==");
    await runOps("hideAttrViewName", [
      {action: "hideAttrViewName", avID, blockID: avBlockID, data: true, viewID: calendarViewID},
    ], [
      {action: "hideAttrViewName", avID, blockID: avBlockID, data: false, viewID: calendarViewID},
    ]);
    await runOps("setAttrViewShowIcon", [
      {action: "setAttrViewShowIcon", avID, blockID: avBlockID, data: true, viewID: calendarViewID},
    ], [
      {action: "setAttrViewShowIcon", avID, blockID: avBlockID, data: false, viewID: calendarViewID},
    ]);
    await runOps("setAttrViewWrapField", [
      {action: "setAttrViewWrapField", avID, blockID: avBlockID, data: true, viewID: calendarViewID},
    ], [
      {action: "setAttrViewWrapField", avID, blockID: avBlockID, data: false, viewID: calendarViewID},
    ]);
    await runOps("setAttrViewPageSize", [
      {action: "setAttrViewPageSize", avID, blockID: avBlockID, data: 50, viewID: calendarViewID},
    ], [
      {action: "setAttrViewPageSize", avID, blockID: avBlockID, data: 10, viewID: calendarViewID},
    ]);

    // -- template fields are computed, so they must be read-only everywhere --
    // fillAttributeViewBaseValue() rewrites a template cell with the field's
    // expression on every render. Writes into one are therefore always lost, so
    // the kernel must REJECT a template field as a writable metadata mapping and
    // the frontend must not offer it (mapped-fields.ts / layout.ts are text-only).
    console.log("\n== step: template fields stay read-only (mapping rejected, writes discarded) ==");
    const probeRowID = nodeID();
    await runOps("template read-only probe", [{
      action: "insertAttrViewBlock", avID, blockID: avBlockID, previousID: "",
      srcs: [{itemID: probeRowID, id: probeRowID, isDetached: true, content: "Template probe"}],
      context: {ignoreTip: "true"},
    }, {
      action: "updateAttrViewCell", avID, keyID: keys.templateProbe, rowID: probeRowID,
      data: {type: "template", keyID: keys.templateProbe, template: {content: "probe payload"}},
    }, {
      action: "updateAttrViewCell", avID, keyID: keys.location, rowID: probeRowID,
      data: {type: "text", keyID: keys.location, text: {content: "probe payload"}},
    }]);
    const probeData = await renderAV();
    const probeCard = cardByID(probeData, probeRowID);
    assertOrDefect(textOf(probeCard, keys.location) === "probe payload",
      "probe: a text-typed metadata cell did not round-trip",
      `got=${textOf(probeCard, keys.location)}`);
    assertOrDefect(textOf(probeCard, keys.templateProbe) !== "probe payload",
      "a template cell unexpectedly persisted a write",
      "template cells are computed; if this ever starts persisting, revisit whether " +
      "template fields may become writable calendar mapping targets again");

    // The kernel must refuse a template field as a writable mapping target.
    const templateMappingRejected = await performTransactions([{
      action: "setAttrViewCalendarFieldMapping", avID, blockID: avBlockID, viewID: calendarViewID,
      data: {descriptionFieldID: keys.templateProbe},
    }], []);
    const mappingAfterReject = await renderAV();
    assertOrDefect(
      (mappingAfterReject.view?.fieldMapping?.descriptionFieldID || "") !== keys.templateProbe,
      "kernel accepted a template field as a writable calendar metadata mapping",
      `fieldMapping.descriptionFieldID=${mappingAfterReject.view?.fieldMapping?.descriptionFieldID} ` +
      `kernelErrors=${templateMappingRejected.kernelErrors.join(" | ") || "(none)"}`,
      {file: "kernel/model/attribute_view.go"});

    await runOps("template read-only probe cleanup",
      [{action: "removeAttrViewBlock", avID, srcIDs: [probeRowID]}]);

    // -- the "no date field yet" empty-state repair button in render.ts -----
    console.log("\n== step: addAttrViewCol + setAttrViewCalendarDateField (empty-state repair) + removeAttrViewCol undo ==");
    const extraDateKeyID = nodeID();
    await runOps("calendar-create-date-field", [{
      action: "addAttrViewCol", avID, id: extraDateKeyID, name: "Date 2", type: "date",
    }, {
      action: "setAttrViewCalendarDateField", avID, blockID: avBlockID,
      keyID: extraDateKeyID, data: extraDateKeyID, viewID: calendarViewID,
    }], [{
      action: "setAttrViewCalendarDateField", avID, blockID: avBlockID,
      keyID: keys.date, data: keys.date, viewID: calendarViewID,
    }, {
      action: "removeAttrViewCol", avID, id: extraDateKeyID,
    }]);
    data = await renderAV();
    assertOrDefect(data.view.dateFieldID === extraDateKeyID,
      "calendar-create-date-field: the newly created date field was not selected",
      `dateFieldID=${data.view.dateFieldID} want=${extraDateKeyID}`);
    await runOps("calendar-create-date-field undo", [{
      action: "setAttrViewCalendarDateField", avID, blockID: avBlockID,
      keyID: keys.date, data: keys.date, viewID: calendarViewID,
    }, {
      action: "removeAttrViewCol", avID, id: extraDateKeyID,
    }]);
    data = await renderAV();
    assertOrDefect(data.view.dateFieldID === keys.date,
      "calendar-create-date-field undo did not restore the previous date field",
      `dateFieldID=${data.view.dateFieldID} want=${keys.date}`);
    assertOrDefect(!data.view.fields.some(field => field.id === extraDateKeyID),
      "calendar-create-date-field undo did not remove the field it had added",
      `fields=${JSON.stringify(data.view.fields.map(f => f.id))}`);

    // ---------------------------------------------------------------------
    // frontend-driven operation sets
    // ---------------------------------------------------------------------
    const frontend = await transpileFrontend();
    const {transactions, normalize, mappedFields, calls} = frontend;
    const protyle = {id: "calendar-contract-protyle", undo: {add: () => undefined}};

    const readState = async () => {
      const rendered = await renderAV();
      const mapping = mappedFields.getCalendarFieldMapping(rendered.view);
      const normalized = normalize.normalizeCalendarEvents(rendered.view, mapping, range());
      return {rendered, mapping, fields: rendered.view.fields, normalized};
    };

    const takeCall = (label) => {
      const call = calls.pop();
      if (!call) {
        recordDefect(`${label}: frontend performed no transaction at all`, "calls stack was empty");
        return undefined;
      }
      if (call.kernelErrors.length > 0) {
        recordDefect(`${label}: kernel logged an error while /api/transactions answered code 0`,
          call.kernelErrors.join("\n"),
          {actions: call.doOperations.map(op => op.action)});
      }
      call.doOperations.forEach(op => op.action && opsCovered.add(op.action));
      call.undoOperations.forEach(op => op.action && opsCovered.add(op.action));
      return call;
    };

    let state = await readState();
    assertOrDefect(state.mapping.hasDateField,
      "the calendar mapping read back from the kernel has no usable date field",
      JSON.stringify(state.mapping));

    console.log("\n== step: createCalendarEvent (insertAttrViewBlock + updateAttrViewCell x N) ==");
    const createDraft = {
      title: "Contract event",
      date: "2026-05-24",
      endDate: "2026-05-24",
      isAllDay: false,
      startTime: "09:00",
      endTime: "10:00",
      recurrenceRaw: "FREQ=WEEKLY;COUNT=5",
      recurrenceExceptionRaw: "2026-05-31",
      location: "Room A",
      description: "Notes A",
      colorContent: "Focus",
    };
    const created = await transactions.createCalendarEvent({
      protyle, avID, blockID: avBlockID,
      dateFieldID: state.mapping.dateFieldID,
      fields: state.fields, mapping: state.mapping,
      draft: createDraft,
    });
    const createCall = takeCall("createCalendarEvent");
    assertOrDefect(created === true, "createCalendarEvent returned false", `returned=${created}`);

    const insertOp = createCall?.doOperations.find(op => op.action === "insertAttrViewBlock");
    const insertedItemID = insertOp?.srcs?.[0]?.itemID;
    const declaredRowID = createCall?.doOperations.find(op => op.action === "updateAttrViewCell")?.rowID;

    state = await readState();
    let card = declaredRowID ? cardByID(state.rendered, declaredRowID) : undefined;
    const realCard = insertedItemID ? cardByID(state.rendered, insertedItemID) : undefined;
    assertOrDefect(!!card,
      "createCalendarEvent: the row its updateAttrViewCell operations target does not exist in the AV",
      `insertAttrViewBlock srcs=${JSON.stringify(insertOp?.srcs)}\n` +
      `updateAttrViewCell rowID=${declaredRowID}\n` +
      `item IDs actually in the view=${JSON.stringify((state.rendered.view.cards || []).map(c => c.id))}\n` +
      `the kernel created the item under srcs[0].itemID, not srcs[0].id: ` +
      `AddAttributeViewBlock() in kernel/model/attribute_view.go reads src["itemID"] as the item ID ` +
      `and only uses src["id"] as the BOUND BLOCK id when isDetached is false\n` +
      `row created under itemID exists=${!!realCard}, its date cell=${JSON.stringify(cellValue(realCard, keys.date))}\n` +
      `orphaned (row-less) values now in av.json=${JSON.stringify(orphanItemIDs())}`,
      {file: "app/src/protyle/render/av/calendar/transactions.ts"});

    const baseEvents = [...state.normalized.baseEventsByID.values()];
    assertOrDefect(baseEvents.length === 1,
      "createCalendarEvent did not produce exactly one normalized calendar event",
      `normalized base events=${baseEvents.length} (cards=${(state.rendered.view.cards || []).length}); ` +
      `an event with no readable date value never renders on the calendar`);

    if (card) {
      const dateValue = cellValue(card, keys.date)?.date;
      assertOrDefect(dateValue?.isNotEmpty === true &&
        dateValue?.content === dayjs("2026-05-24T09:00:00").valueOf(),
        "createCalendarEvent: the date cell did not persist",
        `date value=${JSON.stringify(dateValue)}`);
      assertOrDefect(textOf(card, keys.recurrence) === "FREQ=WEEKLY;COUNT=5",
        "createCalendarEvent: recurrence cell did not persist", `got=${textOf(card, keys.recurrence)}`);
      assertOrDefect(textOf(card, keys.location) === "Room A",
        "createCalendarEvent: location cell did not persist", `got=${textOf(card, keys.location)}`);
      assertOrDefect(textOf(card, keys.description) === "Notes A",
        "createCalendarEvent: description cell did not persist",
        `got=${JSON.stringify(cellValue(card, keys.description))}`);
      assertOrDefect(cellValue(card, keys.color)?.mSelect?.[0]?.content === "Focus",
        "createCalendarEvent: color cell did not persist",
        `got=${JSON.stringify(cellValue(card, keys.color))}`);
      assertOrDefect((cellValue(card, "block")?.block?.content ??
          card.values.find(c => c.valueType === "block")?.value?.block?.content) === "Contract event",
        "createCalendarEvent: the row title from srcs[].content did not persist",
        `got=${JSON.stringify(card.values.find(c => c.valueType === "block")?.value?.block)}`);
    }

    console.log("\n== step: createCalendarEvent undoOperations (Ctrl+Z) ==");
    if (createCall) {
      await runOps("createCalendarEvent undo", createCall.undoOperations, createCall.doOperations);
      state = await readState();
      const stillThere = declaredRowID ? cardByID(state.rendered, declaredRowID) : undefined;
      assertOrDefect(!stillThere && (state.rendered.view.cards || []).length === 0,
        "createCalendarEvent undo did not remove the inserted row: Ctrl+Z leaves a ghost event behind",
        `removeAttrViewBlock srcIDs=${JSON.stringify(createCall.undoOperations.find(op => op.action === "removeAttrViewBlock")?.srcIDs)}\n` +
        `insertAttrViewBlock srcs=${JSON.stringify(insertOp?.srcs)}\n` +
        `item IDs left in the view=${JSON.stringify((state.rendered.view.cards || []).map(c => c.id))}`,
        {file: "app/src/protyle/render/av/calendar/transactions.ts"});
      // Re-do so later steps have an event to work on.
      await runOps("createCalendarEvent redo", createCall.doOperations, createCall.undoOperations);
    }

    // Seed a row whose ID we control end to end, so the update/delete/
    // recurrence steps are testable even if create is broken.
    console.log("\n== step: seeded row (itemID === id) for the remaining steps ==");
    const seedRowID = nodeID();
    await runOps("seed insertAttrViewBlock", [{
      action: "insertAttrViewBlock", avID, blockID: avBlockID, previousID: "",
      srcs: [{itemID: seedRowID, id: seedRowID, isDetached: true, content: "Seed event"}],
      context: {ignoreTip: "true"},
    }, {
      action: "updateAttrViewCell", avID, keyID: keys.date, rowID: seedRowID,
      data: {
        type: "date",
        date: {
          content: dayjs("2026-05-24T09:00:00").valueOf(), isNotEmpty: true,
          content2: dayjs("2026-05-24T10:00:00").valueOf(), isNotEmpty2: true,
          hasEndDate: true, isNotTime: false,
        },
      },
    }, {
      action: "updateAttrViewCell", avID, keyID: keys.recurrence, rowID: seedRowID,
      data: {type: "text", keyID: keys.recurrence, text: {content: "FREQ=WEEKLY;COUNT=5"}},
    }, {
      action: "updateAttrViewCell", avID, keyID: keys.exception, rowID: seedRowID,
      data: {type: "text", keyID: keys.exception, text: {content: "2026-05-31"}},
    }, {
      action: "updateAttrViewCell", avID, keyID: keys.location, rowID: seedRowID,
      data: {type: "text", keyID: keys.location, text: {content: "Seed room"}},
    }, {
      action: "updateAttrViewCell", avID, keyID: keys.description, rowID: seedRowID,
      data: {type: "text", keyID: keys.description, text: {content: "Seed notes"}},
    }, {
      action: "updateAttrViewCell", avID, keyID: keys.color, rowID: seedRowID,
      data: {type: "select", keyID: keys.color, mSelect: [{content: "Focus", color: "1"}]},
    }]);

    state = await readState();
    let seedEvent = state.normalized.baseEventsByID.get(seedRowID);
    if (!seedEvent) {
      recordDefect("seeded row did not normalize into a calendar event",
        `cards=${JSON.stringify((state.rendered.view.cards || []).map(c => c.id))}`);
      fail("cannot continue without a readable seeded event");
    }

    console.log("\n== step: updateCalendarEvent (block rename + date + metadata) ==");
    const updateDraft = {
      title: "Updated event",
      date: "2026-06-07",
      endDate: "2026-06-07",
      isAllDay: false,
      startTime: "11:30",
      endTime: "12:30",
      recurrenceRaw: "FREQ=WEEKLY;COUNT=5",
      recurrenceExceptionRaw: "2026-05-31",
      location: "Room B",
      description: "Notes B",
      colorContent: "Travel",
    };
    const updated = await transactions.updateCalendarEvent({
      protyle, avID, blockID: avBlockID,
      dateFieldID: state.mapping.dateFieldID,
      fields: state.fields, mapping: state.mapping,
      event: seedEvent, draft: updateDraft,
    });
    const updateCall = takeCall("updateCalendarEvent");
    assertOrDefect(updated === true, "updateCalendarEvent returned false", `returned=${updated}`);

    state = await readState();
    card = cardByID(state.rendered, seedRowID);
    assertOrDefect(cellValue(card, keys.date)?.date?.content === dayjs("2026-06-07T11:30:00").valueOf(),
      "updateCalendarEvent: the new date did not persist",
      `date=${JSON.stringify(cellValue(card, keys.date)?.date)}`);
    assertOrDefect(textOf(card, keys.location) === "Room B",
      "updateCalendarEvent: location did not persist", `got=${textOf(card, keys.location)}`);
    assertOrDefect(textOf(card, keys.description) === "Notes B",
      "updateCalendarEvent: description did not persist", `got=${textOf(card, keys.description)}`);
    assertOrDefect(cellValue(card, keys.color)?.mSelect?.[0]?.content === "Travel",
      "updateCalendarEvent: color did not persist",
      `got=${JSON.stringify(cellValue(card, keys.color))}`);
    const titleValue = card?.values.find(c => c.valueType === "block")?.value?.block?.content;
    assertOrDefect(titleValue === "Updated event",
      "updateCalendarEvent: the block cell rename did not persist",
      `title=${titleValue}\nblock op=${JSON.stringify(updateCall?.doOperations.find(op => op.keyID && op.data?.type === "block"))}`);

    console.log("\n== step: updateCalendarEvent undoOperations ==");
    if (updateCall) {
      await runOps("updateCalendarEvent undo", updateCall.undoOperations, updateCall.doOperations);
      state = await readState();
      card = cardByID(state.rendered, seedRowID);
      assertOrDefect(cellValue(card, keys.date)?.date?.content === dayjs("2026-05-24T09:00:00").valueOf(),
        "updateCalendarEvent undo did not restore the original date: Ctrl+Z corrupts the event",
        `date after undo=${JSON.stringify(cellValue(card, keys.date)?.date)}`);
      assertOrDefect(textOf(card, keys.location) === "Seed room",
        "updateCalendarEvent undo did not restore the original location",
        `got=${textOf(card, keys.location)}`);
      assertOrDefect(card?.values.find(c => c.valueType === "block")?.value?.block?.content === "Seed event",
        "updateCalendarEvent undo did not restore the original title",
        `got=${card?.values.find(c => c.valueType === "block")?.value?.block?.content}`);
    }

    console.log("\n== step: deleteCalendarOccurrence (exception write) ==");
    state = await readState();
    seedEvent = state.normalized.baseEventsByID.get(seedRowID);
    const occurrenceDeleted = await transactions.deleteCalendarOccurrence({
      protyle, avID, blockID: avBlockID,
      fields: state.fields, mapping: state.mapping,
      event: seedEvent, occurrenceDate: "2026-06-07",
    });
    const occurrenceCall = takeCall("deleteCalendarOccurrence");
    assertOrDefect(occurrenceDeleted === true, "deleteCalendarOccurrence returned false",
      `returned=${occurrenceDeleted}`);
    state = await readState();
    card = cardByID(state.rendered, seedRowID);
    assertOrDefect(textOf(card, keys.exception) === "2026-05-31,2026-06-07",
      "deleteCalendarOccurrence: the merged exception list did not persist",
      `got=${textOf(card, keys.exception)}`);
    if (occurrenceCall) {
      await runOps("deleteCalendarOccurrence undo", occurrenceCall.undoOperations, occurrenceCall.doOperations);
      state = await readState();
      card = cardByID(state.rendered, seedRowID);
      assertOrDefect(textOf(card, keys.exception) === "2026-05-31",
        "deleteCalendarOccurrence undo did not restore the original exception list",
        `got=${textOf(card, keys.exception)}`);
    }

    console.log("\n== step: createCalendarEventReplacingOccurrence ==");
    state = await readState();
    seedEvent = state.normalized.baseEventsByID.get(seedRowID);
    const occurrence = state.normalized.events.find(event => event.isOccurrence &&
      event.baseEventID === seedRowID && event.start.format("YYYY-MM-DD") !== "2026-05-24");
    const replacementTarget = occurrence || seedEvent;
    const replacementDate = replacementTarget.start.format("YYYY-MM-DD");
    const replaced = await transactions.createCalendarEventReplacingOccurrence({
      protyle, avID, blockID: avBlockID,
      dateFieldID: state.mapping.dateFieldID,
      fields: state.fields, mapping: state.mapping,
      event: replacementTarget,
      draft: {...updateDraft, title: "Replacement", date: replacementDate, endDate: replacementDate},
      occurrenceDate: replacementDate,
    });
    const replaceCall = takeCall("createCalendarEventReplacingOccurrence");
    assertOrDefect(replaced === true, "createCalendarEventReplacingOccurrence returned false",
      `returned=${replaced}`);
    state = await readState();
    const replacementRowID = replaceCall?.doOperations
      .filter(op => op.action === "updateAttrViewCell" && op.rowID !== seedRowID)[0]?.rowID;
    assertOrDefect(!!replacementRowID && !!cardByID(state.rendered, replacementRowID),
      "createCalendarEventReplacingOccurrence: the replacement row its cells target does not exist",
      `replacement rowID=${replacementRowID}\n` +
      `srcs=${JSON.stringify(replaceCall?.doOperations.find(op => op.action === "insertAttrViewBlock")?.srcs)}\n` +
      `item IDs in the view=${JSON.stringify((state.rendered.view.cards || []).map(c => c.id))}\n` +
      `orphaned values in av.json=${JSON.stringify(orphanItemIDs())}`,
      {file: "app/src/protyle/render/av/calendar/transactions.ts"});
    assertOrDefect(textOf(cardByID(state.rendered, seedRowID), keys.exception).includes(replacementDate),
      "createCalendarEventReplacingOccurrence: the original series was not given an exception",
      `exception cell=${textOf(cardByID(state.rendered, seedRowID), keys.exception)}`);
    if (replaceCall) {
      await runOps("createCalendarEventReplacingOccurrence undo",
        replaceCall.undoOperations, replaceCall.doOperations);
      state = await readState();
      assertOrDefect(!replacementRowID || !cardByID(state.rendered, replacementRowID),
        "createCalendarEventReplacingOccurrence undo left the replacement row behind",
        `item IDs in the view=${JSON.stringify((state.rendered.view.cards || []).map(c => c.id))}`);
      assertOrDefect(!textOf(cardByID(state.rendered, seedRowID), keys.exception).includes(replacementDate),
        "createCalendarEventReplacingOccurrence undo did not restore the exception cell",
        `exception cell=${textOf(cardByID(state.rendered, seedRowID), keys.exception)}`);
    }

    console.log("\n== step: updateCalendarEventThisAndFuture (series split) ==");
    state = await readState();
    seedEvent = state.normalized.baseEventsByID.get(seedRowID);
    const splitDate = "2026-06-07";
    const splitOk = await transactions.updateCalendarEventThisAndFuture({
      protyle, avID, blockID: avBlockID,
      dateFieldID: state.mapping.dateFieldID,
      fields: state.fields, mapping: state.mapping,
      event: seedEvent,
      draft: {...updateDraft, title: "Future series", date: splitDate, endDate: splitDate},
      occurrenceDate: splitDate,
    });
    const splitCall = takeCall("updateCalendarEventThisAndFuture");
    assertOrDefect(splitOk === true, "updateCalendarEventThisAndFuture returned false", `returned=${splitOk}`);
    state = await readState();
    assertOrDefect(textOf(cardByID(state.rendered, seedRowID), keys.recurrence).includes("UNTIL=2026-06-06"),
      "updateCalendarEventThisAndFuture: the original series was not truncated",
      `recurrence cell=${textOf(cardByID(state.rendered, seedRowID), keys.recurrence)}`);
    const futureRowID = splitCall?.doOperations
      .filter(op => op.action === "updateAttrViewCell" && op.rowID !== seedRowID)[0]?.rowID;
    assertOrDefect(!!futureRowID && !!cardByID(state.rendered, futureRowID),
      "updateCalendarEventThisAndFuture: the new future-series row its cells target does not exist",
      `future rowID=${futureRowID}\n` +
      `srcs=${JSON.stringify(splitCall?.doOperations.find(op => op.action === "insertAttrViewBlock")?.srcs)}\n` +
      `item IDs in the view=${JSON.stringify((state.rendered.view.cards || []).map(c => c.id))}\n` +
      `orphaned values in av.json=${JSON.stringify(orphanItemIDs())}`,
      {file: "app/src/protyle/render/av/calendar/transactions.ts"});
    if (splitCall) {
      await runOps("updateCalendarEventThisAndFuture undo", splitCall.undoOperations, splitCall.doOperations);
      state = await readState();
      assertOrDefect(textOf(cardByID(state.rendered, seedRowID), keys.recurrence) === "FREQ=WEEKLY;COUNT=5",
        "updateCalendarEventThisAndFuture undo did not restore the original recurrence rule",
        `recurrence cell=${textOf(cardByID(state.rendered, seedRowID), keys.recurrence)}`);
    }

    console.log("\n== step: deleteCalendarEvent (removeAttrViewBlock) + undo restore ==");
    state = await readState();
    seedEvent = state.normalized.baseEventsByID.get(seedRowID);
    const deleted = await transactions.deleteCalendarEvent({
      protyle, avID, blockID: avBlockID, event: seedEvent,
    });
    const deleteCall = takeCall("deleteCalendarEvent");
    assertOrDefect(deleted === true, "deleteCalendarEvent returned false", `returned=${deleted}`);
    state = await readState();
    assertOrDefect(!cardByID(state.rendered, seedRowID),
      "deleteCalendarEvent did not remove the row",
      `item IDs still in the view=${JSON.stringify((state.rendered.view.cards || []).map(c => c.id))}`);
    const rowCountBeforeDeleteUndo = (state.rendered.view.cards || []).length;
    if (deleteCall) {
      await runOps("deleteCalendarEvent undo", deleteCall.undoOperations, deleteCall.doOperations);
      state = await readState();
      const restored = cardByID(state.rendered, seedRowID);
      const undoInsertItemID = deleteCall.undoOperations
        .find(op => op.action === "insertAttrViewBlock")?.srcs?.[0]?.itemID;
      assertOrDefect((state.rendered.view.cards || []).length === rowCountBeforeDeleteUndo + 1,
        "deleteCalendarEvent undo adds a phantom blank row on top of restoring the event",
        `rows before undo=${rowCountBeforeDeleteUndo} after undo=${(state.rendered.view.cards || []).length} ` +
        `(expected ${rowCountBeforeDeleteUndo + 1})\n` +
        `undo insertAttrViewBlock srcs[0].itemID=${undoInsertItemID} (a freshly minted ID) while ` +
        `srcs[0].id=${deleteCall.undoOperations.find(op => op.action === "insertAttrViewBlock")?.srcs?.[0]?.id}\n` +
        `phantom row present=${!!(undoInsertItemID && cardByID(state.rendered, undoInsertItemID))}\n` +
        `titles now in the view=${JSON.stringify((state.rendered.view.cards || []).map(c => c.values.find(v => v.valueType === "block")?.value?.block?.content))}`,
        {file: "app/src/protyle/render/av/calendar/transactions.ts"});
      assertOrDefect(!!restored,
        "deleteCalendarEvent undo did not restore the row under its original ID: Ctrl+Z after deleting an event loses all of its cell values",
        `undo srcs=${JSON.stringify(deleteCall.undoOperations.find(op => op.action === "insertAttrViewBlock")?.srcs)}\n` +
        `undo updateAttrViewCell rowIDs=${JSON.stringify([...new Set(deleteCall.undoOperations.filter(op => op.action === "updateAttrViewCell").map(op => op.rowID))])}\n` +
        `item IDs in the view after undo=${JSON.stringify((state.rendered.view.cards || []).map(c => c.id))}\n` +
        `orphaned values in av.json=${JSON.stringify(orphanItemIDs())}`,
        {file: "app/src/protyle/render/av/calendar/transactions.ts"});
      if (restored) {
        assertOrDefect(textOf(restored, keys.recurrence) === "FREQ=WEEKLY;COUNT=5",
          "deleteCalendarEvent undo restored the row but not its recurrence cell",
          `got=${textOf(restored, keys.recurrence)}`);
        assertOrDefect(cellValue(restored, keys.date)?.date?.isNotEmpty === true,
          "deleteCalendarEvent undo restored the row but not its date cell",
          `date=${JSON.stringify(cellValue(restored, keys.date)?.date)}`);
      }
    }

    // ---------------------------------------------------------------------
    // page-per-entry: a calendar entry must be a real SiYuan document
    // ---------------------------------------------------------------------
    console.log("\n== step: page-per-entry defaults (new-item template + newItemTarget) ==");
    const calendarRender = await renderAV();
    // K4: this calendar view was created during this run, so it must default to "document".
    assertOrDefect(calendarRender.view?.newItemTarget === "document",
      "a newly created calendar view does not default to the document (page) new-entry target",
      `newItemTarget=${JSON.stringify(calendarRender.view?.newItemTarget)}`,
      {file: "kernel/av/layout_calendar.go"});
    // K3: turning a view into a calendar seeds a document-typed new-item template.
    const docTemplate = (calendarRender.newItemTemplates || [])
      .find(itemTemplate => itemTemplate.targetType === "document");
    assertOrDefect(!!docTemplate,
      "becoming a calendar view did not seed a document-typed new-item template",
      `newItemTemplates=${JSON.stringify(calendarRender.newItemTemplates)}`,
      {file: "kernel/model/attribute_view.go"});
    if (docTemplate) {
      assertOrDefect(!!docTemplate.saveLocation && !docTemplate.saveLocation.boxID &&
        !docTemplate.saveLocation.pathTemplate,
        "the seeded entry-page template does not resolve to the AV block's own notebook/root",
        `saveLocation=${JSON.stringify(docTemplate.saveLocation)} ` +
        "(empty boxID + empty pathTemplate is what makes the entry page a child of the doc holding the calendar)",
        {file: "kernel/model/attribute_view.go"});
    }

    console.log("\n== step: createAttributeViewItem with primaryKey + fieldValues ==");
    const pageTitle = "Page entry";
    const pageStartMs = dayjs("2026-07-14T09:00:00").valueOf();
    const pageEndMs = dayjs("2026-07-14T10:00:00").valueOf();
    pushedTransactions.length = 0;
    const createItemResult = await postJSON("/api/av/createAttributeViewItem", {
      avID, blockID: avBlockID, viewID: calendarViewID,
      templateID: docTemplate?.id || "",
      primaryKey: pageTitle,
      fieldValues: {
        [keys.date]: {
          type: "date",
          date: {
            content: pageStartMs, isNotEmpty: true,
            content2: pageEndMs, isNotEmpty2: true,
            hasEndDate: true, isNotTime: false,
          },
        },
        [keys.location]: {type: "text", text: {content: "Page room"}},
      },
      app: PUSH_APP, session: PUSH_SESSION,
    });
    opsCovered.add("createAttributeViewItem");
    const createItemClean = assertOrDefect(createItemResult.code === 0,
      "createAttributeViewItem rejected the page-per-entry payload",
      `code=${createItemResult.code} msg=${createItemResult.msg} data=${JSON.stringify(createItemResult.data)}`,
      {file: "kernel/api/av.go"});
    const pageItemID = createItemResult.data?.itemID;
    const pageDocID = createItemResult.data?.blockID;
    assertOrDefect(!!pageItemID && !!pageDocID,
      "createAttributeViewItem did not return both itemID and blockID",
      `data=${JSON.stringify(createItemResult.data)}`, {file: "kernel/api/av.go"});
    assertOrDefect(!pageItemID || !pageDocID || pageItemID !== pageDocID,
      "createAttributeViewItem returned the same id for the AV item and the document, so nothing was bound",
      `itemID=${pageItemID} blockID=${pageDocID}`, {file: "kernel/model/attribute_view_new_item.go"});

    if (createItemClean && pageItemID) {
      const pageState = await renderAV();
      const pageCard = cardByID(pageState, pageItemID);
      assertOrDefect(!!pageCard,
        "createAttributeViewItem: the created item is not in the calendar view",
        `item IDs=${JSON.stringify((pageState.view.cards || []).map(c => c.id))}`);
      const blockCell = pageCard?.values.find(cell => cell.valueType === "block")?.value;
      assertOrDefect(blockCell?.block?.id === pageDocID,
        "the created row is not bound to the created document",
        `block value=${JSON.stringify(blockCell)} want block.id=${pageDocID}`,
        {file: "kernel/model/attribute_view_new_item.go"});
      assertOrDefect(blockCell?.isDetached !== true,
        "the created row is still detached, so the entry has no page",
        `block value=${JSON.stringify(blockCell)}`);
      assertOrDefect(blockCell?.block?.content === pageTitle,
        "the primary key of the bound row is not the caller-supplied title",
        `content=${JSON.stringify(blockCell?.block?.content)} want=${pageTitle} ` +
        "(for a bound row the kernel derives the primary key from the document, so the document " +
        "must have been created with that title)",
        {file: "kernel/model/attribute_view_new_item.go"});
      const pageDate = cellValue(pageCard, keys.date)?.date;
      assertOrDefect(pageDate?.isNotEmpty === true && pageDate?.content === pageStartMs,
        "createAttributeViewItem: the fieldValues date cell was not written",
        `date=${JSON.stringify(pageDate)} want content=${pageStartMs}`,
        {file: "kernel/model/attribute_view_new_item.go"});
      assertOrDefect(textOf(pageCard, keys.location) === "Page room",
        "createAttributeViewItem: the fieldValues text cell was not written",
        `got=${textOf(pageCard, keys.location)}`, {file: "kernel/model/attribute_view_new_item.go"});

      // -- the document really exists and knows about the AV -----------------
      const docInfo = await postJSON("/api/block/getBlockInfo", {id: pageDocID});
      assertOrDefect(docInfo.code === 0,
        "the document the calendar entry points at does not exist",
        `getBlockInfo code=${docInfo.code} msg=${docInfo.msg}`);
      assertOrDefect(docInfo.data?.rootID === pageDocID,
        "createAttributeViewItem bound the row to something that is not a document root",
        `rootID=${docInfo.data?.rootID} blockID=${pageDocID}`);
      const indexedAttrs = await postJSON("/api/attr/getBlockAttrs", {id: pageDocID});
      const diskIAL = readDocIAL(pageDocID);
      const avsAttr = diskIAL?.["custom-avs"] ?? indexedAttrs.data?.["custom-avs"] ?? "";
      assertOrDefect(String(avsAttr).split(",").includes(avID),
        "the created entry page does not carry the avID in its custom-avs IAL, so the binding is one-way",
        `custom-avs=${JSON.stringify(avsAttr)} want to contain ${avID}\n` +
        `disk IAL=${JSON.stringify(diskIAL)}\nindexed attrs=${JSON.stringify(indexedAttrs.data)}`,
        {file: "kernel/model/attribute_view.go"});

      // -- one undoable unit -------------------------------------------------
      const pushed = await waitForPushedTransaction(pageItemID);
      assertOrDefect(pushed.length === 1,
        "creating a calendar entry page is not ONE undoable unit",
        `transactions pushed for item ${pageItemID}: ${pushed.length}\n` +
        `${JSON.stringify(pushed.map(tx => (tx.doOperations || []).map(op => op.action)))}`,
        {file: "kernel/model/attribute_view_new_item.go"});
      const pushedTx = pushed[0];
      if (pushedTx) {
        const doActions = (pushedTx.doOperations || []).map(op => op.action);
        const undoActions = (pushedTx.undoOperations || []).map(op => op.action);
        (pushedTx.doOperations || []).forEach(op => op.action && opsCovered.add(op.action));
        (pushedTx.undoOperations || []).forEach(op => op.action && opsCovered.add(op.action));
        for (const action of ["restoreCreatedDoc", "insertAttrViewBlock", "updateAttrViewCell"]) {
          assertOrDefect(doActions.includes(action),
            `the pushed create transaction is missing ${action}, so the create is not atomic`,
            `doOperations=${JSON.stringify(doActions)}`,
            {file: "kernel/model/attribute_view_new_item.go"});
        }
        const pushedInsert = (pushedTx.doOperations || []).find(op => op.action === "insertAttrViewBlock");
        assertOrDefect(pushedInsert?.srcs?.[0]?.itemID === pageItemID &&
          pushedInsert?.srcs?.[0]?.id === pageDocID &&
          pushedInsert?.srcs?.[0]?.isDetached === false,
          "the pushed insert does not bind the new item to the new document",
          `srcs=${JSON.stringify(pushedInsert?.srcs)} want itemID=${pageItemID} id=${pageDocID}`,
          {file: "kernel/model/attribute_view_new_item.go"});
        const pushedCellOps = (pushedTx.doOperations || [])
          .filter(op => op.action === "updateAttrViewCell");
        assertOrDefect(pushedCellOps.length > 0 && pushedCellOps.every(op => op.rowID === pageItemID),
          "the pushed cell writes are not addressed at the new item id",
          `rowIDs=${JSON.stringify(pushedCellOps.map(op => op.rowID))} want ${pageItemID}`,
          {file: "kernel/model/attribute_view_new_item.go"});
        assertOrDefect(undoActions.includes("removeAttrViewBlock") &&
          undoActions.includes("removeCreatedDoc"),
          "undoing a calendar entry page would leave the row or the document behind",
          `undoOperations=${JSON.stringify(undoActions)}`,
          {file: "kernel/model/attribute_view_new_item.go"});
        const undoRemove = (pushedTx.undoOperations || [])
          .find(op => op.action === "removeAttrViewBlock");
        assertOrDefect((undoRemove?.srcIDs || []).includes(pageItemID),
          "the undo of a calendar entry page targets the wrong item id",
          `srcIDs=${JSON.stringify(undoRemove?.srcIDs)} want ${pageItemID}`,
          {file: "kernel/model/attribute_view_new_item.go"});
        const undoDoc = (pushedTx.undoOperations || []).find(op => op.action === "removeCreatedDoc");
        assertOrDefect(undoDoc?.id === pageDocID,
          "the undo of a calendar entry page targets the wrong document",
          `removeCreatedDoc id=${undoDoc?.id} want ${pageDocID}`,
          {file: "kernel/model/attribute_view_new_item.go"});
      }

      // -- atomic bound-item update: document title + AV cells land together --
      console.log("\n== step: updateAttributeViewItem (bound title + fields) ==");
      const atomicTitle = "Atomic page title";
      const atomicStartMs = pageStartMs + 24 * 60 * 60 * 1000;
      const atomicEndMs = pageEndMs + 24 * 60 * 60 * 1000;
      const atomicUpdate = await postJSON("/api/av/updateAttributeViewItem", {
        avID,
        blockID: avBlockID,
        viewID: calendarViewID,
        itemID: pageItemID,
        boundBlockID: pageDocID,
        primaryKey: atomicTitle,
        fieldValues: {
          [keys.date]: {
            type: "date", keyID: keys.date,
            date: {
              content: atomicStartMs, isNotEmpty: true,
              content2: atomicEndMs, isNotEmpty2: true,
              hasEndDate: true, isNotTime: false,
            },
          },
          [keys.location]: {type: "text", keyID: keys.location, text: {content: "Atomic room"}},
          [keys.description]: {type: "text", keyID: keys.description, text: {content: "First description"}},
        },
        app: PUSH_APP,
        session: PUSH_SESSION,
      });
      assertOrDefect(atomicUpdate.code === 0,
        "updateAttributeViewItem rejected the bound title/field update",
        `code=${atomicUpdate.code} msg=${atomicUpdate.msg}`,
        {file: "kernel/api/av.go"});
      const atomicState = await renderAV();
      const atomicCard = cardByID(atomicState, pageItemID);
      const atomicBlock = atomicCard?.values.find(cell => cell.valueType === "block")?.value?.block;
      const atomicDate = cellValue(atomicCard, keys.date)?.date;
      assertOrDefect(atomicBlock?.id === pageDocID && atomicBlock?.content === atomicTitle,
        "atomic update did not persist the bound document title into the AV primary key",
        `block=${JSON.stringify(atomicBlock)} want id=${pageDocID} content=${atomicTitle}`,
        {file: "kernel/model/attribute_view_update_item.go"});
      assertOrDefect(atomicDate?.content === atomicStartMs && atomicDate?.content2 === atomicEndMs,
        "atomic update did not persist the new calendar date range",
        `date=${JSON.stringify(atomicDate)}`,
        {file: "kernel/model/attribute_view_update_item.go"});
      assertOrDefect(textOf(atomicCard, keys.location) === "Atomic room" &&
        textOf(atomicCard, keys.description) === "First description",
        "atomic update did not persist the mapped text fields",
        `location=${textOf(atomicCard, keys.location)} description=${textOf(atomicCard, keys.description)}`,
        {file: "kernel/model/attribute_view_update_item.go"});
      const atomicDocInfo = await postJSON("/api/block/getBlockInfo", {id: pageDocID});
      assertOrDefect(atomicDocInfo.code === 0 && atomicDocInfo.data?.rootTitle === atomicTitle,
        "atomic update did not persist the real document title",
        `code=${atomicDocInfo.code} rootTitle=${JSON.stringify(atomicDocInfo.data?.rootTitle)}`,
        {file: "kernel/model/attribute_view_update_item.go"});

      // -- the single atomic operation is a real undo/redo unit ---------------
      const undoState = await postJSON("/api/transactions/undoState", {rootID: pageDocID});
      assertOrDefect(undoState.code === 0 && undoState.data?.canUndo === true,
        "atomic bound update was not recorded on the document undo stack",
        `undoState=${JSON.stringify(undoState.data)}`,
        {file: "kernel/model/undolog.go"});
      const undoResult = await postJSON("/api/transactions/undo", {
        rootID: pageDocID, app: PUSH_APP, session: PUSH_SESSION,
      });
      assertOrDefect(undoResult.code === 0 && undoResult.data?.failed !== true,
        "undoing the atomic bound update failed",
        `data=${JSON.stringify(undoResult.data)} msg=${undoResult.msg}`,
        {file: "kernel/model/attribute_view_update_item.go"});
      const undoneCard = cardByID(await renderAV(), pageItemID);
      const undoneDocInfo = await postJSON("/api/block/getBlockInfo", {id: pageDocID});
      assertOrDefect(undoneDocInfo.data?.rootTitle === pageTitle &&
        undoneCard?.values.find(cell => cell.valueType === "block")?.value?.block?.content === pageTitle &&
        cellValue(undoneCard, keys.date)?.date?.content === pageStartMs &&
        textOf(undoneCard, keys.location) === "Page room" &&
        textOf(undoneCard, keys.description) === "",
        "atomic undo did not restore the old document title and AV fields together",
        `title=${JSON.stringify(undoneDocInfo.data?.rootTitle)} card=${JSON.stringify(undoneCard)}`,
        {file: "kernel/model/attribute_view_update_item.go"});
      const redoResult = await postJSON("/api/transactions/redo", {
        rootID: pageDocID, app: PUSH_APP, session: PUSH_SESSION,
      });
      assertOrDefect(redoResult.code === 0 && redoResult.data?.failed !== true,
        "redoing the atomic bound update failed",
        `data=${JSON.stringify(redoResult.data)} msg=${redoResult.msg}`,
        {file: "kernel/model/attribute_view_update_item.go"});
      const redoneCard = cardByID(await renderAV(), pageItemID);
      const redoneDocInfo = await postJSON("/api/block/getBlockInfo", {id: pageDocID});
      assertOrDefect(redoneDocInfo.data?.rootTitle === atomicTitle &&
        redoneCard?.values.find(cell => cell.valueType === "block")?.value?.block?.content === atomicTitle &&
        cellValue(redoneCard, keys.date)?.date?.content === atomicStartMs &&
        textOf(redoneCard, keys.location) === "Atomic room" &&
        textOf(redoneCard, keys.description) === "First description",
        "atomic redo did not restore the new document title and AV fields together",
        `title=${JSON.stringify(redoneDocInfo.data?.rootTitle)} card=${JSON.stringify(redoneCard)}`,
        {file: "kernel/model/attribute_view_update_item.go"});
    }

    // -- templateID may be omitted: a document-target calendar view still pages
    console.log("\n== step: createAttributeViewItem without templateID (view default) ==");
    const defaultedItem = await postJSON("/api/av/createAttributeViewItem", {
      avID, blockID: avBlockID, viewID: calendarViewID, primaryKey: "Defaulted entry",
      app: PUSH_APP, session: PUSH_SESSION,
    });
    assertOrDefect(defaultedItem.code === 0 && defaultedItem.data?.itemID &&
      defaultedItem.data?.blockID && defaultedItem.data.itemID !== defaultedItem.data.blockID,
      "with no templateID a document-target calendar view still creates a detached row instead of a page",
      `code=${defaultedItem.code} data=${JSON.stringify(defaultedItem.data)}`,
      {file: "kernel/model/attribute_view_new_item.go"});

    // -- K5: deleting the page must not leave a ghost event ------------------
    console.log("\n== step: deleting the entry page removes the event (no ghost card) ==");
    if (pageItemID && pageDocID) {
      const removeDoc = await postJSON("/api/filetree/removeDocByID", {id: pageDocID});
      assertOrDefect(removeDoc.code === 0, "could not remove the created entry page",
        `code=${removeDoc.code} msg=${removeDoc.msg}`);
      await sleep(600);
      const afterRemoval = await renderAV();
      const stillInAvJSON = (readAvJSON().keyValues || []).some(kv => kv.key?.type === "block" &&
        (kv.values || []).some(value => value.blockID === pageItemID));
      assertOrDefect(!cardByID(afterRemoval, pageItemID),
        "deleting an entry page leaves a permanent ghost event on the calendar",
        `item ${pageItemID} is still rendered; its row is ${stillInAvJSON ? "still" : "no longer"} in av.json\n` +
        "kernel/sql/av.go filterNotFoundAttrViewItems() collects the BOUND BLOCK id into notFound but " +
        "deletes from a map keyed by ITEM id; since v3.7.3 those differ, so the row is never hidden.",
        {file: "kernel/sql/av.go"});
      console.log(`  (dangling row still present in av.json: ${stillInAvJSON})`);
    }

    // The same thing again, but with the document's custom-avs IAL stripped first.
    // deleteAttrView() only cleans up rows it can reach through that IAL, so this
    // leaves a genuinely dangling bound row in av.json -- exactly the case
    // kernel/sql/av.go filterNotFoundAttrViewItems() has to hide.
    const defaultedItemID = defaultedItem.data?.itemID;
    const defaultedDocID = defaultedItem.data?.blockID;
    if (defaultedItemID && defaultedDocID && defaultedItemID !== defaultedDocID) {
      await postJSONOk("/api/attr/setBlockAttrs", {id: defaultedDocID, attrs: {"custom-avs": null}});
      const orphanRemoval = await postJSON("/api/filetree/removeDocByID", {id: defaultedDocID});
      assertOrDefect(orphanRemoval.code === 0, "could not remove the second entry page",
        `code=${orphanRemoval.code} msg=${orphanRemoval.msg}`);
      await sleep(600);
      const danglingRow = (readAvJSON().keyValues || []).some(kv => kv.key?.type === "block" &&
        (kv.values || []).some(value => value.blockID === defaultedItemID));
      assertOrDefect(!cardByID(await renderAV(), defaultedItemID),
        "a bound row whose document no longer exists is still rendered as a ghost event",
        `item ${defaultedItemID} bound to the deleted document ${defaultedDocID} is still rendered ` +
        `(its row is ${danglingRow ? "still" : "no longer"} in av.json)\n` +
        "kernel/sql/av.go filterNotFoundAttrViewItems() must delete from the item-keyed map by ITEM id, " +
        "not by the bound BLOCK id.",
        {file: "kernel/sql/av.go"});
      console.log(`  (dangling bound row left in av.json: ${danglingRow} -- ` +
        `${danglingRow ? "filterNotFoundAttrViewItems did the hiding" : "the delete path cleaned it up"})`);
    }

    // -- K4: the per-view setting is a real, validated, persisted toggle -----
    console.log("\n== step: setAttrViewCalendarNewItemTarget ==");
    await runOps("setAttrViewCalendarNewItemTarget(row)", [{
      action: "setAttrViewCalendarNewItemTarget", avID, blockID: avBlockID,
      viewID: calendarViewID, data: "row",
    }], [{
      action: "setAttrViewCalendarNewItemTarget", avID, blockID: avBlockID,
      viewID: calendarViewID, data: "document",
    }]);
    assertOrDefect((await renderAV()).view?.newItemTarget === "row",
      "setAttrViewCalendarNewItemTarget(row) did not persist",
      `newItemTarget=${JSON.stringify((await renderAV()).view?.newItemTarget)}`,
      {file: "kernel/model/attribute_view.go"});
    // A row-only view must go back to the upstream detached behaviour.
    const rowOnlyItem = await postJSON("/api/av/createAttributeViewItem", {
      avID, blockID: avBlockID, viewID: calendarViewID, primaryKey: "Row only entry",
      app: PUSH_APP, session: PUSH_SESSION,
    });
    assertOrDefect(rowOnlyItem.code === 0 &&
      rowOnlyItem.data?.itemID === rowOnlyItem.data?.blockID,
      "a row-only calendar view still creates a document for a new entry",
      `code=${rowOnlyItem.code} data=${JSON.stringify(rowOnlyItem.data)}`,
      {file: "kernel/model/attribute_view_new_item.go"});
    // An invalid value must be refused, exactly like the other calendar setters.
    const badTarget = await performTransactions([{
      action: "setAttrViewCalendarNewItemTarget", avID, blockID: avBlockID,
      viewID: calendarViewID, data: "page",
    }], []);
    assertOrDefect((await renderAV()).view?.newItemTarget === "row",
      "setAttrViewCalendarNewItemTarget accepted an invalid value",
      `newItemTarget=${JSON.stringify((await renderAV()).view?.newItemTarget)} ` +
      `kernelErrors=${badTarget.kernelErrors.join(" | ") || "(none)"}`,
      {file: "kernel/model/attribute_view.go"});
    // An existing (already-configured) view must keep its setting across a layout round trip.
    await postJSONOk("/api/av/changeAttrViewLayout", {blockID: avBlockID, avID, layoutType: "table"});
    await postJSONOk("/api/av/changeAttrViewLayout", {blockID: avBlockID, avID, layoutType: "calendar"});
    assertOrDefect((await renderAV()).view?.newItemTarget === "row",
      "an existing calendar view was silently upgraded to page-per-entry by a layout round trip",
      `newItemTarget=${JSON.stringify((await renderAV()).view?.newItemTarget)}`,
      {file: "kernel/model/attribute_view.go"});
    await runOps("setAttrViewCalendarNewItemTarget(document)", [{
      action: "setAttrViewCalendarNewItemTarget", avID, blockID: avBlockID,
      viewID: calendarViewID, data: "document",
    }]);

    console.log("\n== step: addAttrViewView with layout calendar + removeAttrViewView undo ==");
    const addedViewID = nodeID();
    await runOps("addAttrViewView(calendar)", [{
      action: "addAttrViewView", avID, layout: "calendar", id: addedViewID, blockID: avBlockID,
    }], [{
      action: "removeAttrViewView", avID, layout: "calendar", id: addedViewID, blockID: avBlockID,
    }]);
    let addedView;
    try {
      addedView = await renderAV(addedViewID);
    } catch (error) {
      recordDefect("addAttrViewView(calendar): the new view cannot be rendered", error.message);
    }
    if (addedView) {
      assertOrDefect(addedView.viewType === "calendar",
        "addAttrViewView(calendar) produced a view whose type is not calendar",
        `viewType=${addedView.viewType}`);
      assertOrDefect(!!addedView.view?.dateFieldID,
        "addAttrViewView(calendar) produced a calendar view with no date field, so it renders the empty-state hint",
        `dateFieldID=${addedView.view?.dateFieldID}`);
      // K4: a freshly created calendar view defaults to page-per-entry...
      assertOrDefect(addedView.view?.newItemTarget === "document",
        "addAttrViewView(calendar) did not default the new view to the document (page) new-entry target",
        `newItemTarget=${JSON.stringify(addedView.view?.newItemTarget)}`,
        {file: "kernel/av/layout_calendar.go"});
      // K3: ...and the AV has a document-typed new-item template to create pages with.
      assertOrDefect((addedView.newItemTemplates || [])
          .some(itemTemplate => itemTemplate.targetType === "document"),
        "addAttrViewView(calendar) left the AV without a document-typed new-item template",
        `newItemTemplates=${JSON.stringify(addedView.newItemTemplates)}`,
        {file: "kernel/model/attribute_view.go"});
      // ...while the pre-existing view keeps whatever it was set to.
      const untouched = readAvJSON().views.find(view => view.id === calendarViewID);
      assertOrDefect(untouched?.calendar?.newItemTarget === "document",
        "adding a calendar view changed the new-entry target of the pre-existing calendar view",
        `view ${calendarViewID} newItemTarget=${JSON.stringify(untouched?.calendar?.newItemTarget)}`,
        {file: "kernel/model/attribute_view.go"});
    }

    // addAttrViewView repoints the block's custom-sy-av-view attribute at the
    // new view, so the "current view" is now the added one while the frontend
    // still addresses the old one by viewID.
    console.log("\n== step: does viewID actually route calendar setters? ==");
    const weekStartBefore = (await renderAV(calendarViewID)).view.weekStart;
    await runOps("setAttrViewCalendarWeekStart(viewID = non-current view)", [{
      action: "setAttrViewCalendarWeekStart", avID, blockID: avBlockID,
      data: weekStartBefore === 1 ? 0 : 1, viewID: calendarViewID,
    }]);
    const targetedAfter = readAvJSON().views.find(view => view.id === calendarViewID);
    const otherAfter = readAvJSON().views.find(view => view.id === addedViewID);
    assertOrDefect(targetedAfter?.calendar?.weekStart === (weekStartBefore === 1 ? 0 : 1),
      "calendar setters ignore operation.viewID and always write to the block's current view",
      `sent viewID=${calendarViewID} (weekStart ${weekStartBefore} -> ${weekStartBefore === 1 ? 0 : 1})\n` +
      `targeted view weekStart is now ${targetedAfter?.calendar?.weekStart}\n` +
      `the non-targeted, current view ${addedViewID} weekStart is now ${otherAfter?.calendar?.weekStart}\n` +
      "kernel/model/attribute_view.go setAttrViewCalendarDateField/ViewMode/WeekStart/FieldMapping\n" +
      "all resolve the view with getAttrViewViewByBlockID(attrView, operation.BlockID), which reads\n" +
      "the node's av-view IAL attribute and never looks at operation.ViewID.",
      {file: "kernel/model/attribute_view.go"});

    console.log("\n== step: duplicateAttrViewView of a calendar view ==");
    const duplicatedViewID = nodeID();
    const duplicateClean = await runOps("duplicateAttrViewView(calendar)", [{
      action: "duplicateAttrViewView", avID, previousID: calendarViewID,
      id: duplicatedViewID, blockID: avBlockID,
    }], [{
      action: "removeAttrViewView", avID, id: duplicatedViewID, blockID: avBlockID,
    }]);
    let duplicatedView;
    try {
      duplicatedView = await renderAV(duplicatedViewID);
    } catch (error) {
      recordDefect("duplicateAttrViewView(calendar): the duplicated view cannot be rendered",
        error.message, {file: "kernel/model/attribute_view.go"});
    }
    if (duplicateClean && duplicatedView) {
      assertOrDefect(duplicatedView.viewType === "calendar",
        "duplicateAttrViewView(calendar) produced a view whose type is not calendar",
        `viewType=${duplicatedView.viewType}`, {file: "kernel/model/attribute_view.go"});
      assertOrDefect(duplicatedView.view?.dateFieldID === keys.date,
        "duplicateAttrViewView(calendar) did not copy the date field of the master view",
        `dateFieldID=${duplicatedView.view?.dateFieldID} want=${keys.date}`,
        {file: "kernel/model/attribute_view.go"});
      assertOrDefect(duplicatedView.view?.fieldMapping?.recurrenceFieldID === keys.recurrence,
        "duplicateAttrViewView(calendar) did not copy the calendar field mapping",
        `fieldMapping=${JSON.stringify(duplicatedView.view?.fieldMapping)}`,
        {file: "kernel/model/attribute_view.go"});
    }

    // doDuplicateAttrViewView() repoints the block's av-view IAL attribute
    // BEFORE it builds the new view, so a failure there can leave the block
    // pointing at a view that was never created.
    const afterDuplicate = await postJSONOk("/api/av/renderAttributeView", {
      id: avID, blockID: avBlockID, pageSize: -1, createIfNotExist: false,
    });
    const knownViewIDs = readAvJSON().views.map(view => view.id);
    assertOrDefect(knownViewIDs.includes(afterDuplicate.viewID),
      "after the failed calendar duplicate the AV block points at a view ID that does not exist",
      `block resolves to viewID=${afterDuplicate.viewID}, av.json views=${JSON.stringify(knownViewIDs)}\n` +
      "doDuplicateAttrViewView() writes attrs[av.NodeAttrView] = operation.ID at " +
      "kernel/model/attribute_view.go:3793, before the layout switch that panics at :3811.",
      {file: "kernel/model/attribute_view.go"});

    // Kernel must still be alive; a panic in a tx handler kills the process.
    const alive = await postJSON("/api/system/version").then(() => true).catch(() => false);
    assertOrDefect(alive, "kernel died during the run (a transaction handler panicked)",
      "GET /api/system/version failed after the operation sweep");

    console.log("\n== step: orphan sweep ==");
    const orphans = orphanItemIDs();
    assertOrDefect(orphans.length === 0,
      "the AV contains cell values attached to item IDs that have no row (invisible, unrecoverable data)",
      `orphans=${JSON.stringify(orphans)}`,
      {file: "app/src/protyle/render/av/calendar/transactions.ts"});

    console.log(`\noperations exercised against the real kernel: ${[...opsCovered].sort().join(", ")}`);
    if (defects.length > 0) {
      fail(`${defects.length} contract defect(s) found:\n` +
        defects.map((d, i) => `  ${i + 1}. ${d.title}\n     ${d.evidence.split("\n").join("\n     ")}`).join("\n"));
    }
    console.log(`\ncalendar backend contract smoke passed: workspace=${workspace} port=${port} av=${avID}`);
  } finally {
    if (pushSocket) {
      try {
        pushSocket.close();
      } catch {
        // the kernel may already be gone
      }
      pushSocket = null;
    }
    if (kernel && !kernel.killed) {
      try {
        await postJSON("/api/system/exit", {});
      } catch {
        kernel.kill("SIGTERM");
      }
      await sleep(800);
      if (!kernel.killed) {
        kernel.kill("SIGKILL");
      }
    }
    if (tempDir) {
      fs.rmSync(tempDir, {recursive: true, force: true, maxRetries: 3});
    }
    if (process.env.SIYUAN_CALENDAR_CONTRACT_KEEP_WORKSPACE !== "1" && workspace) {
      fs.rmSync(workspace, {recursive: true, force: true, maxRetries: 3});
    } else if (workspace) {
      console.log(`kept workspace: ${workspace}`);
    }
  }
};

main().catch((error) => {
  console.error(`\ncalendar backend contract smoke failed: ${error.stack || error.message}`);
  process.exit(1);
});
