import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {connectAVMapRuntime, startAVMapRuntime} from "./hostRuntime";
import {AVMapAdapter, AVMapAdapterCallbacks} from "./providers";
import {AVMapLoadError} from "./protocol";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const fixture = () => {
    const replies: any[] = [];
    const calls: Array<[string, ...any[]]> = [];
    const port = {onmessage: null as any, postMessage: (data: unknown) => replies.push(data),
        start() {}, close: () => calls.push(["close"])};
    const adapter: AVMapAdapter = {
        setPoints: (...args) => { calls.push(["setPoints", ...args]); },
        fit: () => { calls.push(["fit"]); }, resize: () => { calls.push(["resize"]); },
        setTheme: (...args) => { calls.push(["theme", ...args]); }, destroy: () => { calls.push(["destroy"]); },
        setVisible: (...args) => { calls.push(["visibility", ...args]); },
    };
    const send = (data: Record<string, unknown>) => port.onmessage?.({data: {version: 1, instanceID: "one", ...data}});
    return {replies, calls, port, adapter, send};
};

describe("isolated map runtime lifecycle", () => {
    it("rejects duplicate init, other providers, old revisions and nonmember marker clicks", async () => {
        const {port, adapter, replies, calls, send} = fixture();
        let callbacks: AVMapAdapterCallbacks;
        let starts = 0;
        const stop = startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
            async (_init, _container, value) => { starts++; callbacks = value; return adapter; });
        await send({type: "init", provider: "amap", theme: "light"});
        assert.equal(starts, 0);
        await send({type: "init", provider: "openfreemap", theme: "light"});
        await send({type: "init", provider: "openfreemap", theme: "dark"});
        assert.equal(starts, 1);
        assert.deepEqual(replies, [{version: 1, instanceID: "one", type: "ready"}]);
        const point = {id: "row-1", longitude: 0, latitude: 0};
        await send({type: "setPoints", revision: 2, points: [{...point, title: "private"},
            {...point, id: "invalid", latitude: 91}]});
        assert.deepEqual(calls.find((call) => call[0] === "setPoints"), ["setPoints", [point], 2]);
        assert.equal(calls.filter((call) => call[0] === "fit").length, 1);
        await send({type: "setPoints", revision: 1, points: []});
        await send({type: "setPoints", revision: 2, points: []});
        await send({type: "setPoints", instanceID: "old", revision: 3, points: []});
        callbacks.onMarkerClick("row-1", 1);
        callbacks.onMarkerClick("not-present", 2);
        callbacks.onMarkerClick("row-1", 2);
        assert.equal(replies.length, 2);
        assert.deepEqual(replies[1], {version: 1, instanceID: "one", type: "markerClick", id: "row-1", revision: 2});
        await send({type: "setPoints", revision: 3, points: []});
        assert.equal(calls.filter((call) => call[0] === "fit").length, 1);
        callbacks.onMarkerClick("row-1", 2);
        callbacks.onMarkerClick("row-1", 3);
        assert.equal(replies.length, 2);
        stop();
        callbacks.onMarkerClick("row-1", 3);
        callbacks.onError("mapUnavailable");
        stop();
        assert.equal(calls.filter((call) => call[0] === "destroy").length, 1);
        assert.equal(replies.length, 2);
    });
    it("destroys a provider that finishes loading after teardown", async () => {
        const {port, adapter, replies, calls, send} = fixture();
        let finish: (value: AVMapAdapter) => void;
        let signal: AbortSignal;
        startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
            async (_init, _container, _callbacks, value) => {
                signal = value;
                return new Promise<AVMapAdapter>((resolve) => { finish = resolve; });
            });
        const pending = send({type: "init", provider: "openfreemap", theme: "light"});
        await send({type: "destroy"});
        assert.equal(signal.aborted, true);
        finish(adapter);
        await pending;
        await tick();
        assert.equal(replies.length, 0);
        assert.equal(calls.filter((call) => call[0] === "destroy").length, 1);
    });
    it("fits only the first nonempty snapshot and rejects the removed external fit command", async () => {
        const {port, adapter, calls, send} = fixture();
        const stop = startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
            async () => adapter);
        await send({type: "init", provider: "openfreemap", theme: "light"});
        await send({type: "fit"});
        await send({type: "setPoints", revision: 0, points: []});
        assert.equal(calls.some(call => call[0] === "fit"), false);
        await send({type: "setPoints", revision: 1, points: [{id: "row-1", longitude: 0, latitude: 0}]});
        assert.equal(calls.filter(call => call[0] === "fit").length, 1);
        await send({type: "fit"});
        await send({type: "visibility", visible: false});
        await send({type: "resize"});
        await send({type: "visibility", visible: true});
        await send({type: "setPoints", revision: 2, points: []});
        await send({type: "setPoints", revision: 3, points: [{id: "row-2", longitude: 20, latitude: 20}]});
        assert.equal(calls.filter(call => call[0] === "fit").length, 1);
        stop();
    });
    it("passes only fixed attribution identifiers and visibility booleans through the runtime", async () => {
        const {port, adapter, replies, calls, send} = fixture();
        let callbacks: AVMapAdapterCallbacks;
        const stop = startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
            async (_init, _container, value) => {
                callbacks = value;
                value.onAttributionClick("maplibre");
                return adapter;
            });
        await send({type: "visibility", visible: true, viewport: {x: 0, y: 0, width: 800, height: 600}});
        await send({type: "init", provider: "openfreemap", theme: "light"});
        assert.deepEqual(replies.map(reply => reply.type), ["ready"]);
        await send({type: "visibility", visible: "true"});
        const viewport = {x: 0, y: 50, width: 800, height: 550};
        await send({type: "visibility", visible: true, viewport});
        await send({type: "visibility", visible: false});
        assert.deepEqual(calls.filter(call => call[0] === "visibility"), [["visibility", true, viewport], ["visibility", false, undefined]]);
        callbacks.onAttributionClick("maplibre");
        callbacks.onAttributionClick("https://evil.invalid/" as any);
        assert.deepEqual(replies[1], {version: 1, instanceID: "one", type: "attributionClick", link: "maplibre"});
        stop(); callbacks.onAttributionClick("maplibre");
        assert.equal(replies.length, 2);
    });
    it("never initializes a removed provider", async () => {
        for (const provider of ["amap", "tencent", "baidu"]) {
            const {port, replies, send} = fixture();
            startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
                async () => assert.fail("must not load an SDK"));
            await send({type: "init", provider, theme: "light"});
            assert.deepEqual(replies, []);
        }
    });
    it("returns only a stable code when SDK loading fails with a secret-bearing exception", async () => {
        const {port, replies, send} = fixture();
        startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
            async () => { throw new Error("https://sdk.invalid?key=secret"); });
        await send({type: "init", provider: "openfreemap", theme: "light"});
        assert.deepEqual(replies, [{version: 1, instanceID: "one", type: "error", code: "sdkUnavailable"}]);
    });
    it("preserves only controlled loading stages without passing exception fields to the owner", async () => {
        for (const code of ["sdkScriptLoadFailed", "sdkGlobalMissing", "mapCreationFailed", "mapReadyTimeout"] as const) {
            const {port, replies, send} = fixture();
            startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
                async () => { throw Object.assign(new AVMapLoadError(code), {message: "https://sdk.invalid?key=secret"}); });
            await send({type: "init", provider: "openfreemap", theme: "light"});
            assert.deepEqual(replies, [{version: 1, instanceID: "one", type: "error", code}]);
        }
        const {port, replies, send} = fixture();
        startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
            async () => { throw Object.assign(new Error("https://sdk.invalid?key=secret"), {code: "mapCreationFailed"}); });
        await send({type: "init", provider: "openfreemap", theme: "light"});
        assert.deepEqual(replies, [{version: 1, instanceID: "one", type: "error", code: "sdkUnavailable"}]);
    });
    it("does not report a provider rejection caused by teardown", async () => {
        const {port, replies, send} = fixture();
        startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
            async (_init, _container, _callbacks, signal) => new Promise<AVMapAdapter>((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new AVMapLoadError("mapReadyTimeout")), {once: true});
            }));
        const pending = send({type: "init", provider: "openfreemap", theme: "light"});
        await send({type: "destroy"});
        await pending;
        assert.deepEqual(replies, []);
    });
});

