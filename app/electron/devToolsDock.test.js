const test = require("node:test");
const assert = require("node:assert/strict");
const {openDevTools, toggleDevTools} = require("./devToolsDock");

const createContents = ({destroyed = false, opened = false} = {}) => ({
    destroyed,
    opened,
    calls: [],
    isDestroyed() { return this.destroyed; },
    isDevToolsOpened() { return this.opened; },
    openDevTools(options) { this.opened = true; this.calls.push(["open", options]); },
    closeDevTools() { this.opened = false; this.calls.push(["close"]); },
});

test("Windows opens docked at the bottom", () => {
    const contents = createContents();
    openDevTools(contents, "win32");
    assert.deepEqual(contents.calls, [["open", {mode: "bottom"}]]);
});

test("other platforms keep the last dock position", () => {
    for (const platform of ["linux", "darwin"]) {
        const contents = createContents();
        openDevTools(contents, platform);
        assert.deepEqual(contents.calls, [["open", undefined]]);
    }
});

test("toggling closes an open developer tools panel", () => {
    const contents = createContents({opened: true});
    toggleDevTools(contents, "win32");
    assert.deepEqual(contents.calls, [["close"]]);
});

test("toggling opens a closed developer tools panel at the platform default", () => {
    const bottom = createContents();
    toggleDevTools(bottom, "win32");
    assert.deepEqual(bottom.calls, [["open", {mode: "bottom"}]]);
    const last = createContents();
    toggleDevTools(last, "darwin");
    assert.deepEqual(last.calls, [["open", undefined]]);
});

test("missing and destroyed contents are ignored", () => {
    for (const contents of [createContents({destroyed: true}), undefined, null]) {
        openDevTools(contents, "win32");
        toggleDevTools(contents, "win32");
    }
    const destroyed = createContents({destroyed: true});
    assert.deepEqual(destroyed.calls, []);
});
