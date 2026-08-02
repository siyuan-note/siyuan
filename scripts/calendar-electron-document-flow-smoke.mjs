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
const appDir = path.join(root, "app");
const expectedKernelVersion = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).version;
const kernelDir = path.join(root, "kernel");
const appKernelDir = path.join(appDir, "kernel");
const appKernelBinary = path.join(appKernelDir, process.platform === "win32" ? "SiYuan-Kernel.exe" : "SiYuan-Kernel");
const electronBinary = path.join(appDir, "node_modules/.bin/electron");
const desktopBuildDir = path.join(appDir, "stage/build/desktop");
const appBuildDir = path.join(appDir, "stage/build/app");
const kernelPort = 6806;

const fail = (message) => {
  throw new Error(message);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const isPortFree = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once("error", () => resolve(false));
  server.listen(port, "127.0.0.1", () => {
    server.close(() => resolve(true));
  });
});

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

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

const performTransactions = (baseURL, doOperations, undoOperations = []) => postJSON(baseURL, "/api/transactions", {
  transactions: [{doOperations, undoOperations}],
  reqId: Date.now(),
});

const textCellValue = (keyID, content) => ({
  type: "text",
  text: {content},
  keyID,
});

const waitForKernelBoot = async (baseURL) => {
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

const getJSON = (url) => new Promise((resolve, reject) => {
  const request = http.get(url, (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      body += chunk;
    });
    response.on("end", () => {
      if (response.statusCode !== 200) {
        reject(new Error(`${url} returned HTTP ${response.statusCode}`));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
  request.on("error", reject);
  request.setTimeout(1000, () => request.destroy(new Error(`${url} timed out`)));
});

const waitForElectronDebug = async (debugPort) => {
  let lastError = "";
  for (let i = 0; i < 80; i++) {
    try {
      const version = await getJSON(`http://127.0.0.1:${debugPort}/json/version`);
      const targets = await getJSON(`http://127.0.0.1:${debugPort}/json/list`);
      const urls = targets.map((target) => target.url || "");
      if (version.Browser && urls.some((url) => url.includes("/stage/build/") || url.includes("/appearance/boot/") || url.endsWith("/check-auth"))) {
        return {browser: version.Browser, urls};
      }
      lastError = `targets=${urls.join(",")}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(500);
  }
  fail(`electron remote debugging endpoint did not expose a SiYuan target: ${lastError}`);
};

const createCDPClient = (webSocketURL) => new Promise((resolve, reject) => {
  const socket = new WebSocket(webSocketURL);
  let id = 0;
  const pending = new Map();
  socket.addEventListener("open", () => {
    resolve({
      send(method, params = {}) {
        const requestID = ++id;
        socket.send(JSON.stringify({id: requestID, method, params}));
        return new Promise((requestResolve, requestReject) => {
          pending.set(requestID, {resolve: requestResolve, reject: requestReject});
        });
      },
      close() {
        socket.close();
      },
    });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data.toString());
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      request.resolve(message.result);
    }
  });
  socket.addEventListener("error", () => reject(new Error(`failed to connect to ${webSocketURL}`)));
});

const evaluateInTarget = async (debugPort, expression, timeout = 10000) => {
  const targets = await getJSON(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find((item) => (item.url || "").includes("/stage/build/")) ||
    targets.find((item) => (item.url || "").endsWith("/check-auth")) ||
    targets.find((item) => (item.url || "").includes("/appearance/boot/"));
  if (!target?.webSocketDebuggerUrl) {
    fail(`no debuggable SiYuan target found: ${targets.map((item) => item.url).join(",")}`);
  }
  const client = await createCDPClient(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    const result = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout,
    });
    if (result.exceptionDetails) {
      fail(`electron target evaluation failed: ${result.exceptionDetails.text}`);
    }
    return result.result?.value;
  } finally {
    client.close();
  }
};

const waitForAppShell = async (debugPort) => {
  let lastState;
  for (let i = 0; i < 80; i++) {
    lastState = await evaluateInTarget(debugPort, `(() => ({
      href: location.href,
      title: document.title,
      hasSiyuan: !!window.siyuan,
      hasOpenFileByURL: typeof window.openFileByURL === 'function',
      hasLayout: !!document.querySelector('.layout, .layout__center, .fn__flex-column'),
      hasLayoutModel: !!(window.siyuan && window.siyuan.layout && window.siyuan.layout.centerLayout),
      openedEditors: document.querySelectorAll('.protyle').length,
    }))()`, 5000);
    if (lastState?.hasSiyuan && lastState.hasLayout && lastState.hasLayoutModel && lastState.hasOpenFileByURL) {
      return lastState;
    }
    await sleep(500);
  }
  fail(`electron target did not expose app shell: ${JSON.stringify(lastState)}`);
};

const createCalendarFixture = async (baseURL) => {
  const notebookData = await postJSON(baseURL, "/api/notebook/createNotebook", {
    name: `Calendar Document Flow ${Date.now()}`,
  });
  const notebookID = notebookData.notebook.id || notebookData.notebook.ID;
  const docData = await postJSON(baseURL, "/api/filetree/createDocWithMd", {
    notebook: notebookID,
    path: "/Calendar Document Flow",
    markdown: "# Calendar Document Flow\\n",
    id: nodeID(),
  });
  const docID = typeof docData === "string" ? docData : (docData.id || docData.ID);
  const docInfo = await postJSON(baseURL, "/api/block/getBlockInfo", {id: docID});
  if (docInfo.rootID !== docID) {
    fail(`created document block info mismatch: ${JSON.stringify(docInfo)}`);
  }
  const avID = nodeID();
  const avBlockID = nodeID();
  await postJSON(baseURL, "/api/block/appendBlock", {
    parentID: docID,
    dataType: "dom",
    data: `<div class="av" data-node-id="${avBlockID}" data-av-id="${avID}" data-type="NodeAttributeView" data-av-type="table"><div></div></div>`,
  });
  const avBlockInfo = await postJSON(baseURL, "/api/block/getBlockInfo", {id: avBlockID});
  if (avBlockInfo.rootID !== docID) {
    fail(`created AV block info mismatch: ${JSON.stringify(avBlockInfo)}`);
  }
  await postJSON(baseURL, "/api/av/renderAttributeView", {
    id: avID,
    blockID: avBlockID,
    pageSize: -1,
    createIfNotExist: true,
  });
  const dateKeyID = nodeID();
  const recurrenceKeyID = nodeID();
  const rowID = nodeID();
  await performTransactions(baseURL, [{
    action: "addAttrViewCol",
    avID,
    id: dateKeyID,
    name: "Flow Date",
    type: "date",
  }, {
    action: "addAttrViewCol",
    avID,
    id: recurrenceKeyID,
    name: "Flow Recurrence",
    type: "text",
  }, {
    action: "insertAttrViewBlock",
    avID,
    blockID: avBlockID,
    srcs: [{itemID: rowID, id: rowID, isDetached: true, content: "Calendar document flow event"}],
    context: {ignoreTip: "true"},
  }, {
    action: "updateAttrViewCell",
    avID,
    keyID: dateKeyID,
    rowID,
    data: {
      type: "date",
      date: {
        content: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 9, 0, 0).getTime(),
        isNotEmpty: true,
        content2: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 10, 0, 0).getTime(),
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
    data: textCellValue(recurrenceKeyID, "None"),
  }]);
  const calendarData = await postJSON(baseURL, "/api/av/changeAttrViewLayout", {
    blockID: avBlockID,
    avID,
    layoutType: "calendar",
  });
  await postJSON(baseURL, "/api/attr/setBlockAttrs", {
    id: avBlockID,
    attrs: {
      "custom-sy-av-view": calendarData.viewID,
    },
  });
  await performTransactions(baseURL, [{
    action: "setAttrViewCalendarDateField",
    avID,
    blockID: avBlockID,
    data: dateKeyID,
    viewID: calendarData.viewID,
  }, {
    action: "setAttrViewCalendarFieldMapping",
    avID,
    blockID: avBlockID,
    viewID: calendarData.viewID,
    data: {recurrenceFieldID: recurrenceKeyID},
  }]);
  return {notebookID, docID, avID, avBlockID, dateKeyID, recurrenceKeyID, viewID: calendarData.viewID};
};

const waitForDocumentCalendar = async (debugPort, fixture) => {
  let lastState;
  await evaluateInTarget(debugPort, `(() => {
    window.__calendarDocFlowErrors = [];
    window.__calendarDocFlowFetches = [];
    window.addEventListener('error', (event) => window.__calendarDocFlowErrors.push(String(event.message || event.error || 'error')));
    window.addEventListener('unhandledrejection', (event) => window.__calendarDocFlowErrors.push(String(event.reason?.stack || event.reason || 'rejection')));
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = String(args[0] || '');
      if (url.includes('/api/av/renderAttributeView')) {
        response.clone().json().then((data) => {
          window.__calendarDocFlowFetches.push({url, body: args[1]?.body || '', code: data.code, msg: data.msg || '', viewType: data.data?.viewType || '', viewID: data.data?.viewID || ''});
        }).catch((error) => window.__calendarDocFlowFetches.push({url, error: String(error)}));
      }
      return response;
    };
    return true;
  })()`, 5000);
  const openURLs = [
    `siyuan://blocks/${fixture.docID}`,
    `siyuan://blocks/${fixture.docID}?focus=1`,
    `siyuan://blocks/${fixture.avBlockID}?focus=1`,
  ];
  const openResults = [];
  for (let i = 0; i < 80; i++) {
    if (i % 20 === 0) {
      const openURL = openURLs[Math.min(i / 20, openURLs.length - 1)];
      openResults.push(await evaluateInTarget(debugPort, `window.openFileByURL(${JSON.stringify(openURL)})`, 5000));
    }
    lastState = await evaluateInTarget(debugPort, `(() => {
      const av = document.querySelector('.av[data-av-id="${fixture.avID}"]');
      const calendars = Array.from(document.querySelectorAll('.av__calendar')).map(item => ({
        text: item.textContent.slice(0, 300),
        avID: item.closest('.av')?.getAttribute('data-av-id') || '',
        avType: item.closest('.av')?.getAttribute('data-av-type') || '',
        eventText: Array.from(item.querySelectorAll('.av__calendar-event')).map(event => event.textContent || '').join('\\n'),
      }));
      const activeTab = document.querySelector('.layout-tab-bar .item--focus, .layout-tab-bar .item--active');
      return {
        href: location.href,
        title: document.title,
        openResults: ${JSON.stringify(openResults)},
        activeTabText: activeTab?.textContent?.trim().slice(0, 120) || '',
        protyleCount: document.querySelectorAll('.protyle').length,
        wysiwygCount: document.querySelectorAll('.protyle-wysiwyg').length,
        avFound: !!av,
        avType: av?.getAttribute('data-av-type') || '',
        avDataRender: av?.getAttribute('data-render') || '',
        avChildCount: av?.children?.length || 0,
        avHTML: av?.outerHTML?.slice(0, 1000) || '',
        fetches: window.__calendarDocFlowFetches || [],
        errors: window.__calendarDocFlowErrors || [],
        calendarCount: calendars.length,
        calendars,
        bodyText: document.body.textContent.slice(0, 500),
      };
    })()`, 5000);
    if (lastState?.calendars?.some((item) => item.avID === fixture.avID && item.eventText.includes("Calendar document flow event"))) {
      return lastState;
    }
    await sleep(500);
  }
  fail(`document Calendar did not render through normal open flow: ${JSON.stringify(lastState)}`);
};

const stopProcessGroup = async (child) => {
  if (!child || child.exitCode !== null) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await sleep(500);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
};

const main = async () => {
  if (!fs.existsSync(electronBinary)) {
    fail(`electron binary missing at ${electronBinary}; run app dependencies install first`);
  }
  if (!process.env.DISPLAY && spawnSync("which", ["xvfb-run"], {stdio: "ignore"}).status !== 0) {
    fail("DISPLAY is not set and xvfb-run is unavailable");
  }
  if (!(await isPortFree(kernelPort))) {
    fail(`port ${kernelPort} is already in use; close the existing SiYuan kernel before running this smoke`);
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-calendar-document-flow-workspace-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-calendar-document-flow-home-"));
  const xdgConfig = path.join(home, ".config");
  const siyuanConfig = path.join(home, ".config/siyuan");
  const debugPort = await getFreePort();
  const baseURL = `http://127.0.0.1:${kernelPort}`;
  const hadKernelBinary = fs.existsSync(appKernelBinary);
  const hadAppBuildDir = fs.existsSync(appBuildDir);
  // A real (non-symlink) stage/build/app left over from `pnpm run build:app`
  // silently shadows the desktop build this smoke was told to verify: the app
  // shell then loads a stale base.css, and every assertion about computed style
  // quietly measures last week's stylesheet. Fail loudly instead.
  if (hadAppBuildDir && !fs.lstatSync(appBuildDir).isSymbolicLink()) {
    const appIndex = path.join(appBuildDir, "index.html");
    const desktopIndex = path.join(desktopBuildDir, "index.html");
    if (fs.existsSync(desktopIndex) &&
      (!fs.existsSync(appIndex) || fs.statSync(appIndex).mtimeMs < fs.statSync(desktopIndex).mtimeMs)) {
      fail(`${appBuildDir} is older than the desktop build and would shadow it; run "cd app && corepack pnpm run build:app" or delete app/stage/build/app`);
    }
  }
  let kernel;
  let electron;

  try {
    fs.mkdirSync(siyuanConfig, {recursive: true});
    fs.writeFileSync(path.join(siyuanConfig, "workspace.json"), JSON.stringify([workspace]));
    if (!hadAppBuildDir) {
      if (!fs.existsSync(path.join(desktopBuildDir, "index.html"))) {
        fail(`desktop build output missing at ${desktopBuildDir}; run cd app && corepack pnpm run build:desktop first`);
      }
      fs.symlinkSync(desktopBuildDir, appBuildDir, "dir");
    }
    if (!hadKernelBinary) {
      fs.mkdirSync(appKernelDir, {recursive: true});
      const build = spawnSync("go", ["build", "-tags", "fts5", "-o", appKernelBinary, "."], {
        cwd: kernelDir,
        env: {...process.env, CGO_ENABLED: "1"},
        stdio: "inherit",
      });
      if (build.status !== 0) {
        fail(`kernel build failed with code ${build.status}`);
      }
    }
    kernel = spawn(appKernelBinary, [
      "serve",
      "--port", String(kernelPort),
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
    await waitForKernelBoot(baseURL);
    const fixture = await createCalendarFixture(baseURL);
    const electronArgs = [
      electronBinary,
      "./electron/main.js",
      `--workspace=${workspace}`,
      `--port=${kernelPort}`,
      `--remote-debugging-port=${debugPort}`,
      "--no-sandbox",
      "--disable-gpu",
      "--ozone-platform=x11",
    ];
    electron = spawn(process.env.DISPLAY ? electronArgs[0] : "xvfb-run", process.env.DISPLAY ? electronArgs.slice(1) : ["-a", ...electronArgs], {
      cwd: appDir,
      env: {...process.env, NODE_ENV: "development", HOME: home, XDG_CONFIG_HOME: xdgConfig},
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let electronOutput = "";
    electron.stdout.on("data", (chunk) => {
      electronOutput += chunk.toString();
      process.stdout.write(chunk);
    });
    electron.stderr.on("data", (chunk) => {
      electronOutput += chunk.toString();
      process.stderr.write(chunk);
    });
    const debugInfo = await waitForElectronDebug(debugPort);
    const shellState = await waitForAppShell(debugPort);
    const calendarState = await waitForDocumentCalendar(debugPort, fixture);
    if (electron.exitCode !== null) {
      fail(`electron exited before document flow completed: ${electronOutput.slice(-2000)}`);
    }
    console.log(`calendar electron document flow smoke passed: workspace=${workspace} debugPort=${debugPort} browser=${debugInfo.browser} shell=${shellState.href} doc=${fixture.docID} av=${fixture.avID} calendars=${calendarState.calendarCount}`);
  } finally {
    await stopProcessGroup(electron);
    if (kernel && kernel.exitCode === null) {
      try {
        await postJSON(baseURL, "/api/system/exit", {});
      } catch {
        kernel.kill("SIGTERM");
      }
      await sleep(500);
      if (kernel.exitCode === null) {
        kernel.kill("SIGKILL");
      }
    }
    if (!hadKernelBinary) {
      fs.rmSync(appKernelDir, {recursive: true, force: true, maxRetries: 3});
    }
    if (!hadAppBuildDir) {
      fs.rmSync(appBuildDir, {recursive: true, force: true, maxRetries: 3});
    }
    if (process.env.SIYUAN_CALENDAR_KEEP_SMOKE_WORKSPACE !== "1") {
      fs.rmSync(workspace, {recursive: true, force: true, maxRetries: 3});
      fs.rmSync(home, {recursive: true, force: true, maxRetries: 3});
    }
  }
};

main().catch((error) => {
  console.error(`calendar electron document flow smoke failed: ${error.stack || error.message}`);
  process.exit(1);
});
