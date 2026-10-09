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
        await send({type: "init", provider: "amap", credentials: {}, theme: "light"});
        assert.equal(starts, 0);
        await send({type: "init", provider: "openfreemap", credentials: {}, theme: "light"});
        await send({type: "init", provider: "openfreemap", credentials: {}, theme: "dark"});
        assert.equal(starts, 1);
        assert.deepEqual(replies, [{version: 1, instanceID: "one", type: "ready"}]);
        const point = {id: "row-1", longitude: 0, latitude: 0, coordinateSystem: "wgs84"};
        await send({type: "setPoints", revision: 2, points: [{...point, title: "private"},
            {...point, id: "invalid", coordinateSystem: "unknown"}]});
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
        const pending = send({type: "init", provider: "openfreemap", credentials: {}, theme: "light"});
        await send({type: "destroy"});
        assert.equal(signal.aborted, true);
        finish(adapter);
        await pending;
        await tick();
        assert.equal(replies.length, 0);
        assert.equal(calls.filter((call) => call[0] === "destroy").length, 1);
    });
    it("does not initialize a key-backed provider without its required credentials", async () => {
        for (const provider of ["amap", "tencent", "baidu"] as const) {
            const {port, replies, send} = fixture();
            startAVMapRuntime(port as unknown as MessagePort, "one", provider, {} as HTMLElement,
                async () => assert.fail("must not load an SDK"));
            await send({type: "init", provider, credentials: {}, theme: "light"});
            assert.deepEqual(replies, [{version: 1, instanceID: "one", type: "error", code: "missingCredentials"}]);
        }
    });
    it("returns only a stable code when SDK loading fails with a secret-bearing exception", async () => {
        const {port, replies, send} = fixture();
        startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
            async () => { throw new Error("https://sdk.invalid?key=secret"); });
        await send({type: "init", provider: "openfreemap", credentials: {}, theme: "light"});
        assert.deepEqual(replies, [{version: 1, instanceID: "one", type: "error", code: "sdkUnavailable"}]);
    });
    it("preserves only controlled loading stages without passing exception fields to the owner", async () => {
        for (const code of ["sdkScriptLoadFailed", "sdkCallbackTimeout", "sdkGlobalMissing", "mapCreationFailed", "mapReadyTimeout"] as const) {
            const {port, replies, send} = fixture();
            startAVMapRuntime(port as unknown as MessagePort, "one", "amap", {} as HTMLElement,
                async () => { throw Object.assign(new AVMapLoadError(code), {message: "https://sdk.invalid?key=secret"}); });
            await send({type: "init", provider: "amap", credentials: {apiKey: "fixture-key", securityCode: "fixture-code"}, theme: "light"});
            assert.deepEqual(replies, [{version: 1, instanceID: "one", type: "error", code}]);
        }
        const {port, replies, send} = fixture();
        startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
            async () => { throw Object.assign(new Error("https://sdk.invalid?key=secret"), {code: "mapCreationFailed"}); });
        await send({type: "init", provider: "openfreemap", credentials: {}, theme: "light"});
        assert.deepEqual(replies, [{version: 1, instanceID: "one", type: "error", code: "sdkUnavailable"}]);
    });
    it("does not report a provider rejection caused by teardown", async () => {
        const {port, replies, send} = fixture();
        startAVMapRuntime(port as unknown as MessagePort, "one", "openfreemap", {} as HTMLElement,
            async (_init, _container, _callbacks, signal) => new Promise<AVMapAdapter>((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new AVMapLoadError("mapReadyTimeout")), {once: true});
            }));
        const pending = send({type: "init", provider: "openfreemap", credentials: {}, theme: "light"});
        await send({type: "destroy"});
        await pending;
        assert.deepEqual(replies, []);
    });
});

describe("isolated map bootstrap ordering", () => {
    const bootstrapFixture = (desktop = false, native = false) => {
        const instanceID = "a".repeat(48);
        const nonce = "b".repeat(48);
        const events: any[] = [];
        const listeners = new Map<string, (event?: any) => void>();
        const parent = Object.defineProperty({postMessage: (message: unknown) => events.push(message)},
            "document", {get() { throw new Error("opaque sandbox"); }});
        const scope: any = {
            origin: "null", location: {hash: `#${instanceID}:${nonce}`, search: "?provider=amap"},
            parent, setTimeout, clearTimeout,
            addEventListener: (name: string, callback: (event?: any) => void) => listeners.set(name, callback),
            removeEventListener: (name: string) => listeners.delete(name),
            document: {createElement: (tag: string) => ({tag}),
                head: {appendChild: (element: any) => events.push({type: "policy", content: element.content})},
                getElementById: () => ({})},
        };
        if (desktop) {
            scope.parent = scope;
            scope.siyuanMapDesktop = {version: 1};
        }
        if (native) {
            scope.JSAndroid = {};
        }
        const port = {onmessage: null as any, start() {}, close() {}, postMessage: (message: unknown) => events.push(message)};
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
        const valid = message("siyuan-map-desktop-connect", {provider: "amap"}, [port]);
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
});
