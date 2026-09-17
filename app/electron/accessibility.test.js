const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {
    readAccessibilitySetting, writeAccessibilitySetting, getAccessibilityOverride, configureAccessibility,
} = require("./accessibility");

const createCommandLine = (...switches) => {
    const values = new Set(switches);
    return {
        hasSwitch: (name) => values.has(name),
        appendSwitch: (name) => values.add(name),
        values,
    };
};

const settingFile = (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-accessibility-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    return path.join(directory, "conf", "accessibility.json");
};

test("desktop accessibility defaults off and restores the saved choice at the next launch", (t) => {
    const file = settingFile(t);
    assert.equal(readAccessibilitySetting(file), false);
    const firstLaunch = createCommandLine();
    configureAccessibility(firstLaunch, readAccessibilitySetting(file));
    assert.equal(firstLaunch.hasSwitch("disable-renderer-accessibility"), true);

    writeAccessibilitySetting(file, true);
    assert.equal(readAccessibilitySetting(file), true);
    const enabledLaunch = createCommandLine();
    configureAccessibility(enabledLaunch, readAccessibilitySetting(file));
    assert.equal(enabledLaunch.hasSwitch("disable-renderer-accessibility"), false);

    writeAccessibilitySetting(file, false);
    const disabledLaunch = createCommandLine();
    configureAccessibility(disabledLaunch, readAccessibilitySetting(file));
    assert.equal(disabledLaunch.hasSwitch("disable-renderer-accessibility"), true);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["accessibility.json"]);
});

test("explicit accessibility arguments override both saved choices", () => {
    for (const enabled of [false, true]) {
        for (const switches of [
            ["force-renderer-accessibility"],
            ["disable-renderer-accessibility"],
            ["force-renderer-accessibility", "disable-renderer-accessibility"],
        ]) {
            const commandLine = createCommandLine(...switches);
            const expected = !switches.includes("disable-renderer-accessibility");
            assert.equal(getAccessibilityOverride(commandLine), expected);
            configureAccessibility(commandLine, enabled);
            assert.deepEqual([...commandLine.values], switches);
        }
    }
    assert.equal(getAccessibilityOverride(createCommandLine()), null);
});

test("invalid or unreadable settings are reported instead of silently disabling accessibility", (t) => {
    const file = settingFile(t);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    for (const contents of ["{", "null", "{}", '{"enabled":"false"}']) {
        fs.writeFileSync(file, contents);
        assert.throws(() => readAccessibilitySetting(file));
        assert.equal(fs.readFileSync(file, "utf8"), contents);
    }
    assert.throws(() => readAccessibilitySetting(path.dirname(file)));
});

test("invalid updates and failed replacement preserve the previous preference", (t) => {
    const file = settingFile(t);
    writeAccessibilitySetting(file, true);
    for (const value of [undefined, null, "false", 0, {}]) {
        assert.throws(() => writeAccessibilitySetting(file, value), TypeError);
        assert.equal(readAccessibilitySetting(file), true);
    }
    t.mock.method(fs, "renameSync", () => {
        throw new Error("Unable to replace preference");
    });
    assert.throws(() => writeAccessibilitySetting(file, false), /Unable to replace preference/);
    assert.equal(readAccessibilitySetting(file), true);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["accessibility.json"]);
});
