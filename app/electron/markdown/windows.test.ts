const assert = require("node:assert/strict");
import {test} from "node:test";
const {EventEmitter} = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {createMarkdownWindows, registerMarkdownSchemes} = require("./windows");
const {MarkdownDesktopHost} = require("./host");
const {windowControls} = require("../fixtures/windowControlsStub.cjs");
const {isDevToolsShortcut, toggleDevTools} = require("../window/devToolsDock");

const fixture = async (t, options: {platform?: NodeJS.Platform; failLoad?: boolean; theme?: string; dark?: boolean} = {}) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-windows-"));
    const appDirectory = path.join(directory, "app");
    const build = path.join(appDirectory, "stage", "build", "markdown");
    await fs.mkdir(build, {recursive: true});
    await fs.writeFile(path.join(build, "index.html"), "<!doctype html><title>Markdown</title>");
    await fs.mkdir(path.join(appDirectory, "appearance", "langs"), {recursive: true});
    await fs.writeFile(path.join(appDirectory, "appearance", "langs", "en.json"), JSON.stringify({markdownEditor: "Markdown editor", untitled: "Untitled"}));
    if (options.theme) {
        const workspace = path.join(directory, "workspace");
        await fs.mkdir(path.join(workspace, "conf"), {recursive: true});
        await fs.writeFile(path.join(workspace, "conf", "conf.json"), JSON.stringify({appearance: {modeOS: options.theme === "system", mode: options.theme === "dark" ? 1 : 0}}));
        await fs.writeFile(path.join(directory, "workspace.json"), JSON.stringify([workspace]));
        await fs.mkdir(path.join(directory, "config"), {recursive: true});
        await fs.writeFile(path.join(directory, "config", "preferences.json"), JSON.stringify({version: 1, mode: "ir", sources: {theme: require("node:crypto").createHash("sha256").update(workspace).digest("hex")}}));
    }
    const windows = [];
    let id = 0;
    class BrowserWindow extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.webContents = new EventEmitter();
            this.webContents.id = ++id;
            this.webContents.mainFrame = {url: ""};
            this.webContents.send = (channel, message) => this.webContents.emit("send", channel, message);
            this.webContents.setIgnoreMenuShortcuts = value => {this.ignoreMenuShortcuts = value;};
            this.webContents.setWindowOpenHandler = callback => { this.webContents.openHandler = callback; };
            this.webContents.session = {
                setPermissionRequestHandler: callback => { this.permissionRequest = callback; },
                setPermissionCheckHandler: callback => { this.permissionCheck = callback; },
                webRequest: {onBeforeRequest: callback => { this.network = callback; }},
                protocol: {handle: (_scheme, callback) => { this.request = callback; }, unhandle() {}},
            };
            windows.push(this);
        }
        isDestroyed() { return this.destroyed || false; }
        isMinimized() { return false; }
        isMaximized() { return this.maximized || false; }
        isFullScreen() { return this.fullscreen || false; }
        minimize() { this.minimized = true; }
        maximize() { this.maximized = true; this.emit("maximize"); }
        unmaximize() { this.maximized = false; this.emit("unmaximize"); }
        setTitleBarOverlay(style) { this.overlay = {...this.overlay, ...style}; }
        show() { this.shown = true; }
        focus() { this.focused = true; }
        setMenu() {}
        setTitle(title) { this.title = title; }
        setDocumentEdited() {}
        async loadURL(url) {
            this.url = url;
            this.webContents.mainFrame.url = url;
            if (options.failLoad) throw new Error("Page unavailable");
            this.emit("ready-to-show");
        }
        close() {
            let cancelled = false;
            this.emit("close", {preventDefault: () => { cancelled = true; }});
            if (!cancelled) { this.destroyed = true; this.emit("closed"); }
        }
    }
    let receive;
    const opens = [];
    const reveals = [];
    const dialog = {showMessageBox: async () => ({response: 0}), showOpenDialog: async () => ({canceled: true}), showSaveDialog: async () => ({canceled: true})};
    const host = new MarkdownDesktopHost({directory: path.join(directory, "config", "recovery")});
    let emptied = 0;
    const manager = createMarkdownWindows({app: {getLocale: () => "en"}, BrowserWindow,
        nativeTheme: Object.assign(new EventEmitter(), {shouldUseDarkColors: options.dark ?? false}),
        ipcMain: {handle: (_channel, callback) => { receive = callback; }}, dialog,
        shell: {openExternal: async url => opens.push(url), showItemInFolder: file => reveals.push(file)}, rootDirectory: appDirectory,
        configDirectory: path.join(directory, "config"), platform: options.platform, host, onEmpty: () => emptied++,
        // 标题栏按钮区由主进程注入，Markdown 模块不直接依赖 window 目录。
        windowControls,
        devTools: {isShortcut: isDevToolsShortcut, toggle: toggleDevTools},
    });
    const call = (window, action, payload?: unknown, event = {}) => receive({sender: window.webContents,
        senderFrame: window.webContents.mainFrame, ...event}, action, payload);
    t.after(async () => {
        for (const window of windows) {
            if (!window.isDestroyed()) {
                window.destroyed = true;
                window.emit("closed");
            }
        }
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await fs.rm(directory, {recursive: true, force: true, maxRetries: 3});
    });
    return {directory, build, manager, host, windows, call, dialog, opens, reveals, emptied: () => emptied};
};

test("revealing a file uses only the current authorized target and ignores renderer paths", async t => {
    const {directory, manager, call, reveals} = await fixture(t);
    const unsaved = await manager.open();
    await call(unsaved, "reveal-file", "untrusted.md");
    assert.deepEqual(reveals, []);
    const file = path.join(directory, "reveal.md");
    await fs.writeFile(file, "# File\n");
    const window = await manager.open(file);
    await call(window, "reveal-file", "untrusted.md");
    assert.deepEqual(reveals, [await fs.realpath(file)]);
});

