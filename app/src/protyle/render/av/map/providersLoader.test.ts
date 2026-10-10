import * as assert from "node:assert/strict";
import {test} from "node:test";
import {AVMapInit, AVMapLoadError} from "./protocol";
import {loadAVMapAdapter} from "./providersLoader";
import {getAVMapLockedPolicy, prepareAVMapBootstrap} from "./bootstrap";

const fixture = (options: {ready?: boolean; assetFailure?: boolean; missingSDK?: boolean; mapError?: boolean} = {}) => {
    const requested: any[] = [];
    let destroyed = 0;
    class FakeMap {
        constructor() {
            requested.push({mapCreated: true});
            if (options.mapError) throw new Error("private error");
        }
        on(type: string, callback: () => void) {
            if (options.ready !== false && type === "load") queueMicrotask(callback);
        }
        off() {}
        addControl() {}
        remove() { destroyed++; }
    }
    const scope: any = {
        setTimeout, clearTimeout, cancelAnimationFrame() {},
        maplibregl: options.missingSDK ? undefined : {Map: FakeMap, AttributionControl: class {},
            setWorkerUrl: (url: string) => requested.push({worker: url})},
        fetch: async (url: string, options: unknown) => {
            requested.push({url, options});
            return {ok: true, text: async () => "/* fixture worker */"};
        },
    };
    const document: any = {
        defaultView: scope, documentElement: {dataset: {}},
        addEventListener() {}, removeEventListener() {},
        createElement: (tag: string) => ({tag, remove() {}}),
        head: {appendChild: (element: any) => {
            requested.push({tag: element.tag, src: element.src, href: element.href, referrerPolicy: element.referrerPolicy,
                policy: element.content});
            if (element.tag !== "meta") queueMicrotask(() => options.assetFailure ? element.onerror?.() : element.onload?.());
        }},
    };
    scope.document = document;
    const container = {ownerDocument: document, replaceChildren() {}, querySelector: () => ({
        classList: {toggle() {}}, addEventListener() {}, removeEventListener() {},
        querySelector: () => ({}),
    })} as unknown as HTMLElement;
    return {scope, requested, container, destroyed: () => destroyed};
};
const init: AVMapInit = {version: 1, instanceID: "fixture", type: "init", provider: "openfreemap", theme: "light"};
const callbacks = {onMarkerClick() {}, onError() {}};

test("loads packaged MapLibre and anonymous worker source before the CSP lock", async () => {
    const {scope, requested, container, destroyed} = fixture();
    const signal = new AbortController().signal;
    await assert.rejects(loadAVMapAdapter(init, container, callbacks, signal), /hostUnavailable/);
    assert.equal(requested.length, 0);
    const dispose = await prepareAVMapBootstrap(scope, "openfreemap", signal);
    assert.equal(requested.some(request => request.worker || request.mapCreated), false);
    assert.equal(requested.at(-1).tag, "meta");
    const lockedAt = requested.length - 1;
    const adapter = await loadAVMapAdapter(init, container, callbacks, signal);
    const scripts = requested.filter(request => request.tag === "script");
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, "/stage/build/map/maplibre-gl.js");
    assert.equal(scripts[0].referrerPolicy, "no-referrer");
    assert.equal(requested.find(request => request.tag === "link").href, "/stage/build/map/maplibre-gl.css");
    const worker = requested.find(request => request.url);
    assert.equal(worker.url, "/stage/build/map/maplibre-gl-csp-worker.js");
    assert.equal(worker.options.credentials, "omit");
    assert.equal(worker.options.cache, "no-store");
    assert.equal(worker.options.mode, "cors");
    assert.match(requested.find(request => request.worker).worker, /^blob:/);
    assert.ok(requested.findIndex(request => request.worker) > lockedAt);
    assert.ok(requested.findIndex(request => request.mapCreated) > lockedAt);
    assert.equal(requested.slice(lockedAt + 1).some(request => request.url || request.tag === "script"), false);
    adapter.destroy();
    adapter.destroy();
    dispose();
    assert.equal(destroyed(), 1);
});

test("locked policy removes local access and permits only the tile origin", () => {
    const policy = getAVMapLockedPolicy("openfreemap");
    assert.equal(/localhost|127\.0\.0\.1|stage\/|nonce-|sha256-|\bself\b|unsafe-eval/.test(policy), false);
    assert.match(policy, /script-src 'none'/);
    assert.match(policy, /connect-src https:\/\/tiles\.openfreemap\.org;/);
    assert.match(policy, /frame-src 'none'/);
    assert.match(policy, /form-action 'none'/);
    for (const provider of ["amap", "tencent", "baidu"]) {
        assert.throws(() => getAVMapLockedPolicy(provider as any), /invalidConfiguration/);
    }
});

test("missing assets or SDK never create a map", async () => {
    for (const options of [{assetFailure: true}, {missingSDK: true}]) {
        const {scope, requested, destroyed} = fixture(options);
        await assert.rejects(prepareAVMapBootstrap(scope, "openfreemap", new AbortController().signal), /hostUnavailable/);
        assert.equal(requested.some(request => request.mapCreated || request.worker), false);
        assert.equal(destroyed(), 0);
    }
});

test("removed providers cannot load assets or initialize an adapter", async () => {
    for (const provider of ["amap", "tencent", "baidu"]) {
        const {scope, requested, container} = fixture();
        const signal = new AbortController().signal;
        await assert.rejects(prepareAVMapBootstrap(scope, provider as any, signal), /hostUnavailable/);
        await assert.rejects(loadAVMapAdapter({...init, provider: provider as any}, container, callbacks, signal), /hostUnavailable/);
        assert.equal(requested.length, 0);
    }
});

test("abort destroys a map that has not become ready", async () => {
    const {scope, container, destroyed} = fixture({ready: false});
    const abort = new AbortController();
    await prepareAVMapBootstrap(scope, "openfreemap", abort.signal);
    const pending = loadAVMapAdapter(init, container, callbacks, abort.signal);
    await new Promise(resolve => setImmediate(resolve));
    abort.abort();
    await assert.rejects(pending, /sdkUnavailable/);
    assert.equal(destroyed(), 1);
});

test("construction and ready failures return controlled stages", async () => {
    for (const mapError of [true, false]) {
        const {scope, container, destroyed} = fixture({mapError, ready: false});
        const signal = new AbortController().signal;
        await prepareAVMapBootstrap(scope, "openfreemap", signal);
        let timer: () => void;
        scope.setTimeout = (callback: () => void) => { timer = callback; return 1; };
        scope.clearTimeout = () => {};
        const pending = loadAVMapAdapter(init, container, callbacks, signal);
        const rejected = assert.rejects(pending, (error: unknown) => {
            assert.ok(error instanceof AVMapLoadError);
            assert.equal(error.code, mapError ? "mapCreationFailed" : "mapReadyTimeout");
            assert.equal(error.message, "Map loading failed");
            return true;
        });
        if (!mapError) timer();
        await rejected;
        assert.equal(destroyed(), mapError ? 0 : 1);
    }
});
