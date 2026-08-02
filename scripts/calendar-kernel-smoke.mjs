#!/usr/bin/env node
import {spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const kernelDir = path.join(root, "kernel");
const appDir = path.join(root, "app");
const expectedKernelVersion = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).version;

const fail = (message) => {
  throw new Error(message);
};

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
  const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0");
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

const postJSON = async (baseURL, endpoint, body = {}) => {
  const response = await fetch(`${baseURL}${endpoint}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    fail(`${endpoint} returned HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data.code !== 0) {
    fail(`${endpoint} failed: ${data.msg || JSON.stringify(data)}`);
  }
  return data.data;
};

const waitForBoot = async (baseURL) => {
  let lastError = "";
  for (let i = 0; i < 120; i++) {
    try {
      const version = await postJSON(baseURL, "/api/system/version");
      const progress = await postJSON(baseURL, "/api/system/bootProgress");
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

const performTransactions = (baseURL, doOperations, undoOperations = []) => postJSON(baseURL, "/api/transactions", {
  transactions: [{
    doOperations,
    undoOperations,
  }],
  reqId: Date.now(),
});

const textCellValue = (keyID, content) => ({
  type: "text",
  text: {content},
  keyID,
});

const selectCellValue = (keyID, content, color) => ({
  type: "select",
  mSelect: [{content, color}],
  keyID,
});

const main = async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-calendar-kernel-smoke-workspace-"));
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-calendar-kernel-smoke-bin-"));
  const kernelBinary = path.join(buildDir, "SiYuan-Kernel");
  const port = await getFreePort();
  const baseURL = `http://127.0.0.1:${port}`;
  let kernel;

  try {
    const build = spawnSync("go", ["build", "-tags", "fts5", "-o", kernelBinary, "."], {
      cwd: kernelDir,
      env: {...process.env, CGO_ENABLED: "1"},
      stdio: "inherit",
    });
    if (build.status !== 0) {
      fail(`kernel build failed with code ${build.status}`);
    }

    kernel = spawn(kernelBinary, [
      "serve",
      "--port", String(port),
      "--wd", appDir,
      "--workspace", workspace,
      "--mode", "dev",
      "--lang", "zh-TW",
    ], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    kernel.stdout.on("data", (chunk) => process.stdout.write(chunk));
    kernel.stderr.on("data", (chunk) => process.stderr.write(chunk));

    await waitForBoot(baseURL);

    const notebookData = await postJSON(baseURL, "/api/notebook/createNotebook", {
      name: `Calendar Smoke ${Date.now()}`,
    });
    const notebookID = notebookData.notebook.id || notebookData.notebook.ID;
    if (!notebookID) {
      fail(`createNotebook returned no notebook ID: ${JSON.stringify(notebookData)}`);
    }
    const requestedDocID = nodeID();
    const docData = await postJSON(baseURL, "/api/filetree/createDocWithMd", {
      notebook: notebookID,
      path: "/Calendar Smoke",
      markdown: "# Calendar Smoke\n",
      id: requestedDocID,
    });
    const docID = typeof docData === "string" ? docData : (docData.id || docData.ID);
    if (!docID) {
      fail(`createDoc returned no document ID: ${JSON.stringify(docData)}`);
    }
    if (!/^\d{14}-[a-z0-9]{7}$/.test(docID)) {
      fail(`createDoc returned invalid document ID [${docID}]: ${JSON.stringify(docData)}`);
    }

    const avID = nodeID();
    const avBlockID = nodeID();
    await postJSON(baseURL, "/api/block/appendBlock", {
      parentID: docID,
      dataType: "dom",
      data: `<div class="av" data-node-id="${avBlockID}" data-av-id="${avID}" data-type="NodeAttributeView" data-av-type="table"></div>`,
    });

    const tableData = await postJSON(baseURL, "/api/av/renderAttributeView", {
      id: avID,
      blockID: avBlockID,
      pageSize: -1,
      createIfNotExist: true,
    });
    if (tableData.viewType !== "table") {
      fail(`expected initial table view, got ${tableData.viewType}`);
    }

    const dateKeyID = nodeID();
    const recurrenceKeyID = nodeID();
    const exceptionKeyID = nodeID();
    const locationKeyID = nodeID();
    const descriptionKeyID = nodeID();
    const colorKeyID = nodeID();
    const rowID = nodeID();
    const start = new Date("2026-05-24T09:00:00").getTime();
    const end = new Date("2026-05-24T10:00:00").getTime();
    await performTransactions(baseURL, [{
      action: "addAttrViewCol",
      avID,
      id: dateKeyID,
      name: "Smoke Date",
      type: "date",
    }, {
      action: "addAttrViewCol",
      avID,
      id: recurrenceKeyID,
      name: "Smoke Recurrence",
      type: "text",
    }, {
      action: "addAttrViewCol",
      avID,
      id: exceptionKeyID,
      name: "Smoke Exceptions",
      type: "text",
    }, {
      action: "addAttrViewCol",
      avID,
      id: locationKeyID,
      name: "Smoke Location",
      type: "text",
    }, {
      action: "addAttrViewCol",
      avID,
      id: descriptionKeyID,
      name: "Smoke Description",
      type: "text",
    }, {
      action: "addAttrViewCol",
      avID,
      id: colorKeyID,
      name: "Smoke Color",
      type: "select",
    }, {
      action: "updateAttrViewColOptions",
      avID,
      id: colorKeyID,
      data: [{name: "Focus", color: "1"}],
    }, {
      action: "insertAttrViewBlock",
      avID,
      blockID: avBlockID,
      srcs: [{itemID: rowID, id: rowID, isDetached: true, content: "Calendar smoke event"}],
      context: {ignoreTip: "true"},
    }, {
      action: "updateAttrViewCell",
      avID,
      keyID: dateKeyID,
      rowID,
      data: {
        type: "date",
        date: {
          content: start,
          isNotEmpty: true,
          content2: end,
          isNotEmpty2: true,
          hasEndDate: true,
          isNotTime: false,
        },
      },
    }, {
      action: "updateAttrViewCell",
      avID,
      keyID: recurrenceKeyID,
      rowID,
      data: textCellValue(recurrenceKeyID, "FREQ=WEEKLY;COUNT=2"),
    }, {
      action: "updateAttrViewCell",
      avID,
      keyID: exceptionKeyID,
      rowID,
      data: textCellValue(exceptionKeyID, "2026-05-31"),
    }, {
      action: "updateAttrViewCell",
      avID,
      keyID: locationKeyID,
      rowID,
      data: textCellValue(locationKeyID, "Smoke Room"),
    }, {
      action: "updateAttrViewCell",
      avID,
      keyID: descriptionKeyID,
      rowID,
      data: textCellValue(descriptionKeyID, "Smoke description"),
    }, {
      action: "updateAttrViewCell",
      avID,
      keyID: colorKeyID,
      rowID,
      data: selectCellValue(colorKeyID, "Focus", "1"),
    }]);

    const calendarData = await postJSON(baseURL, "/api/av/changeAttrViewLayout", {
      blockID: avBlockID,
      avID,
      layoutType: "calendar",
    });
    if (calendarData.viewType !== "calendar") {
      fail(`expected calendar view after layout change, got ${calendarData.viewType}`);
    }
    const viewID = calendarData.viewID;

    await performTransactions(baseURL, [{
      action: "setAttrViewCalendarDateField",
      avID,
      blockID: avBlockID,
      data: dateKeyID,
      viewID,
    }, {
      action: "setAttrViewCalendarFieldMapping",
      avID,
      blockID: avBlockID,
      viewID,
      data: {
        recurrenceFieldID: recurrenceKeyID,
        exceptionFieldID: exceptionKeyID,
        locationFieldID: locationKeyID,
        descriptionFieldID: descriptionKeyID,
        colorFieldID: colorKeyID,
      },
    }]);

    const renderedCalendar = await postJSON(baseURL, "/api/av/renderAttributeView", {
      id: avID,
      blockID: avBlockID,
      viewID,
      pageSize: -1,
      createIfNotExist: false,
    });
    const view = renderedCalendar.view;
    if (renderedCalendar.viewType !== "calendar") {
      fail(`rendered viewType should be calendar, got ${renderedCalendar.viewType}`);
    }
    if (view.dateFieldID !== dateKeyID) {
      fail(`calendar date field mismatch: ${view.dateFieldID}`);
    }
    for (const [name, expected] of Object.entries({
      recurrenceFieldID: recurrenceKeyID,
      exceptionFieldID: exceptionKeyID,
      locationFieldID: locationKeyID,
      descriptionFieldID: descriptionKeyID,
      colorFieldID: colorKeyID,
    })) {
      if (view.fieldMapping?.[name] !== expected) {
        fail(`calendar ${name} mismatch: ${view.fieldMapping?.[name]}`);
      }
    }
    if (!Array.isArray(view.cards) || view.cards.length !== 1) {
      fail(`expected one calendar card, got ${view.cards?.length}`);
    }
    const cellByKey = new Map(view.cards[0].values.map((cell) => [cell.value?.keyID, cell.value]));
    const hasDateValue = cellByKey.get(dateKeyID)?.date?.isNotEmpty;
    if (!hasDateValue) {
      fail("calendar card does not include the smoke date value");
    }
    for (const [keyID, expected] of [
      [recurrenceKeyID, "FREQ=WEEKLY;COUNT=2"],
      [exceptionKeyID, "2026-05-31"],
      [locationKeyID, "Smoke Room"],
      [descriptionKeyID, "Smoke description"],
    ]) {
      if (cellByKey.get(keyID)?.text?.content !== expected) {
        fail(`calendar metadata cell [${keyID}] mismatch: ${JSON.stringify(cellByKey.get(keyID))}`);
      }
    }
    const colorValue = cellByKey.get(colorKeyID)?.mSelect?.[0];
    if (colorValue?.content !== "Focus" || colorValue?.color !== "1") {
      fail(`calendar color cell mismatch: ${JSON.stringify(colorValue)}`);
    }

    console.log(`calendar kernel smoke passed: workspace=${workspace} port=${port} av=${avID} view=${viewID}`);
  } finally {
    if (kernel && !kernel.killed) {
      try {
        await postJSON(baseURL, "/api/system/exit", {});
      } catch {
        kernel.kill("SIGTERM");
      }
      await sleep(500);
      if (!kernel.killed) {
        kernel.kill("SIGKILL");
      }
    }
    fs.rmSync(buildDir, {recursive: true, force: true});
    if (process.env.SIYUAN_CALENDAR_KEEP_SMOKE_WORKSPACE !== "1") {
      fs.rmSync(workspace, {recursive: true, force: true});
    }
  }
};

main().catch((error) => {
  console.error(`calendar kernel smoke failed: ${error.stack || error.message}`);
  process.exit(1);
});
