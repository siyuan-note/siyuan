import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../../util/escape";

const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const pathSource = compile("src/protyle/breadcrumb/globalPath.ts");
const breadcrumbSource = compile("src/protyle/breadcrumb/index.ts");
const item = (id: string, name = id): IBreadcrumb => ({id, name, type: "NodeDocument", subType: "", children: []});
const documentPath = () => ({notebook: "box", id: "doc", title: {text: "Current / & <mark>", empty: false},
    segments: [{id: "parent", text: "Parent / same.sy", empty: false}, {id: "doc", text: "Current", empty: false}]});

const fixture = (mobile = false) => {
    const requests: Array<{url: string; data: any}> = [];
    let response: any = {code: 0, data: {documents: [documentPath()]}};
    const box = {id: "box", name: "Notebook & name", closed: false, encrypted: false, unlocked: true, state: "Unlocked"};
    const window = {siyuan: {notebooks: [box], config: {editor: {globalBreadcrumb: true}},
        languages: {untitled: "Untitled", openBy: "Open", loadMore: "Load more"}}};
    const paths: any = {};
    const dependencies = {
        ...escape,
        fetchSyncPost: async (url: string, data: any) => {requests.push({url, data}); return await response;},
    };
    runInNewContext(pathSource, {exports: paths, window, console, require: () => dependencies});
    const exports: any = {};
    const navigations: any[] = [];
    runInNewContext(breadcrumbSource, {exports, window, console, require: () => ({
        ...dependencies, ...paths, isMobile: () => mobile,
        getDocDisplayName: (name: string, empty: boolean) => empty ? "Untitled" : escape.escapeHtmlTextAndAttr(name),
        openFileById: (options: any) => navigations.push(options),
        openMobileFileById: (_app: unknown, id: string) => navigations.push({id}),
        Constants: {CB_GET_HL: "highlight"},
    })});
    const breadcrumb = Object.create(exports.Breadcrumb.prototype);
    const protyle = {notebookId: "box", block: {rootID: "doc"}, app: {}};
    return {paths, breadcrumb, protyle, window, box, requests, navigations, setResponse: (value: any) => response = value};
};

test("global breadcrumb joins structured ancestors once and preserves special titles and existing block paths", () => {
    const f = fixture();
    const blocks = [item("doc", "old/full/path"), item("heading"), item("paragraph", "")];
    const result = f.paths.mergeGlobalBreadcrumb(blocks, documentPath(), f.box.name, "Untitled");
    assert.deepEqual(Array.from(result, (value: any) => value.id), ["box", "parent", "doc", "heading", "paragraph"]);
    assert.equal(result[0].globalType, "notebook");
    assert.equal(result[1].name, "Parent / same.sy");
    assert.equal(result[2].name, "Current / &amp; &lt;mark>");
    assert.equal(result[2].globalType, undefined);
    assert.equal(result[3], blocks[1]);
    assert.equal(blocks[0].name, "old/full/path");
});

test("top-level, empty-title, notebook-document and incomplete paths remain usable without duplicates", () => {
    const f = fixture();
    const path = documentPath();
    path.segments = [];
    path.title.empty = true;
    let result = f.paths.mergeGlobalBreadcrumb([item("doc")], path, "Notebook", "Untitled");
    assert.deepEqual(Array.from(result, (value: any) => value.name), ["Notebook", "Untitled"]);
    path.id = "box";
    result = f.paths.mergeGlobalBreadcrumb([item("box"), item("heading")], path, "Notebook", "Untitled");
    assert.deepEqual(Array.from(result, (value: any) => value.id), ["box", "heading"]);
    assert.equal(result[0].name, "Notebook");
    assert.equal(result[0].globalType, undefined, "notebook document retains its block navigation");
    const blocks = [item("missing")];
    assert.equal(f.paths.mergeGlobalBreadcrumb(blocks, path, "Notebook", "Untitled"), blocks);
});

