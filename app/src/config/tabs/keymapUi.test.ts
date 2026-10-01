import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("panel mounts forward refresh intent without changing search and navigation arguments", async () => {
    const source = createSourceFile("builder.ts", readFileSync("src/config/setting/builder.ts", "utf8"),
        ScriptTarget.ES2021, true);
    const builder = source.statements.find(statement => isClassDeclaration(statement) && statement.name.text === "SettingBuilder");
    assert.ok(isClassDeclaration(builder));
    const method = builder.members.find(member => isMethodDeclaration(member) && member.name.getText(source) === "panel");
    assert.ok(method);
    const code = transpileModule(`export class Builder {${method.getText(source)}}`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const calls: unknown[][] = [];
    const exports = {} as {Builder: new () => {panel: (options: unknown) => {
        mount: (root: unknown, search?: {keywords: string}, app?: unknown, rebuild?: boolean) => Promise<void>;
    }}};
    runInNewContext(code, {exports});
    const panel = new exports.Builder().panel({mount: (...args: unknown[]) => { calls.push(args); }});
    const root = {};
    const app = {};
    await panel.mount(root, {keywords: "shortcut"}, app, true);
    await panel.mount(root);
    assert.deepEqual(calls, [[root, "shortcut", app, true], [root, undefined, undefined, undefined]]);
});

test("keymap refresh retains local search and untouched controls while synchronizing changed bindings", async () => {
    const source = createSourceFile("keymapUi.ts", readFileSync("src/config/tabs/keymapUi.ts", "utf8"),
        ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === "mountKeymapTab"));
    assert.ok(declaration);
    const code = transpileModule(declaration.getText(source), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const unchanged = {dataset: {key: "general|first", keys: '["F9"]'}, controls: {}};
    const changed = {dataset: {key: "general|second", keys: '["F10"]'}, controls: {}};
    const controls = unchanged.controls;
    const search = {value: "Go to tab #5"};
    const hotkey = {value: "F9", dataset: {keymap: "F9"}};
    const list = {dataset: {keymapFilter: "customized"}};
    const root = {
        innerHTML: "existing panel",
        querySelectorAll: () => [unchanged, changed],
        querySelector: (selector: string) => selector === "#keymapInput" ? search :
            selector === "#searchByKey" ? hotkey : list,
    };
    let refreshed = 0;
    let resets = 0;
    const exports = {} as {mountKeymapTab: (root: unknown, keywords: undefined, app: undefined, rebuild: boolean) => Promise<void>};
    runInNewContext(code, {exports, Constants: {ZWSP: "|"},
        window: {siyuan: {config: {keymap: {first: ["F9"], second: ["F11"]}}}},
        getKeymapItem: (config: Record<string, string[]>, path: string[]) => config[path[1]],
        getKeymapBindings: (keys: string[]) => keys,
        renderRowBindings: (row: typeof unchanged, keys: string[]) => {
            row.dataset.keys = JSON.stringify(keys);
            row.controls = {};
        },
        refreshKeymapBindings: () => { refreshed++; },
        resetKeymapList: () => { resets++; },
    });
    for (let i = 0; i < 2; i++) {
        await exports.mountKeymapTab(root, undefined, undefined, true);
        assert.equal(search.value, "Go to tab #5");
        assert.equal(hotkey.value, "F9");
        assert.equal(hotkey.dataset.keymap, "F9");
        assert.equal(list.dataset.keymapFilter, "customized");
        assert.equal(unchanged.controls, controls);
        assert.equal(changed.dataset.keys, '["F11"]');
    }
    assert.equal(refreshed, 2);
    assert.equal(resets, 0);
    await exports.mountKeymapTab(root, undefined, undefined, false);
    assert.equal(search.value, "");
    assert.equal(hotkey.value, "");
    assert.equal(resets, 1);
});