test("sidebar shortcuts follow their opening workspace and update without changing unrelated windows", async t => {
    const {manager, call} = await fixture(t, {platform: "win32"});
    const first = {fileTree: ["⌥3", "⇧⌘J"], outline: ["⌥4"]};
    const second = {fileTree: ["⌥5"], outline: []};
    manager.updateKeymap("workspace-a", first);
    manager.updateKeymap("workspace-b", second);
    const a = await manager.open(undefined, undefined, "workspace-a");
    const b = await manager.open(undefined, undefined, "workspace-b");
    const standalone = await manager.open();
    assert.deepEqual((await call(a, "bootstrap")).keymap, first);
    assert.deepEqual((await call(b, "bootstrap")).keymap, second);
    assert.deepEqual((await call(standalone, "bootstrap")).keymap, {fileTree: ["⌥1"], outline: ["⌥2"]});
    const events = [];
    for (const [id, window] of [["a", a], ["b", b], ["standalone", standalone]]) {
        window.webContents.on("send", (_channel, message) => {if (message.type === "keymap") events.push({id, keymap: message.keymap});});
    }
    const update = {fileTree: [], outline: ["⌥8"]};
    manager.updateKeymap("workspace-a", update);
    manager.updateKeymap("workspace-a", update);
    b.emit("focus");
    assert.deepEqual(events, [{id: "a", keymap: update}]);
    assert.deepEqual((await call(a, "bootstrap")).keymap, update);
    assert.deepEqual((await call(b, "bootstrap")).keymap, second);
    manager.updateKeymap("workspace-a", {fileTree: "invalid", outline: []});
    assert.deepEqual((await call(a, "bootstrap")).keymap, update);
});

test("documents opened or created from a Markdown window inherit its shortcut source", async t => {
    const {manager, windows, call, dialog, directory} = await fixture(t, {platform: "darwin"});
    const keymap = {fileTree: ["⌥1"], outline: []};
    manager.updateKeymap("source", keymap);
    const parent = await manager.open(undefined, undefined, "source");
    await call(parent, "new");
    assert.deepEqual((await call(windows.at(-1), "bootstrap")).keymap, keymap);
    const file = path.join(directory, "another.md");
    await fs.writeFile(file, "# another");
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [file]});
    await call(parent, "open");
    assert.deepEqual((await call(windows.at(-1), "bootstrap")).keymap, keymap);
    const standalone = await manager.open();
    assert.deepEqual((await call(standalone, "bootstrap")).keymap, {fileTree: ["⌃1"], outline: ["⌃2"]});
});

test("native menus are suppressed only for configured panel shortcuts and restored after release", async t => {
    const {manager} = await fixture(t, {platform: "darwin"});
    manager.updateKeymap("source", {fileTree: ["⌘Z"], outline: []});
    const window = await manager.open(undefined, undefined, "source");
    const key = {type: "keyDown", key: "z", code: "KeyZ", meta: true, control: false, alt: false,
        shift: false, isAutoRepeat: false, isComposing: false};
    const send = overrides => window.webContents.emit("before-input-event", {
        preventDefault: () => assert.fail("Native suppression must still deliver the sidebar event to the renderer"),
    }, {...key, ...overrides});
    send({});
    assert.equal(window.ignoreMenuShortcuts, true);
    send({isAutoRepeat: true});
    assert.equal(window.ignoreMenuShortcuts, true);
    send({type: "keyUp"});
    assert.equal(window.ignoreMenuShortcuts, false);
    send({isComposing: true});
    assert.equal(window.ignoreMenuShortcuts, false);
    send({key: "q", code: "KeyQ"});
    assert.equal(window.ignoreMenuShortcuts, false);
    manager.updateKeymap("source", {fileTree: [], outline: []});
    send({});
    assert.equal(window.ignoreMenuShortcuts, false);
});

test("Markdown scheme registration grants only required local browser capabilities", () => {
    let registered;
    registerMarkdownSchemes({registerSchemesAsPrivileged: entries => { registered = entries; }});
    assert.equal(registered.length, 1);
    assert.equal(registered[0].scheme, "siyuan-markdown");
    assert.deepEqual(registered[0].privileges, {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true});
});

test("file watching reports consecutive external saves including a return to the opening content", async t => {
    const {directory, manager, call} = await fixture(t);
    const file = path.join(directory, "watched.md");
    await fs.writeFile(file, "# Original\n");
    const window = await manager.open(file);
    const initial = await call(window, "bootstrap");
    let target = initial.target;
    let revision = 0;
    for (const content of ["# Original1\n", "# Original\n", "# Third version\n"]) {
        const changed = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {window.webContents.off("send", receive); reject(new Error("External save was not reported"));}, 2500);
            const receive = (_channel, message) => {
                if (message.type !== "external-change") return;
                clearTimeout(timer);
                window.webContents.off("send", receive);
                resolve();
            };
            window.webContents.on("send", receive);
        });
        await fs.writeFile(file, content);
        await changed;
        const result = await call(window, "host:read", {sessionId: initial.sessionId, operationId: initial.sessionId + ":read:" + ++revision,
            targetGeneration: 0, target});
        assert.equal(result.kind, "read");
        assert.equal(result.content, content);
        assert.notEqual(result.target.baseline, target.baseline);
        target = result.target;
    }
    assert.equal(await fs.readFile(file, "utf8"), "# Third version\n");
});

test("initial window and served page use the effective theme before rendering", async t => {
    for (const [theme, systemDark, expectedDark] of [["dark", false, true], ["light", true, false], ["system", true, true], ["system", false, false]] as const) {
        await t.test(`${theme}, system dark ${systemDark}`, async t => {
            const {build, manager} = await fixture(t, {theme, dark: systemDark});
            const html = '<!doctype html><link id="markdownThemeStyle" rel="stylesheet" href="./appearance/themes/daylight/theme.css">';
            await fs.writeFile(path.join(build, "index.html"), html);
            await fs.writeFile(path.join(build, "unchanged.js"), 'const theme = "./appearance/themes/daylight/theme.css";');
            const window = await manager.open();
            assert.equal(window.options.backgroundColor, expectedDark ? "#1e1e1e" : "#fff");
            const response = await window.request(new Request(window.url));
            assert.equal(response.status, 200);
            assert.equal(await response.text(), expectedDark ? html.replace("/daylight/", "/midnight/") : html);
            assert.match(response.headers.get("Content-Security-Policy"), /script-src 'self'/);
            const script = await window.request(new Request(new URL("unchanged.js", window.url)));
            assert.match(await script.text(), /daylight/);
        });
    }
});

