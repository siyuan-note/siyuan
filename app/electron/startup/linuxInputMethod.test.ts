import {test} from "node:test";
import type {App} from "electron";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import {readEnabledSetting, writeEnabledSetting} from "./enabledSettingFile";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const load = (t: any, app: Partial<App> = {}) => {
    resetElectronStub();
    mockElectron(t, {app: app as App});
    t.after(resetElectronStub);
    return require("./linuxInputMethod");
};

test("compatibility mode persists across launches and can be disabled", (t) => {
    const {prepareLinuxInputMethodLaunch} = load(t);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-ime-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const file = path.join(directory, "conf", "linux-input-method.json");
    assert.equal(readEnabledSetting(file), false);
    for (const enabled of [true, false]) {
        writeEnabledSetting(file, enabled);
        const launch = prepareLinuxInputMethodLaunch(["siyuan"], "linux", {enabled: readEnabledSetting(file)});
        assert.equal(launch.relaunchArgs?.includes("--ozone-platform=x11") || false, enabled);
    }
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["linux-input-method.json"]);
});

test("explicit display backend overrides either saved choice", (t) => {
    const {getLinuxInputMethodOverride, prepareLinuxInputMethodLaunch} = load(t);
    for (const backend of ["x11", "wayland", "auto", ""]) {
        for (const enabled of [false, true]) {
            const args = ["siyuan", "--ozone-platform=" + backend];
            assert.equal(getLinuxInputMethodOverride(args), backend === "x11");
            const launch = prepareLinuxInputMethodLaunch(args, "linux", {enabled});
            assert.equal(launch.relaunchArgs, null);
            assert.equal(launch.override, backend === "x11");
        }
    }
    assert.equal(getLinuxInputMethodOverride(["siyuan"]), null);
});

test("managed backend reaches native startup without locking the preference or looping", (t) => {
    const {getLinuxInputMethodOverride, prepareLinuxInputMethodLaunch} = load(t);
    const original = ["siyuan", "--workspace=/path with spaces", "--lang=zh-CN"];
    const first = prepareLinuxInputMethodLaunch(original, "linux", {enabled: true});
    const nativeArgs = [original[0], ...first.relaunchArgs];
    assert.equal(getLinuxInputMethodOverride(nativeArgs), true);
    const second = prepareLinuxInputMethodLaunch(nativeArgs, "linux",
        {enabled: true, relaunchToken: first.relaunchToken});
    assert.equal(second.override, null);
    assert.equal(second.relaunchArgs, null);
    assert.deepEqual(second.args, original);
    const disabled = prepareLinuxInputMethodLaunch(nativeArgs, "linux",
        {enabled: false, relaunchToken: first.relaunchToken});
    assert.deepEqual(disabled.relaunchArgs, original.slice(1));
    const third = prepareLinuxInputMethodLaunch([original[0], ...disabled.relaunchArgs], "linux", {enabled: false});
    assert.equal(third.override, null);
    assert.equal(third.relaunchArgs, null);
});

test("explicit backends support separate values, repeated switches and the argument terminator", (t) => {
    const {getLinuxInputMethodOverride, prepareLinuxInputMethodLaunch} = load(t);
    for (const backend of ["wayland", "x11", "auto", ""]) {
        const args = ["siyuan", "--ozone-platform", backend];
        const launch = prepareLinuxInputMethodLaunch(args, "linux", {enabled: true});
        assert.equal(getLinuxInputMethodOverride(args), backend === "x11");
        assert.equal(launch.override, backend === "x11");
        assert.equal(launch.relaunchArgs, null);
    }
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--ozone-platform=x11", "--ozone-platform=wayland"]), false);
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--", "--ozone-platform=x11"]), null);
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--ozone-platform-hint=x11"]), null);
    assert.equal(getLinuxInputMethodOverride(["siyuan", "--ozone-platform", "--other"]), false);
});

test("managed flags precede the terminator and preserve development and positional arguments", (t) => {
    const {prepareLinuxInputMethodLaunch} = load(t);
    const original = ["electron", "/path with spaces/main.js", "--", "--ozone-platform=wayland", "document"];
    const launch = prepareLinuxInputMethodLaunch(original, "linux", {enabled: true});
    assert.ok(launch.relaunchArgs.indexOf("--ozone-platform=x11") < launch.relaunchArgs.indexOf("--"));
    const restarted = prepareLinuxInputMethodLaunch(["electron", ...launch.relaunchArgs], "linux",
        {enabled: true, relaunchToken: launch.relaunchToken});
    assert.deepEqual(restarted.args, original);
    assert.equal(restarted.override, null);
    assert.equal(restarted.relaunchArgs, null);
});

