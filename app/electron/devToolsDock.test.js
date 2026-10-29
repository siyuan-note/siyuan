const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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

test("explicit dock modes and activation/title options are preserved on every platform", () => {
    for (const platform of ["win32", "linux", "darwin"]) {
        for (const mode of ["left", "right", "bottom", "undocked", "detach"]) {
            const contents = createContents();
            const options = Object.freeze({mode, activate: false, title: "Custom DevTools", ignored: true});
            openDevTools(contents, platform, options);
            assert.deepEqual(contents.calls, [["open", {mode, activate: false, title: "Custom DevTools"}]]);
        }
    }
});

test("activation and title options retain the platform default dock mode", () => {
    for (const platform of ["win32", "linux", "darwin"]) {
        const contents = createContents();
        openDevTools(contents, platform, {activate: true, title: ""});
        assert.deepEqual(contents.calls, [["open", {
            ...(platform === "win32" ? {mode: "bottom"} : {}), activate: true, title: "",
        }]]);
    }
});

test("invalid options are ignored without losing platform defaults", () => {
    for (const platform of ["win32", "linux", "darwin"]) {
        for (const options of [null, false, "right", {}, {mode: "invalid", activate: "false", title: 123, ignored: true}]) {
            const contents = createContents();
            openDevTools(contents, platform, options);
            assert.deepEqual(contents.calls, [["open", platform === "win32" ? {mode: "bottom"} : undefined]]);
        }
    }
});

test("openDevTools IPC forwards options through the docking helper", () => {
    const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
    const start = source.indexOf('case "openDevTools":');
    const handler = source.slice(start, source.indexOf('case "toggleDevTools":', start));
    for (const platform of ["win32", "linux", "darwin"]) {
        const contents = createContents();
        vm.runInNewContext(`switch ("openDevTools") { ${handler} }`, {
            devToolsDock: {openDevTools}, event: {sender: contents}, process: {platform},
            data: {mode: "detach", activate: false, title: "IPC DevTools"},
        });
        assert.deepEqual(contents.calls, [["open", {mode: "detach", activate: false, title: "IPC DevTools"}]]);
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