test("invalid startup preferences show an error without allocating an editor session", async t => {
    const {directory, manager, dialog, windows, host} = await fixture(t);
    await fs.mkdir(path.join(directory, "config"), {recursive: true});
    await fs.writeFile(path.join(directory, "config", "preferences.json"), "invalid");
    let errors = 0;
    dialog.showMessageBox = async () => {errors++; return {response: 0};};
    await manager.open();
    assert.equal(errors, 1);
    assert.equal(windows.length, 0);
    assert.equal(host.sessions.size, 0);
});

test("invalid preferences during recovery keep the migrated durable draft available", async t => {
    const {directory, manager, host, call, windows} = await fixture(t);
    const window = await manager.open();
    const {sessionId} = await call(window, "bootstrap");
    await call(window, "host:putDraft", {sessionId, operationId: sessionId + ":test:1", targetGeneration: 0,
        revision: 1, content: "recoverable content", format: {bom: false, newline: "\n"}});
    window.webContents.emit("render-process-gone");
    const controller = await manager.open();
    await fs.writeFile(path.join(directory, "config", "preferences.json"), "invalid");
    await call(controller, "recover", sessionId);
    assert.equal(windows.length, 2);
    const {records} = await host.listRecoveries();
    assert.equal(records.length, 1);
    assert.notEqual(records[0].watermark.sessionId, sessionId);
    assert.equal((await host.recovery.read(records[0].watermark.sessionId)).draft.content, "recoverable content");
});

test("file launches with reordered switches reuse one window and never add an untitled editor", async t => {
    const {directory, manager, windows, call} = await fixture(t);
    const file = path.join(directory, "example.md");
    await fs.writeFile(file, "example");
    assert.equal(await manager.handleLaunch(["siyuan", file, "--markdown"], directory), true);
    assert.equal(windows.length, 1);
    assert.equal(windows[0].options.title, "example.md");
    assert.equal((await call(windows[0], "bootstrap")).content, "example");
    await manager.handleLaunch(["siyuan", "--markdown=", file], directory);
    assert.equal(windows.length, 1);
    assert.equal(windows[0].focused, true);
    await manager.handleLaunch(["siyuan", "--markdown"], directory);
    assert.equal(windows.length, 2);
    assert.equal(windows[1].options.title, "Untitled");
});

test("native titles use the authorized current filename instead of renderer state", async t => {
    const {directory, manager, call} = await fixture(t);
    const file = path.join(directory, "example.md");
    await fs.writeFile(file, "example");
    const window = await manager.open(file);
    assert.equal(window.options.title, "example.md");
    for (const title of ["SiYuan", "", "untrusted.md"]) {
        let prevented = false;
        window.emit("page-title-updated", {preventDefault: () => {prevented = true;}}, title);
        assert.equal(prevented, true, "page titles cannot replace the native filename during initialization");
    }
    const initial = await call(window, "bootstrap");
    await call(window, "state", {sessionId: initial.sessionId, status: "dirty", revision: 1,
        savedRevision: 0, target: {displayName: "untrusted.md"}});
    assert.equal(window.title, "example.md");
});

test("independent windows are sandboxed, deny navigation and reject foreign bridge frames", async t => {
    const {manager, call} = await fixture(t);
    const window = await manager.open();
    assert.equal(window.options.webPreferences.sandbox, true);
    assert.equal(window.options.webPreferences.contextIsolation, true);
    assert.equal(window.options.webPreferences.nodeIntegration, false);
    assert.equal(window.options.webPreferences.webSecurity, true);
    assert.equal(window.options.webPreferences.webviewTag, false);
    const bootstrap = await call(window, "bootstrap");
    assert.ok(bootstrap.sessionId);
    assert.equal(bootstrap.content, "");
    assert.equal(manager.owns(window.webContents), true);
    assert.deepEqual(window.webContents.openHandler({url: "https://example.com"}), {action: "deny"});
    assert.equal(window.permissionCheck(), false);
    let allowed = true;
    window.permissionRequest(null, "media", value => { allowed = value; });
    assert.equal(allowed, false);
    for (const event of ["will-navigate", "will-frame-navigate", "will-attach-webview"]) {
        let prevented = false;
        window.webContents.emit(event, {preventDefault: () => { prevented = true; }});
        assert.equal(prevented, true);
    }
    await assert.rejects(call(window, "bootstrap", null, {senderFrame: {url: window.url}}));
    await assert.rejects(call(window, "bootstrap", null, {sender: {id: window.webContents.id}}));
    await assert.rejects(call(window, "host:releaseSession", {sessionId: "foreign", targetGeneration: 0}));
    await assert.rejects(call(window, "host:unknown", {}));
});

test("frameless platform controls stay scoped to their window and preserve close protection", async t => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
        const {manager, call} = await fixture(t, {platform});
        const window = await manager.open();
        assert.equal(window.options.title, "Untitled");
        assert.equal(window.options.frame, platform === "darwin");
        assert.equal(window.options.titleBarStyle, "hidden");
        assert.deepEqual(window.options.trafficLightPosition, {x: 8, y: 8});
        assert.deepEqual(window.options.titleBarOverlay, platform === "win32" ? {color: "#00000000", symbolColor: "#808080", height: 32} : false);
        await assert.rejects(call(window, "window-control", "destroy"));
        await assert.rejects(call(window, "window-control", "minimize", {senderFrame: {url: window.url}}));
        assert.equal(window.minimized, undefined);
        await call(window, "window-control", "minimize"); assert.equal(window.minimized, true);
        const notifications = [];
        window.webContents.on("send", (_channel, command) => {
            notifications.push(command);
            if (command.type === "close") void call(window, "response", {id: command.id, accepted: false});
        });
        await call(window, "window-control", "maximize");
        assert.equal((await call(window, "window-state")).maximized, true);
        assert.equal(notifications.at(-1).windowState.maximized, true);
        await call(window, "window-control", "maximize");
        assert.equal((await call(window, "window-state")).maximized, false);
        assert.equal(await call(window, "window-overlay", {height: 60, symbolColor: "#eeeeee"}), platform === "win32");
        if (platform === "win32") assert.deepEqual(window.overlay, {color: "#00000000", height: 60, symbolColor: "#eeeeee"});
        await call(window, "window-control", "close");
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(notifications.some(command => command.type === "close"), true);
        assert.equal(window.isDestroyed(), false, "cancelled close keeps the native window");
    }
});

