const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {randomBytes} = require("node:crypto");
const {createMapSessionRouter, MAP_HOST_BOOTSTRAP_TIMEOUT, MAP_HOST_READY_TIMEOUT} = require("../../../electron/mapHostManager");
const {hasUnsafeMapSwitches, mapHostFiles, parseMapReply} = require("../../../electron/mapHostPolicy");

const appDir = path.resolve(__dirname, "../../..");
const preload = path.join(appDir, "electron/mapHostPreload.js");
const ownerPreferences = Object.freeze({nodeIntegration: true, nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false, webviewTag: true, webSecurity: false, contextIsolation: false,
    autoplayPolicy: "user-gesture-required"});
const guestPreferences = Object.freeze({sandbox: true, contextIsolation: true, webSecurity: true,
    nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
    webviewTag: false, allowRunningInsecureContent: false, plugins: false, experimentalFeatures: false,
    navigateOnDragDrop: false, disablePopups: true, safeDialogs: true, disableDialogs: true,
    spellcheck: false, backgroundThrottling: false, autoplayPolicy: "user-gesture-required"});
// Electron 44 的 getLastWebPreferences 只回传此固定子集，不包含 preload 等构造参数。
const reportedPreferenceKeys = Object.freeze(["sandbox", "contextIsolation", "webSecurity", "nodeIntegration",
    "nodeIntegrationInSubFrames", "nodeIntegrationInWorker", "webviewTag", "allowRunningInsecureContent",
    "experimentalFeatures", "disablePopups", "safeDialogs", "disableDialogs"]);
const getGuestPreferenceMismatch = actual => reportedPreferenceKeys.find(name => actual?.[name] !== guestPreferences[name]);

// 仅供独立原型使用；渲染器不能指定偏好或预载脚本。
const hardenAttachment = (event, preferences, params, expected) => {
    const unsafe = ["preload", "webpreferences", "nodeintegration", "nodeintegrationinsubframes",
        "disablewebsecurity", "allowpopups", "plugins", "blinkfeatures", "disableblinkfeatures",
        "useragent", "httpreferrer"].some(name => !!params[name]);
    if (expected.used || event.sender !== expected.owner || params.src !== expected.src ||
        params.partition !== expected.partition || unsafe) {
        event.preventDefault();
        return false;
    }
    expected.used = true;
    for (const name of Object.keys(preferences)) delete preferences[name];
    Object.assign(preferences, guestPreferences, {preload, session: expected.session, partition: expected.partition});
    return true;
};

const checkRealAssets = (directory = appDir) => {
    for (const [relative] of Object.values(mapHostFiles)) {
        try {
            if (!fs.statSync(path.join(directory, relative)).isFile()) throw new Error("Missing asset");
        } catch (_error) {
            const error = new Error("Real map assets are missing");
            error.code = "MAP_FIXTURE_ASSETS_MISSING";
            throw error;
        }
    }
};

const createTemporaryProfile = () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-map-webview-"));
    return {profile, cleanup() {
        if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) ||
            !path.basename(profile).startsWith("siyuan-map-webview-")) return;
        try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 100}); }
        catch (_error) { /* Electron 退出时可能暂时保留配置目录的文件锁。 */ }
    }};
};

