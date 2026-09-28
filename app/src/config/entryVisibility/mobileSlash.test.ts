import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import * as catalog from "./catalog";
import * as profile from "./profile";

test("slash visibility shares profile settings and only platform defaults differ", () => {
    const root = catalog.SLASH_MENU_ROOT_PATH;
    const custom = {id: "custom", entries: {} as Record<string, boolean>, orders: {}};
    const config = {active: "custom", profiles: [custom]};
    const runtimeWindow = {siyuan: {mobile: undefined as object | undefined,
        config: {appearance: {entryVisibility: config}}, storage: {"local-mobile-slash-menu": {enabled: true}}}};
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {configurable: true, value: runtimeWindow});
    try {
        const api = {} as typeof import("./runtime");
        runInNewContext(transpileModule(readFileSync("src/config/entryVisibility/runtime.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS},
        }).outputText, {
            exports: api,
            window: runtimeWindow,
            require: () => ({...catalog, ...profile, TOOLBAR_ENTRY_ROOT_PATH: "editor.toolbar"}),
        });
        for (const mobile of [false, true]) {
            runtimeWindow.siyuan.mobile = mobile ? {} : undefined;
            assert.equal(catalog.getEntryCatalogDefaultVisibility(root), !mobile);
            assert.equal(catalog.getEntryCatalogCustomDefaultVisibility(root), !mobile);
            for (const active of ["simple", "full", "custom"]) {
                config.active = active;
                for (const legacy of [false, true]) {
                    runtimeWindow.siyuan.storage["local-mobile-slash-menu"].enabled = legacy;
                    assert.equal(api.isEntryVisible(root), !mobile);
                    assert.equal(api.getConfiguredEntryVisibility(`${root}.heading1`), !mobile);
                }
            }
            for (const template of ["simple", "full"] as const) {
                assert.equal(api.createEntryProfileSnapshot(template)[root], !mobile);
            }
            config.active = "custom";
            for (const enabled of [true, false]) {
                custom.entries[root] = enabled;
                assert.equal(api.isEntryVisible(root), enabled);
                assert.equal(api.getConfiguredEntryVisibility(`${root}.heading2`), enabled);
            }
            custom.entries[root] = true;
            custom.entries[`${root}.heading1`] = false;
            assert.equal(api.isEntryVisible(`${root}.heading1`), false);
            assert.equal(api.isEntryVisible(`${root}.heading2`), true);
            custom.entries = {};
        }
        config.active = "custom";
        custom.entries[root] = true;
        runtimeWindow.siyuan.mobile = undefined;
        assert.equal(api.getConfiguredEntryVisibility(root), true);
        runtimeWindow.siyuan.mobile = {};
        assert.equal(api.getConfiguredEntryVisibility(root), true);
        custom.entries[root] = false;
        runtimeWindow.siyuan.mobile = undefined;
        assert.equal(api.getConfiguredEntryVisibility(root), false);
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, "window", descriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});
