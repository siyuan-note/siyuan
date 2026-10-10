const assert = require("node:assert/strict");
const {test} = require("node:test");
const {spawnSync} = require("node:child_process");
const path = require("node:path");
const {pathToFileURL} = require("node:url");

const entryPath = path.join(__dirname, "fixtures/map-webview-boundary/harness.cjs");
const entry = pathToFileURL(entryPath).href;
const support = pathToFileURL(path.join(__dirname, "fixtures/map-webview-boundary/harnessSupport.cjs")).href;

// 在独立进程中复现 Electron 的动态导入，只替换 Electron 和可复用的测试辅助模块。
const runEntry = (scenario = "success", args = []) => spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import {createRequire} from "node:module";
    const require = createRequire(import.meta.url);
    const Module = require("node:module");
    const load = Module._load;
    const calls = [];
    const options = [];
    const scenario = ${JSON.stringify(scenario)};
    const args = ${JSON.stringify(args)};
    process.argv = [process.execPath, ${JSON.stringify(entryPath)}, ...args];
    const electron = {app: {
        once(name) { calls.push(name); },
        exit(code) { calls.push("exit:" + code); process.exitCode = code; },
        commandLine: {hasSwitch(name) {
            return args.some(arg => arg === "--" + name || arg.startsWith("--" + name + "="));
        }}
    }, BrowserWindow: {getAllWindows() { return [{isDestroyed: () => false,
        destroy() { calls.push("destroy"); }}, {isDestroyed: () => true,
        destroy() { throw new Error("destroyed window must be skipped"); }}]; }}};
    const helper = {
        createTemporaryProfile() {
            calls.push("profile");
            if (scenario === "profile-failure") throw new Error("private fixture error");
            return {profile: "isolated-fixture-profile", cleanup() { calls.push("cleanup"); }};
        },
        createHarness(value) {
            options.push(value);
            calls.push("create");
            if (scenario === "sync-failure") throw new Error("private fixture error");
            if (scenario === "isolation-timeout") {
                return Promise.reject(Object.assign(new Error("private fixture error"), {code: "isolationCheckTimeout"}));
            }
            return scenario === "async-failure" ? Promise.reject(new Error("private fixture error")) :
                Promise.resolve({destroy() { calls.push("destroy-harness"); }});
        },
        verifyHarness(harness) {
            if (!harness || typeof harness.destroy !== "function") throw new Error("missing harness");
            calls.push("verify");
            return scenario === "verification-failure" ? Promise.reject(new Error("private fixture error")) :
                Promise.resolve();
        }
    };
    Module._load = function(name, parent, isMain) {
        if (name === "electron") return scenario === "node-mode" ? "electron-binary" : electron;
        if (name === "./harnessSupport.cjs") return helper;
        return load.call(this, name, parent, isMain);
    };
    await import(${JSON.stringify(entry)});
    await import(${JSON.stringify(entry)});
    await new Promise(resolve => setImmediate(resolve));
    console.log("fixture-state:" + JSON.stringify({calls, options}));
