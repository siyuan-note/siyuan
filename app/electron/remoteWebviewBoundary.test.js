const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {shouldBlockRemoteFrameNavigation} = require("./remoteKernel");

const source = readFileSync(join(__dirname, "main.js"), "utf8");

test("remote windows reject guests while local plugin guests keep their original attachment capabilities", () => {
    const start = source.indexOf("const rememberWindowKernelTarget =");
    const end = source.indexOf("\nconst getWindowKernelTarget", start);
    assert.ok(start > 0 && end > start);
    assert.doesNotMatch(source, /mapHostManager|createMapHostManager|MessageChannelMain/);
    for (const mode of ["local", "remote"]) {
        const targets = new Map(), initialized = new Set([42]);
        const scope = {
            windowKernelTargets: targets, initializedWindowIds: initialized,
            blockDragWindowFocusOrder: new Map(), blockDragWindowFocusSequence: 0,
            shouldBlockRemoteFrameNavigation, writeLog() {}, cleanupBlockDragSessions() {}, cleanupBlockDragWindow() {},
        };
        const register = runInNewContext(source.slice(start, end) + "\nrememberWindowKernelTarget;", scope);
        const contents = Object.assign(new EventEmitter(), {id: 42});
        const win = Object.assign(new EventEmitter(), {webContents: contents});
        const target = {mode, origin: "https://example.invalid"};
        register(win, target);
        assert.equal(targets.get(contents.id), target);
        let blocked = 0;
        const guestPreferences = {nodeIntegration: true, preload: "/plugin/preload.js"};
        contents.emit("will-attach-webview", {preventDefault() { blocked++; }}, guestPreferences, {src: "https://plugin.invalid"});
        assert.equal(blocked, mode === "remote" ? 1 : 0);
        assert.deepEqual(guestPreferences, {nodeIntegration: true, preload: "/plugin/preload.js"});
        assert.equal(contents.listenerCount("will-attach-webview"), mode === "remote" ? 1 : 0);
        contents.emit("will-frame-navigate", {isMainFrame: false, preventDefault() { blocked++; }});
        contents.emit("will-frame-navigate", {isMainFrame: true, preventDefault() { blocked++; }});
        assert.equal(blocked, mode === "remote" ? 2 : 0);
        contents.emit("did-start-navigation", {isMainFrame: true, isSameDocument: false});
        assert.equal(initialized.has(42), false);
        contents.emit("destroyed");
        assert.equal(targets.has(42), false);
    }
});

test("main and detached windows enable local webviews and disable remote webviews", () => {
    const windowStarts = [source.indexOf("const currentWindow = new BrowserWindow({"),
        source.indexOf("const win = new BrowserWindow({", source.indexOf('ipcMain.on("siyuan-open-window"'))];
    for (const start of windowStarts) {
        assert.ok(start > 0);
        const preferencesStart = source.indexOf("webPreferences: {", start) + "webPreferences: ".length;
        const preferencesEnd = source.indexOf("\n", source.indexOf("autoplayPolicy:", preferencesStart));
        const expression = "(" + source.slice(preferencesStart, preferencesEnd) + "\n})";
        for (const mode of ["local", "remote"]) {
            const remoteSession = {};
            const preferences = runInNewContext(expression, {
                kernelTarget: {mode}, getRemoteSession: () => remoteSession,
            });
            assert.equal(preferences.webviewTag, mode === "local");
            assert.equal(preferences.webSecurity, mode === "remote");
            assert.equal(preferences.nodeIntegration, true);
            assert.equal(preferences.nodeIntegrationInSubFrames, false);
            assert.equal(preferences.nodeIntegrationInWorker, false);
            assert.equal(preferences.contextIsolation, false);
            assert.equal(preferences.session, mode === "remote" ? remoteSession : undefined);
        }
    }
});
