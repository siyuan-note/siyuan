import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const createEditor = () => {
    const rollup = {id: "employees", name: "Employees", type: "rollup",
        rollup: {relationKeyID: "tasks", keyID: "staff"}} as IAVColumn;
    const fields = [rollup, {id: "tasks", type: "relation", relation: {avID: "tasks-db"}}];
    const requests: Array<{url: string, data: {id: string, blockIDs?: string[]}}> = [];
    const methods = {} as typeof import("./filter");
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/filter.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        window: {siyuan: {languages: new Proxy({}, {get: (_, name) => String(name)})}},
        document: {createElement: () => ({style: {}, offsetWidth: 10}), body: {appendChild() {}, removeChild() {}}},
        require: (name: string) => ({
            "./view": {getFieldsByData: () => fields},
            "./col": {getColIconByType: () => "iconDatabase"},
            "../../../util/escape": {escapeAttr: String, escapeHtml: String},
            "../../../constants": {Constants: {}},
            "../../../util/fetch": {fetchSyncPost: async (url: string, data: {id: string, blockIDs?: string[]}) => {
                requests.push({url, data});
                return {code: 0, data: url === "/api/av/getAttributeView" ? {av: {keyValues: [{key: {
                    id: "staff", type: "relation", relation: {avID: "employees-db"},
                }}]}} : {rows: {values: [{blockID: "alice", block: {content: "Alice"}}]}}};
            }},
        })[name] || {},
    });
    const data = {view: {filters: [{column: rollup.id, operator: "Contains any item", value: {
        type: "rollup", rollup: {contents: [{type: "relation", relation: {blockIDs: ["alice"], contents: []}}]},
    }}]}} as IAV;
    return {methods, rollup, data, requests};
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