// 合成模式复用真实协议、准备阶段和运行时，仅替换地图适配器。
const createSyntheticFiles = () => {
    const ts = require("typescript");
    const directory = path.join(appDir, "src/protyle/render/av/map");
    const modules = Object.fromEntries(["protocol", "loadingBudget", "bootstrap", "hostRuntime"].map(name =>
        ["./" + name, ts.transpileModule(fs.readFileSync(path.join(directory, name + ".ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText]));
    modules["./providersLoader"] = `
        window.mapFixture = {fits: 0, revisions: [], destroyed: 0, visible: [], clicks: 0, locked: false};
        exports.prepareAVMapAssets = async () => ({lock() { window.mapFixture.locked = true; }, destroy() {}});
        exports.loadAVMapAdapter = async (_init, container, callbacks) => {
            window.mapFixture.callbacks = callbacks;
            container.style.background = "rgb(25, 119, 145)";
            container.textContent = "Synthetic map adapter. No provider network or WebGL.";
            container.addEventListener("click", () => window.mapFixture.clicks++);
            return {setPoints(points, revision) { window.mapFixture.revisions.push(revision); },
                fit() { window.mapFixture.fits++; }, resize() {}, setTheme() {},
                setVisible(value) { window.mapFixture.visible.push(value); },
                destroy() { window.mapFixture.destroyed++; }};
        };`;
    const runtime = `(() => {
        const modules = {${Object.entries(modules).map(([name, source]) =>
        `${JSON.stringify(name)}: (require, exports) => {${source}\n}`).join(",")}};
        const cache = {};
        const load = name => {
            if (!modules[name]) throw new Error("Unknown fixture module");
            if (!cache[name]) { cache[name] = {}; modules[name](load, cache[name]); }
            return cache[name];
        };
        load("./hostRuntime").connectAVMapRuntime(window);
    })();`;
    return new Map([["stage/map/index.html", fs.readFileSync(path.join(appDir, "stage/map/index.html"))],
        ["stage/map/host.css", fs.readFileSync(path.join(appDir, "stage/map/host.css"))],
        ["stage/build/map/host.js", Buffer.from(runtime)]]);
};

const waitFor = async (predicate, label, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (!await predicate()) {
        assert.ok(Date.now() < deadline, label);
        await new Promise(resolve => setTimeout(resolve, 25));
    }
};

const createHarness = async ({profile, mode = "real", automate = false} = {}) => {
    if (typeof profile !== "string" || !path.isAbsolute(profile) || !["real", "synthetic"].includes(mode)) {
        throw new Error("An isolated profile and fixed fixture mode are required");
    }
    const {app, BrowserWindow, MessageChannelMain, session} = require("electron");
    if (hasUnsafeMapSwitches(app.commandLine)) throw new Error("Unsafe process switches are prohibited");
    if (mode === "real") checkRealAssets();
    app.setPath("userData", profile);
    await app.whenReady();
    const syntheticFiles = mode === "synthetic" ? createSyntheticFiles() : undefined;
    const instanceID = randomBytes(24).toString("hex"), nonce = randomBytes(24).toString("hex");
    const partition = "map-webview-fixture-" + instanceID;
    const ses = session.fromPartition(partition, {cache: false});
    let win, owner, guest, router, port, expected, timer, ready = false, closed = false, loaded = false, isolating = false;
    let resolveReady, rejectReady;
    const readiness = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // 事件可能在 createHarness 等待就绪前失败。
    void readiness.catch(() => {});
    const evidence = {privateRequests: 0, guestNetworkRequests: 0, defaultHeaderCalls: 0,
        defaultGuestHeaderCalls: 0, rejectedAttachments: 0, attached: 0, replies: [], diagnostics: []};
    const server = http.createServer((request, response) => {
        const files = {"/stage/build/app/": ["owner.html", "text/html"],
            "/fixture-owner.js": ["owner.js", "text/javascript"], "/fixture-owner.css": ["owner.css", "text/css"]};
        const resource = files[request.url];
        if (!resource) {
            if (request.url.startsWith("/api/")) evidence.privateRequests++;
            else evidence.guestNetworkRequests++;
            response.writeHead(403).end();
            return;
        }
        // 复现真实默认会话删除 CSP 的行为，不改生产入口。
        response.setHeader("Content-Security-Policy", "default-src 'none'");
        response.setHeader("Content-Type", resource[1]);
        response.end(fs.readFileSync(path.join(__dirname, resource[0])));
    });
    const fail = (code, detail = {}) => {
        if (closed) return;
        if (owner && !owner.isDestroyed()) owner.send("map-webview-fixture-state", {type: "error", code});
        const error = new Error("Map fixture failure");
        error.code = code;
        error.netError = detail.netError;
        error.preference = detail.preference;
        rejectReady(error);
        if (ready) void destroy();
    };
    const send = value => { if (port && !closed) port.postMessage({version: 1, instanceID, ...value}); };
    const onCreated = (_event, contents) => {
        if (contents.getType() !== "webview") return;
        if (closed || guest || !expected?.used || contents.hostWebContents !== owner || contents.session !== ses) {
            contents.close({waitForBeforeUnload: false});
            return;
        }
        guest = contents;
        // 此事件早于首次 loadURL；did-attach-webview 仅用于复核，不能承担首次防护。
        contents.setWindowOpenHandler(() => ({action: "deny"}));
        for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
            contents.on(name, event => event.preventDefault());
        }
        contents.on("will-prevent-unload", event => event.preventDefault());
        contents.on("select-client-certificate", (event, _url, _certificates, callback) => { event.preventDefault(); callback(); });
        contents.on("login", (event, _details, _auth, callback) => { event.preventDefault(); callback(); });
        contents.on("certificate-error", (_event, _url, _error, _certificate, callback) => callback(false));
        contents.on("console-message", (event, _level, legacyMessage) => {
            const message = event?.message ?? legacyMessage;
            if (!ready && typeof message === "string" && message.includes("frame-ancestors")) fail("documentCSPBlocked");
        });
        contents.on("did-navigate", (_event, url) => { if (url !== expected.src) fail("hostDocumentMismatch"); });
        contents.on("did-navigate-in-page", () => fail("hostDocumentMismatch"));
        contents.on("render-process-gone", () => fail("hostRendererGone"));
        contents.on("destroyed", () => { if (!closed) fail("hostDestroyed"); });
        contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
            if (isMainFrame && code !== -3) fail("hostDocumentLoadFailed", {netError: code});
        });
        contents.on("did-finish-load", () => {
            if (loaded || contents.getURL() !== expected.src) { fail("hostDocumentMismatch"); return; }
            loaded = true;
            const channel = new MessageChannelMain();
            port = channel.port1;
            port.on("message", event => {
                const reply = parseMapReply(event.data, instanceID);
                if (!reply || closed) return;
                if (reply.type === "bootstrapReady" && !ready) {
                    clearTimeout(timer);
                    timer = setTimeout(() => fail("hostSDKTimeout"), MAP_HOST_READY_TIMEOUT);
                    send({type: "init", provider: "openfreemap", theme: "light"});
                } else if (reply.type === "ready" && !ready) {
                    ready = true;
                    clearTimeout(timer);
                    send({type: "setPoints", revision: 1, points: [{id: "synthetic-row-1", longitude: 121.4737, latitude: 31.2304},
                        {id: "synthetic-row-2", longitude: 121.5037, latitude: 31.2404}]});
                    send({type: "visibility", visible: true});
                    owner.send("map-webview-fixture-state", {type: "ready", mode});
                    resolveReady();
                } else if (reply.type === "error") fail(reply.code);
                else if (reply.type === "markerClick" && ready && reply.revision === 1 &&
                    ["synthetic-row-1", "synthetic-row-2"].includes(reply.id)) {
                    evidence.replies.push(reply);
                    owner.send("map-webview-fixture-state", reply);
                }
            });
            port.start();
            contents.postMessage("siyuan-map-port", {version: 1, instanceID, nonce, provider: "openfreemap"}, [channel.port2]);
        });
    };
    const destroy = async () => {
        if (closed) return;
        send({type: "destroy"});
        closed = true;
        if (!ready) {
            const error = new Error("Map fixture closed before ready");
            error.code = "ownerClosed";
            rejectReady(error);
        }
        clearTimeout(timer);
        app.removeListener("web-contents-created", onCreated);
        port?.close();
        router?.destroy();
        if (guest && !guest.isDestroyed()) guest.close({waitForBeforeUnload: false});
        if (win && !win.isDestroyed()) win.destroy();
        session.defaultSession.webRequest.onHeadersReceived(null);
        server.closeAllConnections?.();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    };
    try {
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        const src = origin + "/stage/map/index.html?provider=openfreemap#" + instanceID + ":" + nonce;
        router = createMapSessionRouter({ses, origin, appDir,
            readFile: syntheticFiles ? async filename => {
                const relative = path.relative(appDir, filename).split(path.sep).join("/");
                if (!syntheticFiles.has(relative)) throw new Error("Unknown synthetic fixture asset");
                return syntheticFiles.get(relative);
            } : undefined,
            report: code => evidence.diagnostics.push(code)});
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            evidence.defaultHeaderCalls++;
            if (details.url.includes("/stage/map/") || details.url.includes("/stage/build/map/")) evidence.defaultGuestHeaderCalls++;
            callback({responseHeaders: Object.fromEntries(Object.entries(details.responseHeaders || {})
                .filter(([name]) => !["content-security-policy", "x-frame-options", "access-control-allow-origin"].includes(name.toLowerCase())))});
        });
        app.on("web-contents-created", onCreated);
        win = new BrowserWindow({width: 820, height: 620, useContentSize: true, show: true,
            webPreferences: {...ownerPreferences}});
        owner = win.webContents;
        expected = {owner, src, partition, session: ses, used: false};
        owner.on("will-attach-webview", (event, preferences, params) => {
            if (!hardenAttachment(event, preferences, params, expected)) evidence.rejectedAttachments++;
        });
        owner.on("did-attach-webview", (_event, attached) => {
            const actual = attached.getLastWebPreferences();
            const mismatch = getGuestPreferenceMismatch(actual);
            if (attached !== guest || attached.hostWebContents !== owner || attached.session !== ses || mismatch) {
                fail(mismatch ? "attachPreferenceMismatch" : "hostAttachFailed", {preference: mismatch});
                attached.close({waitForBeforeUnload: false});
                return;
            }
            evidence.attached++;
        });
        win.on("closed", () => { void destroy().then(() => { if (!automate) app.quit(); }); });
        await win.loadURL(origin + "/stage/build/app/");
        timer = setTimeout(() => fail("hostBootstrapTimeout"), MAP_HOST_BOOTSTRAP_TIMEOUT);
        owner.send("map-webview-fixture-start", {src, partition, mode});
        await readiness;
        const harness = {win, owner, get guest() { return guest; }, session: ses, origin, src, partition, instanceID,
            mode, evidence, send, destroy};
        isolating = true;
        await verifyIsolation(harness);
        console.info("Map webview boundary checks passed: isolated session, opaque origin, no Node/IPC or owner DOM access, private network denied.");
        return harness;
    } catch (error) {
        await destroy();
        if (isolating && error.code !== "isolationCheckTimeout") error.code = "isolationAssertionFailed";
        else if (!error.code) error.code = "fixtureSetupFailed";
        throw error;
    }
};

const verifyIsolationChecks = async harness => {
    const {owner, guest, evidence, origin} = harness;
    const inspect = source => guest.executeJavaScript(source);
    const ownerPrefs = owner.getLastWebPreferences();
    for (const [name, value] of Object.entries(ownerPreferences)) {
        if (reportedPreferenceKeys.includes(name)) assert.equal(ownerPrefs[name], value, name);
    }
    assert.equal(getGuestPreferenceMismatch(guest.getLastWebPreferences()), undefined);
    assert.notEqual(guest.session, owner.session);
    assert.notEqual(guest.getOSProcessId(), owner.getOSProcessId());
    assert.equal(guest.session.isPersistent(), false);
    assert.deepEqual(await inspect(`(() => {
        const ownerVisible = target => { try { return !!target?.document?.getElementById("owner-private-sentinel"); } catch (_) { return false; } };
        let evalBlocked = false; try { (0, eval)("1"); } catch (_) { evalBlocked = true; }
        return {origin: window.origin, require: typeof require, process: typeof process, ipc: typeof ipcRenderer,
            bridge: Object.keys(window.siyuanMapDesktop), parentOwner: ownerVisible(parent), topOwner: ownerVisible(top),
            openerOwner: ownerVisible(opener), evalBlocked};
    })()`), {origin: "null", require: "undefined", process: "undefined", ipc: "undefined", bridge: ["version"],
        parentOwner: false, topOwner: false, openerOwner: false, evalBlocked: true});
    assert.ok(evidence.defaultHeaderCalls > 0, "the unsafe owner header-removal fixture is active");
    assert.equal(evidence.defaultGuestHeaderCalls, 0, "guest resources bypass the owner's default session entirely");
    assert.equal(evidence.guestNetworkRequests, 0, "fixed local guest resources never reach the kernel server");
    for (const target of [origin + "/api/fixture-private", "https://example.invalid/private", "file:///fixture-private"]) {
        assert.equal(await inspect(`fetch(${JSON.stringify(target)}).then(() => false, () => true)`), true);
    }
    assert.equal(evidence.privateRequests, 0, "private API probes never reach the kernel server");
};

const verifyIsolation = async harness => {
    let timer;
    const deadline = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            const error = new Error("Map isolation check deadline exceeded");
            error.code = "isolationCheckTimeout";
            reject(error);
        }, 5000);
    });
    try { await Promise.race([verifyIsolationChecks(harness), deadline]); }
    finally { clearTimeout(timer); }
};

