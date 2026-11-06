import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const fixture = ({desktop = false, native = false, active = true,
    save = Promise.resolve(), flush = Promise.resolve()} = {}) => {
    const posted: unknown[][] = [];
    const opened: unknown[][] = [];
    const errors: unknown[][] = [];
    const app = {};
    const system: Record<string, unknown> = {};
    const api = {} as {sendAppSetting: (controlId: string, value: unknown) => void};
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/appRuntime.ts"), "utf8");
    runInNewContext(transpileModule(parse(source, {BROWSER: !desktop, MOBILE: !desktop}, false, true),
        {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText, {
        exports: api,
        console: {warn: (): void => undefined, error: (): void => undefined},
        window: {siyuan: {config: {system}, languages: {settingsPendingSaveError: "Save failed"}}},
        require: (name: string) => {
            if (name === "../util/configApi") {
                return {config: {set: (path: string, value: unknown, onApplied?: () => void) => {
                    posted.push([path, value]);
                    if (desktop) return save.then(() => onApplied?.());
                    onApplied?.();
                    return save;
                }}};
            }
            if (name === "../../util/fetch") {
                return {fetchPost: (url: string, payload: unknown, cb?: () => void) => {
                    posted.push([url, payload]);
                    cb?.();
                }};
            }
            if (name === "../../constants") {
                return {Constants: {}};
            }
            if (name === "../../dialog/processSystem") {
                return {exitSiYuan: (): void => undefined};
            }
            if (name === "electron" || name === "../../layout/util") return {};
            if (name === "../setting/pending") {
                return {settingSaveFailures: () => 0, flushSettingSaves: () => flush};
            }
            if (name === "../setting/windowContext") {
                return {getSettingsOwnerApp: () => app, getSettingsWindowHost: () => native ? {
                    isActive: () => active,
                    reopenSettings: async (value: boolean) => { opened.push(["host", value]); },
                } : undefined};
            }
            if (name === "../index") {
                return {openSetting: (...args: unknown[]) => opened.push(["local", ...args])};
            }
            if (name === "../../dialog/message") {
                return {showMessage: (...args: unknown[]) => errors.push(args)};
            }
            throw new Error("unexpected module: " + name);
        },
    });
    return {posted, system, api, opened, errors, app};
};

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("enabling native settings reopens the app tab only after saving and flushing pending writes", async () => {
    let saved: () => void;
    let flushed: () => void;
    const f = fixture({desktop: true, save: new Promise<void>(resolve => { saved = resolve; }),
        flush: new Promise<void>(resolve => { flushed = resolve; })});
    f.api.sendAppSetting("system.settingsWindow", true);
    await settle();
    assert.deepEqual(f.opened, []);
    saved();
    await settle();
    assert.equal(f.system.settingsWindow, true);
    assert.deepEqual(f.opened, []);
    flushed();
    await settle();
    assert.deepEqual(f.opened, [["local", f.app, "app"]]);
});

test("disabling native settings reopens through the active owner instead of the child window", async () => {
    const f = fixture({desktop: true, native: true});
    f.system.settingsWindow = true;
    f.api.sendAppSetting("system.settingsWindow", false);
    await settle();
    assert.deepEqual(f.opened, [["host", false]]);
    const closed = fixture({desktop: true, native: true, active: false});
    closed.api.sendAppSetting("system.settingsWindow", false);
    await settle();
    assert.deepEqual(closed.opened, []);
});

test("failed preference or pending saves leave the current settings interface open", async () => {
    for (const stage of ["save", "flush"] as const) {
        let fail: (error: Error) => void;
        const pending = new Promise<void>((_resolve, reject) => { fail = reject; });
        const f = fixture({desktop: true, [stage]: pending});
        f.api.sendAppSetting("system.settingsWindow", true);
        fail(new Error("save failed"));
        await settle();
        assert.deepEqual(f.opened, []);
        assert.equal(f.errors.length, 1);
    }
});

test("a newer settings preference supersedes a pending interface switch", async () => {
    let flushed: () => void;
    const f = fixture({desktop: true, flush: new Promise<void>(resolve => { flushed = resolve; })});
    f.api.sendAppSetting("system.settingsWindow", true);
    await settle();
    f.system.settingsWindow = false;
    flushed();
    await settle();
    assert.deepEqual(f.opened, []);
});

test("settings window preference submits the boolean and mirrors it locally", () => {
    const f = fixture();
    f.api.sendAppSetting("system.settingsWindow", true);
    assert.equal(f.system.settingsWindow, true);
    f.api.sendAppSetting("system.settingsWindow", false);
    assert.equal(f.system.settingsWindow, false);
    f.api.sendAppSetting("system.settingsWindow", undefined);
    assert.equal(f.system.settingsWindow, false);
    assert.equal(JSON.stringify(f.posted), JSON.stringify([
        ["system.settingsWindow", true],
        ["system.settingsWindow", false],
        ["system.settingsWindow", false],
    ]));
});

test("unknown control ids are reported instead of silently posting", () => {
    const f = fixture();
    f.api.sendAppSetting("system.unknown", true);
    assert.equal(JSON.stringify(f.posted), "[]");
});
