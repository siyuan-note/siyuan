import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
const {createMockRequire} = require("../../../tests/fixtures/mockModules.cjs");

const harness = () => {
    const handlers = new Map<string, (event?: unknown) => void>();
    const list = {innerHTML: "", isConnected: true, addEventListener() {}};
    const input = {value: "", addEventListener: (name: string, cb: () => void) => handlers.set("input:" + name, cb)};
    const select = {value: "", addEventListener: (name: string, cb: () => void) => handlers.set("select:" + name, cb)};
    const element = {querySelector: (selector: string) => selector === "ul" ? list : selector === "input" ? input : select};
    const requests: Array<{url: string, data: any, receive: (response: any) => void}> = [];
    let clear: () => void;
    let isActive: () => boolean;
    let destroy: () => void;
    let updates = 0;
    const exports: any = {};
    runInNewContext(transpileModule(readFileSync("src/mobile/menu/getRecentDocs.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, window: {siyuan: {config: {fileTree: {recentDocsSort: "viewedAt"}}, languages: {}}},
        require: createMockRequire({
            "../../config/tabs/fileRuntime": {fileConfigApi: {patch: async () => {}}},
            "../../util/fetch": {fetchPost: (url: string, data: any, receive: (response: any) => void) => requests.push({url, data, receive})},
            "../../emoji/fileTreeIcon": {getFileTreeIconHTML: () => ""},
            "../../constants": {Constants: {}},
            "../../util/escape": {escapeHtml: (text: string) => text},
            "../../protyle/util/hasClosest": {},
            "../editor": {},
            "../../business/clearRecentDocs": {
                clearRecentDocsButtonHTML: () => "<button data-action=\"clear-recent-docs\"></button>",
                bindClearRecentDocs: (_button: unknown, _getSort: unknown, active: () => boolean, callback: () => void) => {
                    isActive = active;
                    clear = callback;
                    return () => updates++;
                },
            },
            "./model": {openModel: (options: any) => { destroy = options.destroyCallback; options.bindEvent(element); }},
        })});
    exports.getRecentDocs({});
    requests[0].receive({data: [{rootID: "old", title: "Old"}]});
    return {list, input, select, requests, handlers, clear: () => clear(), isActive: () => isActive(),
        destroy: () => destroy(), updates: () => updates};
};

test("mobile clear invalidates old sort responses and cached search records", () => {
    const h = harness();
    assert.match(h.list.innerHTML, /data-node-id="old"/);
    h.select.value = "closedAt";
    h.handlers.get("select:change")();
    assert.equal(h.updates(), 1);
    h.clear();
    assert.equal(h.list.innerHTML, "");
    assert.equal(h.requests[2].data.sortBy, "closedAt");
    h.requests[1].receive({data: [{rootID: "stale", title: "Stale"}]});
    assert.equal(h.list.innerHTML, "");
    h.input.value = "Old";
    h.handlers.get("input:input")({isComposing: false});
    assert.equal(h.list.innerHTML, "");
    h.input.value = "";
    h.requests[2].receive({data: [{rootID: "new", title: "New"}]});
    assert.match(h.list.innerHTML, /data-node-id="new"/);
});

test("mobile clear preserves creation and modification lists selected while confirmation was open", () => {
    for (const sort of ["created", "updated"]) {
        const h = harness();
        h.select.value = sort;
        h.handlers.get("select:change")();
        h.requests[1].receive({data: [{rootID: sort, title: sort}]});
        h.clear();
        assert.match(h.list.innerHTML, new RegExp(`data-node-id="${sort}"`));
        assert.equal(h.requests[2].data.sortBy, sort);
    }
});

test("mobile model close rejects late sort responses and invalidates clear ownership", () => {
    const h = harness();
    h.handlers.get("select:change")();
    h.destroy();
    assert.equal(h.isActive(), false);
    h.requests[1].receive({data: [{rootID: "late", title: "Late"}]});
    assert.doesNotMatch(h.list.innerHTML, /data-node-id="late"/);
});
