import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const setup = () => {
    const writes: unknown[] = [];
    const storage: Record<string, unknown> = {};
    const module = {exports: {}};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "subItemsState.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {module, exports: module.exports,
        require: (id: string) => ({
            "../../../constants": {Constants: {CUSTOM_SY_AV_VIEW: "view"}},
            "../../util/compatibility": {setStorageVal: (_key: string, value: unknown) => writes.push(value)},
            "../../../util/pathName": {isEncryptedBox: (id: string) => id === "encrypted"},
        }[id]),
        window: {siyuan: {storage, languages: {expand: "Expand", collapse: "Collapse", previous: "Previous", next: "Next"}}},
    });
    return {api: module.exports as typeof import("./subItemsState"), writes, storage};
};

const block = () => {
    let search = "";
    const attributes = new Map([["view", "v"], ["data-av-id", "db"]]);
    const element = {
        getAttribute: (name: string) => attributes.get(name),
        toggleAttribute: (name: string, value: boolean) => value ? attributes.set(name, "") : attributes.delete(name),
        querySelector: () => ({textContent: search}),
        querySelectorAll: (): HTMLElement[] => [],
    } as unknown as HTMLElement;
    return {element, search: (value: string) => { search = value; }};
};

const protyle = (notebookId = "plain") => ({notebookId, options: {}} as IProtyle);

it("stores ordinary folds by database, view and group while keeping child pages local to each carrier", () => {
    const {api, writes} = setup();
    const a = block().element;
    const b = block().element;
    api.toggleSubItems(a, protyle(), "g1", "parent", true);
    api.toggleSubItems(a, protyle(), "g2", "parent", false);
    api.loadMoreSubItems(a, protyle(), "g1", "parent", 51, 200);
    assert.equal(writes.length, 2);
    const saved = api.getSubItemsRequest(b, protyle());
    assert.deepEqual([...saved.groupExpandedIDs.g1], ["parent"]);
    assert.deepEqual([...saved.groupExpandedIDs.g2], []);
    assert.deepEqual(Object.keys(saved.childPaging), []);
    assert.equal(api.getSubItemsRequest(a, protyle()).childPaging["g1/parent"].page, 51);
});

it("keeps encrypted folds in memory and clears them when the notebook closes", () => {
    const {api, writes} = setup();
    const a = block().element;
    api.toggleSubItems(a, protyle("encrypted"), "", "secret", true);
    assert.equal(writes.length, 0);
    assert.deepEqual([...api.getSubItemsRequest(a, protyle("encrypted")).groupExpandedIDs[""]], ["secret"]);
    api.clearSubItemsState({querySelectorAll: () => [a]} as unknown as Element);
    assert.deepEqual(Object.keys(api.getSubItemsRequest(a, protyle("encrypted")).groupExpandedIDs), []);
});

it("does not persist or carry search expansion into the normal view", () => {
    const {api, writes} = setup();
    const a = block();
    api.toggleSubItems(a.element, protyle(), "", "normal", true);
    a.search("needle");
    api.toggleSubItems(a.element, protyle(), "", "search-parent", true);
    assert.equal(writes.length, 1);
    a.search("");
    assert.deepEqual([...api.getSubItemsRequest(a.element, protyle()).groupExpandedIDs[""]], ["normal"]);
});

it("renders accessible fold and bounded previous/next child-page controls for a wide tree", () => {
    const {api} = setup();
    const row = {id: "parent", hierarchy: {depth: 3, childCount: 10001, expanded: true, context: false}} as IAVRow;
    const view = {columns: [], rows: [], rowCount: 10001, nested: {page: 1, pageSize: 50,
        rootCount: 1, rootLoaded: 1, matchedCount: 10001,
        childPaging: {parent: {page: 26, pageSize: 200, total: 10001, loaded: 200}}}} as IAVTable;
    const html = api.getSubItemsControlHTML(row, view);
    assert.match(html, /padding-left:60px/);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /data-page="25"/);
    assert.match(html, /data-page="27"/);
    view.nested.childPaging.parent.page = 51;
    const last = api.getSubItemsControlHTML(row, view);
    assert.match(last, /data-page="50"/);
    assert.doesNotMatch(last, /data-page="52"/);
    row.hierarchy.expanded = false;
    assert.doesNotMatch(api.getSubItemsControlHTML(row, view), /data-page=/);
});

it("restores a deep expanded row inside only its group with a bounded virtual window", () => {
    const {api} = setup();
    const element = block().element;
    const rows = Array.from({length: 500}, (_, index) => ({id: `row-${index}`}));
    const data = {view: {groups: [{id: "first", rows, nested: {}}, {id: "second", rows, nested: {}}]}} as unknown as IAV;
    const windows: Record<string, IAVVirtualData> = {};
    api.setSubItemsViewportAnchor(element, "row-400", "second", 40);
    api.prepareSubItemsViewport(element, data, windows);
    assert.deepEqual(Object.keys(windows), ["second"]);
    assert.equal(windows.second.renderedStart, 350);
    assert.equal(windows.second.renderedEnd, 449);
    assert.equal(windows.second.topSpacerHeight, 14000);
    api.setSubItemsViewportAnchor(element, "row-2", "second", 40);
    (data.view.groups[1] as IAVTable).rows = rows.slice(0, 3) as IAVRow[];
    const collapsed: Record<string, IAVVirtualData> = {};
    api.prepareSubItemsViewport(element, data, collapsed);
    assert.deepEqual(Object.keys(collapsed), []);
});
