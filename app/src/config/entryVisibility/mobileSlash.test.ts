import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as catalog from "./catalog";
import * as profile from "./profile";
import {resolveSlashMenuItems} from "../../protyle/hint/slashMenu";

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
        const source = createSourceFile("extend.ts", readFileSync("src/protyle/hint/extend.ts", "utf8"), ScriptTarget.Latest, true);
        const declaration = source.statements.find(statement => isVariableStatement(statement) &&
            statement.declarationList.declarations.some(item => item.name.getText(source) === "hintSlash"));
        const candidates = ["heading1", "heading2", "code", "newFileRef", "separator_6"].map(id => ({
            id, value: id, html: id === "separator_6" ? "separator" : id,
        }));
        const dependencies = {...catalog, resolveSlashMenuItems,
            registerBuiltinSlashHint: (callback: unknown) => callback,
            getConfiguredEntryVisibility: api.getConfiguredEntryVisibility,
            getEntryOrder: (): string[] => [], getBuiltinSlashMenuItems: () => candidates,
            areProtylePluginExtensionsEnabled: () => false,
            getSelection: (): undefined => undefined, Element: class {}, slashBuiltinStyleIDs: {},
        };
        const hintSlash = new Function(...Object.keys(dependencies),
            transpileModule(declaration.getText(source).replace(/^export /, ""), {
                compilerOptions: {target: ScriptTarget.ES2021},
            }).outputText + "\nreturn hintSlash;")(...Object.values(dependencies));
        const editor = {lite: true, hint: {element: {closest: (): unknown => null}},
            options: {upload: {}}, wysiwyg: {element: {}}};
        for (const mobile of [false, true]) {
            runtimeWindow.siyuan.mobile = mobile ? {} : undefined;
            for (const visible of [false, true]) {
                custom.entries["editor.image.ocrText"] = visible;
                assert.equal(api.isEntryVisible("editor.image.ocrText"), visible);
            }
            delete custom.entries["editor.image.ocrText"];
            assert.equal(catalog.getEntryCatalogDefaultVisibility(root), !mobile);
            assert.equal(catalog.getEntryCatalogCustomDefaultVisibility(root), !mobile);
            for (const active of ["simple", "full", "custom"]) {
                config.active = active;
                for (const legacy of [false, true]) {
                    runtimeWindow.siyuan.storage["local-mobile-slash-menu"].enabled = legacy;
                    assert.equal(api.isEntryVisible(root), !mobile);
                    assert.equal(api.getConfiguredEntryVisibility(`${root}.heading1`), !mobile);
                    assert.equal(api.getConfiguredEntryVisibility(`${root}.heading1`, root), true);
                    editor.hint.element.closest = () => null;
                    assert.equal(hintSlash("", editor).some((item: IHintData) => item.id === "heading1"), !mobile);
                    editor.hint.element.closest = () => ({});
                    const items: IHintData[] = hintSlash("", editor);
                    assert.ok(items.some(item => item.id === "heading1"));
                    assert.equal(items.some(item => item.id === "newFileRef"), false);
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
                assert.equal(api.getConfiguredEntryVisibility(`${root}.heading2`, root), true);
            }
            custom.entries[root] = true;
            custom.entries[`${root}.heading1`] = false;
            assert.equal(api.isEntryVisible(`${root}.heading1`), false);
            assert.equal(api.isEntryVisible(`${root}.heading2`), true);
            custom.entries[root] = false;
            assert.equal(api.getConfiguredEntryVisibility(`${root}.heading1`, root), false);
            assert.equal(api.getConfiguredEntryVisibility(`${root}.heading2`, root), true);
            const items: IHintData[] = hintSlash("", editor);
            assert.equal(items.some(item => item.id === "heading1"), false);
            assert.ok(items.some(item => item.id === "heading2"));
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