test("an unmatched relaunch marker cannot hide an explicit backend", (t) => {
    const {prepareLinuxInputMethodLaunch} = load(t);
    const launch = prepareLinuxInputMethodLaunch(["siyuan"], "linux", {enabled: true});
    const args = ["siyuan", ...launch.relaunchArgs];
    for (const token of [undefined, "invalid", "0".repeat(48)]) {
        const result = prepareLinuxInputMethodLaunch(args, "linux", {enabled: true, relaunchToken: token});
        assert.equal(result.override, true);
        assert.equal(result.relaunchArgs, null);
    }
    const explicit = prepareLinuxInputMethodLaunch(["siyuan", "--ozone-platform=wayland", ...launch.relaunchArgs],
        "linux", {enabled: true, relaunchToken: launch.relaunchToken});
    assert.equal(explicit.override, false);
    assert.deepEqual(explicit.relaunchArgs, ["--ozone-platform=wayland"]);
});

test("relaunch keeps its token in the environment so the next launch does not loop", (t) => {
    const calls = [];
    const env = {};
    // 重启桩只实现 relaunch 与 exit，其余 App 成员不在本用例范围内。
    const {initializeLinuxInputMethod, linuxInputMethodRelaunchEnvironment} = load(t,
        {relaunch: options => calls.push(options), exit: code => calls.push(code)} as unknown as App);
    initializeLinuxInputMethod({
        platform: "linux",
        settingFile: "setting.json",
        launchArguments: ["siyuan"],
        env,
        readSetting: () => true,
    });
    assert.equal(calls.length, 2);
    assert.ok(calls[0].args.includes("--ozone-platform=x11"));
    assert.equal(calls[1], 0);
    assert.match(env[linuxInputMethodRelaunchEnvironment], /^[a-f0-9]{48}$/);
});

test("effective launch arguments drop the managed backend after the relaunch", (t) => {
    const {initializeLinuxInputMethod, linuxInputMethodRelaunchEnvironment, prepareLinuxInputMethodLaunch} = load(t,
        {relaunch: () => { throw new Error("Restarted launch must not relaunch again"); },
            exit: () => { throw new Error("Restarted launch must not exit"); }} as unknown as App);
    const launch = prepareLinuxInputMethodLaunch(["siyuan", "--workspace=/notes"], "linux", {enabled: true});
    const env = {[linuxInputMethodRelaunchEnvironment]: launch.relaunchToken as string};
    const launchArguments = ["siyuan", ...(launch.relaunchArgs as string[])];
    initializeLinuxInputMethod({
        platform: "linux",
        settingFile: "setting.json",
        launchArguments,
        env,
        readSetting: () => true,
    });
    assert.deepEqual(launchArguments, ["siyuan", "--workspace=/notes"]);
});

test("other platforms keep their launch arguments untouched", (t) => {
    const {initializeLinuxInputMethod} = load(t);
    const launchArguments = ["siyuan", "--workspace=/notes"];
    for (const platform of ["win32", "darwin"] as NodeJS.Platform[]) {
        initializeLinuxInputMethod({
            platform,
            settingFile: "setting.json",
            launchArguments,
            env: {},
        });
        assert.deepEqual(launchArguments, ["siyuan", "--workspace=/notes"]);
    }
});

test("compatibility mode does not alter other platforms", (t) => {
    const {prepareLinuxInputMethodLaunch} = load(t);
    for (const platform of ["win32", "darwin"] as NodeJS.Platform[]) {
        const launch = prepareLinuxInputMethodLaunch(["siyuan"], platform, {enabled: true});
        assert.equal(launch.relaunchArgs, null);
    }
});

test("invalid settings and failed writes preserve existing data", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-ime-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const file = path.join(directory, "linux-input-method.json");
    for (const content of ["{", "null", "{}", '{"enabled":"false"}']) {
        fs.writeFileSync(file, content);
        assert.throws(() => readEnabledSetting(file));
        assert.equal(fs.readFileSync(file, "utf8"), content);
    }
    writeEnabledSetting(file, true);
    // 这些值故意违反签名：用例验证运行期校验不依赖类型系统。
    const invalidValues: unknown[] = [undefined, null, "false", 0, {}];
    for (const value of invalidValues) {
        assert.throws(() => writeEnabledSetting(file, value as boolean), TypeError);
        assert.equal(readEnabledSetting(file), true);
    }
    t.mock.method(fs, "renameSync", () => { throw new Error("Write failed"); });
    assert.throws(() => writeEnabledSetting(file, false), /Write failed/);
    assert.equal(readEnabledSetting(file), true);
    assert.deepEqual(fs.readdirSync(directory), ["linux-input-method.json"]);
});
