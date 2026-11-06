import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IDocTreeItem} from "../layout/dock/docTree/types";
import type {IOpenDocTreeMenuOptions} from "./openDocTreeMenu";

const BOX = "20260101000000-box0001";
const OTHER = "20260101000000-box0002";
const DOC = "20260101000000-doc0001";
const CHILD = "20260101000000-doc0002";
const compile = (name: string) => transpileModule(readFileSync(`src/${name}.ts`, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;

const fixture = (mobile = false) => {
    let visible = false;
    let builds = 0;
    let rendered = 0;
    let removals = 0;
    let beforeShow: () => void;
    let duringBuild: () => void;
    let hasMenuItems = true;
    const shown: unknown[] = [];
    const built: {items: IDocTreeItem[], position?: IPosition, target: HTMLElement, elements: () => NodeListOf<HTMLElement>}[] = [];
    const requests: {url: string, data: Record<string, unknown>}[] = [];
    const body = {closest: (): Element => null};
    const menu = {
        data: undefined as unknown,
        element: {classList: {contains: (name: string) => name === "fn__none" && !visible}},
        remove() { removals++; visible = false; menu.data = undefined; },
        popup(position: IPosition) { beforeShow?.(); visible = hasMenuItems; shown.push(position); },
        fullscreen(position: string) { beforeShow?.(); visible = hasMenuItems; shown.push(position); },
    };
    const notebooks = [BOX, OTHER].map(id => ({id, name: id, closed: false, icon: "", sort: 0,
        subFileCount: 1, sortMode: 6, encrypted: false, unlocked: true, state: "Unlocked"}));
    const siyuan = {notebooks, menus: {menu}, ws: {app: {}}, config: {fileTree: {boxDocEnabled: true}}};
    const defaultResponse = (url: string, data: Record<string, unknown>) => {
        const notebook = data.notebook;
        const id = data.id || DOC;
        const parentID = id === CHILD ? DOC : "";
        const path = parentID ? `/${parentID}.sy` : "/";
        if (url === "/api/filetree/locateDocTreeItem") {
            return {code: 0, data: {box: notebook, id, steps: [
                ...(parentID ? [{parentID: "", id: DOC, index: 3, path: "/", revision: "parent", total: 10}] : []),
                {parentID, id, index: 4, path, revision: "revision", total: 12},
            ]}};
        }
        if (url === "/api/filetree/listDocTreeRange") {
            const fileID = data.parentID ? CHILD : DOC;
            const parentPath = data.parentID ? `/${data.parentID}.sy` : "/";
            return {code: 0, data: {box: notebook, parentID: data.parentID, path: parentPath, revision: "revision",
                offset: data.offset, stale: false, total: 12, effectiveSortMode: 6, files: [{id: fileID,
                    path: `${data.parentID ? `/${data.parentID}` : ""}/${fileID}.sy`, name: "Actual title.sy",
                    subFileCount: 2, childrenSortMode: 0, icon: "", hSize: ""}]}};
        }
        if (url === "/api/block/getBlockInfo") {
            return {code: 0, data: {box: notebook, rootID: id, path: `/${id}.sy`, rootTitleEmpty: false}};
        }
        if (url === "/api/block/getDocInfo") {
            return {code: 0, data: {id, rootID: id, name: "Notebook document", subFileCount: 1, icon: "", refCount: 0}};
        }
        throw new Error(`Unexpected endpoint ${url}`);
    };
    let response: (url: string, data: Record<string, unknown>) => unknown | Promise<unknown> = defaultResponse;
    const globals = {window: {siyuan}, document: {
        body,
        createElement: () => {
            const rows: unknown[] = [];
            return {append: (row: unknown) => rows.push(row), querySelectorAll: () => rows};
        },
    }};
    const toggle = {} as typeof import("../menus/menuToggle");
    runInNewContext(compile("menus/menuToggle"), {...globals, exports: toggle});
    const rows = {} as typeof import("../layout/dock/docTree/rowData");
    runInNewContext(compile("layout/dock/docTree/rowData"), {...globals, exports: rows});
    const exports = {} as typeof import("./openDocTreeMenu");
    const dependencies = {
        "../util/fetch": {fetchSyncPost: async (url: string, data: Record<string, unknown>, _headers: unknown, process: boolean) => {
            assert.equal(process, false);
            requests.push({url, data});
            return response(url, data);
        }},
        "../util/functions": {isMobile: () => mobile},
        "../menus/menuToggle": toggle,
        "../menus/navigation": {initDocTreeMenu: (_app: unknown, options: typeof built[number]) => {
            builds++;
            built.push(options);
            duringBuild?.();
        }},
        "../layout/dock/docTree/rowData": rows,
        "../layout/dock/docTree/row": {renderDocTreeRow: (item: IDocTreeItem) => { rendered++; return {item}; }},
    };
    runInNewContext(compile("plugin/openDocTreeMenu"), {...globals, exports,
        require: (name: keyof typeof dependencies) => {
            assert.ok(dependencies[name], `Unexpected dependency ${name}`);
            return dependencies[name];
        },
    });
    const open = (items: IOpenDocTreeMenuOptions["items"], position = {x: 31, y: 47, w: 10, h: 20}) =>
        exports.openDocTreeMenu({items, position});
    return {open, api: exports.openDocTreeMenu, menu, notebooks, siyuan, body, requests, built, shown,
        builds: () => builds, rendered: () => rendered, removals: () => removals, visible: () => visible,
        response: (value: typeof response) => { response = value; }, defaultResponse,
        duringBuild: (value: () => void) => { duringBuild = value; },
        beforeShow: (value: () => void) => { beforeShow = value; },
        noItems: () => { hasMenuItems = false; },
    };
};

test("plugin export is available through require siyuan", () => {
    const source = readFileSync("src/plugin/API.ts", "utf8");
    assert.match(source, /import \{openDocTreeMenu\} from "\.\/openDocTreeMenu"/);
    assert.match(source, /const createAPI = [\s\S]*\n {4}openDocTreeMenu,/);
});

test("notebooks, documents and notebook documents retain distinct identities and first input order", async () => {
    const f = fixture();
    assert.equal(await f.open([{notebookId: BOX}, {notebookId: BOX, id: BOX}, {notebookId: BOX},
        {notebookId: BOX, id: DOC}, {notebookId: BOX, id: DOC}]), true);
    assert.deepEqual(Array.from(f.built[0].items, item => [item.kind, item.id]),
        [["notebook", BOX], ["document", BOX], ["document", DOC]]);
    assert.equal(f.requests.length, 4);
    assert.equal(f.rendered(), 0, "event snapshots remain lazy");
    const elements = f.built[0].elements();
    assert.equal(elements.length, 3);
    assert.equal(f.built[0].elements(), elements);
    assert.equal(f.rendered(), 3);
    assert.equal(f.built[0].target, f.body);
    assert.deepEqual({...f.built[0].position}, {x: 31, y: 47, w: 10, h: 20});
});

test("document metadata comes from the exact range and the parent effective sort", async () => {
    const f = fixture();
    assert.equal(await f.open([{notebookId: BOX, id: CHILD}]), true);
    assert.deepEqual({...f.requests[1].data}, {notebook: BOX, parentID: DOC, offset: 4, limit: 1, revision: "revision"});
    const item = f.built[0].items[0];
    assert.equal(item.path, `/${DOC}/${CHILD}.sy`);
    assert.equal(item.name, "Actual title.sy");
    assert.equal(item.subFileCount, 2);
    assert.equal(item.childrenSortMode, 0);
    assert.equal(item.effectiveSortMode, 6);
});

test("invalid inputs and desktop positions leave the current menu untouched", async () => {
    const f = fixture();
    const valid = {items: [{notebookId: BOX}], position: {x: 0, y: 0}};
    for (const options of [null, undefined, {}, {...valid, items: []}, {...valid, items: null},
        {...valid, items: [null]}, {...valid, items: [{notebookId: "bad"}]},
        {...valid, items: [{notebookId: BOX, id: null}]}, {...valid, items: [{notebookId: BOX, id: ""}]},
        {...valid, position: undefined}, {...valid, position: null}, {...valid, position: {x: NaN, y: 1}},
        {...valid, position: {x: 1, y: Infinity}}, {...valid, position: {x: "1", y: 1}},
        {...valid, position: {x: 1, y: 1, w: -1}}, {...valid, position: {x: 1, y: 1, h: Infinity}}]) {
        assert.equal(await f.api(options as IOpenDocTreeMenuOptions), false);
    }
    assert.equal(f.removals(), 0);
    assert.equal(f.requests.length, 0);
});

test("mobile accepts omitted position and uses the bottom sheet", async () => {
    const f = fixture(true);
    assert.equal(await f.api({items: [{notebookId: BOX}]}), true);
    assert.deepEqual(f.shown, ["bottom"]);
    assert.equal(f.built[0].position, undefined);
});

test("missing, closed, locked and locking notebooks reject the entire request", async () => {
    for (const state of [{closed: true}, {encrypted: true, unlocked: false},
        {encrypted: true, state: "Locking"}, {encrypted: true, state: "Unlocking"},
        {encrypted: true, state: "Error"}, {encrypted: true, state: "Locked"}]) {
        const f = fixture();
        Object.assign(f.notebooks[1], state);
        assert.equal(await f.open([{notebookId: BOX}, {notebookId: OTHER}]), false);
        assert.equal(f.builds(), 0);
        assert.equal(f.removals(), 0);
    }
    const f = fixture();
    f.notebooks.splice(1);
    assert.equal(await f.open([{notebookId: OTHER}]), false);
});

test("ordinary document errors, stale ranges and mismatched identity never partially build", async () => {
    for (const failure of ["error", "wrongBox", "wrongID", "nonRoot", "stale", "revision", "path", "offset", "extraFile"]) {
        const f = fixture();
        f.response((url, data) => {
            const result = f.defaultResponse(url, data);
            if (url.includes("locate")) {
                if (failure === "error" || failure === "nonRoot") { return {code: -1}; }
                if (failure === "wrongBox") { return {...result, data: {...result.data, box: OTHER}}; }
                if (failure === "wrongID") { return {...result, data: {...result.data, id: CHILD}}; }
            }
            if (url.includes("Range")) {
                const range = result.data as {files: unknown[]};
                if (failure === "stale") { return {...result, data: {...range, stale: true}}; }
                if (failure === "revision") { return {...result, data: {...range, revision: "changed"}}; }
                if (failure === "path") { return {...result, data: {...range, path: "/wrong.sy"}}; }
                if (failure === "offset") { return {...result, data: {...range, offset: 5}}; }
                if (failure === "extraFile") { return {...result, data: {...range, files: [...range.files, ...range.files]}}; }
            }
            return result;
        });
        assert.equal(await f.open([{notebookId: BOX}, {notebookId: BOX, id: DOC}]), false, failure);
        assert.equal(f.builds(), 0, failure);
    }
});

test("notebook documents require enabled feature, full exact block identity and matching doc info", async () => {
    for (const failure of ["disabled", "published", "wrongBox", "wrongPath", "nonRoot", "docID", "docRoot", "missing"]) {
        const f = fixture();
        f.siyuan.config.fileTree.boxDocEnabled = failure !== "disabled";
        f.response((url, data) => {
            const result = f.defaultResponse(url, data);
            if (url.includes("getBlockInfo")) {
                if (failure === "published") { return {code: 0, data: {rootID: BOX, publishAccessRequired: true}}; }
                if (failure === "wrongBox") { return {...result, data: {...result.data, box: OTHER}}; }
                if (failure === "wrongPath") { return {...result, data: {...result.data, path: `/${DOC}/${BOX}.sy`}}; }
                if (failure === "nonRoot") { return {...result, data: {...result.data, rootID: DOC}}; }
            }
            if (url.includes("getDocInfo")) {
                if (failure === "docID") { return {...result, data: {...result.data, id: DOC}}; }
                if (failure === "docRoot") { return {...result, data: {...result.data, rootID: DOC}}; }
                if (failure === "missing") { return {...result, data: null}; }
            }
            return result;
        });
        assert.equal(await f.open([{notebookId: BOX, id: BOX}]), false, failure);
        assert.equal(f.builds(), 0);
        assert.equal(f.requests.some(request => request.url.includes("locate")), false);
    }
});

test("cross-notebook conflicting document IDs are rejected without deduplicating either target", async () => {
    const f = fixture();
    assert.equal(await f.open([{notebookId: BOX, id: DOC}, {notebookId: OTHER, id: DOC}]), false);
    assert.equal(f.requests.length, 4);
    assert.equal(f.builds(), 0);
});

test("closing, replacement and a newer API call prevent late responses from opening a menu", async () => {
    for (const action of ["close", "replace", "newer"] as const) {
        const f = fixture();
        let resolve: (value: unknown) => void;
        f.response((url, data) => new Promise(done => { resolve = () => done(f.defaultResponse(url, data)); }));
        const old = f.open([{notebookId: BOX, id: DOC}]);
        assert.equal(f.requests.length, 1);
        if (action === "newer") {
            assert.equal(await f.open([{notebookId: OTHER}]), true);
        } else {
            f.menu.remove();
            if (action === "replace") {
                f.menu.data = {};
                f.menu.popup({x: 1, y: 1});
            }
        }
        resolve(undefined);
        assert.equal(await old, false);
        assert.equal(f.builds(), action === "newer" ? 1 : 0);
        assert.equal(f.visible(), action !== "close");
    }
});

test("late errors preserve a replacement menu and notebook availability is rechecked before publish", async () => {
    const f = fixture();
    let reject: (error: Error) => void;
    f.response(() => new Promise((_resolve, fail) => { reject = fail; }));
    const pending = f.open([{notebookId: BOX, id: DOC}]);
    f.menu.remove();
    f.menu.data = {};
    f.menu.popup({x: 2, y: 2});
    reject(new Error("offline"));
    assert.equal(await pending, false);
    assert.equal(f.visible(), true);
    const changed = fixture();
    changed.response((url, data) => {
        if (url.includes("Range")) { changed.notebooks[0].closed = true; }
        return changed.defaultResponse(url, data);
    });
    assert.equal(await changed.open([{notebookId: BOX, id: DOC}]), false);
    assert.equal(changed.builds(), 0);
});

test("event-time dismissal or notebook locking and empty configured menus return false", async () => {
    const f = fixture();
    f.duringBuild(() => f.menu.remove());
    assert.equal(await f.open([{notebookId: BOX}]), false);
    assert.equal(f.shown.length, 0);
    const locking = fixture();
    locking.duringBuild(() => Object.assign(locking.notebooks[0], {encrypted: true, state: "Locking"}));
    assert.equal(await locking.open([{notebookId: BOX}]), false);
    assert.equal(locking.shown.length, 0);
    const disabled = fixture();
    disabled.duringBuild(() => { disabled.siyuan.config.fileTree.boxDocEnabled = false; });
    assert.equal(await disabled.open([{notebookId: BOX, id: BOX}]), false);
    assert.equal(disabled.shown.length, 0);
    const empty = fixture();
    empty.noItems();
    assert.equal(await empty.open([{notebookId: BOX}]), false);
});
