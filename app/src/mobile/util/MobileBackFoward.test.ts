import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule, ModuleKind, ScriptTarget} from "typescript";
import {isAbove} from "../../util/zIndex";

test("mobile back saves the database text editor before leaving its owner", () => {
    const source = transpileModule(readFileSync(join(__dirname, "MobileBackFoward.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText;
    for (const overlay of ["document", "row", "dialog", "menu"]) {
        let saved = 0;
        let closedDialog = 0;
        let closedMenu = 0;
        let navigated = 0;
        const richText = {style: {zIndex: "2"}};
        const menu = {classList: {contains: (name: string) =>
            name === "fn__none" ? overlay !== "menu" : true},
        dispatchEvent: () => closedMenu++};
        const dialogs = overlay === "document" || overlay === "menu" ? [] : [{
            element: {querySelector: () => ({style: {zIndex: overlay === "dialog" ? "3" : "1"}})},
            destroy: () => closedDialog++,
        }];
        const modules: Record<string, unknown> = {
            "../editor": {getCurrentEditor: (): undefined => undefined},
            "../../protyle/render/av/richTextEditor": {destroyAVRichTextEditor: (save: boolean) => {
                assert.equal(save, true);
                saved++;
            }},
            "../../util/zIndex": {isAbove},
            "./nativeSelect": {getMobileSelectMenuElement: (): undefined => undefined},
        };
        const api = {} as typeof import("./MobileBackFoward");
        runInNewContext(source, {
            exports: api, require: (name: string) => modules[name] || {}, CustomEvent: class {},
            document: {getElementById: () => ({style: {}}), querySelector: () => richText},
            window: {siyuan: {dialogs, menus: {menu: {element: menu}}, mobile: {
                tabs: {goBack: () => { navigated++; return Promise.resolve(true); }},
            }}},
        });
        api.goBack();
        assert.equal(saved, overlay === "document" || overlay === "row" ? 1 : 0);
        assert.equal(closedDialog, overlay === "dialog" ? 1 : 0);
        assert.equal(closedMenu, overlay === "menu" ? 1 : 0);
        assert.equal(navigated, 0);
    }
});

test("mobile back closes a select menu before its containing menu or dialog", () => {
    const source = transpileModule(readFileSync(join(__dirname, "MobileBackFoward.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText;
    let closedSelect = 0;
    let closedOwner = 0;
    const selectMenu = {style: {zIndex: "3"}, dispatchEvent: () => closedSelect++};
    const ownerMenu = {classList: {contains: (name: string) => name !== "fn__none"},
        dispatchEvent: () => closedOwner++};
    const api = {} as typeof import("./MobileBackFoward");
    const modules: Record<string, unknown> = {
        "../editor": {getCurrentEditor: (): undefined => undefined},
        "../../util/zIndex": {isAbove},
        "./nativeSelect": {getMobileSelectMenuElement: () => selectMenu},
    };
    runInNewContext(source, {
        exports: api, require: (name: string) => modules[name] || {}, CustomEvent: class {},
        document: {getElementById: () => ({style: {}}), querySelector: (): undefined => undefined},
        window: {siyuan: {menus: {menu: {element: ownerMenu}}, dialogs: [{
            element: {querySelector: () => ({style: {zIndex: "2"}})}, destroy: () => closedOwner++,
        }]}},
    });
    api.goBack();
    assert.equal(closedSelect, 1);
    assert.equal(closedOwner, 0);
});