const verifyHarness = async harness => {
    assert.equal(harness.mode, "synthetic", "automated adapter checks require explicit synthetic mode");
    const {owner, guest, win, evidence, origin, src} = harness;
    const evaluate = source => owner.executeJavaScript(source);
    const inspect = source => guest.executeJavaScript(source);
    await verifyIsolation(harness);
    await waitFor(() => inspect("window.mapFixture?.fits === 1 && window.mapFixture.visible.length === 1"), "runtime receives points and visibility");
    assert.equal(await inspect("window.mapFixture.locked"), true);
    const privateURL = origin + "/api/fixture-private";
    assert.deepEqual(await inspect(`new Promise(resolve => {
        const code = "fetch(" + ${JSON.stringify(JSON.stringify(privateURL))} + ").then(() => postMessage({denied:false}), () => postMessage({denied:true,node:typeof require,process:typeof process}))";
        const url = URL.createObjectURL(new Blob([code], {type:"text/javascript"}));
        const worker = new Worker(url);
        const done = result => { worker.terminate(); URL.revokeObjectURL(url); resolve(result); };
        worker.onmessage = event => done(event.data);
        worker.onerror = () => done({workerFailed:true});
    })`), {denied: true, node: "undefined", process: "undefined"});
    await inspect(`window.open(${JSON.stringify(privateURL)}); window.location.href = ${JSON.stringify(privateURL)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(guest.getURL(), src);
    assert.equal(evidence.privateRequests, 0);
    const identity = guest.id;
    const before = await inspect("JSON.stringify({fits:mapFixture.fits,revisions:mapFixture.revisions,visible:mapFixture.visible})");
    const pixel = async () => {
        const shot = await win.webContents.capturePage({x: 600, y: 285, width: 1, height: 1});
        const bitmap = shot.toBitmap();
        return [bitmap[2], bitmap[1], bitmap[0]];
    };
    await waitFor(async () => (await pixel()).join() === "25,119,145", "the guest surface is composited into the owner page");
    await evaluate("window.setFixtureMenu(true)");
    await waitFor(async () => (await pixel()).join() === "214,49,49", "ordinary DOM menu paints over the guest");
    owner.sendInputEvent({type: "mouseDown", x: 435, y: 200, button: "left", clickCount: 1});
    owner.sendInputEvent({type: "mouseUp", x: 435, y: 200, button: "left", clickCount: 1});
    await waitFor(() => evaluate("window.ownerFixture.menuActions === 1"), "the overlaid menu receives real input");
    assert.equal(await inspect("window.mapFixture.clicks"), 0);
    await evaluate("document.getElementById('menu-input').focus()");
    owner.sendInputEvent({type: "keyDown", keyCode: "Escape"});
    owner.sendInputEvent({type: "keyUp", keyCode: "Escape"});
    await waitFor(() => evaluate("document.getElementById('menu').hidden"), "Escape dismisses the ordinary DOM menu");
    await waitFor(async () => (await pixel()).join() === "25,119,145", "dismissal uncovers the still-rendered map");
    assert.equal(guest.id, identity);
    assert.equal(await inspect("JSON.stringify({fits:mapFixture.fits,revisions:mapFixture.revisions,visible:mapFixture.visible})"), before,
        "opening/closing an ordinary menu neither hides, rebuilds nor refits the map");
    await evaluate("document.getElementById('scroll-area').scrollTop = 80");
    assert.equal(await evaluate("document.getElementById('scroll-area').scrollTop"), 80);
    assert.equal(guest.id, identity);
    // 拒绝第二个伪造 guest，不影响已准入的 guest 和独立会话。
    await evaluate(`(() => {
        const bad = document.createElement("webview");
        bad.setAttribute("src", ${JSON.stringify(privateURL)});
        bad.setAttribute("partition", "persist:untrusted-fixture");
        bad.setAttribute("nodeintegration", "");
        bad.setAttribute("disablewebsecurity", "");
        document.body.appendChild(bad);
    })()`);
    await waitFor(() => evidence.rejectedAttachments > 0, "a forged second guest is rejected before creation");
    assert.equal(evidence.attached, 1);
    assert.equal(evidence.privateRequests, 0);
    assert.equal(guest.id, identity);
    await inspect("window.mapFixture.callbacks.onMarkerClick('foreign-row', 1); window.mapFixture.callbacks.onMarkerClick('synthetic-row-1', 0)");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(evidence.replies.length, 0);
    await inspect("window.mapFixture.callbacks.onMarkerClick('synthetic-row-1', 1)");
    await waitFor(() => evidence.replies.length === 1, "the existing finite protocol accepts only current member actions");
    await evaluate(`window.fixtureGuest.setAttribute("src", ${JSON.stringify(privateURL)})`);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(guest.isDestroyed() || guest.getURL() === src, "dynamic src changes cannot load another document");
    assert.equal(evidence.privateRequests, 0);
    if (!guest.isDestroyed()) {
        await evaluate("window.fixtureGuest.remove()");
        await waitFor(() => guest.isDestroyed(), "removing the DOM guest destroys its renderer");
    }
};

module.exports = {createHarness, createTemporaryProfile, verifyHarness, hardenAttachment, checkRealAssets,
    createSyntheticFiles, ownerPreferences, guestPreferences, getGuestPreferenceMismatch, reportedPreferenceKeys, verifyIsolation};
