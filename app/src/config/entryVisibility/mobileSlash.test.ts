import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import * as catalog from "./catalog";
import * as profile from "./profile";

test("mobile slash total switch reuses existing preferences and respects candidate visibility", () => {
    const root = catalog.SLASH_MENU_ROOT_PATH;
    const storageKey = "local-mobile-slash-menu";
    const custom = {id: "custom", entries: {[root]: false, [`${root}.heading1`]: false}, orders: {}};
    const config = {active: "custom", profiles: [custom]};
    const storage: Record<string, {enabled: boolean}> = {};
    let mobile = true;
    const api = {} as typeof import("./runtime");
    runInNewContext(transpileModule(readFileSync("src/config/entryVisibility/runtime.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {
        exports: api,
        window: {siyuan: {config: {appearance: {entryVisibility: config}}, storage}},
        require: () => ({
            ...catalog, ...profile,
            Constants: {LOCAL_MOBILE_SLASH_MENU: storageKey},
            isMobile: () => mobile,
            TOOLBAR_ENTRY_ROOT_PATH: "editor.toolbar",
        }),
    });
    assert.equal(api.isEntryVisible(root), false);
    for (const active of ["simple", "full", "custom"]) {
        config.active = active;
        for (const enabled of [false, true]) {
            storage[storageKey] = {enabled};
            assert.equal(api.isEntryVisible(root), enabled);
            assert.equal(api.getConfiguredEntryVisibility(root), enabled);
            assert.equal(api.getConfiguredEntryVisibility(root, true), true);
        }
    }
    config.active = "custom";
    assert.equal(api.isEntryVisible(`${root}.heading1`), false);
    assert.equal(api.isEntryVisible(`${root}.heading2`), true);
    storage[storageKey].enabled = false;
    assert.equal(api.isEntryVisible(`${root}.heading2`), false);
    assert.equal(api.getConfiguredEntryVisibility(`${root}.heading2`, true), true);
    assert.equal(api.getConfiguredEntryVisibility(`${root}.heading1`, true), false);
    mobile = false;
    storage[storageKey].enabled = true;
    assert.equal(api.getConfiguredEntryVisibility(root), false);
    assert.equal(api.getConfiguredEntryVisibility(root, true), false);
    config.active = "full";
    storage[storageKey].enabled = false;
    assert.equal(api.getConfiguredEntryVisibility(root), true);
    assert.equal(custom.entries[root], false);
});
