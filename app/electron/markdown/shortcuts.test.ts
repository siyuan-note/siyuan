import * as assert from "node:assert/strict";
import {test} from "node:test";
import type {Input} from "electron";
import {isMarkdownSidebarShortcut} from "./shortcuts";
import {getSidebarKeymap} from "../../src/util/dockKeymap";

const input = (overrides: Partial<Input> = {}): Input => ({type: "keyDown", key: "1", code: "Digit1", alt: true,
    control: false, meta: false, shift: false, isAutoRepeat: false, isComposing: false, location: 0, modifiers: [], ...overrides});

test("native menu suppression uses the same platform defaults as renderer commands", () => {
    for (const platform of ["win32", "linux"]) {
        const keymap = getSidebarKeymap(undefined, platform);
        assert.equal(isMarkdownSidebarShortcut(input(), keymap, platform), true);
        assert.equal(isMarkdownSidebarShortcut(input({key: "2", code: "Digit2"}), keymap, platform), true);
        assert.equal(isMarkdownSidebarShortcut(input({alt: false, control: true}), keymap, platform), false);
    }
    const keymap = getSidebarKeymap(undefined, "darwin");
    assert.equal(isMarkdownSidebarShortcut(input({alt: false, control: true}), keymap, "darwin"), true);
    assert.equal(isMarkdownSidebarShortcut(input(), keymap, "darwin"), false);
});

test("native menu collisions follow custom bindings including Option symbols and multiple shortcuts", () => {
    const keymap = {fileTree: ["⌘Z", "⌥1"], outline: ["⌥2", "⌥⇧P"]};
    assert.equal(isMarkdownSidebarShortcut(input({key: "z", code: "KeyZ", alt: false, meta: true}), keymap, "darwin"), true);
    assert.equal(isMarkdownSidebarShortcut(input({key: "¡"}), keymap, "darwin"), true);
    assert.equal(isMarkdownSidebarShortcut(input({key: "™", code: "Digit2"}), keymap, "darwin"), true);
    assert.equal(isMarkdownSidebarShortcut(input({key: "∏", code: "KeyP", shift: true}), keymap, "darwin"), true);
    assert.equal(isMarkdownSidebarShortcut(input({key: "q", code: "KeyQ", alt: false, meta: true}), keymap, "darwin"), false);
    assert.equal(isMarkdownSidebarShortcut(input(), {fileTree: [], outline: []}, "darwin"), false);
});

test("composition and key-up restore menu handling while repeats stay suppressed until release", () => {
    const keymap = {fileTree: ["⌥1"], outline: []};
    assert.equal(isMarkdownSidebarShortcut(input({isAutoRepeat: true}), keymap, "darwin"), true);
    assert.equal(isMarkdownSidebarShortcut(input({type: "keyUp"}), keymap, "darwin"), false);
    assert.equal(isMarkdownSidebarShortcut(input({isComposing: true}), keymap, "darwin"), false);
    assert.equal(isMarkdownSidebarShortcut(input({shift: true}), keymap, "darwin"), false);
    assert.equal(isMarkdownSidebarShortcut(input({control: true}), keymap, "darwin"), false);
    assert.equal(isMarkdownSidebarShortcut(input({alt: false}), {fileTree: ["1"], outline: []}, "darwin"), false);
});
