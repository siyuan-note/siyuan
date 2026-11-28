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
            getMobileMainMenuHandler: (id: string) => (app: object) => void;
        };
        const flashcards: string[] = [];
        const actions = {
            openCard: () => flashcards.push("review"),
            openFlashcardV2Management: () => flashcards.push("manage"),
            openFlashcardV2ReviewSets: () => flashcards.push("decks"),
            openFlashcardV2Presets: () => flashcards.push("presets"),
            openFlashcardV2Statistics: () => flashcards.push("statistics"),
            openFlashcardV2AnkiPreview: () => flashcards.push("anki"),
        };
        const flashcardModule = {};
        runInNewContext(transpileModule(readFileSync("src/card/flashcardMenu.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS},
        }).outputText, {exports: flashcardModule, require: () => actions});
        runInNewContext(compiled, {
            exports,
            window: {...host, siyuan: {
                languages: new Proxy({}, {get: (_target, key) => key}),
                config: {readonly: false, lang: "en_US"},
            }},
            require: (name: string) => name === "../../card/flashcardMenu" ? flashcardModule : ({
                isDisabledFeature: () => false,
                isInMobileApp: () => true,
                getHostCapabilities: () => ({importExport: true}),
                getSettingTabDefs: (): never[] => [],
                escapeAttr: (value: string) => value,
                canManageMobileWorkspaces: () => Object.keys(host).length > 0,
                closePanel: () => {},
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
        assert.match(html, /data-menu-group="flashcards"/);
        for (const id of ["menuCard", "menuFlashcards-manage", "menuFlashcards-reviewSets",
            "menuFlashcards-presets", "menuFlashcards-statistics", "menuFlashcards-anki"]) {
            assert.ok(html.includes(`id="${id}"`));
            exports.getMobileMainMenuHandler(id)({});
        }
        assert.deepEqual(flashcards, ["review", "manage", "decks", "presets", "statistics", "anki"]);
    }
});
