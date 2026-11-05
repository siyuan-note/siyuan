import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {compileModule, evaluateModule} from "../testSupport/loadModule";
import * as dockKeymap from "../util/dockKeymap";
import {ModuleKind, transpileModule} from "typescript";

test("main-window keymap synchronization sends only actual sidebar bindings", () => {
    const config = {system: {os: "win32"}, keymap: {general: {
        fileTree: {custom: "⌥7"}, outline: {custom: "⌥2", bindings: {version: 1, keys: [] as string[]}},
    }}, uiLayout: {left: {data: [[{hotkeyLangId: "fileTree"}, {hotkeyLangId: "outline"}]]}},
        sensitiveSetting: "not forwarded"};
    const sent: unknown[] = [];
    const sync = evaluateModule<typeof import("./keymapSync")>(compileModule("src/markdown/keymapSync.ts"), {
        window: {siyuan: {config}}, require: (name: string) => ({
            "../constants": {Constants: {SIYUAN_SYNC_MARKDOWN_KEYMAP: "sidebar-keymap"}},
            "../util/dockKeymap": dockKeymap,
            "../protyle/util/compatibility": {isMac: () => false},
            electron: {ipcRenderer: {send: (channel: string, value: unknown) => sent.push({channel, value})}},
        }[name]),
    });
    sync.syncMarkdownKeymap();
    config.keymap.general.fileTree.custom = "⌥8";
    sync.syncMarkdownKeymap();
    assert.deepEqual(sent, [{channel: "sidebar-keymap", value: {fileTree: ["⌥7"], outline: []}},
        {channel: "sidebar-keymap", value: {fileTree: ["⌥8"], outline: []}}]);
});

test("source Dock reordering immediately updates conflict winners and suppresses unchanged broadcasts", () => {
    const config = {system: {os: "win32"}, keymap: {general: {
        fileTree: {custom: "⌃1"}, outline: {custom: "⌘1"},
    }}, readonly: true, uiLayout: {left: {data: [[{hotkeyLangId: "outline"}, {hotkeyLangId: "fileTree"}]]}}};
    const sent: unknown[] = [];
    const window = {siyuan: {config, layout: {layout: {}, leftDock: {data: [[{hotkeyLangId: "fileTree"}, {hotkeyLangId: "outline"}]]},
        rightDock: {data: [] as unknown[]}, bottomDock: {data: [] as unknown[]}}}};
    const sync = evaluateModule<typeof import("./keymapSync")>(compileModule("src/markdown/keymapSync.ts"), {
        window, require: (name: string) => ({
            "../constants": {Constants: {SIYUAN_SYNC_MARKDOWN_KEYMAP: "sidebar-keymap"}},
            "../util/dockKeymap": dockKeymap,
            "../protyle/util/compatibility": {isMac: () => false},
            electron: {ipcRenderer: {send: (_channel: string, value: unknown) => sent.push(value)}},
        }[name]),
    });
    sync.syncMarkdownKeymap();
    sync.syncMarkdownKeymap();
    const layout = readFileSync("src/layout/util.ts", "utf8");
    const saveSource = layout.slice(layout.indexOf("export const saveLayout ="), layout.indexOf("export const exportLayout ="));
    const save = evaluateModule<{saveLayout(): void}>(transpileModule(saveSource, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, {
        window, layoutSavingSuspended: false, isWindow: () => false,
        document: {querySelector: () => ({getAttribute: () => "#iconDock"})},
        layoutToJSON() {}, dockToJSON: (dock: unknown) => dock, saveCount: 0,
        syncMarkdownKeymap: sync.syncMarkdownKeymap,
    });
    save.saveLayout();
    assert.deepEqual(sent, [{fileTree: [], outline: ["⌘1"]}, {fileTree: ["⌃1"], outline: []}]);
    config.keymap.general.fileTree.custom = "";
    config.keymap.general.outline.custom = "";
    sync.syncMarkdownKeymap();
    assert.deepEqual(sent.at(-1), {fileTree: [], outline: []});
    for (const value of ["layoutJSON", "snapshot"]) {
        assert.match(layout, new RegExp(`window\\.siyuan\\.config\\.uiLayout = ${value};\\s+syncMarkdownKeymap\\(\\);`));
    }
});

test("initialization and settings changes both synchronize Markdown sidebar commands", () => {
    assert.match(readFileSync("src/boot/onGetConfig.ts", "utf8"), /syncMarkdownKeymap\(true\);/);
    const source = readFileSync("src/config/tabs/keymapRuntime.ts", "utf8");
    const calls: string[] = [];
    let setting = false;
    const window = {siyuan: {config: {}, ws: {app: {plugins: [] as unknown[]}}}};
    const runtime = evaluateModule<typeof import("../config/tabs/keymapRuntime")>(compileModule("src/config/tabs/keymapRuntime.ts"), {
        window, document: {activeElement: undefined}, require: (name: string) => ({
            "../../boot/globalEvent/globalShortcut": {sendGlobalShortcut() {}, sendUnregisterGlobalShortcut() {}},
            "../../layout/dock/util": {updateDockHotkeys() {}},
            "../../boot/globalEvent/commonHotkey": {syncAppMenuShortcuts() {}},
            "../setting/windowContext": {isSettingsWindow: () => setting},
            "../../layout/getAll": {getAllEditor: (): unknown[] => []},
            "../../markdown/keymapSync": {syncMarkdownKeymap: () => calls.push("sync")},
        }[name]),
    });
    assert.match(source, /syncMarkdownKeymap\(\);/);
    runtime.applyKeymap({general: {fileTree: {custom: "⌥9"}}} as Config.IKeymap);
    assert.deepEqual(calls, ["sync"]);
    setting = true;
    runtime.applyKeymap({general: {fileTree: {custom: "⌥1"}}} as Config.IKeymap);
    assert.deepEqual(calls, ["sync"]);
});

test("initialized windows force a fresh snapshot after an earlier host-rejected send", () => {
    const config = {system: {os: "win32"}, keymap: {general: {
        fileTree: {custom: "⌥7"}, outline: {custom: "⌥8"},
    }}, uiLayout: {left: {data: [[{hotkeyLangId: "fileTree"}, {hotkeyLangId: "outline"}]]}}};
    const accepted: unknown[] = [];
    let initialized = false;
    let attempts = 0;
    const sync = evaluateModule<typeof import("./keymapSync")>(compileModule("src/markdown/keymapSync.ts"), {
        window: {siyuan: {config}}, require: (name: string) => ({
            "../constants": {Constants: {SIYUAN_SYNC_MARKDOWN_KEYMAP: "sidebar-keymap"}},
            "../util/dockKeymap": dockKeymap,
            "../protyle/util/compatibility": {isMac: () => false},
            electron: {ipcRenderer: {send: (_channel: string, value: unknown) => {
                attempts++;
                if (initialized) accepted.push(value);
            }}},
        }[name]),
    });
    sync.syncMarkdownKeymap();
    assert.equal(attempts, 1);
    assert.equal(accepted.length, 0);
    initialized = true;
    sync.syncMarkdownKeymap(true);
    sync.syncMarkdownKeymap();
    assert.equal(attempts, 2);
    assert.deepEqual(accepted, [{fileTree: ["⌥7"], outline: ["⌥8"]}]);
});
