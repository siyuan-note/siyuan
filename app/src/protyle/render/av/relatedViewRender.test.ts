import * as assert from "node:assert/strict";
import {test} from "node:test";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";

const compiled = compileModule("src/protyle/render/av/render.ts");

const fixture = () => {
    const requests: Array<{url: string; payload: Record<string, unknown>; signal: AbortSignal}> = [];
    const failures: string[] = [];
    const host = {active: true, sourceBlockID: "real-source-carrier", viewID: "configured-table",
        relationContext: {sourceAvID: "source", sourceItemID: "source-entry", relationKeyID: "relation"},
        temporaryFilters: [{column: "status", operator: "IsEmpty"}], temporarySort: {column: "title", order: "DESC"},
        failed: (message?: string) => failures.push(message)};
    const block = {
        style: {}, firstElementChild: {innerHTML: "loading"}, isConnected: true,
        classList: {add() {}},
        getAttribute: (name: string) => ({"data-type": "NodeAttributeView", "data-av-id": "target", "data-av-type": "table"})[name] || null,
        closest: (): null => null, removeAttribute() {}, querySelector: (): null => null, querySelectorAll: (): [] => [],
    } as unknown as HTMLElement;
    const editor = {options: {}, block: {}, contentElement: {scrollTop: 0}} as IProtyle;
    let current = true;
    let mobile = false;
    let responder: () => Promise<unknown> = async () => ({code: -1, msg: "repair configured view"});
    const imports: Record<string, unknown> = {
        Constants: {}, getAVRelationHost: () => host,
        getAVSelectedItemPoints: (): [] => [],
        getPageSize: () => ({unGroupPage: 2, unGroupPageSize: 20, groupPageSize: {}}),
        getSubItemsRequest: () => { throw new Error("Related table must not recursively load nested views"); },
        isCurrentAVRender: () => current,
        guardTemplateHTTPRequest: () => ({signal: new AbortController().signal, dispose() {}}),
        isAVRenderData: (data: {view?: unknown}) => !!data?.view,
        isMobile: () => mobile,
        fetchSyncPost: async (url: string, payload: Record<string, unknown>, _callback: unknown, _show: boolean, signal: AbortSignal) => {
            requests.push({url, payload, signal});
            return responder();
        },
    };
    const api = evaluateModule<typeof import("./render")>(compiled, {
        window: {siyuan: {}}, document: {activeElement: null},
        require: () => new Proxy(imports, {get: (target, key: string) => target[key] || ((): undefined => undefined)}),
    });
    return {api, host, block, editor, requests, failures,
        setCurrent: (value: boolean) => { current = value; }, setMobile: (value: boolean) => { mobile = value; },
        respond: (value: typeof responder) => { responder = value; }};
};

test("desktop and mobile native rendering restrict by entry membership and preserve panel-local filters before paging", async () => {
    for (const mobile of [false, true]) {
        const state = fixture(); state.setMobile(mobile);
        await state.api.avRender(state.block, state.editor);
        assert.equal(state.requests.length, 1);
        const {url, payload, signal} = state.requests[0];
        assert.equal(url, "/api/av/renderAttributeView");
        assert.equal(payload.id, "target");
        assert.equal(payload.blockID, "real-source-carrier");
        assert.equal(payload.viewID, "configured-table");
        assert.equal(payload.relationContext, state.host.relationContext);
        assert.equal(payload.temporaryFilters, state.host.temporaryFilters);
        assert.equal(payload.temporarySort, state.host.temporarySort);
        assert.equal(payload.createIfNotExist, false);
        assert.equal(payload.page, 2);
        assert.equal(payload.pageSize, 20);
        assert.equal(payload.nested, undefined);
        assert.ok(signal instanceof AbortSignal);
        assert.deepEqual(state.failures, ["repair configured view"]);
    }
});

test("related history and snapshot hosts fail closed without requesting an unscoped target or live fallback", async () => {
    for (const history of [{created: "archive"}, {snapshot: "snapshot"}]) {
        const state = fixture(); state.editor.options.history = history;
        await state.api.avRender(state.block, state.editor);
        assert.equal(state.requests.length, 0);
        assert.equal(state.failures.length, 1);
    }
});

test("automatic database refresh requests reuse inputs while manual refresh requests fresh evaluation", async () => {
    for (const mobile of [false, true]) {
        const state = fixture();
        state.setMobile(mobile);
        await state.api.avRender(state.block, state.editor, undefined, true, undefined, true);
        assert.equal(state.requests[0].payload.automaticRefresh, true);
        await state.api.avRender(state.block, state.editor);
        assert.equal(state.requests[1].payload.automaticRefresh, false);
    }
});

test("inactive related tables never load and stale responses never replace the active panel", async () => {
    const state = fixture(); state.host.active = false;
    await state.api.avRender(state.block, state.editor);
    assert.equal(state.requests.length, 0);
    state.host.active = true;
    let resolve: (response: unknown) => void;
    state.respond(() => new Promise(reply => { resolve = reply; }));
    const rendering = state.api.avRender(state.block, state.editor);
    state.setCurrent(false);
    resolve({code: -1, msg: "stale error"});
    await rendering;
    assert.equal(state.failures.length, 0);
});

test("unsupported target layout and missing configured views never silently fall back", async () => {
    const state = fixture();
    state.respond(async () => ({code: 0, data: {view: {}, viewType: "gallery"}}));
    await state.api.avRender(state.block, state.editor);
    assert.equal(state.requests.length, 1);
    assert.equal(state.failures.length, 1);
});
