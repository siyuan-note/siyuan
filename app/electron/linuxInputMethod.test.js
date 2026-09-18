const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {
    readLinuxInputMethodSetting, writeLinuxInputMethodSetting, getLinuxInputMethodOverride, configureLinuxInputMethod,
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
        configureLinuxInputMethod(launch, readLinuxInputMethodSetting(file), "linux");
        assert.equal(launch.getSwitchValue("ozone-platform"), enabled ? "x11" : undefined);
    }
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["linux-input-method.json"]);
});

test("explicit display backend overrides either saved choice", () => {
    for (const backend of ["x11", "wayland", "auto", ""]) {
        for (const enabled of [false, true]) {
            const launch = commandLine(backend);
            assert.equal(getLinuxInputMethodOverride(launch), backend === "x11");
            configureLinuxInputMethod(launch, enabled, "linux");
            assert.equal(launch.getSwitchValue("ozone-platform"), backend);
        }
    }
    assert.equal(getLinuxInputMethodOverride(commandLine()), null);
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
