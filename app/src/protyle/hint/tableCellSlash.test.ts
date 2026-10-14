import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isVariableDeclaration, ScriptTarget, transpileModule} from "typescript";
import {TABLE_CELL_SLASH_IDS} from "../util/tableCellRichMenu";
import {registerBuiltinSlashHint} from "./builtinSlash";
import {resolveSlashMenuItems} from "./slashMenu";

const Constants = {ZWSP: "\u200b"};

const getInitializer = (file: string, name: string) => {
    const source = createSourceFile(file, readFileSync(join(__dirname, file), "utf8"), ScriptTarget.Latest);
    let initializer: string;
    const visit = (node: import("typescript").Node) => {
        if (isVariableDeclaration(node) && node.name.getText(source) === name) {
            initializer = node.initializer.getText(source);
        }
        forEachChild(node, visit);
    };
    visit(source);
    assert.ok(initializer);
    return transpileModule(`(${initializer});`, {compilerOptions: {target: ScriptTarget.ES2020}}).outputText;
};

const hotkeys = new Proxy({}, {get: () => ({custom: ""})});
const builtinItems = runInNewContext(getInitializer("extend.ts", "getBuiltinSlashMenuItems"), {
    Constants,
    Lute: {Caret: "caret"},
    window: {siyuan: {
        languages: new Proxy({}, {get: (_target, key) => key === "currentTime" ? "Current Time" : String(key)}),
        config: {keymap: {editor: new Proxy({}, {get: () => hotkeys})}},
    }},
    getHostCapabilities: () => ({widgets: false, remoteKernel: false}),
    isDisabledFeature: () => false, updateHotkeyTip: (value: string) => value,
    getHotkeyOrMarker: () => "", getSuperBlockCommand: (layout: string) => layout,
    getBuiltinStyleCSS: () => "", getBuiltinStyleLabel: (id: string) => id,
    getBuiltinInlineStylePreview: () => ({color: "", backgroundColor: ""}),
}) as typeof import("./extend").getBuiltinSlashMenuItems;
const hintSource = getInitializer("extend.ts", "hintSlash");
const safeSlashSource = getInitializer("../render/tableCellRichEditor.ts", "safeSlash");

for (const lite of [false, true]) {
    for (const richEditor of [false, true]) {
        test(`current time remains available in ${lite ? "lite" : "full"} ${richEditor ? "rich" : "inline"} table cells`, () => {
            const root = {};
            class FocusElement {
                closest() {
                    return richEditor ? null : {closest: () => root};
                }
            }
            let visible = true;
            const protyle = {
                lite, hint: {element: {closest: (): null => null}}, options: {upload: {}}, wysiwyg: {element: root},
            };
            const hintSlash = runInNewContext(hintSource, {
                registerBuiltinSlashHint, getBuiltinSlashMenuItems: builtinItems,
                SLASH_MENU_ROOT_PATH: "slash", slashBuiltinStyleIDs: {},
                getConfiguredEntryVisibility: () => visible,
                getEntryCatalogNode: () => ({}), getSlashMenuEntryPath: (id: string) => id,
                getEntryOrder: (): string[] => [], refreshSlashMenuCatalog() {},
                areProtylePluginExtensionsEnabled: () => false,
                Element: FocusElement, getSelection: () => ({focusNode: new FocusElement()}),
                TABLE_CELL_SLASH_IDS, resolveSlashMenuItems,
            }) as typeof import("./extend").hintSlash;
            const hint = richEditor ? runInNewContext(safeSlashSource, {
                registerBuiltinSlashHint, hintSlash, TABLE_CELL_SLASH_IDS,
            }) as typeof hintSlash : hintSlash;
            for (const alias of ["time", "now", "current time", "当前时间", "dangqianshijian", "dqsj"]) {
                const items = hint(alias, protyle as unknown as IProtyle, "hint");
                const time = items.find(item => item.id === "currentTime");
                assert.ok(time, alias);
                assert.equal(time.value, Constants.ZWSP + 7);
            }
            assert.ok(hint("", protyle as unknown as IProtyle, "hint").every(item => TABLE_CELL_SLASH_IDS.has(item.id)));
            visible = false;
            assert.equal(hint("time", protyle as unknown as IProtyle, "hint").length, 0);
        });
    }
}
