// 桌面端辅助功能（`accessibility.ts`）：本机开关与显式启动参数。
import {test} from "node:test";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import {readEnabledSetting, writeEnabledSetting} from "./enabledSettingFile";
import type {App} from "electron";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const accessibility = () => require("./accessibility");

const createCommandLine = (...switches: string[]) => {
    const values = new Set<string>(switches);
    return {
        values,
        hasSwitch: (name: string) => values.has(name),
        appendSwitch: (name: string) => { values.add(name); },
        appendArgument: () => {},
        getSwitchValue: () => "",
        removeSwitch: (name: string) => { values.delete(name); },
    };
};

const setup = (t: any, ...switches: string[]) => {
    const commandLine = createCommandLine(...switches);
    resetElectronStub();
    mockElectron(t, {app: {commandLine} as unknown as App});
    t.after(resetElectronStub);
    return {commandLine, ...accessibility()};
};

const settingFile = (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-accessibility-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    return path.join(directory, "conf", "accessibility.json");
};

test("desktop accessibility defaults off and restores the saved choice at the next launch", (t) => {
    const file = settingFile(t);
    assert.equal(readEnabledSetting(file), false);
    const firstLaunch = setup(t);
    firstLaunch.configureAccessibility(readEnabledSetting(file));
    assert.equal(firstLaunch.commandLine.values.has("disable-renderer-accessibility"), true);

    writeEnabledSetting(file, true);
    const enabledLaunch = setup(t);
    enabledLaunch.configureAccessibility(readEnabledSetting(file));
    assert.equal(enabledLaunch.commandLine.values.has("disable-renderer-accessibility"), false);

    writeEnabledSetting(file, false);
    const disabledLaunch = setup(t);
    disabledLaunch.configureAccessibility(readEnabledSetting(file));
    assert.equal(disabledLaunch.commandLine.values.has("disable-renderer-accessibility"), true);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["accessibility.json"]);
});

test("explicit accessibility arguments override both saved choices", (t) => {
    for (const enabled of [false, true]) {
        for (const switches of [
            ["force-renderer-accessibility"],
            ["disable-renderer-accessibility"],
            ["force-renderer-accessibility", "disable-renderer-accessibility"],
        ]) {
            const {commandLine, getAccessibilityOverride, configureAccessibility} = setup(t, ...switches);
            const expected = !switches.includes("disable-renderer-accessibility");
            assert.equal(getAccessibilityOverride(), expected);
            configureAccessibility(enabled);
            assert.deepEqual([...commandLine.values], switches);
        }
    }
    const {getAccessibilityOverride} = setup(t);
    assert.equal(getAccessibilityOverride(), null);
});

test("invalid or unreadable settings are reported instead of silently disabling accessibility", (t) => {
    const file = settingFile(t);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    for (const contents of ["{", "null", "{}", '{"enabled":"false"}']) {
        fs.writeFileSync(file, contents);
        assert.throws(() => readEnabledSetting(file));
        assert.equal(fs.readFileSync(file, "utf8"), contents);
    }
    assert.throws(() => readEnabledSetting(path.dirname(file)));
});

test("invalid updates and failed replacement preserve the previous preference", (t) => {
    const file = settingFile(t);
    writeEnabledSetting(file, true);
    // 这些值故意违反签名：用例验证运行期校验不依赖类型系统。
    const invalidValues: unknown[] = [undefined, null, "false", 0, {}];
    for (const value of invalidValues) {
        assert.throws(() => writeEnabledSetting(file, value as boolean), TypeError);
        assert.equal(readEnabledSetting(file), true);
    }
    t.mock.method(fs, "renameSync", () => {
        throw new Error("Unable to replace preference");
    });
    assert.throws(() => writeEnabledSetting(file, false), /Unable to replace preference/);
    assert.equal(readEnabledSetting(file), true);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["accessibility.json"]);
});