test("DevTools shortcuts toggle only the receiving window and ignore repeats and other keys", async t => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
        const {manager} = await fixture(t, {platform});
        const windows = [await manager.open(), await manager.open()];
        const opened = [false, false];
        const modes = [];
        for (const [index, window] of windows.entries()) {
            Object.assign(window.webContents, {
                isDestroyed: () => window.isDestroyed(),
                isDevToolsOpened: () => opened[index],
                openDevTools: options => { opened[index] = true; modes.push(options); },
                closeDevTools: () => { opened[index] = false; },
            });
        }
        const input = {type: "keyDown", key: "i", code: "KeyI", isAutoRepeat: false,
            control: platform !== "darwin", shift: platform !== "darwin", meta: platform === "darwin", alt: platform === "darwin"};
        const send = (window, value = input) => {
            let prevented = false;
            window.webContents.emit("before-input-event", {preventDefault: () => { prevented = true; }}, value);
            return prevented;
        };
        for (const value of [{...input, type: "keyUp"}, {...input, isAutoRepeat: true},
            {...input, key: "j", code: "KeyJ"}, {...input, control: false, shift: false, meta: false, alt: false}]) {
            assert.equal(send(windows[0], value), false);
            assert.deepEqual(opened, [false, false]);
        }
        assert.equal(send(windows[0]), true);
        assert.deepEqual(opened, [true, false]);
        assert.deepEqual(modes, [platform === "win32" ? {mode: "bottom"} : undefined]);
        assert.equal(send(windows[0]), true);
        assert.deepEqual(opened, [false, false]);
        assert.equal(send(windows[1], {...input, key: "非拉丁键", code: "KeyI"}), true);
        assert.deepEqual(opened, [false, true]);
    }
});

test("static protocol confines local resources and network access permits only HTTP image GET requests", async t => {
    const {directory, manager} = await fixture(t);
    const window = await manager.open();
    const origin = new URL(window.url);
    const base = `${origin.protocol}//${origin.host}`;
    const response = await window.request({url: window.url, method: "GET"});
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Markdown/);
    assert.match(response.headers.get("content-security-policy"), /frame-src 'none'/);
    assert.equal(response.headers.get("content-security-policy").includes("unsafe-eval"), false);
    assert.match(response.headers.get("content-security-policy"), /img-src [^;]*http: https:/);
    await fs.writeFile(path.join(directory, "private.txt"), "secret");
    for (const url of [base + "/..%2f..%2fprivate.txt", window.url.replace(origin.hostname, "foreign"),
        "file:///private.txt", "https://example.com/file", base + "/resource/missing"]) {
        const result = await window.request({url, method: "GET"});
        assert.notEqual(result.status, 200);
    }
    for (const url of ["https://example.com/pixel", "http://localhost:6806/api/system/getConf", "file:///private.txt"]) {
        let cancelled;
        window.network({url}, result => { cancelled = result.cancel; });
        assert.equal(cancelled, true);
    }
    let cancelled;
    window.network({url: window.url}, result => { cancelled = result.cancel; });
    assert.equal(cancelled, false);
    for (const url of ["https://example.com/badge.svg?label=release", "http://example.com/photo.png"]) {
        window.network({url, resourceType: "image", method: "GET"}, result => {cancelled = result.cancel;});
        assert.equal(cancelled, false);
        for (const resourceType of ["script", "xhr", "subFrame", "media", "mainFrame"]) {
            window.network({url, resourceType, method: "GET"}, result => {cancelled = result.cancel;});
            assert.equal(cancelled, true, resourceType);
        }
    }
    for (const url of ["file:///private.png", "https://user:password@example.com/a.png", "https://siyuan-markdown.local/resource/foreign/token"]) {
        window.network({url, resourceType: "image", method: "GET"}, result => {cancelled = result.cancel;});
        assert.equal(cancelled, true);
    }
    window.network({url: "https://example.com/a.png", resourceType: "image", method: "POST"}, result => {cancelled = result.cancel;});
    assert.equal(cancelled, true);
});

test("Markdown Lute URL serves only the single installed shared runtime with the page CSP", async t => {
    const {directory, build, manager} = await fixture(t);
    const shared = path.join(directory, "app/stage/protyle/js/lute/lute.min.js");
    await fs.mkdir(path.dirname(shared), {recursive: true});
    await fs.writeFile(shared, "globalThis.Lute = {shared: true};");
    const window = await manager.open();
    const origin = window.url.slice(0, window.url.lastIndexOf("/"));
    const url = origin + "/vditor/dist/js/lute/lute.min.js";
    const response = await window.request({url, method: "GET"});
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "globalThis.Lute = {shared: true};");
    assert.match(response.headers.get("content-type"), /javascript/);
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
    await assert.rejects(fs.stat(path.join(build, "vditor/dist/js/lute/lute.min.js")), {code: "ENOENT"});
    for (const target of [origin + "/stage/protyle/js/lute/lute.min.js", origin + "/vditor/dist/js/lute/other.js",
        origin + "/vditor/dist/js/lute/%2e%2e%2fprivate.js", url.replace(new URL(window.url).hostname, "foreign")]) {
        assert.notEqual((await window.request({url: target, method: "GET"})).status, 200);
    }
    assert.equal((await window.request({url, method: "POST"})).status, 403);
    await fs.unlink(shared);
    assert.equal((await window.request({url, method: "GET"})).status, 404, "no fallback copy or network request");
    if (process.platform !== "win32") {
        const outside = path.join(directory, "private.js");
        await fs.writeFile(outside, "private");
        await fs.symlink(outside, shared);
        assert.equal((await window.request({url, method: "GET"})).status, 403, "installed alias cannot escape through a symlink");
    }
});

test("relative images require a separate directory grant and remain scoped to the session", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "![image](image.png)");
    await fs.writeFile(path.join(directory, "image.png"), Buffer.from([137, 80, 78, 71]));
    const window = await manager.open(file);
    assert.equal(await call(window, "resource", "image.png"), undefined);
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [directory]});
    assert.equal(await call(window, "authorize-resources"), true);
    const resource = await call(window, "resource", "image.png");
    assert.match(resource, /\/resource\/[a-f\d-]+$/);
    assert.equal(resource.includes(directory), false);
    assert.equal(await call(window, "resource", "image.png"), resource);
    assert.equal((await window.request({url: resource, method: "GET"})).status, 200);
    assert.equal(await call(window, "resource", "https://example.com/image.png"), undefined);
    const other = await manager.open();
    assert.equal((await other.request({url: resource, method: "GET"})).status, 403);
});

