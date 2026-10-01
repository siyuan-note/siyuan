import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/search/avPreview.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = () => {
    let resolveFetch: (value: unknown) => void;
    let resolveRender: () => void;
    let renderedCallback: (data: unknown) => void;
    let current = true;
    let itemVisible = true;
    let fieldVisible = true;
    const field = {};
    const item = {querySelector: () => fieldVisible ? field : null};
    const block = {isConnected: true, removeAttribute() {}, querySelector: () => itemVisible ? item : null};
    const protyle = {element: {isConnected: true}, wysiwyg: {element: {querySelector: () => block}}};
    const requests: {itemID: string, keyID?: string, viewID?: string, select?: boolean, persistView?: boolean}[] = [];
    const fetches: unknown[] = [];
    const api = {} as typeof import("./avPreview");
    const window = {siyuan: {isPublish: false}};
    runInNewContext(compiled, {
        exports: api,
        window,
        require: (name: string) => ({
            "../util/fetch": {fetchSyncPost: (_url: string, data: unknown) => {
                fetches.push(data);
                return new Promise(resolve => { resolveFetch = resolve; });
            }},
            "../protyle/render/av/locate": {setAVLocateRequest: (_block: unknown, request: typeof requests[number]) => {
                assert.equal(_block, block);
                requests.push(request);
            }},
            "../protyle/render/av/render": {avRender: (_block: unknown, _protyle: unknown, callback: typeof renderedCallback) => {
                assert.equal(_block, block);
                assert.equal(_protyle, protyle);
                renderedCallback = callback;
                return new Promise<void>(resolve => { resolveRender = resolve; });
            }},
        })[name],
    });
    return {
        api, protyle, block, item, field, requests, fetches, window,
        options: {protyle: protyle as unknown as IProtyle, id: "database", method: 0,
            keywords: ["needle"], isCurrent: () => current},
        setCurrent(value: boolean) { current = value; },
        setItemVisible(value: boolean) { itemVisible = value; },
        setFieldVisible(value: boolean) { fieldVisible = value; },
        async fetched(data: unknown = {itemID: "row", matchedKeyID: "field", viewID: "other-view"}) {
            resolveFetch({code: 0, data});
            await new Promise(resolve => setImmediate(resolve));
        },
        rendered(status = "visible") {
            renderedCallback({target: {status}});
            resolveRender();
        },
    };
};

test("database preview loads the matched item before exposing its field and keeps the current view", async () => {
    const state = setup();
    let completed = false;
    const pending = state.api.locateSearchAVPreview(state.options).then(result => {
        completed = true;
        return result;
    });
    await state.fetched();
    assert.equal(completed, false);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].itemID, "row");
    assert.equal(state.requests[0].keyID, "field");
    assert.equal(state.requests[0].viewID, undefined);
    assert.equal(state.requests[0].persistView, false);
    assert.equal(state.requests[0].select, false);
    state.rendered();
    const result = await pending;
    assert.equal(result.rootElement, state.block);
    assert.equal(result.currentElement, state.field);
    assert.equal(result.unavailable, false);
});

test("database preview rejects stale fetches and detached blocks before locating", async () => {
    for (const detach of [false, true]) {
        const state = setup();
        const pending = state.api.locateSearchAVPreview(state.options);
        if (detach) {
            state.block.isConnected = false;
        } else {
            state.setCurrent(false);
        }
        await state.fetched();
        assert.equal(await pending, undefined);
        assert.equal(state.requests.length, 0);
    }
});

test("database preview rejects a render completed after another search", async () => {
    const state = setup();
    const pending = state.api.locateSearchAVPreview(state.options);
    await state.fetched();
    state.setCurrent(false);
    state.rendered();
    assert.equal(await pending, undefined);
});

test("database preview preserves filtered and hidden groups and falls back to the row for hidden fields", async () => {
    for (const status of ["filtered", "groupHidden", "itemNotFound", "visible"]) {
        const state = setup();
        state.setItemVisible(status === "visible");
        state.setFieldVisible(false);
        const pending = state.api.locateSearchAVPreview(state.options);
        await state.fetched();
        state.rendered(status);
        const result = await pending;
        assert.equal(result.unavailable, status !== "visible");
        assert.equal(result.currentElement, status === "visible" ? state.item : undefined);
    }
});

test("database preview skips absent value matches, unsupported search methods and publish mode", async () => {
    const state = setup();
    const pending = state.api.locateSearchAVPreview(state.options);
    await state.fetched(null);
    assert.equal(await pending, undefined);
    assert.equal(state.requests.length, 0);
    for (const method of [2, 4]) {
        assert.equal(await state.api.locateSearchAVPreview({...state.options, method}), undefined);
    }
    state.window.siyuan.isPublish = true;
    assert.equal(await state.api.locateSearchAVPreview(state.options), undefined);
    assert.equal(state.fetches.length, 1);
});

test("preview request identity isolates editors, repeated block searches and closed previews", () => {
    const state = setup();
    const first = state.api.beginSearchPreviewRequest(state.protyle as unknown as IProtyle);
    const other = {element: {isConnected: true}};
    const independent = state.api.beginSearchPreviewRequest(other as unknown as IProtyle);
    assert.equal(first(), true);
    const second = state.api.beginSearchPreviewRequest(state.protyle as unknown as IProtyle);
    assert.equal(first(), false);
    assert.equal(second(), true);
    assert.equal(independent(), true);
    state.protyle.element.isConnected = false;
    assert.equal(second(), false);
});

test("stale preview locate requests cannot scroll, highlight or show filtered-item messages", () => {
    const source = transpileModule(readFileSync("src/protyle/render/av/locate.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const requests = new WeakMap();
    const api = {} as typeof import("../protyle/render/av/locate");
    runInNewContext(source, {
        exports: api,
        require: (name: string) => name === "./locateState" ? {locateRequests: requests} : {},
    });
    const block = {isConnected: true} as HTMLElement;
    const data = {target: {status: "filtered", itemID: "row"}} as IAV;
    const request = {itemID: "row", isValid: () => false};
    for (const action of [
        () => api.getAVLocateParams(block),
        () => api.prepareAVLocate(block, data, {virtualData: {}}),
        () => api.finishAVLocate(block, {} as IProtyle, data),
    ]) {
        api.setAVLocateRequest(block, request);
        action();
        assert.equal(requests.has(block), false);
    }
});
