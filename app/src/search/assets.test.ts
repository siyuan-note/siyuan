import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const createRuntime = (mobile: boolean) => {
    const {parse} = require("ifdef-loader/preprocessor");
    const compile = (file: string) => transpileModule(parse(readFileSync(file, "utf8"), {MOBILE: mobile, BROWSER: false}, false, true), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const timers = new Map<number, () => void>();
    let timerID = 0;
    const requests: {url: string, data: {query?: string}, callback?: (response: unknown) => void}[] = [];
    const items: {label: string, click?: () => void}[] = [];
    const panels: {isConnected: boolean, attributes: Map<string, string>}[] = [];
    const localSearch = {method: 3, sort: 0, types: {}, layout: 0};
    const document = {querySelectorAll: () => panels.filter(panel => panel.isConnected && panel.attributes.has("data-asset-search"))};
    const window = {
        setTimeout: (callback: () => void) => {timers.set(++timerID, callback); return timerID;},
        siyuan: {
            languages: new Proxy({}, {get: (_target, name) => name}),
            storage: {assets: localSearch},
            menus: {menu: {element: {setAttribute() {}}, append: (item: {label: string}) => items.push(item)}},
        },
    };
    const createPanel = (query: string) => {
        const values = new Set<string>();
        const classList = {add: (value: string) => values.add(value), remove: (value: string) => values.delete(value)};
        const loading = {classList, style: {} as Record<string, string>};
        const input = {value: query};
        const result = {innerHTML: ""};
        const list = {innerHTML: ""};
        const control = {setAttribute() {}, removeAttribute() {}};
        const panel = {
            isConnected: true,
            attributes: new Map<string, string>(),
            setAttribute: (name: string, value: string) => panel.attributes.set(name, value),
            parentElement: {querySelector: () => loading},
            querySelector: (selector: string) => {
                if (selector === "#searchAssetInput") return input;
                if (selector === "#searchAssetResult") return result;
                if (selector === "#searchAssetList") return list;
                if (selector === "#searchAssetPreview" || selector === ".search__drag") return {classList};
                return control;
            },
            input, result, list, loadingValues: values,
        };
        panels.push(panel);
        return panel;
    };
    const api = {} as typeof import("./assets");
    const clearTimeout = (id: number) => timers.delete(id);
    runInNewContext(compile("src/search/assets.ts"), {exports: api, window, document, clearTimeout,
        require: (name: string) => {
            if (name === "../constants") return {Constants: {LOCAL_SEARCHASSET: "assets", TIMEOUT_INPUT: 1}};
            if (name === "../util/fetch") return {fetchPost: (url: string, data: object, callback: () => void) => {
                requests.push({url, data, callback});
                return Promise.resolve();
            }};
            if (name === "../menus/menuToggle") return {toggleMenu: ({build}: {build: (menu: object, session: object) => void}) => build({}, {show() {}})};
            if (name === "../menus/Menu") return {MenuItem: class {
                public element: object;
                constructor(options: object) {this.element = options;}
            }};
            return {};
        }});
    const messages = {} as typeof import("../util/processMessage");
    runInNewContext(compile("src/util/processMessage.ts"), {exports: messages, window, document,
        require: (name: string) => name === "../search/assets" ? api : {showMessage() {}}});
    const runTimers = () => {
        const pending = Array.from(timers.values());
        timers.clear();
        pending.forEach(callback => callback());
    };
    return {api, messages, requests, timers, items, createPanel, runTimers};
};

for (const mobile of [false, true]) {
    test(`asset rebuild submission waits for completion before refreshing current queries (mobile=${mobile})`, () => {
        const runtime = createRuntime(mobile);
        const first = runtime.createPanel("old query");
        const second = runtime.createPanel("another query");
        runtime.api.assetInputEvent(first as unknown as Element);
        runtime.api.assetInputEvent(second as unknown as Element);
        runtime.runTimers();
        runtime.requests.length = 0;
        runtime.api.assetMoreMenu({getBoundingClientRect: () => ({right: 0, bottom: 0, height: 0})} as Element,
            first as unknown as Element, () => {});
        runtime.items.find(item => item.label === "rebuildAssetContentIndex").click();
        assert.deepEqual(runtime.requests.map(item => item.url), ["/api/asset/fullReindexAssetContent"]);
        assert.equal(runtime.timers.size, 0);
        first.input.value = "latest query";
        assert.equal(runtime.messages.processMessage({cmd: "assetContentIndexCompleted", code: 0} as IWebSocketData), false);
        assert.equal(runtime.timers.size, 2);
        runtime.runTimers();
        const searches = runtime.requests.filter(item => item.url === "/api/search/fullTextSearchAssetContent");
        assert.deepEqual(searches.map(item => item.data.query), ["latest query", "another query"]);
        searches.forEach(request => request.callback({data: {assetContents: [], pageCount: 0, matchedAssetCount: 0}}));
        assert.ok(first.loadingValues.has("fn__none"));
        assert.ok(second.loadingValues.has("fn__none"));
        assert.ok(first.result.innerHTML.includes("total 0"));
    });

    test(`asset search debounce is per panel and ignores closed panels (mobile=${mobile})`, () => {
        const runtime = createRuntime(mobile);
        const first = runtime.createPanel("first");
        const closed = runtime.createPanel("closed");
        runtime.api.assetInputEvent(first as unknown as Element);
        runtime.api.assetInputEvent(closed as unknown as Element);
        first.input.value = "changed";
        runtime.api.assetInputEvent(first as unknown as Element);
        closed.isConnected = false;
        runtime.runTimers();
        assert.deepEqual(runtime.requests.map(item => item.data.query), ["changed"]);
        runtime.requests.length = 0;
        runtime.messages.processMessage({cmd: "assetContentIndexCompleted", code: -1, msg: "failed"} as IWebSocketData);
        assert.equal(runtime.timers.size, 0);
        const unrelated = {cmd: "backgroundtask", code: 0, data: {tasks: []}} as IWebSocketData;
        assert.equal(runtime.messages.processMessage(unrelated), unrelated);
    });

    test(`a search started before rebuild completion cannot overwrite refreshed results (mobile=${mobile})`, () => {
        const runtime = createRuntime(mobile);
        const panel = runtime.createPanel("query");
        runtime.api.assetInputEvent(panel as unknown as Element);
        runtime.runTimers();
        const oldRequest = runtime.requests[0];
        runtime.messages.processMessage({cmd: "assetContentIndexCompleted", code: 0} as IWebSocketData);
        runtime.runTimers();
        runtime.requests[1].callback({data: {assetContents: [], pageCount: 1, matchedAssetCount: 2}});
        const refreshed = panel.result.innerHTML;
        oldRequest.callback({data: {assetContents: [], pageCount: 0, matchedAssetCount: 0}});
        assert.equal(panel.result.innerHTML, refreshed);
        assert.ok(refreshed.includes("total 2"));
    });
}