test("image insertion saves to the chosen new location and grants only that resource", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    const document = path.join(directory, "note.md");
    const source = path.join(directory, "source.png");
    const destination = path.join(directory, "new image.png");
    await fs.writeFile(document, "text");
    await fs.writeFile(source, "image bytes");
    const window = await manager.open(document);
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [source]});
    dialog.showSaveDialog = async () => ({canceled: false, filePath: destination});
    assert.deepEqual(await call(window, "insert-image"), {kind: "inserted", reference: "new%20image.png"});
    assert.equal(await fs.readFile(destination, "utf8"), "image bytes");
    assert.equal(await fs.readFile(document, "utf8"), "text");
    assert.ok(await call(window, "resource", "new%20image.png"));
    assert.equal(await call(window, "resource", "source.png"), undefined);
    await fs.writeFile(destination, "existing resource");
    assert.deepEqual(await call(window, "insert-image"), {kind: "blocked"});
    assert.equal(await fs.readFile(destination, "utf8"), "existing resource");
    dialog.showSaveDialog = async () => ({canceled: true});
    assert.deepEqual(await call(window, "insert-image"), {kind: "cancelled"});
});

test("duplicate opens focus their owner and picker reservations are cancelled explicitly", async t => {
    const {directory, manager, windows, call, dialog} = await fixture(t);
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "existing");
    const window = await manager.open(file);
    await manager.open(file);
    assert.equal(windows.length, 1);
    assert.equal(window.focused, true);
    const destination = path.join(directory, "new.md");
    dialog.showSaveDialog = async () => ({canceled: false, filePath: destination});
    const first = await call(window, "save-as", {bom: false, newline: "\n"});
    assert.equal(first.kind, "selected");
    await call(window, "cancel-save-as", first.target.handle);
    const next = await call(window, "save-as", {bom: false, newline: "\n"});
    assert.equal(next.kind, "selected");
    await call(window, "cancel-save-as", next.target.handle);
    await assert.rejects(fs.stat(destination), {code: "ENOENT"});
});

test("quit cancellation thaws windows and close requires completed host release", async t => {
    const {manager, call, emptied} = await fixture(t);
    const window = await manager.open();
    const bootstrap = await call(window, "bootstrap");
    const commands = [];
    window.webContents.on("send", (_channel, command) => {
        commands.push(command.type);
        if (command.type === "prepare-quit") call(window, "response", {id: command.id, accepted: false});
        if (command.type === "close") call(window, "response", {id: command.id, accepted: true});
    });
    assert.equal(await manager.prepareQuit(), false);
    assert.ok(commands.includes("cancel-quit"));
    assert.equal(await manager.closeAll(), false);
    assert.equal(window.isDestroyed(), false);
    window.webContents.removeAllListeners("send");
    window.webContents.on("send", async (_channel, command) => {
        if (command.type !== "close") return;
        await call(window, "host:releaseSession", {sessionId: bootstrap.sessionId, targetGeneration: 0});
        await call(window, "response", {id: command.id, accepted: true});
    });
    assert.equal(await manager.closeAll(), true);
    assert.equal(manager.hasWindows(), false);
    assert.equal(emptied(), 1);
});

test("explicit links permit only web and email schemes", async t => {
    const {manager, call, opens} = await fixture(t);
    const window = await manager.open();
    await call(window, "link", "https://example.com/path");
    await call(window, "link", "mailto:test@example.com");
    for (const url of ["file:///secret", "javascript:alert(1)", "data:text/html,hello", "siyuan://blocks/test", "https://a:b@example.com"]) {
        await assert.rejects(call(window, "link", url));
    }
    assert.deepEqual(opens, ["https://example.com/path", "mailto:test@example.com"]);
});

test("quit during an authorized file read drains the open and never creates a late window", async t => {
    const {directory, manager, host, windows} = await fixture(t);
    const file = path.join(directory, "note.md");
    await fs.writeFile(file, "original");
    const authorize = host.authorizeOpen.bind(host);
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    host.authorizeOpen = async (...args) => {
        const opened = await authorize(...args);
        started();
        await wait;
        return opened;
    };
    const opening = manager.open(file);
    await ready;
    assert.equal(manager.hasWindows(), false);
    assert.equal(manager.hasPendingWork(), true);
    const closing = manager.closeAll();
    release();
    await opening;
    assert.equal(await closing, true);
    assert.equal(windows.length, 0);
    assert.equal(host.sessions.size, 0);
    assert.equal(await fs.readFile(file, "utf8"), "original");
});

test("a crashed renderer can close through native recovery protection without a dead bridge", async t => {
    const {manager, host, call, dialog} = await fixture(t);
    const window = await manager.open();
    const {sessionId} = await call(window, "bootstrap");
    await call(window, "host:putDraft", {sessionId, operationId: sessionId + ":test:1", targetGeneration: 0,
        revision: 1, content: "confirmed draft", format: {bom: false, newline: "\n"}});
    window.webContents.emit("render-process-gone");
    assert.equal(host.sessions.get(sessionId).crashed, true);
    dialog.showMessageBox = async () => ({response: 1});
    assert.equal(await manager.closeAll(), false);
    assert.equal(window.isDestroyed(), false);
    dialog.showMessageBox = async () => ({response: 0});
    assert.equal(await manager.prepareQuit(), true);
    dialog.showMessageBox = async () => assert.fail("prepared close must not prompt a second time");
    assert.equal(await manager.closeAll(), true);
    assert.equal(window.isDestroyed(), true);
    assert.equal((await host.recovery.read(sessionId)).draft.content, "confirmed draft");
});

test("a failed page load remains visible and closes through native protection instead of waiting on a dead bridge", async t => {
    const {manager, host, dialog, emptied} = await fixture(t, {failLoad: true});
    const window = await manager.open();
    assert.equal(window.shown, true);
    assert.equal([...host.sessions.values()][0].crashed, true);
    dialog.showMessageBox = async () => ({response: 0});
    assert.equal(await manager.closeAll(), true);
    assert.equal(host.sessions.size, 0);
    assert.equal(manager.hasPendingWork(), false);
    assert.equal(emptied(), 1);
});

