import * as assert from "node:assert/strict";
import {test} from "node:test";
import {compileModule, evaluateModule} from "../testSupport/loadModule";
import * as dockKeymap from "../util/dockKeymap";
import * as shortcut from "../util/shortcut";
import * as hotKeyPolicy from "../util/hotKeyPolicy";
import type {SidebarKeymap} from "../util/dockKeymap";

const constants = evaluateModule<typeof import("../constants")>(compileModule("src/constants.ts"), {
    SIYUAN_VERSION: "test", NODE_ENV: "test", require: () => dockKeymap,
});
const {createMarkdownSidebarShortcuts} = evaluateModule<typeof import("./shortcuts")>(compileModule("src/markdown/shortcuts.ts"), {
    require: (name: string) => ({"../constants": constants, "../util/dockKeymap": dockKeymap,
        "../util/shortcut": shortcut, "../util/hotKeyPolicy": hotKeyPolicy}[name]),
});
const event = (overrides: Partial<KeyboardEvent> = {}) => {
    let prevented = 0;
    let stopped = 0;
    return {key: "1", code: "Digit1", keyCode: 49, altKey: true, shiftKey: false, ctrlKey: false, metaKey: false,
        isComposing: false, repeat: false, defaultPrevented: false,
        preventDefault() {prevented++;}, stopImmediatePropagation() {stopped++;}, ...overrides,
        consumed: () => ({prevented, stopped}),
    } as KeyboardEvent & {consumed(): {prevented: number; stopped: number}};
};
const fixture = (platform = "win32", keymap?: SidebarKeymap) => {
    const toggles: string[] = [];
    let composing = false;
    let available = {fileTree: true, outline: true};
    const shortcuts = createMarkdownSidebarShortcuts({platform, keymap, canToggle: key => available[key],
        isComposing: () => composing, toggle: key => toggles.push(key)});
    return {shortcuts, toggles, compose: (value: boolean) => {composing = value;},
        availability: (value: typeof available) => {available = value;}};
};

test("Windows and Linux dispatch actual Alt defaults and display the same shortcuts", () => {
    for (const platform of ["win32", "linux"]) {
        const {shortcuts, toggles} = fixture(platform);
        assert.equal(shortcuts.label("fileTree"), "Alt+1");
        assert.equal(shortcuts.label("outline"), "Alt+2");
        const first = event();
        assert.equal(shortcuts.handle(first), true);
        assert.deepEqual(first.consumed(), {prevented: 1, stopped: 1});
        assert.equal(shortcuts.handle(event({key: "2", code: "Digit2", keyCode: 50})), true);
        assert.equal(shortcuts.handle(event({altKey: false, ctrlKey: true})), false);
        assert.deepEqual(toggles, ["fileTree", "outline"]);
    }
});

test("Mac uses Control defaults and handles Option symbols from configured physical digit keys", () => {
    const {shortcuts, toggles} = fixture("darwin");
    assert.equal(shortcuts.label("fileTree"), "⌃1");
    assert.equal(shortcuts.handle(event({altKey: false, ctrlKey: true})), true);
    assert.equal(shortcuts.handle(event({altKey: false, metaKey: true})), false);
    assert.equal(shortcuts.handle(event()), false);
    shortcuts.update({fileTree: ["⌥1"], outline: ["⌥2"]});
    assert.equal(shortcuts.label("fileTree"), "⌥1");
    assert.equal(shortcuts.handle(event({key: "¡"})), true);
    assert.equal(shortcuts.handle(event({key: "™", code: "Digit2", keyCode: 50})), true);
    assert.deepEqual(toggles, ["fileTree", "fileTree", "outline"]);
});

test("custom changes and explicit unbinding take effect without another listener registration", () => {
    const {shortcuts, toggles} = fixture();
    shortcuts.update({fileTree: ["⌥3", "⇧⌘J"], outline: []});
    assert.equal(shortcuts.label("fileTree"), "Alt+3 / Ctrl+Shift+J");
    assert.equal(shortcuts.label("outline"), "");
    assert.equal(shortcuts.handle(event()), false);
    assert.equal(shortcuts.handle(event({key: "2", keyCode: 50})), false);
    assert.equal(shortcuts.handle(event({key: "3", keyCode: 51})), true);
    assert.equal(shortcuts.handle(event({key: "J", keyCode: 74, altKey: false, ctrlKey: true, shiftKey: true})), true);
    shortcuts.update({fileTree: [], outline: []});
    assert.equal(shortcuts.handle(event({key: "3", keyCode: 51})), false);
    assert.deepEqual(toggles, ["fileTree", "fileTree"]);
});

test("composition, already consumed events and unavailable commands leave editor input alone", () => {
    const h = fixture();
    for (const change of [{isComposing: true}, {keyCode: 229}, {defaultPrevented: true}, {shiftKey: true},
        {ctrlKey: true}, {metaKey: true}, {altKey: false}]) {
        const input = event(change);
        assert.equal(h.shortcuts.handle(input), false);
        assert.deepEqual(input.consumed(), {prevented: 0, stopped: 0});
    }
    h.compose(true);
    assert.equal(h.shortcuts.handle(event()), false);
    h.compose(false);
    h.availability({fileTree: false, outline: false});
    assert.equal(h.shortcuts.handle(event()), false);
    assert.deepEqual(h.toggles, []);
});

test("held keys are consumed without repeated toggle or propagation to Vditor and menus", () => {
    const {shortcuts, toggles} = fixture();
    assert.equal(shortcuts.handle(event()), true);
    const repeat = event({repeat: true});
    for (let i = 0; i < 3; i++) assert.equal(shortcuts.handle(repeat), true);
    assert.deepEqual(repeat.consumed(), {prevented: 3, stopped: 3});
    assert.deepEqual(toggles, ["fileTree"]);
});

test("text input shortcuts are rejected and conflicting enabled commands dispatch once", () => {
    const h = fixture("win32", {fileTree: ["1", "⌥1"], outline: ["⌥1"]});
    assert.equal(h.shortcuts.label("fileTree"), "Alt+1");
    assert.equal(h.shortcuts.handle(event({altKey: false})), false);
    assert.equal(h.shortcuts.handle(event()), true);
    h.availability({fileTree: false, outline: true});
    assert.equal(h.shortcuts.handle(event()), true);
    assert.deepEqual(h.toggles, ["fileTree", "outline"]);
    assert.equal(shortcut.formatShortcut("⌥⇧⌘↩", false), "Ctrl+Shift+Alt+Enter");
    assert.equal(shortcut.formatShortcut("⌘↩", true), "⌘↩\uFE0E");
});
