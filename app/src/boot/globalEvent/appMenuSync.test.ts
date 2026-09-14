import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {createContext, runInContext} from "node:vm";
import {transpileModule, ModuleKind} from "typescript";

test("menu sync includes language changes even when shortcuts stay unchanged", () => {
    const source = readFileSync(resolve("src/boot/globalEvent/commonHotkey.ts"), "utf8");
    const script = source.slice(source.indexOf("let lastAppMenuSync:"), source.indexOf("export const filterHotkey"));
    const config = {
        lang: "zh-CN", readonly: false, system: {workspaceDir: "workspace"},
        keymap: {general: {config: {custom: ""}, toggleWin: {custom: ""}},
            editor: {general: {undo: {custom: ""}, redo: {custom: ""}}}},
    };
    const siyuan = {config};
    const messages: Array<{lang: string}> = [];
    const context = createContext({
        exports: {}, window: {siyuan}, isMac: () => true,
        getHostCapabilities: () => ({workspaces: true}),
        Constants: {SIYUAN_SYNC_APP_MENU: "menu"},
        ipcRenderer: {send: (_channel: string, data: typeof messages[number]) => messages.push(data)},
    });
    runInContext(transpileModule(script, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, context);
    const sync = () => runInContext("exports.syncAppMenuShortcuts();", context);
    sync();
    sync();
    assert.equal(messages.length, 1);
    config.lang = "en";
    sync();
    assert.equal(messages.length, 2);
    assert.equal(messages[1].lang, "en");
    assert.equal("i18n" in messages[1], false);
    sync();
    assert.equal(messages.length, 2);
});
