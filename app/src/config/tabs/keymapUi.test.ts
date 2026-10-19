import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isClassDeclaration, isMethodDeclaration, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {CALLOUT_PRESETS} from "../../protyle/wysiwyg/calloutType";

test("binding refresh hides an empty conflict filter and returns to all bindings", () => {
    const source = createSourceFile("keymapUi.ts", readFileSync("src/config/tabs/keymapUi.ts", "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === "refreshKeymapBindings"));
    const code = transpileModule(declaration.getText(source) + "\nexports.refresh = refreshKeymapBindings;", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const reset = {style: {display: ""}, tabIndex: 0};
    let keys = ["F9"];
    const row = {dataset: {key: "general|test", defaults: '["F9"]', customized: "false", conflict: "true"},
        querySelector: () => ({querySelector: () => reset}), querySelectorAll: (): unknown[] => []};
    const hidden = new Map<string, boolean>();
    const filter = {dataset: {keymapFilterValue: "conflict"}, classList: {
        toggle: (name: string, value: boolean) => hidden.set(name, value),
    }, setAttribute: () => {}};
    let hasConflict = false;
    const list = {dataset: {keymapFilter: "conflict"}, querySelector: () => hasConflict ? row : undefined,
        querySelectorAll: () => [filter]};
    const root = {querySelectorAll: () => [row], querySelector: () => list};
    let searches = 0;
    const exports = {} as {refresh: (root: unknown) => void};
    runInNewContext(code, {exports, Constants: {ZWSP: "|"}, window: {siyuan: {config: {keymap: {}}}},
        getRowBindings: () => keys, normalizeShortcutKey: (key: string) => key, isMac: () => false,
        getKeymapItem: () => ({}), searchKeymapList: () => { searches++; },
    });
    for (const updated of [[], ["F10"], ["F9"]]) {
        list.dataset.keymapFilter = "conflict";
        keys = updated;
        exports.refresh(root);
        assert.equal(list.dataset.keymapFilter, "all");
        assert.equal(hidden.get("fn__none"), true);
        assert.equal(row.dataset.conflict, "false");
    }
    assert.equal(searches, 0);
    assert.equal(row.dataset.customized, "false");
    hasConflict = true;
    list.dataset.keymapFilter = "conflict";
    exports.refresh(root);
    assert.equal(list.dataset.keymapFilter, "conflict");
    assert.equal(hidden.get("fn__none"), false);
    hasConflict = false;
    list.dataset.keymapFilter = "customized";
    exports.refresh(root);
    assert.equal(list.dataset.keymapFilter, "customized");
    assert.equal(hidden.get("fn__none"), true);
});

test("editing, deleting and resetting a binding immediately reapplies the current text and shortcut filters", () => {
    const source = createSourceFile("keymapUi.ts", readFileSync("src/config/tabs/keymapUi.ts", "utf8"), ScriptTarget.ES2021, true);
    let declaration: string;
    const visit = (node: import("typescript").Node) => {
        if (isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === "saveRow")) {
            declaration = node.getText(source);
        }
        forEachChild(node, visit);
    };
    visit(source);
    assert.ok(declaration);
    const code = transpileModule(declaration + "\nexports.save = saveRow;", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const root = {};
    const list = {dataset: {keymapFilter: "customized"}};
    const search = {value: "Go to tab #5"};
    const shortcut = {dataset: {keymap: "⌘5"}};
    const row = {dataset: {key: "general|test"}};
    const calls: unknown[][] = [];
    const item = {bindings: {priority: 3}};
    const exports = {} as {save: (row: unknown, keys: string[], reset?: boolean) => void};
    runInNewContext(code, {exports, root, keymapListElement: list, searchElement: search, searchKeymapElement: shortcut,
        Constants: {ZWSP: "|"}, getKeymapItem: () => item,
        renderRowBindings: (...args: unknown[]) => calls.push(["render", ...args]),
        saveKeymapRow: (_root: unknown, _row: unknown, keys: string[], change?: (data: unknown) => void) => {
            calls.push(["save", keys]);
            change?.({});
        },
        refreshBindings: () => calls.push(["refresh"]),
        searchKeymapList: (...args: unknown[]) => calls.push(["search", ...args]),
    });
    for (const [keys, reset] of [[["F10"], false], [[], false], [["⌘5"], true]] as [string[], boolean][]) {
        calls.length = 0;
        exports.save(row, keys, reset);
        assert.deepEqual(calls, [["render", row, keys], ["save", keys], ["refresh"],
            ["search", list, "Go to tab #5", "⌘5"]]);
        assert.equal(list.dataset.keymapFilter, "customized");
    }
    assert.equal(item.bindings.priority, undefined);
    delete shortcut.dataset.keymap;
    exports.save(row, ["F11"]);
    assert.deepEqual(calls.at(-1), ["search", list, "Go to tab #5", ""]);
});

test("callout shortcut rows use localized labels without requiring separate translation keys", () => {
    const source = createSourceFile("keymapUi.ts", readFileSync("src/config/tabs/keymapUi.ts", "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === "getKeymapLabel"));
    assert.ok(declaration);
    const code = transpileModule(declaration.getText(source) + "\nexports.label = getKeymapLabel;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const exports = {} as {label: (key: string) => string};
    runInNewContext(code, {exports, CALLOUT_PRESETS, window: {siyuan: {languages: {callout: "提示块", quote: "引述块"}}}});
    for (const preset of CALLOUT_PRESETS) {
        assert.equal(exports.label(preset.id), `提示块 - ${preset.title}`);
    }
    assert.equal(exports.label("quote"), "引述块");
});

test("a failed binding save reapplies filters after restoring saved bindings", async () => {
    const source = createSourceFile("keymapUi.ts", readFileSync("src/config/tabs/keymapUi.ts", "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === "saveKeymapRow"));
    assert.ok(declaration);
    const code = transpileModule(declaration.getText(source) + "\nexports.save = saveKeymapRow;", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const row = {dataset: {key: "general|test"}, keys: ["F10"]};
    const list = {dataset: {keymapFilter: "customized"}};
    const root = {querySelectorAll: () => [row], querySelector: (selector: string) =>
        selector === "#keymapList" ? list : selector === "#keymapInput" ? {value: "tab"} : {dataset: {keymap: "F9"}}};
    const calls: unknown[][] = [];
    const exports = {} as {save: (root: unknown, row: unknown, keys: string[]) => void};
    const config = {keymap: {test: {keys: ["F9"]}}};
    const context = {exports, Constants: {ZWSP: "|"}, window: {siyuan: {config, languages: {keymapSaveFailed: "failed"}}},
        savedKeymap: undefined as typeof config.keymap | undefined, keymapRevision: 0, keymapSaveQueue: Promise.resolve(),
        getKeymapItem: (data: typeof config.keymap) => data.test,
        getKeymapBindings: (item: {keys: string[]}) => item.keys,
        setKeymapBindings: (item: {keys: string[]}, keys: string[]) => { item.keys = keys; },
        applyKeymap: (data: typeof config.keymap) => { config.keymap = data; },
        keymapRowPatch: () => ({}),
        configApi: {set: async () => { throw new Error("save rejected"); }},
        trackSettingSave: (promise: Promise<void>) => promise,
        renderRowBindings: (element: typeof row, keys: string[]) => { element.keys = keys; },
        refreshKeymapBindings: () => calls.push(["refresh", [...row.keys]]),
        searchKeymapList: (...args: unknown[]) => calls.push(["search", ...args]),
        showMessage: (message: string) => calls.push(["message", message]), console: {error() {}},
    };
    runInNewContext(code, context);
    exports.save(root, row, ["F10"]);
    await context.keymapSaveQueue;
    assert.deepEqual([...row.keys], ["F9"]);
    assert.deepEqual(calls, [["refresh", ["F9"]], ["search", list, "tab", "F9"], ["message", "failed"]]);
});

test("settings keymap search keeps undeclared owner plugins visible", () => {
    const source = createSourceFile("keymapUi.ts", readFileSync("src/config/tabs/keymapUi.ts", "utf8"), ScriptTarget.ES2021, true);
    const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => ["buildKeymapPluginDisplayNames", "pluginHasKeymapItems"].includes(item.name.getText(source))));
    const code = transpileModule(declarations.map(item => item.getText(source)).join("\n") +
        "\nexports.names = buildKeymapPluginDisplayNames;", {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const owner = {plugins: [{displayName: "Main-only plugin", commands: [{}]}]};
    const exports = {} as {names: () => string[]};
    runInNewContext(code, {exports, getSettingsOwnerApp: () => owner, window: {siyuan: {ws: {app: {plugins: []}}}}});
    assert.deepEqual(Array.from(exports.names()), ["Main-only plugin"]);
});

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
    const searches: unknown[][] = [];
    const exports = {} as {mountKeymapTab: (root: unknown, keywords: undefined, app: undefined, rebuild: boolean) => Promise<void>};
    runInNewContext(code, {exports, Constants: {ZWSP: "|"},
        window: {siyuan: {config: {keymap: {first: ["F9"], second: ["F11"]}}}},
        getKeymapItem: (config: Record<string, string[]>, path: string[]) => config[path[1]],
        getKeymapBindings: (keys: string[]) => keys,
        renderRowBindings: (row: typeof unchanged, keys: string[]) => {
            row.dataset.keys = JSON.stringify(keys);
            row.controls = {};
        },
        refreshKeymapBindings: () => {
            refreshed++;
            if (list.dataset.keymapFilter === "conflict") list.dataset.keymapFilter = "all";
        },
        searchKeymapList: (...args: unknown[]) => searches.push([list.dataset.keymapFilter, ...args]),
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
    assert.deepEqual(searches, [
        ["customized", list, "Go to tab #5", "F9"],
        ["customized", list, "Go to tab #5", "F9"],
    ]);
    list.dataset.keymapFilter = "conflict";
    await exports.mountKeymapTab(root, undefined, undefined, true);
    assert.equal(list.dataset.keymapFilter, "all");
    assert.deepEqual(searches.at(-1), ["all", list, "Go to tab #5", "F9"]);
    await exports.mountKeymapTab(root, undefined, undefined, false);
    assert.equal(search.value, "");
    assert.equal(hotkey.value, "");
    assert.equal(resets, 1);
});
