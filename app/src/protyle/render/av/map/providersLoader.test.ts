import * as assert from "node:assert/strict";
import {test} from "node:test";
import {AVMapInit, AVMapLoadError} from "./protocol";
import {loadAVMapAdapter} from "./providersLoader";
import {getAVMapLockedPolicy, prepareAVMapBootstrap} from "./bootstrap";
import {AV_MAP_ASSET_TIMEOUT, AV_MAP_READY_TIMEOUT} from "./loadingBudget";
import {startAVMapRuntime} from "./hostRuntime";

const fixture = (options: {ready?: boolean; assetFailure?: boolean; scriptFailure?: boolean; missingSDK?: boolean;
    mapError?: boolean; controlError?: boolean; manualAssets?: boolean; policyFailure?: boolean} = {}) => {
    const requested: any[] = [];
    const elements: any[] = [];
    const mapEvents = new Map<string, () => void>();
    let destroyed = 0;
    class FakeMap {
        constructor() {
            requested.push({mapCreated: true});
            if (options.mapError) throw new Error("private error");
        }
        on(type: string, callback: () => void) {
            mapEvents.set(type, callback);
            if (options.ready !== false && type === "style.load") queueMicrotask(callback);
        }
        off(type: string) { mapEvents.delete(type); }
        addControl() { if (options.controlError) throw new Error("private control failure"); }
        fitBounds(bounds: unknown) { requested.push({bounds}); }
        remove() { destroyed++; }
    }
    const scope: any = {
        setTimeout, clearTimeout, cancelAnimationFrame() {},
        maplibregl: options.missingSDK ? undefined : {Map: FakeMap, AttributionControl: class {},
            Marker: class {
                setLngLat(coordinates: number[]) { requested.push({coordinates}); return this; }
                addTo() { return this; }
                getElement() { return {addEventListener() {}, removeEventListener() {}}; }
                remove() {}
            },
            LngLatBounds: class { extend() {} },
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
            elements.push(element);
            requested.push({tag: element.tag, src: element.src, href: element.href, referrerPolicy: element.referrerPolicy,
                policy: element.content});
            if (element.tag === "meta" && options.policyFailure) throw new Error("private policy failure");
            if (element.tag !== "meta" && !options.manualAssets) queueMicrotask(() =>
                options.assetFailure || options.scriptFailure && element.tag === "script" ? element.onerror?.() : element.onload?.());
        }},
    };
    scope.document = document;
    const container = {ownerDocument: document, replaceChildren() {}, querySelector: () => ({
        classList: {toggle() {}}, addEventListener() {}, removeEventListener() {},
        querySelector: () => ({}),
    })} as unknown as HTMLElement;
    return {scope, requested, elements, container, mapEvents, destroyed: () => destroyed};
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
        await assert.rejects(prepareAVMapBootstrap(scope, "openfreemap", new AbortController().signal), (error: any) => {
            if (options.missingSDK) {
                assert.ok(error instanceof AVMapLoadError);
                assert.equal(error.code, "sdkGlobalMissing");
            } else {
                assert.equal(error.message, "hostUnavailable");
            }
            return true;
        });
        assert.equal(requested.some(request => request.mapCreated || request.worker), false);
        assert.equal(destroyed(), 0);
    }
});

