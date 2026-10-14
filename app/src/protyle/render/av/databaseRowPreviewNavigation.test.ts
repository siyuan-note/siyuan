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
    let switched: (opened: boolean) => void;
    let documentLoaded: () => void;
    let attributesLoaded: (element: unknown) => void;
    let customLoaded: (ready: boolean) => void;
    let checkSource: () => void;
    const element = () => {
        const classes = new Set<string>();
        const root = {isConnected: true, dataset: {}, querySelector: (): unknown => root, dispatchEvent() {},
            remove() { root.isConnected = false; },
            classList: {add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
                contains: (name: string) => classes.has(name)}};
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
        callback?: (tab: TestTab) => void;
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
        public resize() {}
        public destroy() {}
        public send() {}
    }
    class Editor {
        public app = app;
        public parent: ReturnType<typeof makeTab>;
        public editor = {resize() {}, protyle: {element: element(), contentElement: {scrollTop: 20}, upload: {isUploading: false},
            databaseAttributePanel: {expand() {}, afterRender(callback: (element: unknown) => void) { attributesLoaded = callback; }}}};
        public destroy() {}
        public send() {}
    }
    const makeTab = (id: string, model: Custom | Editor): TestTab => {
        const tab = {id, parent: wnd, model, panelElement: element(), callback() {}};
        model.parent = tab;
        return tab;
    };
    const initial = new Custom();
    makeTab("initial", initial);
    let latest: ReturnType<typeof makeTab>;
    const modules: Record<string, unknown> = {
        "../../../layout/dock/Custom": {Custom}, "../../../editor": {Editor},
        "../../../editor/databaseRow": {whenDatabaseRowReady: () => new Promise(resolve => { customLoaded = resolve; }),
            switchDatabaseRow: (model: Custom, row: IDatabaseRowOpenData) => {
            assert.equal(model, initial);
            assert.equal(row.itemID, "next-detached");
            return new Promise(resolve => { switched = resolve; });
        }},
        "../../../editor/util": {
            updatePanelByEditor() {},
            openFile: async (options: IOpenFileOptions) => { options.afterOpen(initial as never); return initial.parent; },
            newTab: (options: IOpenFileOptions, afterInit: () => void) => {
                documentLoaded = afterInit;
                created.push(options);
                latest = makeTab("new-" + created.length, options.custom ? new Custom() : new Editor());
                return latest;
            },
        },
        "../../../util/fetch": {fetchSyncPost: () => new Promise(resolve => { request = resolve; })},
        "../../../dialog/message": {showMessage() {}},
        "../../../layout/util": {saveLayout() {}},
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
        window: {setTimeout, clearTimeout, siyuan: {config: {editor: {databaseAttrShow: true}}, languages: {untitled: "Untitled"}}},
        document: {body: {append() {}}},
        MutationObserver: class {
            constructor(callback: () => void) { checkSource = callback; }
            public observe() {}
            public disconnect() {}
        },
        CustomEvent: class { constructor(public type: string) {} },
    });
    const data: IDatabaseRowOpenData = {avID: "av", databaseBlockID: "carrier", notebookID: "notebook",
        itemID: "row", valueID: "value", title: "Row", isDetached: true, navigation: {viewID: "view", query: ""}};
    await exports.openDatabaseRowByData({app} as Pick<IProtyle, "app">, data);
    const reuse = callbacks.get(initial.element)({...data, itemID: "next-detached"});
    assert.equal(created.length, 0);
    assert.equal(removed.length, 0);
    switched(true);
    assert.equal(await reuse, true);
    assert.equal(created.length, 0);
    const move = callbacks.get(initial.element)({...data, isDetached: false, boundBlockID: "bound"});
    assert.equal(removed.length, 0);
    request({code: 0, data: {rootID: "another-document", rootTitle: "Document"}});
    await new Promise(setImmediate);
    assert.equal(removed.length, 0, "the current preview stays until document and attributes load");
    assert.equal(latest.panelElement.classList.contains("fn__none"), true);
    documentLoaded();
    await new Promise(setImmediate);
    assert.equal(removed.length, 0);
    attributesLoaded({querySelector: () => ({})});
    assert.equal(await move, true);
    assert.deepEqual(removed, ["initial"]);
    assert.equal(latest.parent, wnd);
    assert.equal(created[0].id, "bound");
    assert.equal(created[0].rootID, "another-document");
    assert.equal(created[0].zoomIn, true);
    let bound = latest.model as Editor;
    bound.editor.protyle.upload.isUploading = true;
    assert.equal(await callbacks.get(bound.editor.protyle.element)(data), false);
    assert.equal(created.length, 1);
    bound.editor.protyle.upload.isUploading = false;
    const toBound = callbacks.get(bound.editor.protyle.element)({...data, isDetached: false, boundBlockID: "next-bound"});
    request({code: 0, data: {rootID: "next-document", rootTitle: "Next"}});
    await new Promise(setImmediate);
    assert.deepEqual(removed, ["initial"]);
    documentLoaded();
    await new Promise(setImmediate);
    assert.deepEqual(removed, ["initial"]);
    attributesLoaded({querySelector: () => ({})});
    assert.equal(await toBound, true);
    bound = latest.model as Editor;
    const toDetached = callbacks.get(bound.editor.protyle.element)(data);
    assert.deepEqual(removed, ["initial", "new-1"]);
    customLoaded(true);
    assert.equal(await toDetached, true);
    assert.deepEqual(removed, ["initial", "new-1", "new-2"]);
    assert.equal(created[2].custom.data.itemID, "row");
    assert.equal(created[2].custom.data.navigation.viewID, "view");
    const detached = latest.model as Custom;
    const failed = callbacks.get(detached.element)({...data, isDetached: false, boundBlockID: "denied"});
    request({code: -1});
    assert.equal(await failed, false);
    assert.equal(removed.length, 3);
    const closed = callbacks.get(detached.element)({...data, isDetached: false, boundBlockID: "bound"});
    latest.panelElement.isConnected = false;
    request({code: 0, data: {rootID: "document"}});
    assert.equal(await closed, false);
    assert.equal(created.length, 3);
    latest.panelElement.isConnected = true;
    const cancelled = callbacks.get(detached.element)({...data, isDetached: false, boundBlockID: "bound"});
    request({code: 0, data: {rootID: "document"}});
    await new Promise(setImmediate);
    detached.parent.panelElement.isConnected = false;
    checkSource();
    assert.equal(await cancelled, false);
    assert.equal(latest.panelElement.isConnected, false, "cancelled preview is removed from its staging container");
    assert.equal(removed.length, 3);
});
