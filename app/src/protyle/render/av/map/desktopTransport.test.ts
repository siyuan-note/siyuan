import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";
import {describe, it} from "node:test";
import * as ts from "typescript";
import * as protocol from "./protocol";

const source = readFileSync(__dirname + "/desktopTransport.ts", "utf8");
const load = (ipc: unknown, browser = false, warnings: unknown[][] = []) => {
    // Exercise the same compile-time branches as webpack without importing Electron into Node.
    let keep = true;
    const code = source.split("\n").filter((line) => {
        if (line.includes("/// #if !BROWSER")) { keep = !browser; return false; }
        if (line.includes("/// #else")) { keep = browser; return false; }
        if (line.includes("/// #endif")) { keep = true; return false; }
        return keep;
    }).join("\n");
    const result: any = {};
    const requireModule = (name: string) => {
        if (name === "./protocol") { return protocol; }
        assert.equal(name, "electron");
        assert.equal(browser, false, "browser must not import Electron");
        return {ipcRenderer: ipc};
    };
    new Function("require", "exports", "console", ts.transpileModule(code, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText)(requireModule, result, {warn: (...values: unknown[]) => warnings.push(values)});
    return result;
};

const fixture = () => {
    const calls: Array<[string, any]> = [];
    const listeners = new Map<string, (...args: any[]) => void>();
    const domListeners = new Map<string, () => void>();
    const frames = new Map<number, () => void>();
    let resolveCreate: (value: unknown) => void;
    let now = 0, nextFrame = 0;
    const ipc = {
        invoke: (name: string, value: unknown) => {
            calls.push([name, value]);
            return new Promise((resolve) => { resolveCreate = resolve; });
        },
        send: (name: string, value: unknown) => calls.push([name, value]),
        on: (name: string, fn: (...args: any[]) => void) => listeners.set(name, fn),
        removeListener: (name: string) => listeners.delete(name),
    };
    const rect = {x: 10, y: 20, width: 400, height: 300};
    const doc: any = {hidden: false, documentElement: {}, querySelectorAll: (): HTMLElement[] => [],
        elementFromPoint: () => container,
        addEventListener: (name: string, fn: () => void) => domListeners.set(name, fn),
        removeEventListener: (name: string) => domListeners.delete(name)};
    const scope = {crypto: webcrypto, innerWidth: 1000, innerHeight: 800, performance: {now: () => now},
        setTimeout: () => 1, clearTimeout() {},
        requestAnimationFrame: (fn: () => void) => { frames.set(++nextFrame, fn); return nextFrame; },
        cancelAnimationFrame: (id: number) => frames.delete(id),
        addEventListener: (name: string, fn: () => void) => domListeners.set(name, fn),
        removeEventListener: (name: string) => domListeners.delete(name),
        getComputedStyle: () => ({display: "block", visibility: "visible", opacity: "1", overflowX: "visible", overflowY: "visible",
            getPropertyValue: () => ""})};
    doc.defaultView = scope;
    const container: any = {ownerDocument: doc, isConnected: true, parentElement: null,
        getClientRects: () => [rect], getBoundingClientRect: () => rect, contains: (target: unknown) => target === container};
    const errors: string[] = [], clicks: unknown[] = [];
    let ready = 0;
    const api = load(ipc);
    const host = api.createDesktopAVMapHost(container, {provider: "openfreemap", theme: "light",
        credentials: {apiKey: "do-not-send", extra: "private"}, onError: (value: string) => errors.push(value),
        onMarkerClick: (...args: unknown[]) => clicks.push(args), onReady: () => ready++});
    const instanceID = calls[0][1].instanceID;
    return {host, calls, listeners, domListeners, frames, errors, clicks, doc, container, rect,
        ready: () => ready,
        reply: (value: object) => listeners.get("siyuan-map-reply")?.({}, {version: 1, instanceID, ...value}),
        created: async () => {
            resolveCreate({version: 1, instanceID});
            await new Promise<void>((resolve) => setImmediate(resolve));
        },
        advance: (milliseconds = 150) => {
            now += milliseconds;
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach((fn) => fn());
        }};
};

describe("desktop map transport", () => {
    it("logs only approved capability reason codes and never exception or response details", async () => {
        for (const reason of ["ownerUnavailable", "notMainFrame", "notInitialized", "unregisteredOwner", "invalidKernelOrigin",
            "originMismatch", "unsupportedDocument", "invalidDocument", "unsafeProcessSwitches"]) {
            const warnings: unknown[][] = [];
            assert.equal(await load({invoke: async () => ({version: 1, supported: false, reason,
                url: "https://private.invalid/?token=secret", credentials: "secret"})}, false, warnings)
                .isDesktopAVMapHostSupported(), false);
            assert.deepEqual(warnings, [["Database map host unavailable:", reason]]);
        }
        const warnings: unknown[][] = [];
        assert.equal(await load({invoke: async () => ({version: 1, supported: false, reason: "secret"})}, false, warnings)
            .isDesktopAVMapHostSupported(), false);
        assert.equal(await load({invoke: async () => { throw new Error("secret"); }}, false, warnings)
            .isDesktopAVMapHostSupported(), false);
        assert.deepEqual(warnings, [["Database map host unavailable:", "unsupportedCapability"],
            ["Database map host unavailable:", "capabilityUnavailable"]]);
        const browserWarnings: unknown[][] = [];
        assert.equal(await load(undefined, true, browserWarnings).isDesktopAVMapHostSupported(), false);
        assert.deepEqual(browserWarnings, []);
    });
    it("clips CSS rectangles, preserves full logical size and never multiplies by display scale", () => {
        const compute = load({}).computeDesktopAVMapGeometry;
        assert.deepEqual(compute({x: -20.5, y: 30, width: 200, height: 100},
            [{x: 0, y: 0, width: 1000, height: 800}, {x: 10, y: 40, width: 100, height: 60}]),
        {visible: true, bounds: {x: 10, y: 40, width: 100, height: 60},
            logicalSize: {width: 200, height: 100}, crop: {x: 30.5, y: 10}});
        const rect = {x: 0, y: 0, width: 100, height: 100};
        assert.deepEqual(compute(rect, [{...rect, x: 200}]), {visible: false});
        assert.deepEqual(compute(rect, [], [{x: 30, y: 40, width: 5, height: 5}]), {visible: false});
        assert.equal(compute(rect, [], [{...rect, x: 100}]).visible, true);
        assert.deepEqual(compute({...rect, width: NaN}, []), {visible: false});
    });
    it("fails closed for missing capability and omits Electron from browser compilation", async () => {
        assert.equal(await load(undefined, true).isDesktopAVMapHostSupported(), false);
        assert.equal(await load({invoke: async () => ({version: 1, supported: true})}).isDesktopAVMapHostSupported(), true);
        assert.equal(await load({invoke: async () => ({version: 2, supported: true})}).isDesktopAVMapHostSupported(), false);
        assert.equal(await load({invoke: async () => { throw new Error("old main"); }}).isDesktopAVMapHostSupported(), false);
    });
    it("caches ready commands, validates replies and recovers from scroll, occlusion and visibility changes", async () => {
        const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
        let disconnects = 0;
        class Observer { observe() {} disconnect() { disconnects++; } }
        globalThis.MutationObserver = Observer as any;
        globalThis.ResizeObserver = Observer as any;
        const f = fixture();
        try {
            const point = {id: "row", longitude: 1, latitude: 2, coordinateSystem: "wgs84", name: "private"};
            f.host.setPoints([point], 1);
            f.host.setTheme("dark");
            f.host.fit();
            assert.deepEqual(f.calls[0][1].credentials, {});
            assert.match(f.calls[0][1].instanceID, /^[a-f0-9]{48}$/);
            await f.created();
            f.reply({type: "ready", instanceID: "old"});
            assert.equal(f.ready(), 0);
            f.reply({type: "ready"});
            f.reply({type: "ready"});
            assert.equal(f.ready(), 1);
            const commands = f.calls.filter(([name]) => name === "siyuan-map-command").map(([, value]) => value);
            assert.deepEqual(commands.map((value) => value.type), ["setPoints", "theme", "fit"]);
            assert.equal(commands[0].points[0].name, undefined);
            assert.equal(commands[1].theme, "dark");
            f.reply({type: "markerClick", id: "row", revision: 0});
            f.reply({type: "markerClick", id: "missing", revision: 1});
            f.reply({type: "markerClick", id: "row", revision: 1});
            assert.deepEqual(f.clicks, [["row", 1]]);
            f.host.setPoints([], 2);
            f.reply({type: "markerClick", id: "row", revision: 2});
            assert.equal(f.clicks.length, 1);
            const lastGeometry = () => {
                const entries = f.calls.filter(([name]) => name === "siyuan-map-geometry");
                return entries[entries.length - 1][1];
            };
            f.advance();
            assert.equal(lastGeometry().visible, true);
            assert.equal(f.domListeners.has("blur"), false, "focusing the native map must not hide it");
            f.domListeners.get("focus")();
            assert.equal(lastGeometry().visible, false);
            f.advance();
            assert.equal(lastGeometry().visible, true);
            f.domListeners.get("scroll")();
            assert.equal(lastGeometry().visible, false);
            f.advance();
            assert.equal(lastGeometry().visible, true);
            f.doc.elementFromPoint = () => ({});
            f.advance();
            assert.equal(lastGeometry().visible, false);
            f.doc.elementFromPoint = () => f.container;
            f.advance(); f.advance();
            assert.equal(lastGeometry().visible, true);
            f.doc.hidden = true;
            f.domListeners.get("visibilitychange")();
            assert.equal(lastGeometry().visible, false);
            f.doc.hidden = false;
            f.advance(); f.advance();
            assert.equal(lastGeometry().visible, true);
            f.container.isConnected = false;
            f.advance();
            assert.equal(lastGeometry().visible, false);
            f.host.destroy();
            assert.equal(f.listeners.size, 0);
            assert.equal(f.frames.size, 0);
            assert.equal(f.domListeners.size, 0);
            assert.equal(disconnects, 2);
            assert.deepEqual(f.errors, []);
        } finally {
            f.host.destroy();
            globalThis.MutationObserver = oldMutation;
            globalThis.ResizeObserver = oldResize;
        }
    });
    it("keeps unrelated hover mutations visible while geometry and occlusion changes hide immediately", async () => {
        const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
        const callbacks: Array<() => void> = [];
        class Observer {
            constructor(callback: () => void) { callbacks.push(callback); }
            observe() {}
            disconnect() {}
        }
        globalThis.MutationObserver = Observer as any;
        globalThis.ResizeObserver = Observer as any;
        const f = fixture();
        const geometryCalls = () => f.calls.filter(([name]) => name === "siyuan-map-geometry");
        const lastGeometry = () => geometryCalls().at(-1)[1];
        try {
            await f.created();
            f.reply({type: "ready"});
            f.advance();
            assert.equal(lastGeometry().visible, true);
            const count = geometryCalls().length;
            for (let i = 0; i < 5; i++) {
                callbacks[0]();
                f.advance(30);
            }
            assert.equal(geometryCalls().length, count, "unrelated gutter and tooltip mutations must not hide the map");
            f.rect.x += 10;
            callbacks[0]();
            assert.equal(lastGeometry().visible, false, "a real geometry change hides before the next animation frame");
            f.advance(119);
            assert.equal(lastGeometry().visible, false);
            callbacks[0]();
            f.advance(1);
            assert.equal(lastGeometry().visible, true, "unrelated mutations must not restart the stability delay");
            assert.equal(lastGeometry().bounds.x, f.rect.x);
            const menu = {contains: () => false, getClientRects: () => [f.rect],
                getBoundingClientRect: () => ({...f.rect, width: 5, height: 5})};
            f.doc.querySelectorAll = () => [menu];
            callbacks[0]();
            assert.equal(lastGeometry().visible, false, "an overlapping menu hides immediately even with unchanged bounds");
            f.doc.querySelectorAll = (): HTMLElement[] => [];
            callbacks[0]();
            f.advance(119);
            assert.equal(lastGeometry().visible, false);
            f.advance(1);
            assert.equal(lastGeometry().visible, true);
            f.host.destroy();
            const destroyedCount = f.calls.length;
            callbacks[0]();
            assert.equal(f.calls.length, destroyedCount, "queued mutations cannot reactivate a destroyed host");
        } finally {
            f.host.destroy();
            globalThis.MutationObserver = oldMutation;
            globalThis.ResizeObserver = oldResize;
        }
    });
    it("destroys a create that resolves after disposal and never recreates listeners", async () => {
        const f = fixture();
        f.host.destroy();
        await f.created();
        assert.equal(f.calls.filter(([name]) => name === "siyuan-map-destroy").length, 2);
        assert.equal(f.listeners.size, 0);
        assert.equal(f.frames.size, 0);
        assert.deepEqual(f.errors, []);
    });
});
