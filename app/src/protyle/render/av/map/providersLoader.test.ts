import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {AVMapInit, AVMapLoadError, AVMapLoadErrorCode, AVMapProvider} from "./protocol";
import {loadAVMapAdapter} from "./providersLoader";
import {getAVMapLockedPolicy, prepareAVMapBootstrap} from "./bootstrap";

const fixture = (ready = true, scriptError = false,
                 options: {skipCallback?: boolean; missingSDK?: boolean; mapError?: boolean; appendError?: boolean} = {}) => {
    const requested: any[] = [];
    let destroyed = 0;
    class FakeMap {
        constructor() {
            requested.push({mapCreated: true});
            if (options.mapError) {
                throw new Error("https://fixture.invalid?key=private");
            }
        }
        on(type: string, callback: () => void) {
            if (ready && ["load", "complete", "tilesloaded"].includes(type)) {
                queueMicrotask(callback);
            }
        }
        off() {}
        addEventListener(type: string, callback: () => void) { this.on(type, callback); }
        removeEventListener() {}
        remove() { destroyed++; }
        destroy() { destroyed++; }
        centerAndZoom() {}
        enableScrollWheelZoom() {}
        disableMapClick() {}
        disableIconInfoWindow() {}
        addOverlay() {}
        removeOverlay() {}
        clearOverlays() {}
    }
    const sdk = {Map: FakeMap, MultiMarker: class {
        setGeometries() {}
        setMap() {}
    }, Marker: class {
        constructor(_point: unknown, options: unknown) { requested.push({markerOptions: options}); }
        addEventListener() {}
        removeEventListener() {}
    }, MarkerStyle: class {}, LatLng: class {}, Point: class {}, setWorkerUrl: (url: string) => requested.push({worker: url})};
    const scope: any = {
        setTimeout, clearTimeout, maplibregl: sdk,
        BMAP_COORD_BD09: "official-bd09", BMAP_COORD_GCJ02: "official-gcj02",
        fetch: async (url: string, options: unknown) => {
            requested.push({url, options});
            return {ok: true, text: async () => "/* fixture worker */"};
        },
    };
    const document: any = {
        defaultView: scope, documentElement: {dataset: {}},
        createElement: (tag: string) => ({tag, remove() {}}),
        head: {appendChild: (element: any) => {
            requested.push({tag: element.tag, src: element.src, href: element.href, referrerPolicy: element.referrerPolicy,
                policy: element.content});
            if (element.tag === "link") {
                queueMicrotask(() => element.onload?.());
            }
            if (element.tag === "script") {
                if (options.appendError) {
                    throw new Error("https://fixture.invalid?key=private");
                }
                queueMicrotask(() => {
                    if (scriptError) {
                        element.onerror?.(new Error("https://fixture.invalid?key=private"));
                        return;
                    }
                    const url = new URL(element.src, "https://fixture.invalid");
                    const callback = url.searchParams.get("callback");
                    if (callback) {
                        if (!options.skipCallback) {
                            if (!options.missingSDK) {
                                scope[{"webapi.amap.com": "AMap", "map.qq.com": "TMap", "api.map.baidu.com": "BMap"}[url.hostname]] = sdk;
                            }
                            scope[callback]?.();
                        }
                    } else {
                        element.onload?.();
                    }
                });
            }
        }},
    };
    scope.document = document;
    const container = {ownerDocument: document, replaceChildren() {}} as unknown as HTMLElement;
    return {scope, requested, container, destroyed: () => destroyed};
};

const init = (provider: AVMapProvider, key = "fixture-key"): AVMapInit => ({
    version: 1, instanceID: "fixture", type: "init", provider, theme: "light",
    credentials: {apiKey: key, securityCode: "fixture-security-code"},
});