test("script failures and missing SDK globals expose only the controlled diagnostics", async () => {
    for (const options of [{scriptFailure: true}, {missingSDK: true}]) {
        const {scope, requested} = fixture(options);
        await assert.rejects(prepareAVMapBootstrap(scope, "openfreemap", new AbortController().signal), (error: unknown) => {
            assert.ok(error instanceof AVMapLoadError);
            assert.equal(error.code, options.scriptFailure ? "sdkScriptLoadFailed" : "sdkGlobalMissing");
            assert.equal(error.message, "Map loading failed");
            return true;
        });
        assert.equal(requested.some(request => request.url || request.mapCreated || request.worker || request.tag === "meta"), false);
    }
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const controlledTimers = (scope: any) => {
    let serial = 0;
    const pending = new Map<number, {callback: () => void; delay: number}>();
    scope.setTimeout = (callback: () => void, delay: number) => {
        pending.set(++serial, {callback, delay});
        return serial;
    };
    scope.clearTimeout = (id: number) => pending.delete(id);
    return pending;
};

test("style-ready runtime fits records once while slow tiles outlive the old readiness deadline", async () => {
    const f = fixture({ready: false});
    const timers = controlledTimers(f.scope);
    const signal = new AbortController().signal;
    await prepareAVMapBootstrap(f.scope, "openfreemap", signal);
    const replies: any[] = [];
    const port = {onmessage: null as any, postMessage: (value: unknown) => replies.push(value), start() {}, close() {}};
    const stop = startAVMapRuntime(port as unknown as MessagePort, init.instanceID, init.provider, f.container);
    const send = (command: object) => port.onmessage({data: {...init, ...command}});
    try {
        const pending = send(init);
        assert.equal(replies.length, 0);
        const deadline = [...timers.values()].find(timer => timer.delay === AV_MAP_READY_TIMEOUT);
        assert.ok(deadline);
        f.mapEvents.get("style.load")();
        await pending;
        assert.deepEqual(replies, [{version: 1, instanceID: init.instanceID, type: "ready"}]);
        assert.equal(timers.size, 0, "slow tiles no longer retain the adapter readiness timer");
        const point = {id: "row-1", longitude: 121, latitude: 31};
        await send({type: "setPoints", revision: 1, points: [point]});
        await send({type: "setPoints", revision: 2, points: [{...point, id: "row-2"}]});
        assert.deepEqual(f.requested.filter(request => request.coordinates).map(request => request.coordinates), [[121, 31], [121, 31]]);
        assert.equal(f.requested.filter(request => request.bounds).length, 1, "the first points fit before any full-load event");
        // 即使过期计时回调已经入队，也不能销毁已能接收记录的地图。
        deadline.callback();
        assert.equal(f.destroyed(), 0);
        f.mapEvents.get("load")();
        await flush();
        assert.equal(f.destroyed(), 0);
        assert.equal(replies.length, 1);
        assert.equal(f.requested.filter(request => request.bounds).length, 1);
    } finally {
        stop();
    }
    assert.equal(f.destroyed(), 1);
    assert.equal(f.mapEvents.size, 0);
});

test("each packaged asset is bounded and CSP cannot lock before the worker body finishes", async () => {
    const f = fixture({manualAssets: true});
    const timers = controlledTimers(f.scope);
    let finishBody: (source: string) => void;
    f.scope.fetch = async () => ({ok: true, text: () => new Promise<string>(resolve => { finishBody = resolve; })});
    const pending = prepareAVMapBootstrap(f.scope, "openfreemap", new AbortController().signal);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].delay, AV_MAP_ASSET_TIMEOUT);
    assert.deepEqual(f.elements.map(element => element.tag), ["link"]);
    f.elements[0].onload();
    await flush();
    assert.deepEqual(f.elements.map(element => element.tag), ["link", "script"]);
    assert.equal(timers.size, 1);
    f.elements[1].onload();
    await flush();
    assert.equal(timers.size, 1, "the worker response body remains inside the asset deadline");
    assert.equal(f.requested.some(request => request.policy || request.mapCreated || request.worker), false);
    finishBody("/* fixture worker */");
    const dispose = await pending;
    assert.equal(f.elements.at(-1).tag, "meta");
    assert.equal(timers.size, 0);
    dispose();
});

