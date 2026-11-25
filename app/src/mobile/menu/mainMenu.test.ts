import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("native mobile menus list workspaces before navigation and omit the standalone Markdown entry", () => {
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
                canManageMobileWorkspaces: () => Object.keys(host).length > 0,
            }),
        });
        const html = exports.renderMobileMainMenuHTML();
        assert.deepEqual([...html.matchAll(/data-menu-group="([^"]+)"/g)].slice(0, 2).map(match => match[1]),
            ["workspaces", "navigation"]);
        assert.equal(html.includes('class="b3-menu__group fn__none" data-menu-group="workspaces"'), !Object.keys(host).length);
        assert.match(html, /id="menuManageWorkspaces"/);
        assert.doesNotMatch(html, /menuMarkdownEditor/);
        assert.equal(exports.getMobileMainMenuHandler("menuMarkdownEditor"), undefined);
        for (const id of ["menuTemplateManager", "menuCard", "menuCommand", "menuSafeQuit"]) {
            assert.ok(html.includes(`id="${id}"`));
            assert.equal(typeof exports.getMobileMainMenuHandler(id), "function");
        }
    }
});
