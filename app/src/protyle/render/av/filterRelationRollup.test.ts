import * as capabilities from "./capabilities";
import * as filterDropdown from "./filterDropdown";
import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";

const createEditor = () => {
    const rollup = {id: "employees", name: "Employees", type: "rollup",
        rollup: {relationKeyID: "tasks", keyID: "staff"}} as IAVColumn;
    const fields = [rollup, {id: "tasks", type: "relation", relation: {avID: "tasks-db"}}];
    const requests: Array<{url: string, data: {id: string, blockIDs?: string[], blockID?: string,
        relationDependencyContext?: {relationContext: {sourceAvID: string, sourceItemID: string, relationKeyID: string}, relationKeyIDs: string[]}}}> = [];
    const candidates: Array<(response: unknown) => void> = [];
    const document = {activeElement: null as HTMLElement, createElement: () => ({style: {}, offsetWidth: 10}),
        body: {appendChild() {}, removeChild() {}}};
    let respond: (url: string, request: typeof requests[number]["data"]) => Promise<unknown> = async url => ({code: 0,
        data: url === "/api/av/getAttributeView" ? {av: {keyValues: [{key: {
            id: "staff", type: "relation", relation: {avID: "employees-db"},
        }}]}} : {rows: {values: [{blockID: "alice", block: {content: "Alice"}}]}}});
    const methods = loadModule<typeof import("./filter")>("src/protyle/render/av/filter.ts", {
        window: {siyuan: {languages: new Proxy({}, {get: (_, name) => String(name)})}},
        document,
        require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities : (({
            "./view": {getFieldsByData: () => fields},
            "./filterDropdown": filterDropdown,
            "./col": {getColIconByType: () => "iconDatabase"},
            "../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../../constants": {Constants: {}},
            "../../../util/fetch": {fetchSyncPost: async (url: string, data: typeof requests[number]["data"]) => {
                requests.push({url, data});
                return respond(url, data);
            }, fetchPost: (url: string, data: typeof requests[number]["data"], callback: (response: unknown) => void) => {
                requests.push({url, data}); candidates.push(callback);
            }},
        })[name] || {}),
    }, ScriptTarget.ES2022);
    const data = {view: {filters: [{column: rollup.id, operator: "Contains any item", value: {
        type: "rollup", rollup: {contents: [{type: "relation", relation: {blockIDs: ["alice"], contents: []}}]},
    }}]}} as IAV;
    return {methods, rollup, data, requests, candidates, document,
        setResponder: (value: typeof respond) => { respond = value; }};
};

test("relation rollups load selected labels from the final database and expose exact selection", async () => {
    const {methods, rollup, data, requests} = createEditor();
    await methods.prepareFilterColumns(data);
    assert.equal(requests[0].data.id, "tasks-db");
    assert.equal(requests[1].data.id, "employees-db");
    assert.deepEqual(Array.from(requests[1].data.blockIDs), ["alice"]);
    const html = methods.getFiltersHTML(data, true);
    assert.match(html, /data-type="relationFilterTrigger"[^>]*data-av-id="employees-db"/);
    assert.match(html, />Alice</);
    assert.doesNotMatch(html, /data-type="quantifier"/);
    assert.equal(methods.genEmptyFilterValue(rollup).operator, "Contains any item");

    rollup.rollup.calc = {operator: "Unique values"};
    assert.equal(methods.genEmptyFilterValue(rollup).operator, "Contains any item");
    rollup.rollup.calc = {operator: "Count all"};
    assert.equal(methods.genEmptyFilterValue(rollup).value.rollup.contents[0].type, "number");
    assert.doesNotMatch(methods.getFiltersHTML(data, true), /data-type="relationFilterTrigger"/);

    rollup.rollup.calc = undefined;
    data.view.filters[0].operator = "Contains";
    data.view.filters[0].value.rollup.contents[0].relation.blockIDs = ["keyword"];
    const keywordHTML = methods.getFiltersHTML(data, true);
    assert.match(keywordHTML, /data-type-rel="relation"/);
    assert.match(keywordHTML, /data-type="quantifier"/);
});

