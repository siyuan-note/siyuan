import * as assert from "node:assert/strict";
import {test} from "node:test";
import {compileModule, evaluateModule} from "../../../testSupport/loadModule";

const compiled = compileModule("src/protyle/render/av/httpRender.ts");
const fixture = (header = false, publish = false, cells = true) => {
    const events: string[] = [];
    const attributes = new Map<string, string>();
    const indicators: Array<{removed: boolean; remove: () => void; setAttribute: () => void}> = [];
    let current = true;
    let finish: (value: unknown) => void;
    let reject: (error: Error) => void;
    const final = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
    const requests: Record<string, unknown>[] = [];
    const owner = {
        querySelector: (selector: string) => selector === ".av__header" ? header : {after() {}},
        querySelectorAll: () => cells ? [{closest: (): null => null, replaceChildren: () => events.push("loading")}] : [],
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as HTMLElement;
    const initial = {code: 0, data: {view: {}, pendingHTTPTemplates: ["template"]}};
    const api = evaluateModule<typeof import("./httpRender")>(compiled, {
        CSS: {escape: (id: string) => id},
        window: {siyuan: {isPublish: publish, languages: {templateHTTPRequesting: "Loading"}}},
        document: {createElement: () => {
            const indicator = {removed: false, remove: () => { indicator.removed = true; }, setAttribute() {}};
            indicators.push(indicator);
            return indicator;
        }},
        require: () => ({
            isAVRenderData: (data: {view?: unknown}) => !!data?.view,
            fetchSyncPost: async (_url: string, request: Record<string, unknown>) => {
                requests.push(request);
                events.push(request.deferHTTPTemplates ? "preview-request" : "network-request");
                return request.deferHTTPTemplates ? initial : final;
            },
        }),
    });
    const controller = new AbortController();
    const run = (preview?: () => Promise<void>) => api.fetchAVRender({id: "database", automaticRefresh: false},
        controller.signal, owner, () => current, preview || (async () => { events.push("render-preview"); header = true; }));
    return {run, events, attributes, indicators, requests, initial, finish: (value = {code: 0, data: {view: {}}}) => finish(value),
        reject: () => reject(new Error("offline")), invalidate: () => { current = false; }, controller};
};

test("database rows and template loading indicators render before the HTTP result arrives", async () => {
    const f = fixture();
    const pending = f.run();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.events, ["preview-request", "render-preview", "loading", "network-request"]);
    assert.equal(f.attributes.get("aria-busy"), "true");
    assert.equal(f.requests[1].deferHTTPTemplates, undefined);
    f.finish();
    await pending;
    assert.equal(f.attributes.has("aria-busy"), false);
    assert.ok(f.indicators.every(indicator => indicator.removed));
});

test("views awaiting template filtering show a loading indicator without provisional rows", async () => {
    const f = fixture(false, false, false);
    const pending = f.run();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.indicators.length, 1);
    f.finish();
    await pending;
    assert.ok(f.indicators[0].removed);
});

test("closing or replacing the preview prevents its pending HTTP execution from starting", async () => {
    const f = fixture();
    await f.run(async () => { f.invalidate(); });
    assert.equal(f.requests.length, 1);
    assert.equal(f.attributes.has("aria-busy"), false);
});

test("a failed or invalidated HTTP execution clears its loading state", async () => {
    const f = fixture();
    const pending = f.run();
    const rejected = assert.rejects(pending, /offline/);
    await new Promise(resolve => setImmediate(resolve));
    f.invalidate();
    f.reject();
    await rejected;
    assert.equal(f.attributes.has("aria-busy"), false);
    assert.ok(f.indicators.every(indicator => indicator.removed));
});

test("manual refresh and published rendering keep the existing single request path", async () => {
    for (const [header, publish] of [[true, false], [false, true]]) {
        const f = fixture(header, publish);
        const pending = f.run();
        f.finish();
        await pending;
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].deferHTTPTemplates, undefined);
        assert.equal(f.events.includes("render-preview"), false);
    }
});

test("a loading preview cannot consume a pending locate request or persist a provisional view", () => {
    const api = evaluateModule<typeof import("./locate")>(compileModule("src/protyle/render/av/locate.ts"), {
        require: () => ({}), window: {siyuan: {}},
    });
    const data = {pendingHTTPTemplates: ["template"]} as IAV;
    assert.equal(api.persistAVLocateView(null, null, data), false);
    assert.equal(api.prepareAVLocate(null, data, null), undefined);
    assert.equal(api.finishAVLocate(null, null, data), undefined);
});
