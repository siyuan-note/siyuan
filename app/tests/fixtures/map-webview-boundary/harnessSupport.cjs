const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {randomBytes} = require("node:crypto");
const {createMapHostManager} = require("../../../electron/mapHostManager");
const {hasUnsafeMapSwitches, mapHostFiles} = require("../../../electron/mapHostPolicy");

const appDir = path.resolve(__dirname, "../../..");
const ownerPreferences = Object.freeze({nodeIntegration: true, nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false, webviewTag: true, webSecurity: false, contextIsolation: false,
    autoplayPolicy: "user-gesture-required"});
const {MAP_WEBVIEW_PREFERENCES: guestPreferences, getMapWebviewPreferenceMismatch: getGuestPreferenceMismatch} =
    require("../../../electron/mapWebviewHost");
// Electron 44 的 getLastWebPreferences 只回传此固定子集，不包含 preload 等构造参数。
const reportedPreferenceKeys = Object.freeze(["sandbox", "contextIsolation", "webSecurity", "nodeIntegration",
    "nodeIntegrationInSubFrames", "nodeIntegrationInWorker", "webviewTag", "allowRunningInsecureContent",
    "experimentalFeatures", "disablePopups", "safeDialogs", "disableDialogs"]);
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

// 编译实际业务样式和可见性函数，避免夹具自行重写圆角规则或命中判断。
const readMapCornerAssets = () => {
    const ts = require("typescript");
    const source = fs.readFileSync(path.join(appDir, "src/protyle/render/av/map/host.ts"), "utf8");
    const parsed = ts.createSourceFile("host.ts", source, ts.ScriptTarget.Latest, true);
    const visibility = parsed.statements.find(statement => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === "getAVMapVisibility"));
    assert.ok(visibility, "production visibility function exists");
    const theme = fs.readFileSync(path.join(appDir, "appearance/themes/daylight/theme.css"), "utf8");
    const radius = theme.match(/--b3-border-radius:\s*([^;]+);/);
    assert.ok(radius, "production theme defines the shared corner radius");
    return {css: require("sass").compile(path.join(appDir, "src/assets/scss/business/_av.scss")).css,
        radius: radius[1].trim(), visibility: ts.transpileModule(visibility.getText(parsed), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText};
};

const verifyMapCorners = async harness => {
    const {owner, guest, win} = harness;
    const assets = readMapCornerAssets();
    const evaluate = source => owner.executeJavaScript(source);
    const before = await evaluate(`(() => {
        const rect = document.getElementById("map-slot").getBoundingClientRect();
        return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
    })()`);
    await owner.insertCSS(assets.css);
    await evaluate(`document.documentElement.style.setProperty("--b3-border-radius", ${JSON.stringify(assets.radius)});
        document.getElementById("map-slot").classList.add("av__map-canvas");`);
    const state = await evaluate(`(() => {
        const exports = {};
        ${assets.visibility}
        const slot = document.getElementById("map-slot");
        const rect = slot.getBoundingClientRect();
        return {bounds: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
            visibility: exports.getAVMapVisibility(slot)};
    })()`);
    assert.deepEqual(state.bounds, before, "production child clipping preserves the map position and height");
    assert.deepEqual(state.visibility, {visible: true, viewport: {x: 0, y: 0, width: before.width, height: before.height}},
        "rounded guest corners retain the rectangular owner hit region and attribution viewport");
    // 移除合成文案，确保内侧采样不会碰到字形；不改变生产 guest 的隔离配置。
    const caption = await guest.executeJavaScript('document.getElementById("map").textContent');
    await guest.executeJavaScript('document.getElementById("map").textContent = ""');
    try {
        const pixel = async (x, y) => {
            const shot = await win.webContents.capturePage({x: Math.round(before.x + x), y: Math.round(before.y + y), width: 1, height: 1});
            const bitmap = shot.toBitmap();
            return [bitmap[2], bitmap[1], bitmap[0]].join();
        };
        for (const x of [0, before.width - 1]) {
            for (const y of [0, before.height - 1]) {
                await waitFor(async () => await pixel(x, y) === "255,255,255", "owner background is visible at every clipped guest corner");
            }
        }
        const inset = Math.ceil(parseFloat(assets.radius)) + 2;
        for (const x of [inset, before.width - inset - 1]) {
            for (const y of [inset, before.height - inset - 1]) {
                await waitFor(async () => await pixel(x, y) === "25,119,145", "the guest remains painted inside every rounded corner");
            }
        }
    } finally {
        await guest.executeJavaScript(`document.getElementById("map").textContent = ${JSON.stringify(caption)}`);
    }
};