const treeFile = async (call, window, name) => {
    const state = await call(window, "tree-state");
    assert.equal(state.kind, "ready");
    const location = {rootId: state.rootId, generation: state.generation, nodeId: state.rootId};
    const result = await call(window, "tree-list", location);
    assert.equal(result.kind, "listed");
    const file = result.entries.find(entry => entry.name === name);
    assert.ok(file, name);
    return {...location, nodeId: file.id};
};

test("tree switching keeps the native container and root while preserving the old draft and rejecting old permissions", async t => {
    const {directory, manager, host, windows, call, dialog} = await fixture(t);
    const first = path.join(directory, "first.md");
    const second = path.join(directory, "second.md");
    await fs.writeFile(first, "first content");
    await fs.writeFile(second, "second content");
    await fs.writeFile(path.join(directory, "image.png"), "image");
    const window = await manager.open(first);
    const originalURL = window.url;
    const initial = await call(window, "bootstrap");
    const originalRoot = await call(window, "tree-state");
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [directory]});
    await call(window, "authorize-resources");
    const oldResource = await call(window, "resource", "image.png");
    const selected = await call(window, "tree-prepare-open", await treeFile(call, window, "second.md"));
    assert.equal(selected.kind, "ready");
    assert.notEqual(selected.sessionId, initial.sessionId);
    assert.equal(selected.content, undefined);
    assert.equal(host.sessions.size, 2);
    assert.equal((await call(window, "bootstrap")).sessionId, initial.sessionId);
    await assert.rejects(call(window, "tree-commit-open", selected.ticket));
    await call(window, "host:putDraft", {sessionId: initial.sessionId, operationId: initial.sessionId + ":test:1",
        targetGeneration: 0, revision: 1, content: "unsaved first", format: initial.target.format, target: initial.target});
    await call(window, "host:releaseSession", {sessionId: initial.sessionId, targetGeneration: 0});
    const next = await call(window, "tree-commit-open", selected.ticket);
    assert.equal(next.sessionId, selected.sessionId);
    assert.equal(next.content, "second content");
    assert.deepEqual(await call(window, "tree-commit-open", selected.ticket), next);
    assert.equal((await call(window, "bootstrap")).sessionId, selected.sessionId);
    assert.equal(windows.length, 1);
    assert.equal(window.url, originalURL);
    assert.equal((await call(window, "tree-state")).rootId, originalRoot.rootId);
    assert.equal((await host.recovery.read(initial.sessionId)).draft.content, "unsaved first");
    assert.equal((await window.request({url: oldResource, method: "GET"})).status, 404);
    assert.equal(await call(window, "resource", "image.png"), undefined);
    await assert.rejects(call(window, "host:read", {sessionId: initial.sessionId, targetGeneration: 0,
        operationId: initial.sessionId + ":test:2", target: initial.target}));
    await call(window, "state", {sessionId: next.sessionId, status: "saved", revision: 0, savedRevision: 0});
    const title = window.title;
    assert.equal(title, "second.md");
    await call(window, "state", {sessionId: initial.sessionId, status: "dirty", revision: 99, savedRevision: 0});
    assert.equal(window.title, title);
    await manager.open(second);
    assert.equal(windows.length, 1);
    assert.equal(window.focused, true);
    window.webContents.on("send", async (_channel, command) => {
        if (command.type !== "close") return;
        await call(window, "host:releaseSession", {sessionId: next.sessionId, targetGeneration: 0});
        await call(window, "response", {id: command.id, accepted: true});
    });
    assert.equal(await manager.closeAll(), true);
    assert.equal(host.sessions.size, 0);
});

test("tree current, occupied, invalid and cancelled selections leave the current editor and registry intact", async t => {
    const {directory, manager, host, windows, call} = await fixture(t);
    for (const [name, content] of [["first.md", "first"], ["second.md", "second"], ["large.md", "x".repeat(8 * 1024 * 1024 + 1)],
        ["invalid.md", Buffer.from([255])], ["free.md", "free"]]) await fs.writeFile(path.join(directory, name), content);
    const window = await manager.open(path.join(directory, "first.md"));
    const second = await manager.open(path.join(directory, "second.md"));
    const initial = await call(window, "bootstrap");
    assert.deepEqual(await call(window, "tree-prepare-open", await treeFile(call, window, "first.md")), {kind: "current"});
    assert.deepEqual(await call(window, "tree-prepare-open", await treeFile(call, window, "second.md")), {kind: "occupied"});
    assert.equal(second.focused, true);
    assert.equal((await call(window, "tree-prepare-open", await treeFile(call, window, "large.md"))).error.code, "size");
    assert.equal((await call(window, "tree-prepare-open", await treeFile(call, window, "invalid.md"))).error.code, "encoding");
    const candidate = await call(window, "tree-prepare-open", await treeFile(call, window, "free.md"));
    assert.equal(candidate.kind, "ready");
    await call(window, "tree-cancel-open", candidate.ticket);
    await call(window, "tree-cancel-open", candidate.ticket);
    await assert.rejects(call(window, "tree-commit-open", candidate.ticket));
    assert.equal(host.sessions.size, 2);
    assert.equal(host.disk.registry.entries.size, 2);
    assert.equal(windows.length, 2);
    assert.equal((await call(window, "bootstrap")).sessionId, initial.sessionId);
});

test("choosing a root changes only the file tree and grants no image access", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    const file = path.join(directory, "first.md");
    const other = path.join(directory, "other");
    await fs.writeFile(file, "first");
    await fs.mkdir(other);
    await fs.writeFile(path.join(other, "image.png"), "image");
    const window = await manager.open(file);
    const initial = await call(window, "bootstrap");
    const previous = await call(window, "tree-state");
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [other]});
    const result = await call(window, "tree-choose-root");
    assert.equal(result.kind, "ready");
    assert.equal(result.rootName, "other");
    assert.equal(result.currentNodeId, undefined);
    assert.equal(result.generation, previous.generation + 1);
    assert.equal((await call(window, "tree-state")).rootId, result.rootId);
    assert.equal((await call(window, "bootstrap")).sessionId, initial.sessionId);
    assert.equal(await call(window, "resource", "other/image.png"), undefined);
    dialog.showOpenDialog = async () => ({canceled: true});
    assert.deepEqual(await call(window, "tree-choose-root"), {kind: "cancelled"});
    assert.equal((await call(window, "tree-state")).rootId, result.rootId);
});