test("disabled mode makes no path request; enabled reads carry the notebook and failures preserve block context", async () => {
    const f = fixture();
    const blocks = [item("doc")];
    assert.equal(await f.paths.getGlobalBreadcrumb(blocks, "box", "doc", false), blocks);
    assert.equal(f.requests.length, 0);
    assert.equal((await f.paths.getGlobalBreadcrumb(blocks, "box", "doc", true)).length, 3);
    assert.equal(f.requests[0].data.notebook, "box");
    assert.equal(f.requests[0].data.ids[0], "doc");
    for (const response of [{code: -1}, {code: 0, data: {reason: "indexUnavailable"}},
        {code: 0, data: {documents: [] as ReturnType<typeof documentPath>[]}}]) {
        f.setResponse(response);
        assert.equal(await f.paths.getGlobalBreadcrumb(blocks, "box", "doc", true), blocks);
    }
});

test("locking, closed and removed notebooks cannot provide global path titles", async () => {
    const f = fixture();
    f.box.encrypted = true;
    for (const state of ["Locking", "Locked", "Error"]) {
        f.box.state = state;
        assert.equal((await f.paths.getGlobalBreadcrumb([item("doc")], "box", "doc", true)).length, 0);
    }
    f.box.state = "Unlocked";
    let release: (response: any) => void;
    f.setResponse(new Promise(resolve => release = resolve));
    const pending = f.paths.getGlobalBreadcrumb([item("doc")], "box", "doc", true);
    f.box.state = "Locking";
    release({code: 0, data: {documents: [documentPath()]}});
    assert.equal((await pending).length, 0);
    f.box.closed = true;
    assert.equal(f.paths.isBreadcrumbNotebookAvailable("box"), false);
    assert.equal(f.paths.isBreadcrumbNotebookAvailable("missing"), false);
});

for (const mobile of [false, true]) {
    test(`document children use bounded paging and independent navigation/submenu actions (mobile=${mobile})`, async () => {
        const f = fixture(mobile);
        f.setResponse({code: 0, data: {revision: "v1", total: 3, stale: false, files: [
            {id: "parent", name: "<mark>/same.sy", titleEmpty: false, subFileCount: 1},
            {id: "leaf", name: "", titleEmpty: true, subFileCount: 0},
        ]}});
        const items = await f.breadcrumb.genDocumentMenuItems(f.protyle, "", new Set(["parent"]));
        assert.equal(f.requests[0].url, "/api/filetree/listDocTreeRange");
        assert.equal(f.requests[0].data.limit, 64);
        assert.equal(f.requests[0].data.parentID, "");
        assert.equal(items[0].label, "&lt;mark&gt;/same.sy");
        assert.equal(items[0].current, true);
        assert.equal(items[1].label, "Untitled");
        assert.equal(items[2].label, "Load more");
        assert.equal(typeof items[0].click, mobile ? "undefined" : "function");
        assert.equal(typeof items[0].loadSubmenu, "function");
        f.setResponse({code: 0, data: {revision: "v2", total: 0, stale: false, files: []}});
        const children = await items[0].loadSubmenu();
        assert.equal(children.length, mobile ? 1 : 0);
        if (mobile) assert.equal(children[0].label, "Open");
        f.protyle.notebookId = "other";
        const count = f.requests.length;
        assert.equal((await items[0].loadSubmenu()).length, 0);
        items[1].click();
        assert.equal(f.requests.length, count);
        assert.equal(f.navigations.length, 0);
    });
}

test("document menus reject stale revisions and late results after lock, navigation, setting changes or destruction", async () => {
    for (const mutation of ["lock", "navigation", "disable", "destroy"]) {
        const f = fixture();
        let release: (response: any) => void;
        f.setResponse(new Promise(resolve => release = resolve));
        const pending = f.breadcrumb.genDocumentMenuItems(f.protyle, "parent", new Set());
        if (mutation === "lock") {f.box.encrypted = true; f.box.state = "Locking";}
        if (mutation === "navigation") f.protyle.block.rootID = "other";
        if (mutation === "disable") f.window.siyuan.config.editor.globalBreadcrumb = false;
        if (mutation === "destroy") f.breadcrumb.destroyed = true;
        release({code: 0, data: {files: [{id: "private", name: "Private", subFileCount: 0}], total: 1}});
        assert.equal((await pending).length, 0);
    }
    const f = fixture();
    f.setResponse({code: 0, data: {stale: true, files: []}});
    await assert.rejects(f.breadcrumb.genDocumentMenuItems(f.protyle, "parent", new Set(), 64, "old"), /changed/);
    assert.equal(f.requests[0].data.revision, "old");
    assert.equal(f.requests[0].data.offset, 64);
});
