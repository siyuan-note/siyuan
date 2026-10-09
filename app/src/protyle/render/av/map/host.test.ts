import * as assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {afterEach, describe, it} from "node:test";
import {createAVMapHost, isAVMapHostEnvironmentSupported} from "./host";
import {isAVMapRuntimeIsolated} from "./hostRuntime";

describe("map host boundary", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => { cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); });
    it("fails closed for Electron and unguarded native bridges but does not require credentialless", async () => {
        const browser = {location: {protocol: "http:"}, navigator: {userAgent: "Chromium"},
            HTMLIFrameElement: {prototype: {credentialless: false}}};
        assert.equal(await isAVMapHostEnvironmentSupported(browser as unknown as Window), true);
        for (const unsafe of [{require() {}}, {process: {}}, {webkit: {messageHandlers: {}}}, {JSAndroid: {}},
            {Android: {}}, {Harmony: {}}, {JSHarmony: {}}, {location: {protocol: "file:"}}, {navigator: {userAgent: "Electron/44"}},
            {HTMLIFrameElement: undefined as unknown}]) {
            assert.equal(await isAVMapHostEnvironmentSupported({...browser, ...unsafe,
                setTimeout, clearTimeout} as unknown as Window), false);
        }
        assert.equal(await isAVMapHostEnvironmentSupported({...browser,
            HTMLIFrameElement: {prototype: {}}} as unknown as Window), true);
        assert.equal(isAVMapRuntimeIsolated({parent: {document: {}}} as Window), false);
        const isolated = {origin: "null", credentialless: true,
            parent: Object.defineProperty({}, "document", {get() { throw new Error("sandbox"); }})};
        assert.equal(isAVMapRuntimeIsolated(isolated as unknown as Window), true);
        assert.equal(isAVMapRuntimeIsolated({...isolated, require() {}} as unknown as Window), false);
        assert.equal(isAVMapRuntimeIsolated({...isolated, JSAndroid: {}} as unknown as Window), false);
        assert.equal(isAVMapRuntimeIsolated({...isolated, JSHarmony: {}} as unknown as Window), false);
        assert.equal(isAVMapRuntimeIsolated({...isolated, origin: "https://app.invalid"} as unknown as Window), false);
        assert.equal(isAVMapRuntimeIsolated({...isolated, credentialless: false} as unknown as Window), true);
        assert.equal(isAVMapRuntimeIsolated({...isolated, credentialless: undefined} as unknown as Window), true);
        assert.equal(isAVMapRuntimeIsolated({...isolated, JSHarmony: {}} as unknown as Window, true), true);
    });
    it("binds one exact wrapper and nonce, waits for locked bootstrap, and discards stale replies", async () => {
        const channels: any[] = [];
        const original = globalThis.MessageChannel;
        class Port {
            onmessage: (event: {data: unknown}) => void;
            messages: any[] = [];
            closed = false;
            postMessage(data: unknown) { this.messages.push(data); }
            start() {}
            close() { this.closed = true; }
        }
        globalThis.MessageChannel = class {
            port1 = new Port();
            port2 = new Port();
            constructor() { channels.push(this); }
        } as any;
        cleanups.push(() => { globalThis.MessageChannel = original; });
        const attributes: Record<string, string> = {};
        const listeners = new Map<string, (event?: unknown) => void>();
        const transfers: any[] = [];
        const iframe = {
            src: "", style: {}, removed: false, credentialless: false,
            contentWindow: {postMessage: (...args: any[]) => transfers.push(args)},
            setAttribute: (name: string, value: string) => { attributes[name] = value; },
            addEventListener() {}, remove() { iframe.removed = true; },
        };
        const scope = {
            location: {protocol: "https:", origin: "https://fixture.invalid"}, navigator: {userAgent: "Chromium"}, crypto: webcrypto,
            HTMLIFrameElement: {prototype: {credentialless: false}},
            clearTimeout() {}, setTimeout() { return 1; },
            addEventListener: (name: string, listener: (event?: unknown) => void) => listeners.set(name, listener),
            removeEventListener: (name: string) => listeners.delete(name),
        };
        const container = {ownerDocument: {defaultView: scope, createElement: () => iframe}, appendChild() {}};
        let ready = 0;
        const clicked: any[] = [];
        const host = createAVMapHost(container as unknown as HTMLElement, {
            provider: "openfreemap", theme: "light", credentials: {apiKey: "fixture-key", token: "secret"} as any,
            onReady: () => ready++, onMarkerClick: (...args) => clicked.push(args), onError: () => assert.fail("unexpected error"),
        });
        cleanups.push(host.destroy);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(attributes.sandbox, "allow-scripts allow-same-origin");
        assert.equal(iframe.credentialless, true);
        assert.equal(iframe.src.split("#")[0], "/stage/map/wrapper.html?provider=openfreemap");
        const [instanceID, nonce] = iframe.src.split("#")[1].split(":");
        const onMessage = listeners.get("message");
        const handshake = {source: iframe.contentWindow, origin: scope.location.origin, ports: [] as unknown[],
            data: {version: 1, type: "wrapperHello", instanceID, nonce}};
        const point = {id: "row-1", longitude: 0, latitude: 0, coordinateSystem: "wgs84" as const};
        host.setPoints([{...point, title: "private"} as any], 1);
        host.fit();
        onMessage({...handshake, source: {}});
        onMessage({...handshake, origin: "https://attacker.invalid"});
        onMessage({...handshake, data: {...handshake.data, nonce: "old"}});
        assert.equal(channels.length, 0);
        onMessage({...handshake, data: {...handshake.data, type: "bootstrapReady"}});
        assert.equal(channels.length, 0);
        onMessage(handshake);
        assert.equal(channels.length, 0);
        assert.deepEqual(transfers[0][0], {version: 1, instanceID, nonce, type: "prepare", nativeBoundary: false});
        onMessage({...handshake, data: {...handshake.data, type: "bootstrapReady"}});
        assert.equal(channels.length, 1);
        assert.equal(listeners.has("message"), false);
        onMessage(handshake);
        assert.equal(channels.length, 1);
        assert.equal(transfers.length, 2);
        const port = channels[0].port1 as Port;
        assert.deepEqual(port.messages[0], {version: 1, instanceID, type: "init", provider: "openfreemap",
            credentials: {}, theme: "light"});
        const reply = (data: Record<string, unknown>) => port.onmessage({data: {version: 1, instanceID, ...data}});
        reply({type: "ready", instanceID: "old"});
        assert.equal(ready, 0);
        reply({type: "ready"});
        reply({type: "ready"});
        assert.equal(ready, 1);
        assert.deepEqual(port.messages.find((message) => message.type === "setPoints").points, [point]);
        assert.equal(port.messages.filter((message) => message.type === "fit").length, 1);
        reply({type: "markerClick", id: "row-1", revision: 0});
        reply({type: "markerClick", id: "missing", revision: 1});
        reply({type: "markerClick", id: "row-1", revision: 1});
        assert.deepEqual(clicked, [["row-1", 1]]);
        host.setPoints([], 2);
        reply({type: "markerClick", id: "row-1", revision: 1});
        reply({type: "markerClick", id: "row-1", revision: 2});
        assert.equal(clicked.length, 1);
        const lateReply = port.onmessage;
        host.destroy();
        assert.equal(iframe.removed, true);
        assert.equal(port.closed, true);
        lateReply({data: {version: 1, instanceID, type: "markerClick", id: "row-1", revision: 2}});
        assert.equal(clicked.length, 1);
    });
    it("does not create a frame after destruction while an asynchronous native report is pending", async () => {
        let finish: (value: unknown) => void;
        const scope = {location: {protocol: "http:"}, navigator: {userAgent: "SiYuanAndroid"}, JSAndroid: {},
            HTMLIFrameElement: {prototype: {}}, setTimeout, clearTimeout, removeEventListener() {},
            getAVMapNativeBoundary: () => new Promise((resolve) => { finish = resolve; })};
        const container = {ownerDocument: {defaultView: scope,
            createElement: () => assert.fail("late native response must not create an iframe")}};
        const host = createAVMapHost(container as unknown as HTMLElement, {provider: "openfreemap", theme: "light",
            onMarkerClick() {}, onError: () => assert.fail("destroyed host must not emit errors")});
        await Promise.resolve();
        host.destroy();
        finish({version: 1, enabled: true});
        await new Promise<void>((resolve) => setImmediate(resolve));
    });
});