test("abort during slow CSS or script removes handlers and cannot lock CSP from a late load", async () => {
    for (const stage of ["link", "script"]) {
        const f = fixture({manualAssets: true});
        const timers = controlledTimers(f.scope);
        const abort = new AbortController();
        const pending = prepareAVMapBootstrap(f.scope, "openfreemap", abort.signal);
        if (stage === "script") {
            f.elements[0].onload();
            await flush();
        }
        const element = f.elements.at(-1);
        const lateLoad = element.onload;
        abort.abort();
        await assert.rejects(pending, /hostUnavailable/);
        lateLoad();
        assert.equal(element.onload, null);
        assert.equal(element.onerror, null);
        assert.equal(timers.size, 0);
        assert.equal(f.requested.some(request => request.policy || request.mapCreated || request.worker || request.url), false);
    }
});

test("worker header/body timeout and abort settle immediately and ignore late results", async () => {
    for (const stage of ["headers", "body"]) for (const cause of ["timeout", "abort"]) {
        const f = fixture();
        const timers = controlledTimers(f.scope);
        const abort = new AbortController();
        let finishWorker: () => void;
        let requestSignal: AbortSignal;
        f.scope.fetch = async (_url: string, options: RequestInit) => {
            requestSignal = options.signal;
            if (stage === "headers") {
                return new Promise(resolve => { finishWorker = () => resolve({ok: true, text: async () => "/* too late */"}); });
            }
            return {ok: true, text: () => new Promise<string>(resolve => { finishWorker = () => resolve("/* too late */"); })};
        };
        const pending = prepareAVMapBootstrap(f.scope, "openfreemap", abort.signal);
        await flush();
        assert.equal(timers.size, 1);
        if (cause === "timeout") [...timers.values()][0].callback();
        else abort.abort();
        await assert.rejects(pending, /hostUnavailable/);
        assert.equal(requestSignal.aborted, true);
        assert.equal(timers.size, 0);
        finishWorker();
        await flush();
        assert.equal(f.requested.some(request => request.policy || request.mapCreated || request.worker), false);
        await assert.rejects(loadAVMapAdapter(init, f.container, callbacks, new AbortController().signal), /hostUnavailable/);
    }
});

test("control initialization failure disposes the map and revokes its prepared worker", async () => {
    const f = fixture({controlError: true});
    const signal = new AbortController().signal;
    await prepareAVMapBootstrap(f.scope, "openfreemap", signal);
    const revoked: string[] = [];
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = url => { revoked.push(url); original(url); };
    try {
        await assert.rejects(loadAVMapAdapter(init, f.container, callbacks, signal), (error: unknown) => {
            assert.ok(error instanceof AVMapLoadError);
            assert.equal(error.code, "mapCreationFailed");
            return true;
        });
        assert.equal(f.destroyed(), 1);
        assert.deepEqual(revoked, [f.requested.find(request => request.worker).worker]);
        await assert.rejects(loadAVMapAdapter(init, f.container, callbacks, signal), /hostUnavailable/);
    } finally {
        URL.revokeObjectURL = original;
    }
});

test("failed worker or CSP preparation cannot leave usable prepared assets", async () => {
    for (const stage of ["workerResponse", "workerBody", "workerThrow", "policy"]) {
        const f = fixture({policyFailure: stage === "policy"});
        const timers = controlledTimers(f.scope);
        if (stage === "workerResponse") f.scope.fetch = async () => ({ok: false});
        if (stage === "workerBody") f.scope.fetch = async () => ({ok: true, text: async () => { throw new Error("private body"); }});
        if (stage === "workerThrow") f.scope.fetch = () => { throw new Error("private request"); };
        await assert.rejects(prepareAVMapBootstrap(f.scope, "openfreemap", new AbortController().signal), /hostUnavailable/);
        assert.equal(timers.size, 0);
        await assert.rejects(loadAVMapAdapter(init, f.container, callbacks, new AbortController().signal), /hostUnavailable/);
        assert.equal(f.requested.some(request => request.mapCreated || request.worker), false);
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
        scope.setTimeout = (callback: () => void, delay: number) => {
            assert.equal(delay, AV_MAP_READY_TIMEOUT);
            timer = callback;
            return 1;
        };
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
