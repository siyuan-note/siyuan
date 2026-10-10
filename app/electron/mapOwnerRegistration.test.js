const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {shouldBlockRemoteFrameNavigation} = require("./remoteKernel");

test("window target registration installs the map guard before remote document events and retains subframe denial", () => {
    const source = readFileSync(join(__dirname, "main.js"), "utf8");
    const start = source.indexOf("const rememberWindowKernelTarget =");
    const end = source.indexOf("\nconst getWindowKernelTarget", start);
    const targets = new Map(), initialized = new Set([42]), registered = [];
    const scope = {
        windowKernelTargets: targets, initializedWindowIds: initialized,
        blockDragWindowFocusOrder: new Map(), blockDragWindowFocusSequence: 0,
        mapHostManager: {registerOwner(contents) {
            assert.equal(targets.get(contents.id)?.mode, "remote");
            assert.equal(contents.eventNames().length, 0);
            registered.push(contents);
        }},
        shouldBlockRemoteFrameNavigation, writeLog() {}, cleanupBlockDragSessions() {}, cleanupBlockDragWindow() {},
    };
    const register = runInNewContext(source.slice(start, end) + "\nrememberWindowKernelTarget;", scope);
    const owner = Object.assign(new EventEmitter(), {id: 42});
    const win = Object.assign(new EventEmitter(), {webContents: owner});
    register(win, {mode: "remote", origin: "https://example.invalid"});
    assert.deepEqual(registered, [owner]);
    let blocked = 0;
    owner.emit("will-frame-navigate", {isMainFrame: false, preventDefault() { blocked++; }});
    owner.emit("will-frame-navigate", {isMainFrame: true, preventDefault() { blocked++; }});
    assert.equal(blocked, 1);
    owner.emit("did-start-navigation", {isMainFrame: true, isSameDocument: false});
    assert.equal(initialized.has(42), false);
    owner.emit("destroyed");
    assert.equal(targets.has(42), false);
    assert.match(source, /mapHostManager = createMapHostManager/);
    assert.equal((source.match(/webSecurity: kernelTarget\.mode === "remote"/g) || []).length, 2);
});
