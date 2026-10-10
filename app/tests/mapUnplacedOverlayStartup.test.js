const assert = require("node:assert/strict");
const {test} = require("node:test");
const {spawnSync} = require("node:child_process");
const path = require("node:path");
const {pathToFileURL} = require("node:url");

const entry = pathToFileURL(path.join(__dirname, "fixtures/map-unplaced-overlay/harness.cjs")).href;
const support = pathToFileURL(path.join(__dirname, "fixtures/map-unplaced-overlay/harnessSupport.cjs")).href;

// Match Electron default_app's dynamic import in a fresh process. Only Electron
// and the reusable harness are replaced; the actual manual entry is executed.
const runEntry = mode => spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import {createRequire} from "node:module";
    const require = createRequire(import.meta.url);
    const Module = require("node:module");
    const load = Module._load;
    const calls = [];
    const mode = ${JSON.stringify(mode)};
    const electron = {app: {
        once(name) { calls.push(name); },
        exit(code) { calls.push("exit:" + code); process.exitCode = code; }
    }, BrowserWindow: {getAllWindows() { return [{isDestroyed: () => false,
        destroy() { calls.push("destroy"); }}]; }}};
    const helper = {
        createTemporaryProfile() {
            calls.push("profile");
            if (mode === "profile-failure") throw new Error("private fixture error");
            return {profile: "isolated-fixture-profile", cleanup() { calls.push("cleanup"); }};
        },
        createHarness(options) {
            if (options.profile !== "isolated-fixture-profile") throw new Error("wrong profile");
            calls.push("create");
            if (mode === "sync-failure") throw new Error("private fixture error");
            return mode === "async-failure" ? Promise.reject(new Error("private fixture error")) : Promise.resolve();
        }
    };
    Module._load = function(name, parent, isMain) {
        if (name === "electron") return mode === "node-mode" ? "electron-binary" : electron;
        if (name === "./harnessSupport.cjs") return helper;
        return load.call(this, name, parent, isMain);
    };
    await import(${JSON.stringify(entry)});
    await import(${JSON.stringify(entry)});
    await new Promise(resolve => setImmediate(resolve));
    console.log("fixture-calls:" + JSON.stringify(calls));
`], {cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 10000});

test("manual Electron dynamic-import entry starts exactly once and reports readiness", () => {
    const result = runEntry("success");
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Map overlay prototype starting\.\.\./);
    assert.match(result.stdout, /Map overlay prototype window ready\./);
    assert.match(result.stdout, /fixture-calls:\["profile","will-quit","quit","create"\]/);
    assert.equal(result.stderr, "");
});

test("manual startup reports synchronous and asynchronous failures without exposing exception details", () => {
    for (const mode of ["sync-failure", "async-failure", "profile-failure"]) {
        const result = runEntry(mode);
        assert.equal(result.error, undefined, mode);
        assert.equal(result.status, 1, mode);
        assert.match(result.stderr, /Map overlay prototype startup failed\./, mode);
        assert.doesNotMatch(result.stdout + result.stderr, /private fixture error|window ready/, mode);
        assert.match(result.stdout, /"destroy"/, mode);
        if (mode !== "profile-failure") assert.match(result.stdout, /"cleanup"/, mode);
        assert.match(result.stdout, /"exit:1"/, mode);
    }
});

test("Node-mode invocation gives an explicit message without creating a profile or window", () => {
    const result = runEntry("node-mode");
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires Electron GUI mode; check ELECTRON_RUN_AS_NODE/);
    assert.match(result.stdout, /fixture-calls:\[\]/);
});

test("importing reusable harness support does not start Electron or create a profile", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
        import {createRequire} from "node:module";
        const require = createRequire(import.meta.url);
        const Module = require("node:module");
        const load = Module._load;
        Module._load = function(name, parent, isMain) {
            if (name === "electron") throw new Error("support must not initialize Electron");
            return load.call(this, name, parent, isMain);
        };
        require("node:fs").mkdtempSync = () => { throw new Error("support must not create a profile"); };
        const imported = await import(${JSON.stringify(support)});
        if (typeof imported.default.createHarness !== "function") throw new Error("missing reusable harness");
    `], {cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 10000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
});
