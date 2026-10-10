import * as assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {afterEach, describe, it} from "node:test";
import {createAVMapHost, getAVMapVisibility, isAVMapHostEnvironmentSupported} from "./host";
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
        const timers = new Map<number, {callback: () => void; delay: number}>();
        let nextTimer = 0;
        const iframe = {
            src: "", style: {}, removed: false, credentialless: false,
            contentWindow: {postMessage: (...args: any[]) => transfers.push(args)},
            setAttribute: (name: string, value: string) => { attributes[name] = value; },
            addEventListener() {}, remove() { iframe.removed = true; },
        };
        const scope = {
            location: {protocol: "https:", origin: "https://fixture.invalid"},
            navigator: {userAgent: "Chromium", userActivation: {isActive: true}}, crypto: webcrypto,
            innerWidth: 1000, innerHeight: 800,
            getComputedStyle: () => ({display: "block", visibility: "visible", opacity: "1", getPropertyValue: () => ""}),
            requestAnimationFrame: () => 1, cancelAnimationFrame() {},
            HTMLIFrameElement: {prototype: {credentialless: false}},
            clearTimeout(id: number) { timers.delete(id); },
            setTimeout(callback: () => void, delay: number) {
                timers.set(++nextTimer, {callback, delay});
                return nextTimer;
            },
            addEventListener: (name: string, listener: (event?: unknown) => void) => listeners.set(name, listener),
            removeEventListener: (name: string) => listeners.delete(name),
        };
        const rect = {left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300};
        const doc = {defaultView: scope, createElement: () => iframe, hidden: false,
            elementFromPoint: () => iframe, querySelectorAll: (): HTMLElement[] => [], addEventListener() {}, removeEventListener() {}};
        const container = {ownerDocument: doc, appendChild() {}, isConnected: true, clientWidth: 400, clientHeight: 300,
            getClientRects: () => [rect],
            getBoundingClientRect: () => rect, contains: (element: unknown) => element === iframe};
        let ready = 0;
        const clicked: any[] = [];
        const links: string[] = [];
        const host = createAVMapHost(container as unknown as HTMLElement, {
            provider: "openfreemap", theme: "light",
            onReady: () => ready++, onMarkerClick: (...args) => clicked.push(args), onError: () => assert.fail("unexpected error"),
            onAttributionClick: link => links.push(link),
        });
        cleanups.push(host.destroy);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual([...timers.values()].map((timer) => timer.delay), [30000]);
        assert.equal(attributes.sandbox, "allow-scripts allow-same-origin");
        assert.equal(iframe.credentialless, true);
        assert.equal(iframe.src.split("#")[0], "/stage/map/wrapper.html?provider=openfreemap");
        const [instanceID, nonce] = iframe.src.split("#")[1].split(":");
        const onMessage = listeners.get("message");
        const handshake = {source: iframe.contentWindow, origin: scope.location.origin, ports: [] as unknown[],
            data: {version: 1, type: "wrapperHello", instanceID, nonce}};
        const point = {id: "row-1", longitude: 0, latitude: 0};
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
        assert.deepEqual([...timers.values()].map((timer) => timer.delay), [45000],
            "bootstrap completion starts a fresh budget covering both 20-second SDK phases");
        assert.equal(listeners.has("message"), false);
        onMessage(handshake);
        assert.equal(channels.length, 1);
        assert.equal(transfers.length, 2);
        const port = channels[0].port1 as Port;
        assert.deepEqual(port.messages[0], {version: 1, instanceID, type: "init", provider: "openfreemap",
            theme: "light"});
        const reply = (data: Record<string, unknown>) => port.onmessage({data: {version: 1, instanceID, ...data}});
        reply({type: "attributionClick", link: "maplibre"});
        assert.equal(links.length, 0);
        reply({type: "ready", instanceID: "old"});
        assert.equal(ready, 0);
        reply({type: "ready"});
        reply({type: "ready"});
        assert.equal(timers.size, 0, "ready clears the SDK deadline");
        assert.equal(ready, 1);
        reply({type: "attributionClick", link: "maplibre", instanceID: "old"});
        reply({type: "attributionClick", link: "https://evil.invalid/"});
        scope.navigator.userActivation.isActive = false;
        reply({type: "attributionClick", link: "maplibre"});
        scope.navigator.userActivation.isActive = true;
        doc.hidden = true; reply({type: "attributionClick", link: "maplibre"}); doc.hidden = false;
        assert.equal(links.length, 0);
        rect.top = -100;
        reply({type: "attributionClick", link: "maplibre"});
        assert.deepEqual(links, ["maplibre"], "visible attribution remains clickable when the map top is cropped");
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
        lateReply({data: {version: 1, instanceID, type: "attributionClick", link: "maplibre"}});
        assert.equal(links.length, 1);
        assert.equal(clicked.length, 1);
    });
    it("does not create a frame after destruction while an asynchronous native report is pending", async () => {
        let finish: (value: unknown) => void;
        const scope = {location: {protocol: "http:"}, navigator: {userAgent: "SiYuanAndroid"}, JSAndroid: {},
            HTMLIFrameElement: {prototype: {}}, setTimeout, clearTimeout, removeEventListener() {},
            getAVMapNativeBoundary: () => new Promise((resolve) => { finish = resolve; })};
        const container = {ownerDocument: {defaultView: {...scope, cancelAnimationFrame() {}}, removeEventListener() {},
            createElement: () => assert.fail("late native response must not create an iframe")}};
        const host = createAVMapHost(container as unknown as HTMLElement, {provider: "openfreemap", theme: "light",
            onMarkerClick() {}, onError: () => assert.fail("destroyed host must not emit errors")});
        await Promise.resolve();
        host.destroy();
        finish({version: 1, enabled: true});
        await new Promise<void>((resolve) => setImmediate(resolve));
    });
    it("distinguishes partial visibility from safe attribution display time and checks clipping", () => {
        const rect = {left: 10, top: -10, right: 410, bottom: 290, width: 400, height: 300};
        const style = {display: "block", visibility: "visible", opacity: "1", overflowX: "visible", overflowY: "visible",
            getPropertyValue: () => ""};
        const doc: any = {hidden: false, defaultView: {innerWidth: 800, innerHeight: 600, getComputedStyle: () => style},
            elementFromPoint: () => container, querySelectorAll: (): HTMLElement[] => []};
        const container: any = {ownerDocument: doc, isConnected: true, clientWidth: 400, clientHeight: 300, getClientRects: () => [rect],
            getBoundingClientRect: () => rect, contains: (element: unknown) => element === container};
        assert.deepEqual(getAVMapVisibility(container), {visible: true, viewport: {x: 0, y: 10, width: 400, height: 290}});
        rect.top = 10;
        rect.bottom = 310;
        assert.equal(getAVMapVisibility(container).visible, true);
        doc.hidden = true; assert.equal(getAVMapVisibility(container).visible, false); doc.hidden = false;
        style.opacity = "0"; assert.equal(getAVMapVisibility(container).visible, false); style.opacity = "1";
        doc.elementFromPoint = () => ({}); assert.equal(getAVMapVisibility(container).visible, false);
        doc.elementFromPoint = () => container;
        rect.width = 800; rect.right = 810; rect.height = 600; rect.bottom = 610;
        assert.deepEqual(getAVMapVisibility(container), {visible: true, viewport: {x: 0, y: 0, width: 395, height: 295}},
            "parent CSS scaling is removed before forwarding iframe viewport coordinates");
        container.parentElement = {parentElement: null, clientLeft: 0, clientTop: 0, clientWidth: 350, clientHeight: 500,
            offsetWidth: 350, offsetHeight: 500, getBoundingClientRect: () => ({left: 20, top: 30, width: 350, height: 500})};
        style.overflowX = "hidden"; style.overflowY = "scroll";
        assert.deepEqual(getAVMapVisibility(container), {visible: true, viewport: {x: 5, y: 10, width: 175, height: 250}},
            "ancestor scroll clipping is converted in the same coordinate system");
        doc.querySelectorAll = () => [{contains: () => false, getClientRects: () => [{}],
            getBoundingClientRect: () => ({left: 100, right: 120, top: 250, bottom: 270, width: 20, height: 20})}];
        assert.deepEqual(getAVMapVisibility(container), {visible: true},
            "a small parent overlay blocks counting even when it misses every sampled point");
    });
});
