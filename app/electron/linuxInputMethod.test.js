const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {
    readLinuxInputMethodSetting, writeLinuxInputMethodSetting, readLinuxInputMethodArguments,
    getLinuxInputMethodOverride, prepareLinuxInputMethodLaunch, linuxInputMethodRelaunchEnvironment,
} = require("./linuxInputMethod");

test("compatibility mode persists across launches and can be disabled", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-ime-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const file = path.join(directory, "conf", "linux-input-method.json");
    assert.equal(readLinuxInputMethodSetting(file), false);
    for (const enabled of [true, false]) {
        writeLinuxInputMethodSetting(file, enabled);
        const launch = prepareLinuxInputMethodLaunch(["siyuan"], readLinuxInputMethodSetting(file), "linux");
        assert.equal(launch.relaunchArgs?.includes("--ozone-platform=x11") || false, enabled);
    }
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["linux-input-method.json"]);
});

test("explicit display backend overrides either saved choice", () => {
    for (const backend of ["x11", "wayland", "auto", ""]) {
        for (const enabled of [false, true]) {
            const args = ["siyuan", "--ozone-platform=" + backend];
            assert.equal(getLinuxInputMethodOverride(args), backend === "x11");
            const launch = prepareLinuxInputMethodLaunch(args, enabled, "linux");
            assert.equal(launch.relaunchArgs, null);
            assert.equal(launch.override, backend === "x11");
        }
    }
    assert.equal(getLinuxInputMethodOverride(["siyuan"]), null);
});

test("managed backend reaches native startup without locking the preference or looping", () => {
    const original = ["siyuan", "--workspace=/path with spaces", "--lang=zh-CN"];
    const first = prepareLinuxInputMethodLaunch(original, true, "linux");
    const nativeArgs = [original[0], ...first.relaunchArgs];
    assert.equal(getLinuxInputMethodOverride(nativeArgs), true);
    const second = prepareLinuxInputMethodLaunch(nativeArgs, true, "linux", first.relaunchToken);
    assert.equal(second.override, null);
    assert.equal(second.relaunchArgs, null);
    assert.deepEqual(second.args, original);
    const disabled = prepareLinuxInputMethodLaunch(nativeArgs, false, "linux", first.relaunchToken);
    assert.deepEqual(disabled.relaunchArgs, original.slice(1));
    const third = prepareLinuxInputMethodLaunch([original[0], ...disabled.relaunchArgs], false, "linux");
    assert.equal(third.override, null);
    assert.equal(third.relaunchArgs, null);
});

test("explicit backends support separate values, repeated switches and the argument terminator", () => {
    for (const backend of ["wayland", "x11", "auto", ""]) {
        const args = ["siyuan", "--ozone-platform", backend];
        const launch = prepareLinuxInputMethodLaunch(args, true, "linux");
        assert.equal(getLinuxInputMethodOverride(args), backend === "x11");
        assert.equal(launch.override, backend === "x11");
        assert.equal(launch.relaunchArgs, null);
    }
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--ozone-platform=x11", "--ozone-platform=wayland"]), false);
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--", "--ozone-platform=x11"]), null);
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--ozone-platform-hint=x11"]), null);
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--ozone-platform", "--other"]), false);
});

test("managed flags precede the terminator and preserve development and positional arguments", () => {
    const original = ["electron", "/path with spaces/main.js", "--", "--ozone-platform=wayland", "document"];
    const launch = prepareLinuxInputMethodLaunch(original, true, "linux");
    assert.ok(launch.relaunchArgs.indexOf("--ozone-platform=x11") < launch.relaunchArgs.indexOf("--"));
    const restarted = prepareLinuxInputMethodLaunch(["electron", ...launch.relaunchArgs], true, "linux", launch.relaunchToken);
    assert.deepEqual(restarted.args, original);
    assert.equal(restarted.override, null);
    assert.equal(restarted.relaunchArgs, null);
});