`], {cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 10000});

const readState = result => {
    assert.equal(result.error, undefined);
    const state = result.stdout.match(/^fixture-state:(.+)$/m);
    assert.ok(state, result.stderr || result.stdout);
    return JSON.parse(state[1]);
};

test("manual webview dynamic-import entry starts exactly once and reports readiness", () => {
    const result = runEntry();
    const state = readState(result);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split("Map webview prototype starting...").length - 1, 1);
    assert.equal(result.stdout.split("Map webview prototype window ready.").length - 1, 1);
    assert.deepEqual(state.calls, ["profile", "will-quit", "quit", "create"]);
    assert.deepEqual(state.options, [{profile: "isolated-fixture-profile", mode: "real", automate: false}]);
    assert.equal(result.stderr, "");
});

test("manual webview mode flags select real or synthetic harness and synthetic verification", () => {
    const cases = [
        {args: ["--real"], mode: "real", automate: false},
        {args: ["--synthetic"], mode: "synthetic", automate: false},
        {args: ["--synthetic", "--verify"], mode: "synthetic", automate: true},
        {args: ["--verify", "--synthetic"], mode: "synthetic", automate: true},
    ];
    for (const {args, mode, automate} of cases) {
        const result = runEntry("success", args);
        const state = readState(result);
        assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
        assert.deepEqual(state.options, [{profile: "isolated-fixture-profile", mode, automate}]);
        if (automate) {
            assert.match(result.stdout, /Map webview prototype verification passed\./);
            assert.equal(state.calls.filter(call => call === "verify").length, 1);
            assert.ok(state.calls.includes("destroy-harness"));
            assert.ok(state.calls.includes("exit:0"));
        } else {
            assert.ok(!state.calls.includes("verify"));
        }
        assert.equal(result.stderr, "");
    }
});

test("manual webview entry rejects conflicting, unsupported and unsafe switches before creating the harness", () => {
    const cases = [
        ["--real", "--synthetic"],
        ["--synthetic", "--real"],
        ["--verify"],
        ["--real", "--verify"],
        ["--unknown-option"],
        ["--synthetic", "--no-sandbox"],
        ["--synthetic", "--disable-web-security"],
    ];
    for (const args of cases) {
        const result = runEntry("success", args);
        const state = readState(result);
        assert.equal(result.status, 1, args.join(" "));
        assert.match(result.stderr, /Map webview prototype startup failed\./);
        assert.deepEqual(state.options, []);
        assert.doesNotMatch(result.stdout, /window ready|verification passed/);
    }
});

test("manual webview startup cleans up synchronous, asynchronous and profile failures", () => {
    for (const scenario of ["sync-failure", "async-failure", "profile-failure"]) {
        const result = runEntry(scenario);
        const state = readState(result);
        assert.equal(result.status, 1, scenario);
        assert.match(result.stderr, /Map webview prototype startup failed\./, scenario);
        assert.doesNotMatch(result.stdout + result.stderr, /private fixture error|window ready/, scenario);
        assert.equal(state.calls.filter(call => call === "destroy").length, 1, scenario);
        assert.equal(state.calls.filter(call => call === "exit:1").length, 1, scenario);
        assert.equal(state.calls.filter(call => call === "cleanup").length, scenario === "profile-failure" ? 0 : 1,
            scenario);
    }
});

test("synthetic verification failures clean up without reporting success or exception details", () => {
    const result = runEntry("verification-failure", ["--synthetic", "--verify"]);
    const state = readState(result);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Map webview prototype startup failed\./);
    assert.doesNotMatch(result.stdout + result.stderr, /private fixture error|verification passed/);
    assert.ok(state.calls.includes("verify"));
    assert.ok(state.calls.includes("destroy"));
    assert.ok(state.calls.includes("cleanup"));
    assert.ok(state.calls.includes("exit:1"));
});

test("isolation timeout reports a fixed boundary stage and cleans up without exposing private details", () => {
    const result = runEntry("isolation-timeout");
    const state = readState(result);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Map webview prototype startup failed\./);
    assert.match(result.stderr, /Boundary stage: isolationCheckTimeout/);
    assert.doesNotMatch(result.stdout + result.stderr, /private fixture error|window ready/);
    assert.equal(state.calls.filter(call => call === "destroy").length, 1);
    assert.equal(state.calls.filter(call => call === "cleanup").length, 1);
    assert.equal(state.calls.filter(call => call === "exit:1").length, 1);
});

test("Node-mode webview invocation explains ELECTRON_RUN_AS_NODE without creating resources", () => {
    const result = runEntry("node-mode");
    const state = readState(result);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Map webview prototype requires Electron GUI mode; check ELECTRON_RUN_AS_NODE\./);
    assert.deepEqual(state, {calls: [], options: []});
    assert.doesNotMatch(result.stdout, /prototype starting|window ready/);
});

test("importing webview harness support does not start Electron or create a profile", () => {
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
        if (typeof imported.default.createTemporaryProfile !== "function") throw new Error("missing profile helper");
    `], {cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 10000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
});
