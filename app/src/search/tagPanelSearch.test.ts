import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("tag panel reuses its own search tab and keeps ordinary search independent", async () => {
    const defaults = {k: "previous", method: 2, idPath: ["notebook/document.sy"], page: 3};
    const searchTabs: TestTab[] = [];
    let activeTab: TestTab;
    let openRequest: Promise<unknown>;
    let otherWindowRequests = 0;
    const window = {
        siyuan: {
            config: {fileTree: {openFilesUseCurrentTab: true, noSplitScreenWhenOpenTab: true}},
            layout: {centerLayout: {children: [] as TestTab[]}},
            languages: {tag: "Tag", search: "Search"},
            storage: {search: defaults},
        },
    };
    const wnd = {
        element: {},
        children: searchTabs,
        addTab(tab: TestTab) {
            searchTabs.push(tab);
            activeTab = tab;
            tab.parent = wnd;
            tab.options.callback(tab);
        },
        switchTab(tab: TestTab) {
            activeTab = tab;
        },
        showHeading() {},
        removeTab() {
            assert.fail("Opening a tag search removed an existing tab");
        },
    };
    class TestTab {
        model: {tagPanel: boolean; config: Config.IUILayoutTabSearchConfig};
        parent = wnd;
        headElement = this;
        panelElement = {parentElement: {}, addEventListener() {}};
        private readonly classes = new Set<string>();
        classList = {
            add: (name: string) => this.classes.add(name),
            contains: (name: string) => name === "item--focus" ? activeTab === this : this.classes.has(name),
        };

        constructor(public readonly options: {title: string; icon: string; callback: (tab: TestTab) => void}) {}

        addModel(model: typeof this.model) {
            this.model = model;
            Object.assign(model, {parent: this});
        }
    }
    const getAllModels = () => ({search: searchTabs.map(tab => tab.model), editor: [] as never[]});
    const load = <T>(file: string, modules: Record<string, unknown>): T => {
        const exports = {};
        const source = readFileSync(join(__dirname, file), "utf8");
        const code = transpileModule(source, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText;
        runInNewContext(code, {
            exports,
            require: (id: string) => modules[id] || {},
            window,
            HTMLElement: class {},
            location: {port: "6806"},
            document: {activeElement: null, querySelectorAll: (): [] => [], querySelector: (): null => null},
        });
        return exports as T;
    };
    const {Search} = load<typeof import("./index")>("index.ts", {
        "../layout/Model": {Model: class {}},
        "./util": {
            genSearch: () => ({edit: {}}),
            updateConfig: (_element: unknown, next: Config.IUILayoutTabSearchConfig, current: Config.IUILayoutTabSearchConfig) => {
                Object.assign(current, next);
            },
        },
    });
    const editor = load<typeof import("../editor/util")>("../editor/util.ts", {
        "../layout/Tab": {Tab: TestTab},
        "../layout/getAll": {getAllModels},
        "../layout/util": {pdfIsLoading: () => false, getWndByLayout: () => wnd, setPanelFocus() {}},
        "../layout/dock/util": {clearOBG() {}},
        "../util/functions": {objEquals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)},
        "../search": {Search},
        "../constants": {Constants: {}},
        electron: {ipcRenderer: {invoke: async () => { otherWindowRequests++; return false; }}},
        "./openFileWindow": {shouldCheckOtherWindows: () => true},
    });
    const {openGlobalSearch} = load<typeof import("./util")>("util.ts", {
        "../constants": {Constants: {LOCAL_SEARCHDATA: "search"}},
        "../layout/getAll": {getAllModels},
        "../editor/util": {openFile: (options: IOpenFileOptions) => { openRequest = editor.openFile(options); }},
    });
    const app = {} as Parameters<typeof openGlobalSearch>[0];
    const ordinary = new TestTab({title: "Search", icon: "iconSearch", callback: () => {
        const search = new Search({app, tab: ordinary as unknown as ConstructorParameters<typeof Search>[0]["tab"],
            config: structuredClone(defaults)});
        search.updateSearch = (text, replace) => {
            assert.equal(replace, false);
            search.config.k += " " + text;
        };
        ordinary.addModel(search);
    }});
    wnd.addTab(ordinary);

    openGlobalSearch(app, "#first#", false, {method: 0, tagPanel: true});
    const firstOpen = openRequest;
    const tag = activeTab;
    tag.model.config.method = 3;
    tag.model.config.idPath = ["another-notebook"];
    tag.model.config.page = 4;
    openGlobalSearch(app, "#second#", false, {method: 0, tagPanel: true});
    await Promise.all([firstOpen, openRequest]);

    assert.deepEqual(searchTabs, [ordinary, tag]);
    assert.equal(otherWindowRequests, 0);
    assert.equal(activeTab, tag);
    assert.equal(tag.options.title, "Tag");
    assert.equal(tag.options.icon, "iconTag");
    assert.equal(tag.classList.contains("item--unupdate"), false);
    assert.equal(tag.model.config.k, "#second#");
    assert.equal(tag.model.config.method, 0);
    assert.equal(tag.model.config.idPath.length, 0);
    assert.equal(tag.model.config.page, 1);
    assert.deepEqual(ordinary.model.config, defaults);
    assert.equal(window.siyuan.storage.search, defaults);

    searchTabs.reverse();
    openGlobalSearch(app, "#second#", false, {method: 0});
    assert.equal(activeTab, ordinary);
    assert.equal(ordinary.model.config.k, "previous #second#");
    assert.equal(tag.model.config.k, "#second#");
});