describe("isolated map bootstrap ordering", () => {
    const bootstrapFixture = (desktop = false, native = false, timing = {setTimeout, clearTimeout}) => {
        const instanceID = "a".repeat(48);
        const nonce = "b".repeat(48);
        const events: any[] = [];
        const listeners = new Map<string, (event?: any) => void>();
        const parent = Object.defineProperty({postMessage: (message: unknown) => events.push(message)},
            "document", {get() { throw new Error("opaque sandbox"); }});
        const scope: any = {
            origin: "null", location: {hash: `#${instanceID}:${nonce}`, search: "?provider=openfreemap"},
            parent, ...timing, maplibregl: {Map() {}, AttributionControl() {}, setWorkerUrl() {}},
            fetch: async () => ({ok: true, text: async () => "worker"}),
            addEventListener: (name: string, callback: (event?: any) => void) => listeners.set(name, callback),
            removeEventListener: (name: string) => listeners.delete(name),
            document: {createElement: (tag: string) => ({tag, remove() {}}),
                head: {appendChild: (element: any) => {
                    if (element.tag === "meta") events.push({type: "policy", content: element.content});
                    else queueMicrotask(() => element.onload?.());
                }},
                getElementById: () => ({})},
        };
        if (desktop) {
            scope.parent = scope;
            scope.siyuanMapDesktop = {version: 1};
        }
        if (native) {
            scope.JSAndroid = {};
        }
        const port = {onmessage: null as any, closed: 0, start() {}, close() { this.closed++; },
            postMessage: (message: unknown) => events.push(message)};
        connectAVMapRuntime(scope);
        const message = (type: string, values: Record<string, unknown> = {}, ports: unknown[] = []) => ({
            source: desktop ? scope : parent, origin: "https://fixture.invalid", ports,
            data: {version: 1, instanceID, nonce, type, ...values},
        });
        return {scope, events, listeners, port, message};
    };
    it("rejects early ports and locks CSP before exposing bootstrap readiness", async () => {
        const {events, listeners, port, message} = bootstrapFixture();
        const receive = listeners.get("message");
        assert.equal(events[0].type, "hello");
        receive(message("connect", {}, [port]));
        assert.equal(port.onmessage, null);
        receive({...message("prepare"), source: {}});
        assert.equal(events.length, 1);
        receive(message("prepare"));
        await tick();
        assert.deepEqual(events.map((event) => event.type), ["hello", "policy", "bootstrapReady"]);
        receive(message("connect", {}, [port]));
        assert.equal(typeof port.onmessage, "function");
        const handler = port.onmessage;
        receive(message("connect", {}, [port]));
        assert.equal(port.onmessage, handler);
        listeners.get("pagehide")();
        assert.equal(port.onmessage, null);
    });
    it("requires the verified native boundary before permitting preparation in a native frame", async () => {
        const denied = bootstrapFixture(false, true);
        denied.listeners.get("message")(denied.message("prepare", {nativeBoundary: false}));
        await tick();
        assert.deepEqual(denied.events.map((event) => event.type), ["hello", "bootstrapError"]);
        const allowed = bootstrapFixture(false, true);
        allowed.listeners.get("message")(allowed.message("prepare", {nativeBoundary: true}));
        await tick();
        assert.deepEqual(allowed.events.map((event) => event.type), ["hello", "policy", "bootstrapReady"]);
        allowed.listeners.get("pagehide")();
    });
    it("accepts a desktop preload port once and returns readiness only after the same CSP lock", async () => {
        const {events, listeners, port, message} = bootstrapFixture(true);
        const receive = listeners.get("message");
        const valid = message("siyuan-map-desktop-connect", {provider: "openfreemap"}, [port]);
        receive({...valid, source: {}});
        receive({...valid, data: {...valid.data, provider: "baidu"}});
        receive({...valid, data: {...valid.data, nonce: "old"}});
        assert.equal(events.length, 0);
        receive(valid);
        receive(valid);
        await tick();
        assert.deepEqual(events.map((event) => event.type), ["policy", "bootstrapReady"]);
        assert.equal(events[1].nonce, undefined);
        assert.equal(typeof port.onmessage, "function");
        assert.equal(listeners.has("message"), false);
        listeners.get("pagehide")();
    });
    it("reports preparation failures once with fixed codes and closes a transferred desktop port", async () => {
        for (const desktop of [false, true]) {
            for (const failure of ["script", "global", "policy"]) {
                const {scope, events, listeners, port, message} = bootstrapFixture(desktop);
                if (failure === "global" || failure === "script") scope.maplibregl = undefined;
                const append = scope.document.head.appendChild;
                scope.document.head.appendChild = (element: any) => {
                    if (failure === "script" && element.tag === "script") {
                        queueMicrotask(() => element.onerror?.(new Error("https://private.invalid/?token=secret")));
                    } else if (failure === "policy" && element.tag === "meta") {
                        throw new Error("https://private.invalid/?token=secret");
                    } else append(element);
                };
                const receive = listeners.get("message");
                const request = desktop ? message("siyuan-map-desktop-connect", {provider: "openfreemap"}, [port]) : message("prepare");
                receive(request);
                await tick();
                const code = failure === "script" ? "sdkScriptLoadFailed" : failure === "global" ? "sdkGlobalMissing" : "hostUnavailable";
                const replies = events.filter(event => event.type === "error" || event.type === "bootstrapError");
                assert.equal(replies.length, 1);
                assert.equal(replies[0].code, code);
                assert.equal(JSON.stringify(events).includes("secret"), false);
                assert.equal(events.some(event => event.type === "bootstrapReady"), false);
                assert.equal(listeners.has("message"), false);
                assert.equal(port.closed, desktop ? 1 : 0);
                receive(request);
                listeners.get("pagehide")();
                assert.equal(events.filter(event => event.type === "error" || event.type === "bootstrapError").length, 1);
            }
        }
    });
    it("keeps slow CSS and script loading inside one bootstrap deadline and ignores late completion", async () => {
        for (const desktop of [false, true]) {
            let now = 0, nextTimer = 0, removed = 0;
            const timers = new Map<number, {at: number; callback: () => void}>();
            const timing = {
                setTimeout: (callback: () => void, delay: number) => {
                    timers.set(++nextTimer, {at: now + delay, callback});
                    return nextTimer;
                }, clearTimeout: (id: number) => timers.delete(id),
            } as unknown as {setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout};
            const {scope, events, listeners, port, message} = bootstrapFixture(desktop, false, timing);
            const assets: any[] = [];
            scope.document.createElement = (tag: string) => ({tag, remove() { removed++; }});
            scope.document.head.appendChild = (element: any) => assets.push(element);
            listeners.get("message")(desktop ? message("siyuan-map-desktop-connect", {provider: "openfreemap"}, [port]) : message("prepare"));
            assert.equal(assets[0].tag, "link");
            now = 19000;
            assets[0].onload();
            await tick();
            assert.equal(assets[1].tag, "script");
            const lateLoad = assets[1].onload;
            now = 30000;
            for (const [id, timer] of Array.from(timers)) {
                if (timer.at <= now) { timers.delete(id); timer.callback(); }
            }
            await tick();
            assert.equal(assets[1].onload, null);
            assert.equal(assets[1].onerror, null);
            assert.equal(removed, 1);
            assert.equal(timers.size, 0);
            assert.equal(port.closed, desktop ? 1 : 0);
            lateLoad();
            await tick();
            assert.equal(events.some(event => event.type === "bootstrapReady" || event.type === "error"), false);
            assert.equal(assets.some(element => element.tag === "meta"), false);
            assert.equal(listeners.has("message"), false);
        }
    });
});
