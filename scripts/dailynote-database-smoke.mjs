#!/usr/bin/env node
// Smoke test: dailyNoteDatabaseID feature.
// 1. create notebook A + doc with an Attribute View block, materialize the AV
// 2. set notebook A conf dailyNoteDatabaseID = av block id
// 3. createDailyNote twice (same day): first adds exactly one row bound to the note, second is idempotent
// 4. notebook B without the setting behaves as before
import {spawn} from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const appDir = path.join(root, "app");
const kernelBinary = path.join(appDir, "kernel", "SiYuan-Kernel");
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

const main = async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-dailynote-db-smoke-workspace-"));
  const port = await getFreePort();
  const baseURL = `http://127.0.0.1:${port}`;
  let kernel;

  try {
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

    // Notebook A: target for daily notes
    const notebookAData = await postJSON(baseURL, "/api/notebook/createNotebook", {name: `Dailynote DB Smoke ${Date.now()}`});
    const notebookA = notebookAData.notebook.id || notebookAData.notebook.ID;
    if (!notebookA) {
      fail(`createNotebook returned no notebook ID: ${JSON.stringify(notebookAData)}`);
    }

    // Doc holding the database block
    const docID = nodeID();
    const docData = await postJSON(baseURL, "/api/filetree/createDocWithMd", {
      notebook: notebookA,
      path: "/Dailynote DB",
      markdown: "# Dailynote DB\n",
      id: docID,
    });
    const docIDResult = typeof docData === "string" ? docData : (docData.id || docData.ID);
    if (!docIDResult || docIDResult !== docID) {
      fail(`createDocWithMd returned unexpected doc id: ${JSON.stringify(docData)}`);
    }

    // Attribute View block (table layout)
    const avID = nodeID();
    const avBlockID = nodeID();
    await postJSON(baseURL, "/api/block/appendBlock", {
      parentID: docID,
      dataType: "dom",
      data: `<div class="av" data-node-id="${avBlockID}" data-av-id="${avID}" data-type="NodeAttributeView" data-av-type="table"></div>`,
    });

    // Materialize the AV
    const initialView = await postJSON(baseURL, "/api/av/renderAttributeView", {
      id: avID,
      blockID: avBlockID,
      pageSize: -1,
      createIfNotExist: true,
    });
    if (initialView.viewType !== "table") {
      fail(`expected table view, got ${initialView.viewType}`);
    }
    const initialRowCount = initialView.view?.rowCount ?? 0;
    if (initialRowCount !== 0) {
      fail(`expected 0 rows initially, got ${initialRowCount}`);
    }
    console.log(`[ok] initial AV rowCount = ${initialRowCount}`);

    // Configure notebook A: target database = av block id
    const confData = await postJSON(baseURL, "/api/notebook/setNotebookConf", {
      notebook: notebookA,
      conf: {dailyNoteDatabaseID: avBlockID},
    });
    if (confData.dailyNoteDatabaseID !== avBlockID) {
      fail(`setNotebookConf did not persist dailyNoteDatabaseID: ${JSON.stringify(confData)}`);
    }
    console.log(`[ok] dailyNoteDatabaseID persisted as ${confData.dailyNoteDatabaseID}`);

    // First daily note creation -> should add exactly one row bound to the note
    const firstData = await postJSON(baseURL, "/api/filetree/createDailyNote", {notebook: notebookA});
    const firstDocID = firstData.id;
    if (!firstDocID) {
      fail(`createDailyNote returned no doc id: ${JSON.stringify(firstData)}`);
    }
    console.log(`[ok] first daily note created: ${firstDocID}`);

    let view = await postJSON(baseURL, "/api/av/renderAttributeView", {
      id: avID,
      blockID: avBlockID,
      pageSize: -1,
      createIfNotExist: false,
    });
    let rowCount = view.view?.rowCount ?? 0;
    if (rowCount !== 1) {
      fail(`expected 1 row after first daily note, got ${rowCount}`);
    }
    let bound = await postJSON(baseURL, "/api/av/getAttributeViewItemIDsByBoundIDs", {
      avID,
      blockIDs: [firstDocID],
    });
    if (!bound[firstDocID]) {
      fail(`daily note not bound as a row: ${JSON.stringify(bound)}`);
    }
    const firstItemID = bound[firstDocID];
    console.log(`[ok] exactly 1 row after first create, itemID=${firstItemID}`);

    // Second daily note creation (same day, existed) -> must NOT add another row
    const secondData = await postJSON(baseURL, "/api/filetree/createDailyNote", {notebook: notebookA});
    if (secondData.id !== firstDocID) {
      fail(`second createDailyNote returned a different doc: ${secondData.id} vs ${firstDocID}`);
    }
    view = await postJSON(baseURL, "/api/av/renderAttributeView", {
      id: avID,
      blockID: avBlockID,
      pageSize: -1,
      createIfNotExist: false,
    });
    rowCount = view.view?.rowCount ?? 0;
    console.log(`[debug] render2 rowCount=${rowCount} rows=${view.view?.rows?.length} viewID=${view.view?.id}`);
    console.log(`[debug] render2 view keys: ${Object.keys(view.view || {}).join(",")}`);
    const avFile = path.join(workspace, "data", "storage", "av", `${avID}.json`);
    if (fs.existsSync(avFile)) {
      const avJson = JSON.parse(fs.readFileSync(avFile, "utf8"));
      const blockKv = (avJson.keyValues || []).find((kv) => kv.key?.type === "block");
      console.log(`[debug] av json block values: ${JSON.stringify((blockKv?.values || []).map((v) => ({id: v.blockID, bound: v.block?.id, detached: v.isDetached})))}`);
      console.log(`[debug] av json views itemIds: ${JSON.stringify((avJson.views || []).map((v) => ({id: v.id, itemIds: v.itemIDs}))) }`);
    } else {
      console.log(`[debug] av file missing: ${avFile}`);
    }
    if (rowCount !== 1) {
      fail(`expected still 1 row after second create, got ${rowCount}`);
    }
    bound = await postJSON(baseURL, "/api/av/getAttributeViewItemIDsByBoundIDs", {
      avID,
      blockIDs: [firstDocID],
    });
    if (bound[firstDocID] !== firstItemID) {
      fail(`item id changed on re-create: ${bound[firstDocID]} vs ${firstItemID}`);
    }
    console.log(`[ok] second create idempotent: still 1 row, same itemID`);

    // Notebook B without the setting -> unchanged behaviour
    const notebookBData = await postJSON(baseURL, "/api/notebook/createNotebook", {name: `Dailynote No DB ${Date.now()}`});
    const notebookB = notebookBData.notebook.id || notebookBData.notebook.ID;
    const plainData = await postJSON(baseURL, "/api/filetree/createDailyNote", {notebook: notebookB});
    if (!plainData.id) {
      fail(`createDailyNote without setting failed: ${JSON.stringify(plainData)}`);
    }
    console.log(`[ok] unset setting: daily note created normally: ${plainData.id}`);

    console.log("SMOKE_TEST_OK: dailyNoteDatabaseID feature verified");
  } finally {
    if (kernel) {
      kernel.kill("SIGTERM");
      await sleep(500);
      if (kernel.exitCode === null) {
        kernel.kill("SIGKILL");
      }
    }
    fs.rmSync(workspace, {recursive: true, force: true});
  }
};

main().catch((error) => {
  console.error(`SMOKE_TEST_FAILED: ${error.message}`);
  process.exit(1);
});