const createHarness = async ({profile, mode = "real", automate = false} = {}) => {
    if (typeof profile !== "string" || !path.isAbsolute(profile) || !["real", "synthetic"].includes(mode)) {
        throw new Error("An isolated profile and fixed fixture mode are required");
    }
    const {app, BrowserWindow, WebContentsView, MessageChannelMain, ipcMain, session} = require("electron");
    if (hasUnsafeMapSwitches(app.commandLine)) throw new Error("Unsafe process switches are prohibited");
    if (mode === "real") checkRealAssets();
    app.setPath("userData", profile);
    await app.whenReady();
    const syntheticFiles = mode === "synthetic" ? createSyntheticFiles() : undefined;
    const instanceID = randomBytes(24).toString("hex");
    let win, owner, guest, manager, src, partition, startupTimer, closed = false, isolating = false;
    let resolveReady, rejectReady;
    const readiness = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
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
        response.setHeader("Content-Security-Policy", "default-src 'none'");
        response.setHeader("Content-Type", resource[1]);
        response.end(fs.readFileSync(path.join(__dirname, resource[0])));
    });
    const onCreated = (_event, contents) => {
        if (!contents.isDestroyed() && contents.getType() === "webview" && contents.hostWebContents === owner && !guest) guest = contents;
    };
    const onState = (event, value) => {
        if (event.sender !== owner || event.senderFrame !== owner.mainFrame || closed || value?.instanceID !== instanceID) return;
        if (value.type === "attached") { src = value.src; partition = value.partition; }
        else if (value.type === "ready") { clearTimeout(startupTimer); resolveReady(); }
        else if (value.type === "error") {
            const error = new Error("Map fixture failure");
            error.code = value.code;
            rejectReady(error);
        } else if (value.type === "markerClick") evidence.replies.push(value);
    };
    const destroy = async () => {
        if (closed) return;
        closed = true;
        const error = new Error("Map fixture closed before ready");
        error.code = "ownerClosed";
        rejectReady(error);
        clearTimeout(startupTimer);
        manager?.destroyAll();
        ipcMain.removeListener("map-webview-fixture-state", onState);
        app.removeListener("web-contents-created", onCreated);
        if (win && !win.isDestroyed()) win.destroy();
        session.defaultSession.webRequest.onHeadersReceived(null);
        server.closeAllConnections?.();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    };
    try {
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
        const origin = `http://127.0.0.1:${server.address().port}`;
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            evidence.defaultHeaderCalls++;
            if (details.url.includes("/stage/map/") || details.url.includes("/stage/build/map/")) evidence.defaultGuestHeaderCalls++;
            callback({responseHeaders: Object.fromEntries(Object.entries(details.responseHeaders || {})
                .filter(([name]) => !["content-security-policy", "x-frame-options", "access-control-allow-origin"].includes(name.toLowerCase())))});
        });
        manager = createMapHostManager({app, ipcMain, session, BrowserWindow, WebContentsView, MessageChannelMain, appDir,
            getTarget: id => owner && id === owner.id ? {mode: "local", origin} : undefined,
            isInitialized: id => owner && id === owner.id,
            readFile: syntheticFiles ? async filename => {
                const relative = path.relative(appDir, filename).split(path.sep).join("/");
                if (!syntheticFiles.has(relative)) throw new Error("Unknown synthetic fixture asset");
                return syntheticFiles.get(relative);
            } : undefined});
        app.on("web-contents-created", onCreated);
        ipcMain.on("map-webview-fixture-state", onState);
        win = new BrowserWindow({width: 820, height: 620, useContentSize: true, show: true, webPreferences: {...ownerPreferences}});
        owner = win.webContents;
        owner.on("will-attach-webview", event => { queueMicrotask(() => { if (event.defaultPrevented) evidence.rejectedAttachments++; }); });
        owner.on("did-attach-webview", () => { evidence.attached++; });
        win.on("closed", () => { void destroy().then(() => { if (!automate) app.quit(); }); });
        startupTimer = setTimeout(() => {
            const error = new Error("Owner fixture startup deadline exceeded");
            error.code = "hostBootstrapTimeout";
            rejectReady(error);
        }, 85000);
        await Promise.race([win.loadURL(origin + "/stage/build/app/"), readiness]);
        owner.send("map-webview-fixture-start", {instanceID, mode});
        await readiness;
        const harness = {win, owner, get guest() { return guest; }, session: guest.session, origin,
            get src() { return src; }, get partition() { return partition; }, instanceID, mode, evidence, destroy};
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
    await waitFor(() => inspect("window.mapFixture?.fits === 1 && window.mapFixture.visible.at(-1) === true"), "runtime receives points and visibility");
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
    await verifyMapCorners(harness);
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
    await evaluate("window.setFixtureMenu(true)");
    guest.sendInputEvent({type: "mouseDown", x: 40, y: 100, button: "left", clickCount: 1});
    guest.sendInputEvent({type: "mouseUp", x: 40, y: 100, button: "left", clickCount: 1});
    await waitFor(() => evaluate("document.getElementById('menu').hidden && window.ownerFixture.dismissals === 1"),
        "a real map press dismisses the owner menu through the production manager");
    await waitFor(() => inspect("window.mapFixture.clicks === 1"), "the same map click still reaches the map");
    assert.equal(guest.id, identity);
    assert.equal(await inspect("JSON.stringify({fits:mapFixture.fits,revisions:mapFixture.revisions,visible:mapFixture.visible})"), before);
    await evaluate("document.getElementById('scroll-area').scrollTop = 80");
    assert.equal(await evaluate("document.getElementById('scroll-area').scrollTop"), 80);
    assert.equal(guest.id, identity);
    // 拒绝第二个伪造 guest，不影响已准入的 guest 和独立会话。
    await evaluate(`(() => {
        const bad = document.createElement("webview");
        bad.setAttribute("src", ${JSON.stringify(privateURL)});
        bad.setAttribute("partition", ${JSON.stringify(harness.partition)});
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

module.exports = {createHarness, createTemporaryProfile, verifyHarness, checkRealAssets,
    createSyntheticFiles, ownerPreferences, guestPreferences, verifyIsolation, readMapCornerAssets};