describe("isolated provider loading", () => {
    for (const provider of ["openfreemap", "amap", "tencent", "baidu"] as AVMapProvider[]) {
        it(`${provider} loads only its fixed SDK and waits for its documented ready event`, async () => {
            const {scope, requested, container, destroyed} = fixture();
            await prepareAVMapBootstrap(scope, provider, new AbortController().signal);
            const adapter = await loadAVMapAdapter(init(provider), container,
                {onMarkerClick() {}, onError: () => assert.fail("unexpected provider error")}, new AbortController().signal);
            const scripts = requested.filter((request) => request.tag === "script");
            assert.equal(scripts.length, 1);
            assert.equal(scripts[0].referrerPolicy, "strict-origin-when-cross-origin");
            if (provider === "openfreemap") {
                assert.equal(scripts[0].src, "/stage/build/map/maplibre-gl.js");
                assert.equal(requested.find((request) => request.tag === "link").href, "/stage/build/map/maplibre-gl.css");
                const worker = requested.find((request) => request.url);
                assert.equal(worker.url, "/stage/build/map/maplibre-gl-csp-worker.js");
                assert.equal(worker.options.credentials, "omit");
                assert.equal(worker.options.cache, "no-store");
                assert.equal(worker.options.mode, "cors");
                assert.match(requested.find((request) => request.worker).worker, /^blob:/);
            } else {
                const url = new URL(scripts[0].src);
                assert.equal(url.origin, {amap: "https://webapi.amap.com", tencent: "https://map.qq.com",
                    baidu: "https://api.map.baidu.com"}[provider]);
                assert.equal(url.searchParams.get(provider === "baidu" ? "ak" : "key"), "fixture-key");
                assert.equal(url.searchParams.get("v"), {amap: "2.0", tencent: "1.exp", baidu: "4.0"}[provider]);
                assert.equal(url.searchParams.has("libraries"), false);
                assert.equal(url.searchParams.has("plugin"), false);
                assert.equal(requested.filter((request) => request.tag === "link").length, 0);
                if (provider === "amap") {
                    assert.deepEqual(scope._AMapSecurityConfig, {securityJsCode: "fixture-security-code"});
                }
            }
            assert.equal(scope.__siyuanMapSDKReady, undefined);
            adapter.destroy();
            adapter.destroy();
            assert.equal(destroyed(), 1);
        });
    }
    it("passes both documented Baidu coordinate constants from the isolated SDK to individual markers", async () => {
        const {requested, container} = fixture();
        await prepareAVMapBootstrap(container.ownerDocument.defaultView, "baidu", new AbortController().signal);
        const adapter = await loadAVMapAdapter(init("baidu"), container,
            {onMarkerClick() {}, onError: () => assert.fail("unexpected provider error")}, new AbortController().signal);
        adapter.setPoints([
            {id: "bd", longitude: -73, latitude: 40, coordinateSystem: "bd09"},
            {id: "gcj", longitude: 121, latitude: 31, coordinateSystem: "gcj02"},
        ], 1);
        assert.deepEqual(requested.filter((request) => request.markerOptions).map((request) => request.markerOptions), [
            {enableDragging: false, coordType: "official-bd09"},
            {enableDragging: false, coordType: "official-gcj02"},
        ]);
        adapter.destroy();
    });
    it("does not cache SDK credentials between isolated frames", async () => {
        const first = fixture();
        const second = fixture();
        const callbacks = {onMarkerClick() {}, onError() {}};
        await prepareAVMapBootstrap(first.scope, "amap", new AbortController().signal);
        await prepareAVMapBootstrap(second.scope, "amap", new AbortController().signal);
        const one = await loadAVMapAdapter(init("amap", "first-fixture-key"), first.container, callbacks, new AbortController().signal);
        const two = await loadAVMapAdapter(init("amap", "second-fixture-key"), second.container, callbacks, new AbortController().signal);
        assert.match(first.requested.find((request) => request.tag === "script").src, /first-fixture-key/);
        assert.match(second.requested.find((request) => request.tag === "script").src, /second-fixture-key/);
        one.destroy();
        two.destroy();
    });
    it("aborts an SDK that never completes map loading and destroys its instance", async () => {
        const {container, destroyed} = fixture(false);
        const abort = new AbortController();
        await prepareAVMapBootstrap(container.ownerDocument.defaultView, "amap", abort.signal);
        const pending = loadAVMapAdapter(init("amap"), container, {onMarkerClick() {}, onError() {}}, abort.signal);
        await new Promise<void>((resolve) => setImmediate(resolve));
        abort.abort();
        await assert.rejects(pending, {message: "sdkUnavailable"});
        assert.equal(destroyed(), 1);
    });
    it("sanitizes secret-bearing network failures and does not instantiate the map", async () => {
        const {container, destroyed} = fixture(true, true);
        await prepareAVMapBootstrap(container.ownerDocument.defaultView, "amap", new AbortController().signal);
        await assert.rejects(loadAVMapAdapter(init("amap"), container, {onMarkerClick() {}, onError() {}},
            new AbortController().signal), {code: "sdkScriptLoadFailed", message: "Map loading failed"});
        assert.equal(destroyed(), 0);
    });
    it("retains distinct script, callback, SDK global, map construction and ready timeout failures", async () => {
        const cases: Array<{code: AVMapLoadErrorCode; ready?: boolean;
            options: {skipCallback?: boolean; missingSDK?: boolean; mapError?: boolean; appendError?: boolean};
            timeout?: boolean; callbackAssignmentError?: boolean}> = [
            {code: "sdkScriptLoadFailed", options: {appendError: true}},
            {code: "sdkScriptLoadFailed", options: {}, callbackAssignmentError: true},
            {code: "sdkCallbackTimeout", options: {skipCallback: true}, timeout: true},
            {code: "sdkGlobalMissing", options: {missingSDK: true}},
            {code: "mapCreationFailed", options: {mapError: true}},
            {code: "mapReadyTimeout", ready: false, options: {}, timeout: true},
        ];
        for (const item of cases) {
            const {scope, container, destroyed} = fixture(item.ready, false, item.options);
            const timers = new Map<number, () => void>();
            let timerID = 0;
            scope.setTimeout = (callback: () => void) => { timers.set(++timerID, callback); return timerID; };
            scope.clearTimeout = (id: number) => timers.delete(id);
            const signal = new AbortController().signal;
            await prepareAVMapBootstrap(scope, "amap", signal);
            if (item.callbackAssignmentError) {
                Object.defineProperty(scope, "__siyuanMapSDKReady", {
                    set() { throw new Error("https://fixture.invalid?key=private"); },
                });
            }
            const pending = loadAVMapAdapter(init("amap"), container, {onMarkerClick() {}, onError() {}}, signal);
            const rejected = assert.rejects(pending, (error: unknown) => {
                assert.ok(error instanceof AVMapLoadError);
                assert.equal(error.code, item.code);
                assert.equal(error.message, "Map loading failed");
                assert.equal(JSON.stringify(error).includes("private"), false);
                return true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (item.timeout) {
                assert.equal(timers.size, 1);
                timers.values().next().value();
            }
            await rejected;
            assert.equal(timers.size, 0);
            assert.equal(scope.__siyuanMapSDKReady, undefined);
            assert.equal(destroyed(), item.code === "mapReadyTimeout" ? 1 : 0);
        }
    });
    it("does not report an aborted SDK callback wait as a load failure or timeout", async () => {
        const {scope, container, destroyed} = fixture(true, false, {skipCallback: true});
        const abort = new AbortController();
        await prepareAVMapBootstrap(scope, "amap", abort.signal);
        const pending = loadAVMapAdapter(init("amap"), container, {onMarkerClick() {}, onError() {}}, abort.signal);
        abort.abort();
        await assert.rejects(pending, (error: unknown) => {
            assert.ok(error instanceof Error && !(error instanceof AVMapLoadError));
            assert.equal(error.message, "sdkUnavailable");
            return true;
        });
        assert.equal(scope.__siyuanMapSDKReady, undefined);
        assert.equal(destroyed(), 0);
    });
    it("prepares local files before locking and only creates a worker blob/map after locking", async () => {
        const {scope, requested, container} = fixture();
        const signal = new AbortController().signal;
        await assert.rejects(loadAVMapAdapter(init("openfreemap"), container, {onMarkerClick() {}, onError() {}}, signal),
            {message: "hostUnavailable"});
        assert.equal(requested.length, 0);
        const dispose = await prepareAVMapBootstrap(scope, "openfreemap", signal);
        assert.equal(requested.some((request) => request.worker || request.mapCreated), false);
        assert.equal(requested[requested.length - 1].tag, "meta");
        const lockedAt = requested.length - 1;
        const adapter = await loadAVMapAdapter(init("openfreemap"), container, {onMarkerClick() {}, onError() {}}, signal);
        assert.ok(requested.findIndex((request) => request.worker) > lockedAt);
        assert.ok(requested.findIndex((request) => request.mapCreated) > lockedAt);
        assert.equal(requested.slice(lockedAt + 1).some((request) => request.url || request.tag === "script"), false);
        adapter.destroy();
        dispose();
    });
    it("never loads a remote SDK during bootstrap and removes every local source from its locked policy", async () => {
        for (const provider of ["openfreemap", "amap", "tencent", "baidu"] as AVMapProvider[]) {
            const {scope, requested} = fixture();
            const dispose = await prepareAVMapBootstrap(scope, provider, new AbortController().signal);
            assert.equal(requested.some((request) => /^https?:/.test(request.src || request.url || "")), false);
            const policy = getAVMapLockedPolicy(provider);
            assert.equal(/localhost|127\.0\.0\.1|stage\/|nonce-|sha256-|\bself\b|unsafe-eval/.test(policy), false);
            assert.match(policy, /frame-src 'none'/);
            assert.match(policy, /form-action 'none'/);
            dispose();
        }
    });
    it("allows only the approved AMap REST script and blob worker while keeping child frames disabled", () => {
        const policy = getAVMapLockedPolicy("amap");
        assert.match(policy, /(?:^|; )script-src https:\/\/webapi\.amap\.com https:\/\/restapi\.amap\.com https:\/\/jsapi-service\.amap\.com;/);
        assert.match(policy, /worker-src blob:; child-src 'none'; frame-src 'none';/);
        assert.match(policy, /connect-src https:\/\/webapi\.amap\.com https:\/\/restapi\.amap\.com https:\/\/vdata\.amap\.com https:\/\/jsapi\.amap\.com;/);
        assert.equal(/unsafe-eval|script-src[^;]*unsafe-inline|https:\/\/\*\.amap/.test(policy), false);
        for (const provider of ["tencent", "baidu"] as AVMapProvider[]) {
            assert.match(getAVMapLockedPolicy(provider), /worker-src 'none'; child-src 'none';/);
            assert.equal(getAVMapLockedPolicy(provider).includes("restapi.amap.com"), false);
        }
        assert.match(getAVMapLockedPolicy("openfreemap"), /worker-src blob:; child-src blob:;/);
    });
});
