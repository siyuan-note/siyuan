import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("mobile main menus omit the standalone Markdown entry even when native bridges are available", () => {
    const compiled = transpileModule(readFileSync("src/mobile/menu/mainMenu.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const unexpectedOpen = () => assert.fail("The main menu must not launch the Markdown editor");
    for (const host of [{}, {JSAndroid: {openMarkdownEditor: unexpectedOpen}},
        {JSHarmony: {openMarkdownEditor: unexpectedOpen}},
        {webkit: {messageHandlers: {openMarkdownEditor: {postMessage: unexpectedOpen}}}}]) {
        const exports = {} as {
            renderMobileMainMenuHTML: () => string;
            getMobileMainMenuHandler: (id: string) => unknown;
        };
        runInNewContext(compiled, {
            exports,
            window: {...host, siyuan: {
                languages: new Proxy({}, {get: (_target, key) => key}),
                config: {readonly: false, lang: "en_US"},
            }},
            require: () => ({
                isDisabledFeature: () => false,
                isInMobileApp: () => true,
                getHostCapabilities: () => ({importExport: true}),
                getSettingTabDefs: (): never[] => [],
                escapeAttr: (value: string) => value,
            }),
        });
        const html = exports.renderMobileMainMenuHTML();
        assert.doesNotMatch(html, /menuMarkdownEditor/);
        assert.equal(exports.getMobileMainMenuHandler("menuMarkdownEditor"), undefined);
        for (const id of ["menuTemplateManager", "menuCard", "menuCommand", "menuSafeQuit"]) {
            assert.ok(html.includes(`id="${id}"`));
            assert.equal(typeof exports.getMobileMainMenuHandler(id), "function");
        }
    }
});
