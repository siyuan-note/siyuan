import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IDatabaseRowOpenData} from "./openDatabaseRow";

const {parse} = require("ifdef-loader/preprocessor");
const compile = (source: string) => transpileModule(source, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const utilSource = createSourceFile("util.ts", readFileSync("src/editor/util.ts", "utf8"), ScriptTarget.ES2021, true);
const utilCode = compile(utilSource.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => ["openFile", "isSameCustomTab", "getUnInitTab"]
        .includes(item.name.getText(utilSource)))).map(statement => statement.getText(utilSource)).join("\n"));
const rowCode = compile(parse(readFileSync("src/protyle/render/av/openDatabaseRow.ts", "utf8"),
    {MOBILE: false, BROWSER: true}, false, true));

// 执行条目入口和通用页签查找，覆盖已加载及布局恢复后尚未初始化的预览。
const setup = (restored = false) => {
    let created = 0;
    let switched = 0;
    interface TestPane {
        children: {headElement: object}[];
        parent: {children: unknown[]};
        element: {getAttribute(): string};
        split(): TestPane;
        addTab(): void;
        showHeading(): void;
        switchTab(head: TestTab["headElement"]): void;
    }
    interface TestTab {
        parent: TestPane;
        model?: Custom;
        headElement: {getAttribute(name: string): string};
    }
    const models: Custom[] = [];
    const tabs: TestTab[] = [];
    const wnd: TestPane = {
        children: [{headElement: {}}], parent: {children: []}, element: {getAttribute: () => "pane"},
        split: () => wnd, addTab() {}, showHeading() {},
        switchTab(head: {getAttribute: (name: string) => string}) {
            switched++;
            const tab = tabs.find(item => item.headElement === head);
            if (!tab.model) {
                const data = JSON.parse(head.getAttribute("data-initdata"));
                tab.model = new Custom(data.customModelData);
                tab.model.parent = tab;
                models.push(tab.model);
            }
        },
    };
    class Custom {
        public type = "siyuan-database-row";
        public parent: TestTab;
        public element = {dispatchEvent() {}, querySelector: () => ({})};
        constructor(public data: IDatabaseRowOpenData) {}
        public update() {}
    }
    const makeTab = (data: IDatabaseRowOpenData, lazy = false): TestTab => {
        const tab: TestTab = {parent: wnd, model: lazy ? undefined : new Custom(data),
            headElement: {getAttribute: (name: string) => name === "data-initdata" && lazy ? JSON.stringify({
                instance: "Custom", customModelType: "siyuan-database-row", customModelData: data,
            }) : null}};
        if (tab.model) {
            tab.model.parent = tab;
            models.push(tab.model);
        }
        tabs.push(tab);
        return tab;
    };
    const data: IDatabaseRowOpenData = {avID: "database", databaseBlockID: "carrier", notebookID: "notebook",
        itemID: "row", valueID: "value", title: "Entry", isDetached: true};
    if (restored) {
        makeTab(data, true);
    }
    const siyuan = {config: {editor: {databaseAttrShow: true}}, languages: {untitled: "Untitled"}, layout: {}};
    const common = {
        window: {siyuan},
        document: {querySelectorAll: (): Element[] => [], querySelector: () => wnd.element},
        HTMLElement: class {}, CustomEvent: class {},
    };
    const util = {openFile: undefined as typeof import("../../../editor/util").openFile};
    runInNewContext(utilCode, {...common, exports: util, clearOBG() {},
        getAllModels: () => ({custom: models}), getAllTabs: () => tabs, pdfIsLoading: () => false,
        getInstanceById: () => wnd, shouldCheckOtherWindows: () => false,
        newTab: (options: IOpenFileOptions) => { created++; return makeTab(options.custom.data); },
    });
    const api = {} as typeof import("./openDatabaseRow");
    const dependencies: Record<string, unknown> = {
        "../../../editor/util": util, "../../../layout/dock/Custom": {Custom},
        "../../../layout/util": {saveLayout() {}},
        "./databaseRowNavigation": {getDatabaseRowNavigation: (): undefined => undefined, mountDatabaseRowNavigation() {}},
    };
    runInNewContext(rowCode, {...common, exports: api, require: (name: string) => dependencies[name] || {}});
    return {data, siyuan, tabs, created: () => created, switched: () => switched,
        open: (row = data, options?: Parameters<typeof api.openDatabaseRowByData>[2]) =>
            api.openDatabaseRowByData({app: {}} as Pick<IProtyle, "app">, row, options)};
};

for (const restored of [false, true]) {
    test(`ordinary row clicks reuse ${restored ? "restored" : "loaded"} previews by database and item identity`, async () => {
        const h = setup(restored);
        assert.equal(await h.open(), true);
        const opened = h.tabs[0];
        assert.equal(await h.open({...h.data, title: "Renamed", navigation: {viewID: "other-view", query: "text"}}), true);
        assert.equal(h.tabs.length, 1);
        assert.equal(h.tabs[0], opened);
        assert.equal(opened.model.data.title, "Renamed");
        assert.equal(h.created(), restored ? 0 : 1);
        assert.equal(h.switched(), restored ? 2 : 1);
        await h.open({...h.data, itemID: "other-row"});
        await h.open({...h.data, avID: "other-database"});
        assert.equal(h.tabs.length, 3);
    });
}

test("standalone bound rows and panel-preserving opens retain preview reuse", async () => {
    const h = setup();
    const bound = {...h.data, isDetached: false, boundBlockID: "document"};
    h.siyuan.config.editor.databaseAttrShow = false;
    await h.open(bound);
    await h.open(bound);
    h.siyuan.config.editor.databaseAttrShow = true;
    await h.open(bound, {standalone: true, keepAVPanel: true});
    assert.equal(h.created(), 1);
    assert.equal(h.tabs.length, 1);
});