test("quit waits for candidate authorization and closes without a late session or native window", async t => {
    const {directory, manager, host, windows, call} = await fixture(t);
    await fs.writeFile(path.join(directory, "first.md"), "first");
    await fs.writeFile(path.join(directory, "second.md"), "second");
    const window = await manager.open(path.join(directory, "first.md"));
    const initial = await call(window, "bootstrap");
    const location = await treeFile(call, window, "second.md");
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    const authorize = host.authorizeOpen.bind(host);
    host.authorizeOpen = async (...args) => {
        const result = await authorize(...args);
        started();
        await waiting;
        return result;
    };
    window.webContents.on("send", async (_channel, command) => {
        if (command.type !== "close") return;
        await call(window, "host:releaseSession", {sessionId: initial.sessionId, targetGeneration: 0});
        await call(window, "response", {id: command.id, accepted: true});
    });
    const preparing = call(window, "tree-prepare-open", location);
    await ready;
    const closing = manager.closeAll();
    release();
    assert.equal((await preparing).kind, "blocked");
    assert.equal(await closing, true);
    assert.equal(host.sessions.size, 0);
    assert.equal(host.disk.registry.entries.size, 0);
    assert.equal(windows.length, 1);
    assert.equal(window.isDestroyed(), true);
});

test("closing a prepared but uncommitted switch releases its candidate", async t => {
    const {directory, manager, host, call} = await fixture(t);
    await fs.writeFile(path.join(directory, "first.md"), "first");
    await fs.writeFile(path.join(directory, "second.md"), "second");
    const window = await manager.open(path.join(directory, "first.md"));
    const initial = await call(window, "bootstrap");
    const candidate = await call(window, "tree-prepare-open", await treeFile(call, window, "second.md"));
    assert.equal(candidate.kind, "ready");
    window.webContents.on("send", async (_channel, command) => {
        if (command.type !== "close") return;
        await call(window, "host:releaseSession", {sessionId: initial.sessionId, targetGeneration: 0});
        await call(window, "response", {id: command.id, accepted: true});
    });
    assert.equal(await manager.closeAll(), true);
    assert.equal(host.sessions.size, 0);
    assert.equal(host.disk.registry.entries.size, 0);
});

const saveAsThroughBridge = async ({call, window, dialog, sessionId, target, generation, sequence, file}) => {
    dialog.showSaveDialog = async () => ({canceled: false, filePath: file});
    const selected = await call(window, "save-as", target.format);
    assert.equal(selected.kind, "selected");
    const operationId = sessionId + ":test:" + sequence;
    const reserved = await call(window, "host:reserveSaveAs", {sessionId, operationId, target: selected.target, format: target.format});
    assert.equal(reserved.kind, "reserved");
    const operation = {sessionId, operationId, targetGeneration: generation + 1, revision: sequence,
        content: "saved copy", target: reserved.reservation.target, expectedBaseline: selected.target.baseline,
        reservationId: reserved.reservation.id};
    await call(window, "host:prepareSaveAs", {operation, previousTarget: target});
    const receipt = await call(window, "host:write", operation);
    assert.equal(receipt.kind, "committed");
    const result = await call(window, "host:commitSaveAs", {operation, previousTarget: target, receipt, nextTargetGeneration: generation + 1});
    assert.equal(result.kind, "committed");
    return result.target;
};

test("Save As retains an enclosing root and follows the parent when saving outside it", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    const notes = path.join(directory, "notes");
    const other = path.join(directory, "other");
    await fs.mkdir(notes);
    await fs.mkdir(other);
    await fs.writeFile(path.join(notes, "first.md"), "first");
    const window = await manager.open(path.join(notes, "first.md"));
    const initial = await call(window, "bootstrap");
    const root = await call(window, "tree-state");
    const next = await saveAsThroughBridge({call, window, dialog, sessionId: initial.sessionId, target: initial.target,
        generation: 0, sequence: 1, file: path.join(notes, "copy.md")});
    assert.equal((await call(window, "tree-state")).rootId, root.rootId);
    await saveAsThroughBridge({call, window, dialog, sessionId: initial.sessionId, target: next,
        generation: 1, sequence: 2, file: path.join(other, "copy.md")});
    await call(window, "state", {sessionId: initial.sessionId, status: "saved", revision: 2, savedRevision: 2});
    assert.equal(window.title, "copy.md");
    const after = await call(window, "tree-state");
    assert.equal(after.rootName, "other");
    assert.notEqual(after.rootId, root.rootId);
    assert.equal(after.generation, root.generation + 1);
});

test("Save As during switch protection retains the selected tree until that switch is cancelled", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    const notes = path.join(directory, "notes");
    const other = path.join(directory, "other");
    await fs.mkdir(notes);
    await fs.mkdir(other);
    await fs.writeFile(path.join(notes, "first.md"), "first");
    await fs.writeFile(path.join(notes, "second.md"), "second");
    const window = await manager.open(path.join(notes, "first.md"));
    const initial = await call(window, "bootstrap");
    const root = await call(window, "tree-state");
    const candidate = await call(window, "tree-prepare-open", await treeFile(call, window, "second.md"));
    assert.equal(candidate.kind, "ready");
    await saveAsThroughBridge({call, window, dialog, sessionId: initial.sessionId, target: initial.target,
        generation: 0, sequence: 1, file: path.join(other, "copy.md")});
    assert.equal((await call(window, "tree-state")).rootId, root.rootId);
    await call(window, "tree-cancel-open", candidate.ticket);
    assert.equal((await call(window, "tree-state")).rootName, "other");
});

test("a resource picker completed after switching cannot grant access to the new document", async t => {
    const {directory, manager, call, dialog} = await fixture(t);
    await fs.writeFile(path.join(directory, "first.md"), "first");
    await fs.writeFile(path.join(directory, "second.md"), "second");
    await fs.writeFile(path.join(directory, "image.png"), "image");
    const window = await manager.open(path.join(directory, "first.md"));
    const initial = await call(window, "bootstrap");
    let finishPicker;
    dialog.showOpenDialog = () => new Promise(resolve => { finishPicker = resolve; });
    const resourceGrant = call(window, "authorize-resources");
    const candidate = await call(window, "tree-prepare-open", await treeFile(call, window, "second.md"));
    await call(window, "host:releaseSession", {sessionId: initial.sessionId, targetGeneration: 0});
    await call(window, "tree-commit-open", candidate.ticket);
    finishPicker({canceled: false, filePaths: [directory]});
    assert.equal(await resourceGrant, false);
    assert.equal(await call(window, "resource", "image.png"), undefined);
});

