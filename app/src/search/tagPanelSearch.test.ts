import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const load = <T>(file: string, modules: Record<string, unknown>, window: unknown): T => {
    const exports = {};
    const source = readFileSync(join(__dirname, file), "utf8");
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, require: (id: string) => modules[id] || {}, window, HTMLElement: class {}, location: {port: "6806"}});
    return exports as T;
};

test("desktop tag clicks use global search and preserve modifier matching", () => {
    const window = {siyuan: {
        config: {keymap: {editor: {general: {expand: {}, collapse: {}}}, general: {closeTab: {}}},
            fileTree: {noSplitScreenWhenOpenTab: true}},
        ctrlIsPressed: false,
        languages: {tag: "Tag", search: "Search"},
        storage: {search: {k: "old", method: 2}},
    }};
    let searchOptions: IOpenFileOptions;
    const updates: [string, boolean][] = [];
    let tabCount = 0;
    const headElement = {};
    let activeHead: object;
    const searchModels: {config: object; parent: object; updateSearch: (text: string, replace: boolean) => void}[] = [];
    const {openGlobalSearch} = load<typeof import("./util")>("util.ts", {
        "../constants": {Constants: {LOCAL_SEARCHDATA: "search"}},
        "../layout/getAll": {getAllModels: () => ({search: searchModels, editor: [] as never[]})},
        "../editor/util": {openFile: (options: IOpenFileOptions) => {
            searchOptions = options;
            tabCount++;
            searchModels.push({
                config: options.searchData,
                parent: {headElement, parent: {switchTab: (head: object) => { activeHead = head; }}},
                updateSearch: (text, replace) => updates.push([text, replace]),
            });
        }},
    }, window);
    const {newTab} = load<typeof import("../editor/util")>("../editor/util.ts", {
        "../layout/Tab": {Tab: class { constructor(public options: unknown) {} }},
    }, window);
    let clickTag: (label: string) => void;
    const {Tag} = load<typeof import("../layout/dock/Tag")>("../layout/dock/Tag.ts", {
        "../Model": {Model: class { public connect() {} }},
        "./TagTree": {TagTree: class {
            constructor(options: {open: typeof clickTag}) { clickTag = options.open; }
            public update() {}
        }},
        "./panelSearch": {bindPanelSearch() {}},
        "../../protyle/util/compatibility": {updateHotkeyAfterTip: () => ""},
        "../../search/util": {openGlobalSearch},
    }, window);
    const control = {addEventListener() {}};
    const tab = {panelElement: {...control, classList: {add() {}}, querySelector: () => control}};
    const app = {} as Parameters<typeof openGlobalSearch>[0];
    new Tag(app, tab as unknown as ConstructorParameters<typeof Tag>[1]);

    clickTag("first");
    assert.equal(tabCount, 1);
    assert.equal(searchOptions.searchData.k, "#first#");
    assert.equal(searchOptions.searchData.method, 0);
    assert.equal("tagPanel" in searchOptions, false);
    const created = newTab(searchOptions) as unknown as {options: {title: string; icon: string}};
    assert.equal(created.options.title, "Search");
    assert.equal(created.options.icon, "iconSearch");
    clickTag("second");
    window.siyuan.ctrlIsPressed = true;
    clickTag("third");
    assert.deepEqual(updates, [["#second#", true], ["#third#", false]]);
    assert.equal(activeHead, headElement);
    assert.equal(tabCount, 1);
});

test("a saved Alpha 2 tag search restores as ordinary search without losing the query", () => {
    const headElement = {classList: {add() {}}, querySelector: () => ({classList: {add() {}}})};
    class Tab {
        public headElement = headElement;
        public model: unknown;
        constructor(public options: {title: string; icon: string}) {}
        public addModel(model: unknown) { this.model = model; }
    }
    const {JSONToCenter} = load<typeof import("../layout/util")>("../layout/util.ts", {
        "./Tab": {Tab},
        "../search": {Search: class { constructor(public options: unknown) {} }},
        "../protyle/util/compatibility": {isSensitiveLayoutData: () => false},
    }, {siyuan: {languages: {search: "Search"}}});
    let restored: Tab;
    const wnd = {addTab(tab: Tab) { restored = tab; }};
    const config = {k: "#saved#"};
    const saved = {instance: "Tab", title: "Tag", icon: "iconTag",
        children: {instance: "Search", tagPanel: true, config}};
    JSONToCenter({} as Parameters<typeof JSONToCenter>[0], saved as Parameters<typeof JSONToCenter>[1],
        wnd as unknown as Parameters<typeof JSONToCenter>[2]);
    assert.equal(restored.options.title, "Search");
    assert.equal(restored.options.icon, "iconSearch");
    const search = restored.model as {options: {config: typeof config}};
    assert.equal(search.options.config, config);
    assert.equal("tagPanel" in search.options, false);
});