test("an unmatched relaunch marker cannot hide an explicit backend", () => {
    const launch = prepareLinuxInputMethodLaunch(["siyuan"], true, "linux");
    const args = ["siyuan", ...launch.relaunchArgs];
    for (const token of [undefined, "invalid", "0".repeat(48)]) {
        const result = prepareLinuxInputMethodLaunch(args, true, "linux", token);
        assert.equal(result.override, true);
        assert.equal(result.relaunchArgs, null);
    }
    const explicit = prepareLinuxInputMethodLaunch(["siyuan", "--ozone-platform=wayland", ...launch.relaunchArgs],
        true, "linux", launch.relaunchToken);
    assert.equal(explicit.override, false);
    assert.deepEqual(explicit.relaunchArgs, ["--ozone-platform=wayland"]);
});

test("main relaunches before claiming the instance or creating windows and kernels", () => {
    const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
    const start = source.indexOf("let linuxInputMethodOverride = null;");
    const end = source.indexOf("const appCrashLogPath = ", start);
    assert.ok(start > 0 && end > start);
    assert.ok(end < source.indexOf("app.requestSingleInstanceLock()"));
    assert.ok(end < source.indexOf("new BrowserWindow("));
    assert.ok(end < source.indexOf("childProcess.spawn(kernelPath"));
    const calls = [];
    const env = {};
    runInNewContext(source.slice(start, end), {
        process: {platform: "linux", argv: ["siyuan"], env},
        linuxInputMethodSettingPath: "setting.json", linuxInputMethodRelaunchEnvironment,
        readLinuxInputMethodSetting: () => true,
        readLinuxInputMethodArguments: () => ["siyuan"], prepareLinuxInputMethodLaunch,
        app: {relaunch: options => calls.push(options), exit: code => calls.push(code)},
        writeLog: message => { throw new Error(message); },
    });
    assert.equal(calls.length, 2);
    assert.ok(calls[0].args.includes("--ozone-platform=x11"));
    assert.equal(calls[1], 0);
    assert.match(env[linuxInputMethodRelaunchEnvironment], /^[a-f0-9]{48}$/);
});

test("Electron launch arguments are copied without reading a mutable process title", (t) => {
    t.mock.method(fs, "readFileSync", () => { throw new Error("Process title is not an argument source"); });
    const original = ["siyuan", "--workspace=/path with spaces", ""];
    const args = readLinuxInputMethodArguments(original);
    original.push("--ozone-platform=wayland");
    assert.deepEqual(args, ["siyuan", "--workspace=/path with spaces", ""]);
    assert.equal(getLinuxInputMethodOverride(args), null);
});

test("invalid original arguments are reported instead of guessing an override", () => {
    for (const args of [null, [], "siyuan", ["siyuan", null]]) {
        assert.throws(() => readLinuxInputMethodArguments(args), /Invalid Linux launch arguments/);
    }
});

test("compatibility mode does not alter other platforms", () => {
    for (const platform of ["win32", "darwin"]) {
        const launch = prepareLinuxInputMethodLaunch(["siyuan"], true, platform);
        assert.equal(launch.relaunchArgs, null);
    }
});

test("invalid settings and failed writes preserve existing data", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-ime-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const file = path.join(directory, "linux-input-method.json");
    for (const content of ["{", "null", "{}", '{"enabled":"false"}']) {
        fs.writeFileSync(file, content);
        assert.throws(() => readLinuxInputMethodSetting(file));
        assert.equal(fs.readFileSync(file, "utf8"), content);
    }
    writeLinuxInputMethodSetting(file, true);
    for (const value of [undefined, null, "false", 0, {}]) {
        assert.throws(() => writeLinuxInputMethodSetting(file, value), TypeError);
        assert.equal(readLinuxInputMethodSetting(file), true);
    }
    t.mock.method(fs, "renameSync", () => { throw new Error("Write failed"); });
    assert.throws(() => writeLinuxInputMethodSetting(file, false), /Write failed/);
    assert.equal(readLinuxInputMethodSetting(file), true);
    assert.deepEqual(fs.readdirSync(directory), ["linux-input-method.json"]);
});
