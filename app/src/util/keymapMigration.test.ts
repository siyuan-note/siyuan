import * as assert from "node:assert/strict";
import test from "node:test";
import {migrateEditModeKeymap} from "./keymapMigration";

test("edit mode keymap migration prefers the customized preview shortcut", () => {
    const keymap: Record<string, {default: string, custom: string}> = {
        preview: {default: "preview-default", custom: "preview-custom"},
        wysiwyg: {default: "wysiwyg-default", custom: "wysiwyg-custom"},
    };
    assert.equal(migrateEditModeKeymap(keymap, "new-default"), true);
    assert.deepEqual(keymap["edit-mode"], {default: "new-default", custom: "preview-custom"});
});

test("edit mode keymap migration preserves the only customized shortcut", () => {
    const keymap: Record<string, {default: string, custom: string}> = {
        preview: {default: "preview-default", custom: "preview-default"},
        wysiwyg: {default: "wysiwyg-default", custom: "wysiwyg-custom"},
    };
    migrateEditModeKeymap(keymap, "new-default");
    assert.deepEqual(keymap["edit-mode"], {default: "new-default", custom: "wysiwyg-custom"});
});

test("edit mode keymap migration keeps an active legacy shortcut", () => {
    const keymap: Record<string, {default: string, custom: string}> = {
        preview: {default: "preview-default", custom: ""},
        wysiwyg: {default: "wysiwyg-default", custom: "wysiwyg-default"},
    };
    migrateEditModeKeymap(keymap, "new-default");
    assert.deepEqual(keymap["edit-mode"], {default: "new-default", custom: "wysiwyg-default"});
});

test("edit mode keymap migration keeps preview as the default toggle shortcut", () => {
    const keymap: Record<string, {default: string, custom: string}> = {
        preview: {default: "preview-default", custom: "preview-default"},
        wysiwyg: {default: "wysiwyg-default", custom: "wysiwyg-default"},
    };
    migrateEditModeKeymap(keymap, "preview-default");
    assert.deepEqual(keymap["edit-mode"], {default: "preview-default", custom: "preview-default"});
});

test("edit mode keymap migration preserves clearing both shortcuts", () => {
    const keymap: Record<string, {default: string, custom: string}> = {
        preview: {default: "preview-default", custom: ""},
        wysiwyg: {default: "wysiwyg-default", custom: ""},
    };
    migrateEditModeKeymap(keymap, "new-default");
    assert.deepEqual(keymap["edit-mode"], {default: "new-default", custom: ""});
});

test("edit mode keymap migration does not overwrite the merged shortcut", () => {
    const keymap: Record<string, {default: string, custom: string}> = {
        "edit-mode": {default: "new-default", custom: "merged-custom"},
        preview: {default: "preview-default", custom: "preview-custom"},
        wysiwyg: {default: "wysiwyg-default", custom: "wysiwyg-custom"},
    };
    assert.equal(migrateEditModeKeymap(keymap, "new-default"), false);
    assert.deepEqual(keymap["edit-mode"], {default: "new-default", custom: "merged-custom"});
});