test("selecting, removing and clearing rollup relation candidates preserves the rollup wrapper", async () => {
    const {methods, data} = createEditor();
    await methods.prepareFilterColumns(data);
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const dropdown = {
        dataset: {path: "0", avId: "employees-db", selected: '["alice"]'},
        style: {display: "none"}, querySelector: (): HTMLElement => null, querySelectorAll: (): HTMLElement[] => [],
    };
    let saves = 0;
    const panel = {
        dataset: {}, querySelector: (): HTMLElement => null, querySelectorAll: (): HTMLElement[] => [],
        addEventListener: (type: string, listener: (event: unknown) => void) => {
            listeners.set(type, [...listeners.get(type) || [], listener]);
        },
    };
    methods.bindInlineFilterEvents(panel as unknown as HTMLElement, data, {} as IProtyle, "block", "database", {
        root: panel as unknown as HTMLElement, save: () => { saves++; },
    });
    const click = (type: string, id?: string) => {
        const action = {dataset: {path: "0", id}, closest: () => dropdown};
        const target = {closest: (selector: string) => selector === '[data-filter-events-bound="true"]' ? panel :
            selector === `[data-type="${type}"]` ? action : null};
        for (const listener of listeners.get("click")) {
            listener({target, stopImmediatePropagation() {}});
        }
    };
    click("relationFilterOption", "bob");
    assert.equal(data.view.filters[0].value.type, "rollup");
    assert.deepEqual(Array.from(data.view.filters[0].value.rollup.contents[0].relation.blockIDs), ["alice", "bob"]);
    click("relationFilterRemove", "alice");
    assert.deepEqual(Array.from(data.view.filters[0].value.rollup.contents[0].relation.blockIDs), ["bob"]);
    click("relationFilterClear");
    assert.deepEqual(Array.from(data.view.filters[0].value.rollup.contents[0].relation.blockIDs), []);
    assert.equal(saves, 3);
});

test("related filters validate one-hop metadata and one- or two-hop labels from their root relation context", async () => {
    const h = createEditor();
    const relationContext = {sourceAvID: "source", sourceItemID: "entry", relationKeyID: "root-relation"};
    const scope = {blockID: "source-carrier", relationContext, isCurrent: () => true};
    await h.methods.prepareFilterColumns(h.data, scope);
    assert.deepEqual(JSON.parse(JSON.stringify(h.requests.map(request => request.data))), [
        {id: "tasks-db", blockID: "source-carrier", relationDependencyContext: {relationContext, relationKeyIDs: ["tasks"]}},
        {id: "employees-db", blockIDs: ["alice"], blockID: "source-carrier",
            relationDependencyContext: {relationContext, relationKeyIDs: ["tasks", "staff"]}},
    ]);
    h.data.view.filters = [{column: "tasks", operator: "Contains any item", value: {
        type: "relation", relation: {blockIDs: ["alice"], contents: []},
    } as IAVCellValue}];
    await h.methods.prepareFilterColumns(h.data, scope);
    assert.deepEqual(JSON.parse(JSON.stringify(h.requests.at(-1).data)), {id: "tasks-db", blockIDs: ["alice"],
        blockID: "source-carrier", relationDependencyContext: {relationContext, relationKeyIDs: ["tasks"]}});
});

test("related filter labels stay isolated for identical database and item IDs across panels and ordinary editors", async () => {
    const h = createEditor();
    const left = structuredClone(h.data), right = structuredClone(h.data), ordinary = structuredClone(h.data);
    const original = h.requests.length;
    h.setResponder(async (url, request) => url.endsWith("getAttributeView") ? {code: 0, data: {av: {keyValues: [{key: {
        id: "staff", type: "relation", relation: {avID: "employees-db"},
    }}]}}} : {code: 0, data: {rows: {values: [{blockID: "alice", block: {
        content: request.relationDependencyContext?.relationContext.sourceAvID || "Ordinary",
    }}]}}});
    const scope = (sourceAvID: string) => ({blockID: sourceAvID + "-carrier", isCurrent: () => true,
        relationContext: {sourceAvID, sourceItemID: "entry", relationKeyID: "root"}});
    await h.methods.prepareFilterColumns(left, scope("Private A"));
    await h.methods.prepareFilterColumns(right, scope("Private B"));
    await h.methods.prepareFilterColumns(ordinary);
    assert.equal(h.requests.length, original + 6);
    for (const [data, expected, rejected] of [[left, "Private A", "Private B|Ordinary"],
        [right, "Private B", "Private A|Ordinary"], [ordinary, "Ordinary", "Private A|Private B"]] as const) {
        const html = h.methods.getFiltersHTML(data, true);
        assert.match(html, new RegExp(expected)); assert.doesNotMatch(html, new RegExp(rejected));
    }
});

