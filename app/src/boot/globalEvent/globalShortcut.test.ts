import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {clearDisallowedTextInputHotkey, normalizePluginHotkey} from "../../util/hotKeyPolicy";
import {getKeymapBindings, setKeymapBindings} from "../../util/keymapBindings";
import {dispatchPluginGlobalShortcut} from "../../plugin/globalShortcut";
import type {App} from "../../index";
import type {Plugin} from "../../plugin";

const compiled = Object.fromEntries(["boot/globalEvent/globalShortcut", "plugin/index", "plugin/keymap"].map(name => [
    name,
    transpileModule(readFileSync(resolve("src", name + ".ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText,
]));

const setup = (detached = false) => {
    const siyuan: {languages?: {_trayMenu?: Record<string, string>}; config: {keymap: {
        general: {toggleWin: {custom: string}};
        plugin: Config.IKeymapPlugin;
    }}} = {config: {keymap: {general: {toggleWin: {custom: "⌥M"}}, plugin: {}}}};
    const messages: Array<{channel: string; data: {
        languages?: Record<string, string>; hotkeys: string[]; toggleHotkeys?: string[]; suspended?: boolean;
    }}> = [];
    const menuSyncs: boolean[] = [];
    const registeredCommands: ICommand[] = [];
    const document = {activeElement: {matches: () => false}};
    const dependencies: Record<string, unknown> = {
        "../../constants": {Constants: {SIYUAN_HOTKEY: "siyuan-hotkey"}},
        "../../util/functions": {isWindow: () => detached},
        "../../util/hotKeyPolicy": {clearDisallowedTextInputHotkey},
        "../../util/keymapBindings": {getKeymapBindings},
        "../util/hotKeyPolicy": {normalizePluginHotkey},
        "../util/keymapBindings": {getKeymapBindings, setKeymapBindings},
        "./commonHotkey": {syncAppMenuShortcuts: (suspended = false) => menuSyncs.push(suspended)},
        "electron": {ipcRenderer: {send: (channel: string, data: unknown) => {
            messages.push({channel, data: JSON.parse(JSON.stringify(data))});
        }}},
        "./commandAdapter": {registerPluginCommand: (_app: App, _plugin: Plugin, command: ICommand) => {
            registeredCommands.push(command);
        }},
    };
    const load = <T>(name: string) => {
        const exports = {} as T;
        runInNewContext(compiled[name], {
            exports, window: {siyuan}, document, console,
            require: (id: string) => dependencies[id] || {},
        });
        return exports;
    };
    const shortcuts = load<typeof import("./globalShortcut")>("boot/globalEvent/globalShortcut");
    dependencies["../boot/globalEvent/globalShortcut"] = shortcuts;
    dependencies["./keymap"] = load<typeof import("../../plugin/keymap")>("plugin/keymap");
    const {Plugin: PluginClass} = load<typeof import("../../plugin")>("plugin/index");
    const plugin = Object.create(PluginClass.prototype) as Plugin;
    const app = {plugins: [plugin]} as App;
    Object.assign(plugin, {app, name: "startup-test", commands: []});
    return {siyuan, messages, menuSyncs, registeredCommands, document, plugin,
        sync: () => shortcuts.sendGlobalShortcut(app)};
};

for (const languages of [undefined, {}]) {
    test(`plugin onload completes before tray translations are ready (${languages ? "missing tray" : "missing languages"})`, () => {
        const f = setup();
        f.siyuan.languages = languages;
        const callbacks: string[] = [];
        let loaded = false;
        f.plugin.onload = () => {
            f.plugin.addCommand({langKey: "first", hotkey: "⌥J", globalCallback: () => callbacks.push("first")});
            f.plugin.addCommand({langKey: "second", hotkey: "⌥K", globalCallback: () => callbacks.push("second")});
            loaded = true;
        };

        assert.doesNotThrow(() => f.plugin.onload());
        assert.equal(loaded, true);
        assert.equal(f.plugin.commands.length, 2);
        assert.equal(f.registeredCommands.length, 2);
        assert.deepEqual(f.messages, []);

        const trayMenu = {hideWindow: "Hide window", showWindow: "Show window"};
        f.siyuan.languages = {_trayMenu: trayMenu};
        f.sync();
        assert.deepEqual(f.messages, [{channel: "siyuan-hotkey", data: {
            languages: trayMenu, hotkeys: ["⌥M", "⌥J", "⌥K"], toggleHotkeys: ["⌥M"],
        }}]);
        assert.equal(dispatchPluginGlobalShortcut([f.plugin], "⌥K", f.siyuan.config.keymap.plugin), true);
        assert.deepEqual(callbacks, ["second"]);

        f.plugin.addCommand({langKey: "late", hotkey: "⌥L", globalCallback: () => callbacks.push("late")});
        assert.equal(f.messages.length, 2);
        assert.deepEqual(f.messages[1].data.hotkeys, ["⌥M", "⌥J", "⌥K", "⌥L"]);
        assert.deepEqual(f.messages[1].data.languages, trayMenu);
    });
}

test("recording still suspends global shortcuts before translations are ready", () => {
    const f = setup();
    f.document.activeElement.matches = () => true;
    f.sync();
    assert.deepEqual(f.messages, [{channel: "siyuan-hotkey", data: {hotkeys: [], suspended: true}}]);
    assert.deepEqual(f.menuSyncs, [true]);
});

test("detached windows sync app menus without registering global shortcuts", () => {
    const f = setup(true);
    f.sync();
    assert.deepEqual(f.messages, []);
    assert.deepEqual(f.menuSyncs, [false]);
});
