const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {
    readLinuxInputMethodSetting, writeLinuxInputMethodSetting, readLinuxInputMethodArguments,
    getLinuxInputMethodOverride, configureLinuxInputMethod,
} = require("./linuxInputMethod");

const commandLine = (platform) => {
    const switches = new Map(platform === undefined ? [] : [["ozone-platform", platform]]);
    return {
        hasSwitch: (name) => switches.has(name),
        getSwitchValue: (name) => switches.get(name),
        appendSwitch: (name, value) => switches.set(name, value),
    };
};

test("compatibility mode persists across launches and can be disabled", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-ime-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const file = path.join(directory, "conf", "linux-input-method.json");
    assert.equal(readLinuxInputMethodSetting(file), false);
    for (const enabled of [true, false]) {
        writeLinuxInputMethodSetting(file, enabled);
        const launch = commandLine();
        configureLinuxInputMethod(launch, readLinuxInputMethodSetting(file), "linux", ["siyuan"]);
        assert.equal(launch.getSwitchValue("ozone-platform"), enabled ? "x11" : undefined);
    }
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["linux-input-method.json"]);
});

test("explicit display backend overrides either saved choice", () => {
    for (const backend of ["x11", "wayland", "auto", ""]) {
        for (const enabled of [false, true]) {
            const launch = commandLine(backend);
            const args = ["siyuan", "--ozone-platform=" + backend];
            assert.equal(getLinuxInputMethodOverride(args), backend === "x11");
            configureLinuxInputMethod(launch, enabled, "linux", args);
            assert.equal(launch.getSwitchValue("ozone-platform"), backend);
        }
    }
    assert.equal(getLinuxInputMethodOverride(["siyuan"]), null);
});

test("automatically selected backends do not lock the preference across launches", () => {
    const args = ["siyuan"];
    for (const backend of ["wayland", "x11"]) {
        for (const enabled of [false, true]) {
            const launch = commandLine(backend);
            configureLinuxInputMethod(launch, enabled, "linux", args);
            assert.equal(launch.getSwitchValue("ozone-platform"), enabled ? "x11" : backend);
            assert.equal(getLinuxInputMethodOverride(args), null);
        }
    }
});

test("explicit backends support separate values, repeated switches and the argument terminator", () => {
    for (const backend of ["wayland", "x11", "auto", ""]) {
        const args = ["siyuan", "--ozone-platform", backend];
        const launch = commandLine("");
        configureLinuxInputMethod(launch, true, "linux", args);
        assert.equal(getLinuxInputMethodOverride(args), backend === "x11");
        assert.equal(launch.getSwitchValue("ozone-platform"), backend);
    }
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--ozone-platform=x11", "--ozone-platform=wayland"]), false);
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--", "--ozone-platform=x11"]), null);
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--ozone-platform-hint=x11"]), null);
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--ozone-platform", "--other"]), false);
});

test("original process arguments exclude appended switches and preserve empty arguments", (t) => {
    t.mock.method(fs, "readFileSync", (file, encoding) => {
        assert.equal(file, "/proc/self/cmdline");
        assert.equal(encoding, "utf8");
        return "siyuan\0--workspace=/path with spaces\0\0";
    });
    const args = readLinuxInputMethodArguments();
    assert.deepEqual(args, ["siyuan", "--workspace=/path with spaces", ""]);
    assert.equal(getLinuxInputMethodOverride(args), null);
});

test("unavailable or invalid original arguments are reported instead of guessing an override", (t) => {
    const read = t.mock.method(fs, "readFileSync", () => { throw new Error("Access denied"); });
    assert.throws(() => readLinuxInputMethodArguments(), /Access denied/);
    for (const content of ["", "siyuan"]) {
        read.mock.mockImplementation(() => content);
        assert.throws(() => readLinuxInputMethodArguments(), /Invalid Linux process command line/);
    }
});

test("compatibility mode does not alter other platforms", () => {
    for (const platform of ["win32", "darwin"]) {
        const launch = commandLine();
        configureLinuxInputMethod(launch, true, platform);
        assert.equal(launch.hasSwitch("ozone-platform"), false);
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