test("a candidate being cancelled cannot be committed while its release is still pending", async t => {
    const {directory, manager, host, call} = await fixture(t);
    await fs.writeFile(path.join(directory, "first.md"), "first");
    await fs.writeFile(path.join(directory, "second.md"), "second");
    const window = await manager.open(path.join(directory, "first.md"));
    const initial = await call(window, "bootstrap");
    const candidate = await call(window, "tree-prepare-open", await treeFile(call, window, "second.md"));
    await call(window, "host:releaseSession", {sessionId: initial.sessionId, targetGeneration: 0});
    const releaseSession = host.releaseSession.bind(host);
    let finish;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const waiting = new Promise(resolve => { finish = resolve; });
    host.releaseSession = async request => {
        if (request.sessionId === candidate.sessionId) { started(); await waiting; }
        return releaseSession(request);
    };
    const cancelling = call(window, "tree-cancel-open", candidate.ticket);
    await ready;
    await assert.rejects(call(window, "tree-commit-open", candidate.ticket));
    finish();
    await cancelling;
    assert.equal(host.sessions.size, 0);
});

test("native destruction drains a candidate read, retains the durable draft and releases settled sessions", async t => {
    const {directory, manager, host, call} = await fixture(t);
    await fs.writeFile(path.join(directory, "first.md"), "first");
    await fs.writeFile(path.join(directory, "second.md"), "second");
    const window = await manager.open(path.join(directory, "first.md"));
    const initial = await call(window, "bootstrap");
    await call(window, "host:putDraft", {sessionId: initial.sessionId, operationId: initial.sessionId + ":test:1",
        targetGeneration: 0, revision: 1, content: "durable content", format: initial.target.format, target: initial.target});
    const location = await treeFile(call, window, "second.md");
    let finish;
    let started;
    let cleaned;
    const ready = new Promise(resolve => { started = resolve; });
    const waiting = new Promise(resolve => { finish = resolve; });
    const cleanup = new Promise(resolve => { cleaned = resolve; });
    const authorize = host.authorizeOpen.bind(host);
    host.authorizeOpen = async (...args) => {
        const result = await authorize(...args);
        started();
        await waiting;
        return result;
    };
    const releaseSession = host.releaseSession.bind(host);
    host.releaseSession = async request => {
        await releaseSession(request);
        if (request.sessionId === initial.sessionId) cleaned();
    };
    const preparing = call(window, "tree-prepare-open", location);
    await ready;
    window.destroyed = true;
    window.emit("closed");
    finish();
    assert.equal((await preparing).kind, "blocked");
    await cleanup;
    assert.equal(host.sessions.size, 0);
    assert.equal(host.disk.registry.entries.size, 0);
    assert.equal((await host.recovery.read(initial.sessionId)).draft.content, "durable content");
});

test("workspace asset opens preserve expected identity through window creation and reject mismatches", async t => {
    const {directory, manager, host, windows} = await fixture(t);
    const file = path.join(directory, "asset.md");
    await fs.writeFile(file, "# Asset");
    const expected = await host.disk.describe(file);
    await manager.open(file, {...expected, identity: "changed"});
    assert.equal(windows.length, 0);
    assert.equal(host.sessions.size, 0);
    assert.equal(host.disk.registry.entries.size, 0);
    await manager.open(file, expected);
    assert.equal(windows.length, 1);
    await manager.open(file, {...expected, path: path.join(directory, "other.md")});
    assert.equal(windows.length, 1);
    assert.equal(host.sessions.size, 1);
});

test("workspace appearance capability persists independent source selections without changing edit mode", async t => {
    const {directory, manager, call} = await fixture(t, {theme: "dark"});
    const window = await manager.open();
    const initial = await call(window, "bootstrap");
    assert.equal(initial.appearance.theme, "dark");
    const id = initial.appearance.workspaces[0].id;
    const result = await call(window, "appearance", {sources: {fonts: id}});
    assert.equal(result.sources.fonts, id);
    await assert.rejects(call(window, "appearance", {sources: {theme: "../secret"}}));
    await assert.rejects(call(window, "preferences", {theme: "light"}));
    await call(window, "preferences", {mode: "sv"});
    const persisted = JSON.parse(await fs.readFile(path.join(directory, "config", "preferences.json"), "utf8"));
    assert.equal(persisted.mode, "sv");
    assert.deepEqual(persisted.sources, {theme: id, fonts: id});
    assert.equal(persisted.theme, undefined);
});

test("independent appearance can be configured with no registered workspace", async t => {
    const {manager, call} = await fixture(t);
    const window = await manager.open();
    const initial = await call(window, "bootstrap");
    assert.equal(initial.appearance.sources.theme, "independent");
    const result = await call(window, "appearance", {sources: {theme: "independent", fontSize: "independent"}, independent: {theme: "dark", fontSize: 27}});
    assert.equal(result.theme, "dark");
    assert.equal(result.fontSize, 27);
    const next = await manager.open();
    const restored = await call(next, "bootstrap");
    assert.equal(restored.appearance.theme, "dark");
    assert.equal(restored.appearance.fontSize, 27);
    await assert.rejects(call(window, "appearance", {independent: {fontSize: 1000}}));
    assert.equal((await call(window, "bootstrap")).appearance.fontSize, 27);
});

test("missing workspace sources switch to independent persistently without altering other settings", async t => {
    const {directory, manager, call} = await fixture(t, {theme: "dark"});
    const workspace = path.join(directory, "workspace");
    const window = await manager.open();
    const initial = await call(window, "bootstrap");
    assert.equal(initial.appearance.theme, "dark");
    await call(window, "appearance", {independent: {theme: "light", fontSize: 25}});
    await fs.rename(workspace, workspace + "-offline");
    const fallback = await call(window, "appearance");
    assert.equal(fallback.sources.theme, "independent");
    assert.equal(fallback.theme, "light");
    assert.equal(fallback.fontSize, 25);
    await fs.rename(workspace + "-offline", workspace);
    const next = await manager.open();
    assert.equal((await call(next, "bootstrap")).appearance.sources.theme, "independent");
    assert.equal((await call(next, "bootstrap")).appearance.theme, "light");
});
