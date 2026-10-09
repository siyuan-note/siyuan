import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

// sendAppSetting 只负责 submit 与本地回写；桌面分支的 ipc / 布局依赖在 BROWSER+MOBILE 下被裁剪
const fixture = () => {
    const posted: unknown[][] = [];
    const system: Record<string, unknown> = {};
    const api = {} as {sendAppSetting: (controlId: string, value: unknown) => void};
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/appRuntime.ts"), "utf8");
    runInNewContext(transpileModule(parse(source, {BROWSER: true, MOBILE: true}, false, true),
        {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText, {
        exports: api,
        console: {warn: (): void => undefined},
        window: {siyuan: {config: {system}}},
        require: (name: string) => {
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
            throw new Error("unexpected module: " + name);
        },
    });
    return {posted, system, api};
};

test("settings window preference submits the boolean and mirrors it locally", () => {
    const f = fixture();
    f.api.sendAppSetting("system.settingsWindow", true);
    assert.equal(f.system.settingsWindow, true);
    f.api.sendAppSetting("system.settingsWindow", false);
    assert.equal(f.system.settingsWindow, false);
    f.api.sendAppSetting("system.settingsWindow", undefined);
    assert.equal(f.system.settingsWindow, false);
    assert.equal(JSON.stringify(f.posted), JSON.stringify([
        ["/api/system/setSettingsWindow", {settingsWindow: true}],
        ["/api/system/setSettingsWindow", {settingsWindow: false}],
        ["/api/system/setSettingsWindow", {settingsWindow: false}],
    ]));
});

test("unknown control ids are reported instead of silently posting", () => {
    const f = fixture();
    f.api.sendAppSetting("system.unknown", true);
    assert.equal(JSON.stringify(f.posted), "[]");
});
