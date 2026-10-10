import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IDatabaseRowOpenData} from "../protyle/render/av/openDatabaseRow";

const {parse} = require("ifdef-loader/preprocessor");

const createPreview = async (mobile: boolean) => {
    const data: IDatabaseRowOpenData = {avID: "database", databaseBlockID: "carrier", notebookID: "notebook",
        itemID: "first", valueID: "first-value", title: "First", isDetached: true,
        navigation: {viewID: "view", query: ""}};
    const title = {textContent: "", style: {}};
    const content = {scrollTop: 25};
    let body: Body;
    class Body {
        public isConnected = true;
        public style = {};
        public rowID = "";
        public available = true;
        public querySelector(selector: string) {
            if (!this.available) { return null; }
            return selector.includes("data-primary") ? {dataset: {
                cellValue: encodeURIComponent(JSON.stringify({block: {content: this.rowID}})),
            }} : {};
        }
        public replaceWith(next: Body) { this.isConnected = false; body = next; }
    }
    body = new Body();
    const listeners = new Map<string, (event: {detail: unknown}) => void>();
    const root = {
        dataset: {}, clientWidth: 800, isConnected: true, scrollTop: 25,
        querySelector: (selector: string): unknown => {
            if (selector.includes("__body")) { return body; }
            if (selector.includes("__title")) { return title; }
            if (selector === ".protyle-content") { return content; }
            return root;
        },
        append() {},
        addEventListener: (name: string, listener: (event: {detail: unknown}) => void) => listeners.set(name, listener),
    };
    let closed = 0;
    const tab = {updateTitle: (value: string) => { title.textContent = value; }, parent: {removeTab: () => { closed++; }}};
    let destroy: () => void;
    let loaded: () => void;
    let refresh: () => void;
    let navigate: (next: IDatabaseRowOpenData) => Promise<boolean>;
    let mountedRow: string;
    const requests: {element: Body, callback: (element: Body) => void}[] = [];
    class Custom {
        public data: Record<string, unknown>;
        public element = root;
        public tab = tab;
        constructor(options: {data: Record<string, unknown>, init: (model: Custom) => void, destroy: () => void}) {
            this.data = options.data;
            destroy = options.destroy;
            options.init(this);
        }
    }
    const context = {id: "context", highlight: {}, hint: {}};
    const modules: Record<string, unknown> = {
        "../layout/dock/Custom": {Custom},
        "../layout/util": {saveLayout() {}},
        "../protyle/render/av/openDatabaseRow": {mountDesktopDatabaseRowNavigation: (_model: unknown, row: IDatabaseRowOpenData) => {
            mountedRow = row.itemID;
        }},
        "../protyle/ui/padding": {getEditorHorizontalPadding: () => ({left: 0, right: 0})},
        "../../../dialog": {Dialog: class {
            public element = root;
            constructor(options: {destroyCallback: () => void}) { destroy = options.destroyCallback; }
            public destroy() { closed++; destroy(); }
        }},
        "./databaseRowNavigation": {
            getDatabaseRowNavigation: (): undefined => undefined,
            mountDatabaseRowNavigation: (_root: unknown, row: IDatabaseRowOpenData,
                                         open: (next: IDatabaseRowOpenData) => Promise<boolean>) => {
                mountedRow = row.itemID;
                navigate = open;
            },
        },
    };
    const load = <T>(file: string) => {
        const exports = {} as T;
        runInNewContext(transpileModule(parse(readFileSync("src/" + file + ".ts", "utf8"),
            {MOBILE: mobile, BROWSER: true}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {
            exports, document: {createElement: () => new Body()},
            window: {siyuan: {dialogs: [], languages: {untitled: "Untitled"}, config: {editor: {databaseAttrShow: true}}}},
            ResizeObserver: class { observe() {} disconnect() {} },
            require: (name: string) => {
                if (name === "../protyle" || name === "../../index") {
                    return {Protyle: class {
                        constructor(_app: unknown, _element: unknown, options: {after: (editor: unknown) => void}) {
                            loaded = () => options.after({protyle: context});
                        }
                        public destroy() {}
                    }};
                }
                if (name.endsWith("/blockAttr")) {
                    return {renderAVAttribute: (element: Body, id: string, _context: unknown,
                                                callback: (element: Body) => void) => {
                        element.rowID = id;
                        requests.push({element, callback});
                    }};
                }
                if (name.endsWith("/databaseRowRefresh")) {
                    return {registerDatabaseRowRefresh: (_id: string, options: {refresh: () => void}) => {
                        refresh = options.refresh;
                        return () => {};
                    }};
                }
                if (name.endsWith("/binding")) { return {preserveAVBindingRange: () => () => {}}; }
                if (name.endsWith("/rowReadonly")) { return {inheritDatabaseRowReadonly() {}}; }
                if (name.endsWith("/primaryFocus")) { return {focusDatabasePrimary() {}}; }
                return modules[name] || {};
            },
        });
        return exports;
    };
    let model: Custom;
    if (mobile) {
        await load<typeof import("../protyle/render/av/openDatabaseRow")>("protyle/render/av/openDatabaseRow")
            .openDatabaseRowByData({app: {}} as Pick<IProtyle, "app">, data);
    } else {
        const api = load<typeof import("./databaseRow")>("editor/databaseRow");
        model = api.newDatabaseRowModel({app: {} as never, tab: tab as never,
            data: {...data, blockID: data.databaseBlockID, notebookId: data.notebookID}}) as unknown as Custom;
        navigate = next => api.switchDatabaseRow(model as never,
            {...next, blockID: next.databaseBlockID, notebookId: next.notebookID});
    }
    loaded();
    const complete = (index: number, available = true) => {
        requests[index].element.available = available;
        requests[index].callback(requests[index].element);
    };
    complete(0);
    return {data, title, root, content, requests, complete, refresh: () => refresh(),
        navigate: (next: IDatabaseRowOpenData) => navigate(next), destroy: () => destroy(),
        body: () => body, closed: () => closed, savedRow: () => model?.data.itemID,
        mountedRow: () => mountedRow};
};

for (const mobile of [false, true]) {
    test(`row preview commits loaded content without clearing the current row (${mobile ? "mobile" : "desktop"})`, async () => {
        const preview = await createPreview(mobile);
        assert.equal(preview.mountedRow(), "first", "restoring the preview mounts its saved navigation");
        const original = preview.body();
        const next = {...preview.data, itemID: "second", valueID: "second-value", title: "Second"};
        const switching = preview.navigate(next);
        assert.equal(preview.body(), original);
        assert.equal(preview.title.textContent, "first");
        assert.equal(mobile ? preview.mountedRow() : preview.savedRow(), "first");
        preview.refresh();
        preview.complete(1);
        assert.equal(preview.body(), original, "superseded response must not replace the current content");
        preview.complete(2);
        assert.equal(await switching, true);
        assert.equal(preview.body().rowID, "second");
        assert.equal(preview.title.textContent, "second");
        assert.equal(mobile ? preview.mountedRow() : preview.savedRow(), "second");
        assert.equal(mobile ? preview.root.scrollTop : preview.content.scrollTop, 0);
        assert.equal(preview.closed(), 0);

        const unavailable = preview.navigate({...next, itemID: "deleted"});
        preview.complete(3, false);
        assert.equal(await unavailable, false);
        assert.equal(preview.body().rowID, "second");
        assert.equal(preview.title.textContent, "second");
        assert.equal(preview.closed(), 0);

        const closing = preview.navigate({...next, itemID: "third"});
        preview.destroy();
        assert.equal(await closing, false);
        preview.complete(4);
        assert.equal(preview.body().rowID, "second");
    });
}
