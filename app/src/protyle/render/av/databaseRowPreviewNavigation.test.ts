import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IDatabaseRowOpenData} from "./openDatabaseRow";

const {parse} = require("ifdef-loader/preprocessor");

test("row navigation replaces only its original desktop preview across bound and detached items", async () => {
    const callbacks = new Map<object, (data: IDatabaseRowOpenData) => Promise<boolean>>();
    const removed: string[] = [];
    const created: IOpenFileOptions[] = [];
    const app = {};
    let request: (response: unknown) => void;
    const element = () => {
        const root = {isConnected: true, dataset: {}, querySelector: (): unknown => root, dispatchEvent() {}};
        return root;
    };
    interface TestWnd {
        addTab(tab: TestTab, keep: boolean, save: boolean, active: string, replace: string): void;
        removeTab(id: string): void;
    }
    interface TestTab {
        id: string;
        parent: TestWnd;
        model: Custom | Editor;
        panelElement: ReturnType<typeof element>;
    }
    const wnd: TestWnd = {
        addTab(tab: ReturnType<typeof makeTab>, _keep: boolean, _save: boolean, _active: string, replace: string) {
            tab.parent = wnd;
            wnd.removeTab(replace);
        },
        removeTab(id: string) { removed.push(id); },
    };
    class Custom {
        public app = app;
        public element = element();
        public data = {};
        public parent: ReturnType<typeof makeTab>;
        public update() {}
    }
    class Editor {
        public app = app;
        public parent: ReturnType<typeof makeTab>;
        public editor = {protyle: {element: element(), contentElement: {scrollTop: 20}, upload: {isUploading: false},
            databaseAttributePanel: {expand() {}, afterRender() {}}}};
    }
    const makeTab = (id: string, model: Custom | Editor): TestTab => {
        const tab = {id, parent: wnd, model, panelElement: element()};
        model.parent = tab;
        return tab;
    };
    const initial = new Custom();
    makeTab("initial", initial);
    let latest: ReturnType<typeof makeTab>;
    const modules: Record<string, unknown> = {
        "../../../layout/dock/Custom": {Custom}, "../../../editor": {Editor},
        "../../../editor/util": {
            openFile: async (options: IOpenFileOptions) => { options.afterOpen(initial as never); return initial.parent; },
            newTab: (options: IOpenFileOptions) => {
                created.push(options);
                latest = makeTab("new-" + created.length, options.custom ? new Custom() : new Editor());
                return latest;
            },
        },
        "../../../util/fetch": {fetchSyncPost: () => new Promise(resolve => { request = resolve; })},
        "../../../dialog/message": {showMessage() {}},
        "./rowReadonly": {inheritDatabaseRowReadonly() {}},
        "./databaseRowNavigation": {
            getDatabaseRowNavigation: (): undefined => undefined,
            mountDatabaseRowNavigation: (root: object, _data: unknown, open: (data: IDatabaseRowOpenData) => Promise<boolean>) => callbacks.set(root, open),
        },
    };
    const exports = {} as typeof import("./openDatabaseRow");
    runInNewContext(transpileModule(parse(readFileSync("src/protyle/render/av/openDatabaseRow.ts", "utf8"),
        {MOBILE: false, BROWSER: true}, false, true), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: (name: string) => modules[name] || {},
        window: {siyuan: {config: {editor: {databaseAttrShow: true}}, languages: {untitled: "Untitled"}}},
        CustomEvent: class { constructor(public type: string) {} },
    });
    const data: IDatabaseRowOpenData = {avID: "av", databaseBlockID: "carrier", notebookID: "notebook",
        itemID: "row", valueID: "value", title: "Row", isDetached: true, navigation: {viewID: "view", query: ""}};
    await exports.openDatabaseRowByData({app} as Pick<IProtyle, "app">, data);
    const move = callbacks.get(initial.element)({...data, isDetached: false, boundBlockID: "bound"});
    assert.equal(removed.length, 0);
    request({code: 0, data: {rootID: "another-document", rootTitle: "Document"}});
    assert.equal(await move, true);
    assert.deepEqual(removed, ["initial"]);
    assert.equal(latest.parent, wnd);
    assert.equal(created[0].id, "bound");
    assert.equal(created[0].rootID, "another-document");
    assert.equal(created[0].zoomIn, true);
    const bound = latest.model as Editor;
    bound.editor.protyle.upload.isUploading = true;
    assert.equal(await callbacks.get(bound.editor.protyle.element)(data), false);
    assert.equal(created.length, 1);
    bound.editor.protyle.upload.isUploading = false;
    assert.equal(await callbacks.get(bound.editor.protyle.element)(data), true);
    assert.deepEqual(removed, ["initial", "new-1"]);
    assert.equal(created[1].custom.data.itemID, "row");
    assert.equal(created[1].custom.data.navigation.viewID, "view");
    const detached = latest.model as Custom;
    const failed = callbacks.get(detached.element)({...data, isDetached: false, boundBlockID: "denied"});
    request({code: -1});
    assert.equal(await failed, false);
    assert.equal(removed.length, 2);
    const closed = callbacks.get(detached.element)({...data, isDetached: false, boundBlockID: "bound"});
    latest.panelElement.isConnected = false;
    request({code: 0, data: {rootID: "document"}});
    assert.equal(await closed, false);
    assert.equal(created.length, 2);
});
