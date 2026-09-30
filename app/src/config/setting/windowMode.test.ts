import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const fixture = (browser = false, mobile = false) => {
    const storage: Record<string, unknown> = {};
    const saved: unknown[] = [];
    const calls: unknown[][] = [];
    const source = readFileSync("src/config/setting/windowMode.ts", "utf8");
    const mode = {} as {getSettingsWindowMode: () => number; setSettingsWindowMode: (value: unknown) => void};
    const compilerOptions = {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021};
    runInNewContext(transpileModule(source, {compilerOptions}).outputText, {
        exports: mode, window: {siyuan: {storage}}, require: () => ({
            Constants: {LOCAL_SETTINGS_WINDOW_MODE: "mode"}, setStorageVal: (...args: unknown[]) => saved.push(args),
        }),
    });
    const index = createSourceFile("index.ts", parse(readFileSync("src/config/index.ts", "utf8"),
        {BROWSER: browser, MOBILE: mobile}, false, true), ScriptTarget.ES2021, true);
    const declarations = index.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => ["openSetting", "openBazaarReadme"].includes(item.name.getText(index))));
    const entry = {} as {openSetting: (app: unknown, tab?: string) => void;
        openBazaarReadme: (app: unknown, type: string, name: string, from: string) => Promise<void>};
    let native = false;
    runInNewContext(transpileModule(declarations.map(item => item.getText(index)).join("\n"), {compilerOptions}).outputText, {
        exports: entry, ...mode, isSettingsWindow: () => native,
        isBazaarAvailable: () => true, getHostCapabilities: () => ({documentImportExport: true}),
        openNativeSettings: (...args: unknown[]) => calls.push(["native", ...args]),
        openSettingDialog: (...args: unknown[]) => calls.push(["dialog", ...args]),
        openMobileSetting: (...args: unknown[]) => calls.push(["mobile", ...args]),
        window: {siyuan: {dialogs: [{element: {getAttribute: () => "settings"}}], config: {bazaar: {trust: true}}}},
        Constants: {DIALOG_SETTING: "settings"}, switchSettingTab: (...args: unknown[]) => calls.push(["switch", ...args]),
        fetchSyncPost: async () => ({code: 0, data: {packages: [{name: "plugin"}]}}),
        getFrontend: () => "desktop", withMountedBazaar: async () => calls.push(["readme"]),
    });
    return {storage, saved, calls, mode, entry, setNative: () => { native = true; }};
};

test("settings mode defaults to a native window, persists valid choices and ignores invalid values", () => {
    const f = fixture();
    assert.equal(f.mode.getSettingsWindowMode(), 1);
    for (const value of [null, false, "0", 2]) f.mode.setSettingsWindowMode(value);
    assert.equal(f.saved.length, 0);
    f.mode.setSettingsWindowMode(0);
    assert.equal(f.mode.getSettingsWindowMode(), 0);
    assert.equal(JSON.stringify(f.saved), JSON.stringify([["mode", 0]]));
    f.mode.setSettingsWindowMode(1);
    assert.equal(f.mode.getSettingsWindowMode(), 1);
});

test("settings and marketplace readmes follow the current workspace preference", async () => {
    const f = fixture();
    const app = {};
    f.entry.openSetting(app, "app");
    await f.entry.openBazaarReadme(app, "plugins", "plugin", "downloaded");
    assert.deepEqual(f.calls.map(item => item[0]), ["native", "native"]);
    f.calls.length = 0;
    f.storage.mode = 0;
    f.entry.openSetting(app, "app");
    await f.entry.openBazaarReadme(app, "plugins", "plugin", "downloaded");
    assert.deepEqual(f.calls.map(item => item[0]), ["dialog", "dialog", "readme"]);
    f.calls.length = 0;
    f.setNative();
    f.entry.openSetting(app, "app");
    assert.deepEqual(f.calls.map(item => item[0]), ["switch"]);
});

test("browser and mobile keep their own settings UI regardless of the native preference", () => {
    for (const [browser, mobile, expected] of [[true, false, "dialog"], [true, true, "mobile"]] as const) {
        const f = fixture(browser, mobile);
        f.entry.openSetting({});
        assert.equal(f.calls[0][0], expected);
    }
});
