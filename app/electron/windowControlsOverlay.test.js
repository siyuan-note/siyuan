const assert = require("node:assert/strict");
const {test} = require("node:test");
const {getTitleBarOverlayOptions, updateTitleBarOverlay} = require("./windowControlsOverlay");

test("caption overlays are Windows-only and keep the page background visible", () => {
    assert.deepEqual(getTitleBarOverlayOptions("win32"), {color: "#00000000", symbolColor: "#808080"});
    assert.equal(getTitleBarOverlayOptions("darwin"), false);
    assert.equal(getTitleBarOverlayOptions("linux"), false);
});

test("caption updates deduplicate per window and preserve transparent theme backgrounds", () => {
    const calls = [];
    const win = {isDestroyed: () => false, setTitleBarOverlay: style => calls.push(style)};
    const data = {height: 42, symbolColor: "rgb(85, 85, 85)", color: "#ffffff"};
    assert.equal(updateTitleBarOverlay(win, data, "win32"), true);
    assert.equal(updateTitleBarOverlay(win, data, "win32"), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {color: "#00000000", symbolColor: data.symbolColor, height: 42});
    assert.equal(updateTitleBarOverlay(win, {...data, height: 63}, "win32"), true);
    assert.equal(calls.at(-1).height, 63);
    assert.equal(updateTitleBarOverlay({...win}, data, "win32"), true);
    assert.equal(calls.length, 3);
});

test("invalid caption dimensions, unavailable windows and non-Windows updates are ignored", () => {
    const win = {isDestroyed: () => false, setTitleBarOverlay: () => assert.fail("invalid update reached Electron")};
    for (const height of [NaN, Infinity, -1, 0, 0.5, 257, "42", undefined]) {
        assert.equal(updateTitleBarOverlay(win, {height, symbolColor: "#ffffff"}, "win32"), false);
    }
    for (const symbolColor of [undefined, 1, "", "x".repeat(101)]) {
        assert.equal(updateTitleBarOverlay(win, {height: 42, symbolColor}, "win32"), false);
    }
    assert.equal(updateTitleBarOverlay(win, null, "win32"), false);
    assert.equal(updateTitleBarOverlay(undefined, {}, "win32"), false);
    assert.equal(updateTitleBarOverlay({...win, isDestroyed: () => true}, {}, "win32"), false);
    assert.equal(updateTitleBarOverlay(win, {height: 42, symbolColor: "#fff"}, "linux"), false);
    assert.equal(updateTitleBarOverlay(win, {height: 42, symbolColor: "#fff"}, "darwin"), false);
});

test("failed native caption updates do not poison later retries", () => {
    let fail = true;
    let calls = 0;
    const win = {isDestroyed: () => false, setTitleBarOverlay: () => {
        calls++;
        if (fail) throw new Error("overlay is not ready");
    }};
    const style = {height: 32, symbolColor: "#555555"};
    assert.equal(updateTitleBarOverlay(win, style, "win32"), false);
    fail = false;
    assert.equal(updateTitleBarOverlay(win, style, "win32"), true);
    assert.equal(calls, 2);
});