test("stale related metadata cannot issue dependent label requests after the host becomes inactive", async () => {
    const h = createEditor();
    let resolve: (response: unknown) => void;
    let active = true;
    h.setResponder(() => new Promise(value => { resolve = value; }));
    const loading = h.methods.prepareFilterColumns(h.data, {blockID: "source-carrier",
        relationContext: {sourceAvID: "source", sourceItemID: "entry", relationKeyID: "root"}, isCurrent: () => active});
    active = false;
    resolve({code: 0, data: {av: {keyValues: [{key: {id: "staff", type: "relation", relation: {avID: "employees-db"}}}]}}});
    await loading;
    assert.equal(h.requests.length, 1);
});

for (const field of ["tasks", "employees"]) {
    for (const type of ["relationFilterSearch", "filterValue"]) {
        test(`${field} ${type} preserves dependency context and rejects responses after the host becomes inactive`, async () => {
            const h = createEditor();
            let active = true;
            const scope = {blockID: "source-carrier", relationContext: {
                sourceAvID: "source", sourceItemID: "entry", relationKeyID: "root",
            }, isCurrent: () => active};
            h.data.view.filters[0].column = field;
            if (field === "tasks") h.data.view.filters[0].value = {type: "relation", relation: {blockIDs: ["alice"], contents: []}} as IAVCellValue;
            await h.methods.prepareFilterColumns(h.data, scope);
            const listeners = new Map<string, Array<(event: unknown) => void>>();
            const options = {innerHTML: "unchanged"};
            const dropdown = {isConnected: true, dataset: {path: "0", avId: field === "tasks" ? "tasks-db" : "employees-db", selected: "[]"},
                style: {display: "none"}, querySelector: () => options, querySelectorAll: (): HTMLElement[] => []};
            const panel = {isConnected: true, dataset: {}, querySelector: () => dropdown, querySelectorAll: (): HTMLElement[] => [],
                addEventListener: (event: string, listener: (event: unknown) => void) => {
                    listeners.set(event, [...listeners.get(event) || [], listener]);
                }};
            h.methods.bindInlineFilterEvents(panel as unknown as HTMLElement, h.data, {} as IProtyle, "source-carrier", "target", {
                root: panel as unknown as HTMLElement, save() {},
            });
            const input = {isConnected: true, value: "search", dataset: {type, typeRel: "relation", path: "0"},
                closest: (selector: string) => selector === '[data-filter-events-bound="true"]' ? panel : dropdown};
            h.document.activeElement = input as unknown as HTMLElement;
            for (const listener of listeners.get("input")) listener({target: input});
            assert.deepEqual(JSON.parse(JSON.stringify(h.requests.at(-1).data)), {
                id: dropdown.dataset.avId, keyword: "search", blockID: "source-carrier", relationDependencyContext: {
                    relationContext: scope.relationContext, relationKeyIDs: field === "tasks" ? ["tasks"] : ["tasks", "staff"],
                },
            });
            assert.doesNotThrow(() => h.candidates.at(-1)({code: -1, data: null}));
            options.innerHTML = "unchanged";
            active = false;
            h.candidates.at(-1)({code: 0, data: {rows: {values: [{blockID: "secret", block: {content: "Late secret"}}]}}});
            assert.equal(options.innerHTML, "unchanged");
            const count = h.requests.length;
            for (const listener of listeners.get("input")) listener({target: input});
            assert.equal(h.requests.length, count);
        });
    }
}
