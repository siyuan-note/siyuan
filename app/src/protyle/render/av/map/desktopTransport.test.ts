import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";
import {describe, it} from "node:test";
import * as ts from "typescript";
import * as protocol from "./protocol";
import * as unplacedMenu from "./unplacedMenu";
import {computeDesktopAVMapGeometry, MapGeometry} from "./desktopGeometry";
import * as desktopGeometryDOM from "./desktopGeometryDOM";
import * as loadingBudget from "./loadingBudget";
import * as desktopUnplaced from "./desktopUnplaced";

const visibleGeometry = (geometry: MapGeometry) => {
    assert.ok(geometry.visible === true, "the fixture must produce visible geometry");
    return geometry;
};

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
        if (name === "./desktopGeometryDOM") { return desktopGeometryDOM; }
        if (name === "./loadingBudget") { return loadingBudget; }
        if (name === "./desktopUnplaced") { return desktopUnplaced; }
        assert.equal(name, "electron");
        assert.equal(browser, false, "browser must not import Electron");
        return {ipcRenderer: ipc};
    };
    new Function("require", "exports", "console", ts.transpileModule(code, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText)(requireModule, result, {warn: (...values: unknown[]) => warnings.push(values)});
    return result;
};

const fixture = (warnings: unknown[][] = []) => {
    const calls: Array<[string, any]> = [];
    const listeners = new Map<string, (...args: any[]) => void>();
    const domListeners = new Map<string, () => void>();
    const frames = new Map<number, () => void>();
    const timers = new Map<number, {callback: () => void; delay: number}>();
    let resolveCreate: (value: unknown) => void;
    let rejectCreate: (value: unknown) => void;
    let now = 0, nextFrame = 0, nextTimer = 0;
    const ipc = {
        invoke: (name: string, value: unknown) => {
            calls.push([name, value]);
            return new Promise((resolve, reject) => { resolveCreate = resolve; rejectCreate = reject; });
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
        setTimeout: (callback: () => void, delay: number) => {
            timers.set(++nextTimer, {callback, delay});
            return nextTimer;
        },
        clearTimeout: (id: number) => timers.delete(id),
        requestAnimationFrame: (fn: () => void) => { frames.set(++nextFrame, fn); return nextFrame; },
        cancelAnimationFrame: (id: number) => frames.delete(id),
        addEventListener: (name: string, fn: () => void) => domListeners.set(name, fn),
        removeEventListener: (name: string) => domListeners.delete(name),
        getComputedStyle: () => ({display: "block", visibility: "visible", opacity: "1", overflowX: "visible", overflowY: "visible",
            transform: "none", filter: "none", boxShadow: "none", outlineStyle: "none",
            getPropertyValue: () => ""})};
    doc.defaultView = scope;
    const container: any = {ownerDocument: doc, isConnected: true, parentElement: null, closest: (): HTMLElement | null => null,
        getClientRects: () => [rect], getBoundingClientRect: () => rect, contains: (target: unknown) => target === container};
    const errors: string[] = [], clicks: unknown[] = [], attributionClicks: string[] = [];
    let ready = 0;
    const api = load(ipc, false, warnings);
    const host = api.createDesktopAVMapHost(container, {provider: "openfreemap", theme: "light",
        onError: (value: string) => errors.push(value),
        onAttributionClick: (link: string) => attributionClicks.push(link),
        onMarkerClick: (...args: unknown[]) => clicks.push(args), onReady: () => ready++});
    const instanceID = calls[0][1].instanceID;
    return {host, calls, listeners, domListeners, frames, timers, errors, clicks, attributionClicks, doc, container, rect,
        ready: () => ready,
        reply: (value: object) => listeners.get("siyuan-map-reply")?.({}, {version: 1, instanceID, ...value}),
        rejected: async () => {
            rejectCreate(new Error("https://private.invalid/?key=secret"));
            await new Promise<void>((resolve) => setImmediate(resolve));
        },
        created: async (overrides: object = {}) => {
            resolveCreate({version: 1, instanceID, ...overrides});
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
    it("registers a menu only for its ready map and closes a late menu creation after map disposal", async () => {
        class Observer { observe() {} disconnect() {} }
        const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver, oldWindow = globalThis.window;
        globalThis.MutationObserver = Observer as any;
        globalThis.ResizeObserver = Observer as any;
        globalThis.window = {siyuan: {config: {editor: {fontSize: 16}}}} as any;
        const f = fixture();
        let closed = 0;
        const anchor = {...f.container, getBoundingClientRect: () => ({left: 100, right: 130, top: 20, bottom: 44})};
        const state: desktopUnplaced.DesktopMapUnplacedState = {requestID: 0, query: "", rows: [], total: 0, page: 1,
            loading: true, error: false, labels: {title: "Unplaced", search: "Search", empty: "Empty", loading: "Loading",
                more: "Next", previous: "Previous", retry: "Retry", close: "Close"}};
        const open = () => desktopUnplaced.openDesktopMapUnplaced(f.container, anchor, state, () => {}, () => closed++, () => true);
        try {
            assert.equal(open(), undefined);
            await f.created();
            assert.equal(open(), undefined, "an initializing map cannot own a native menu");
            f.reply({type: "ready"});
            assert.ok(open());
            assert.equal(f.calls.filter(([name]) => name === "siyuan-map-unplaced-open").length, 1);
            f.host.destroy();
            assert.equal(closed, 1);
            await f.created({sessionID: "b".repeat(48)});
            assert.ok(f.calls.some(([name, value]) => name === "siyuan-map-unplaced-close" && value.sessionID === "b".repeat(48)),
                "a session created after disposal is immediately closed");
            assert.equal(open(), undefined);
            assert.equal(f.listeners.size, 0);
            assert.equal(f.frames.size, 0);
            assert.equal(f.timers.size, 0);
        } finally {
            f.host.destroy();
            globalThis.MutationObserver = oldMutation;
            globalThis.ResizeObserver = oldResize;
            globalThis.window = oldWindow;
        }
    });
    it("forwards only ready current fixed attribution replies already verified by main", async () => {
        class Observer { observe() {} disconnect() {} }
        const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
        globalThis.MutationObserver = Observer as any;
        globalThis.ResizeObserver = Observer as any;
        const f = fixture();
        try {
            f.reply({type: "attributionClick", link: "maplibre"});
            assert.deepEqual(f.attributionClicks, []);
            await f.created(); f.reply({type: "ready"});
            f.reply({type: "attributionClick", link: "maplibre", instanceID: "old"});
            f.reply({type: "attributionClick", link: "https://evil.invalid/"});
            f.reply({type: "attributionClick", link: "maplibre", url: "https://evil.invalid/"});
            assert.deepEqual(f.attributionClicks, ["maplibre"]);
            f.host.destroy();
            f.reply({type: "attributionClick", link: "maplibre"});
            assert.deepEqual(f.attributionClicks, ["maplibre"]);
        } finally {
            f.host.destroy();
            globalThis.MutationObserver = oldMutation;
            globalThis.ResizeObserver = oldResize;
        }
    });
    it("preserves fixed creation failures and never logs rejected IPC details", async () => {
        for (const code of ["hostLimitReached", "hostSetupFailed", "hostAttachFailed"] as const) {
            const warnings: unknown[][] = [];
            const f = fixture(warnings);
            await f.created({error: code, details: "https://private.invalid/?key=secret"});
            assert.deepEqual(f.errors, [code]);
            assert.deepEqual(warnings, [["Database map failed:", code]]);
            assert.equal(f.timers.size, 0);
        }
        for (const response of [{version: 2}, {instanceID: "other"}, {error: "secret"}]) {
            const f = fixture();
            await f.created(response);
            assert.deepEqual(f.errors, ["hostCreateInvalidResponse"]);
        }
        const warnings: unknown[][] = [];
        const f = fixture(warnings);
        await f.rejected();
        assert.deepEqual(f.errors, ["hostCreateRejected"]);
        assert.deepEqual(warnings, [["Database map failed:", "hostCreateRejected"]]);
        assert.equal(f.listeners.size, 0);
    });
    it("lets main report a late SDK failure before the owner fallback and cleans the fallback", async () => {
        const f = fixture();
        assert.deepEqual([...f.timers.values()].map((timer) => timer.delay), [90000]);
        f.reply({type: "error", code: "hostSDKTimeout"});
        assert.deepEqual(f.errors, ["hostSDKTimeout"]);
        assert.equal(f.timers.size, 0);
        await f.created();
        assert.equal(f.frames.size, 0, "late create must not revive a failed host");
        const stalled = fixture();
        const callback = [...stalled.timers.values()][0].callback;
        callback();
        assert.deepEqual(stalled.errors, ["hostReadyTimeout"]);
        assert.equal(stalled.listeners.size, 0);
        assert.equal(stalled.timers.size, 0);
        await stalled.created();
        assert.equal(stalled.frames.size, 0);
        const disposed = fixture();
        const late = [...disposed.timers.values()][0].callback;
        disposed.host.destroy();
        late();
        assert.deepEqual(disposed.errors, []);
    });
    it("logs only allowlisted diagnostics for the current instance and ignores provider text", () => {
        const warnings: unknown[][] = [];
        const f = fixture(warnings);
        f.reply({type: "diagnostic", code: "cspWorker", detail: "https://secret.invalid/?key=private"});
        f.reply({type: "diagnostic", code: "https://secret.invalid/?key=private"});
        f.reply({type: "diagnostic", code: "cspScript", instanceID: "wrong"});
        assert.deepEqual(warnings, [["Database map diagnostic:", "cspWorker"]]);
        assert.deepEqual(f.errors, []);
        f.host.destroy();
        f.reply({type: "diagnostic", code: "cspScript"});
        assert.equal(warnings.length, 1);
        const {mapDiagnosticCodes} = require("../../../../../electron/mapHostDiagnostics");
        for (const code of mapDiagnosticCodes) assert.ok(source.includes(`"${code}"`));
    });
    it("validates CSP resource categories and never logs arbitrary resource values", () => {
        const warnings: unknown[][] = [];
        const f = fixture(warnings);
        const {mapCSPResourceCodes, mapCSPDiagnosticCodes} = require("../../../../../electron/mapHostDiagnostics");
        for (const resource of mapCSPResourceCodes) {
            f.reply({type: "diagnostic", code: "cspConnect", resource, detail: "private-token"});
        }
        assert.deepEqual(warnings, mapCSPResourceCodes.map((resource: string) => ["Database map diagnostic:", "cspConnect", resource]));
        for (const code of mapCSPDiagnosticCodes) assert.ok(source.includes(`"${code}"`));
        for (const resource of ["https://webapi.amap.com/?key=secret", "https:private.invalid", "private-token", null,
            {toString: () => "secret"}, ["blob"]]) {
            f.reply({type: "diagnostic", code: "cspConnect", resource});
        }
        f.reply({type: "diagnostic", code: "storageUnavailable", resource: "blob"});
        f.reply({type: "diagnostic", code: "cspWorker", resource: "blob", instanceID: "wrong"});
        assert.equal(warnings.length, mapCSPResourceCodes.length);
        f.host.destroy();
        f.reply({type: "diagnostic", code: "cspWorker", resource: "data"});
        assert.equal(warnings.length, mapCSPResourceCodes.length);
        assert.equal(JSON.stringify(warnings).includes("secret"), false);
    });
    it("deduplicates allowed resources and rejects arbitrary public hostnames", () => {
        const warnings: unknown[][] = [];
        const f = fixture(warnings);
        for (let i = 0; i < 100; i++) {
            f.reply({type: "diagnostic", code: "cspConnect", resource: "https:tiles.openfreemap.org"});
            f.reply({type: "diagnostic", code: "cspConnect", resource: "https:map" + i + ".invalid"});
        }
        assert.deepEqual(warnings, [["Database map diagnostic:", "cspConnect", "https:tiles.openfreemap.org"]]);
        f.host.destroy();
    });
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
        const compute = computeDesktopAVMapGeometry;
        assert.deepEqual(compute({x: -20.5, y: 30, width: 200, height: 100},
            [{x: 0, y: 0, width: 1000, height: 800}, {x: 10, y: 40, width: 100, height: 60}]),
        {visible: true, bounds: {x: 11, y: 41, width: 98, height: 58},
            logicalSize: {width: 200, height: 100}, crop: {x: 31.5, y: 11}});
        const rect = {x: 0, y: 0, width: 100, height: 100};
        assert.deepEqual(compute(rect, [{...rect, x: 200}]), {visible: false});
        assert.deepEqual(compute(rect, [], [{x: 30, y: 40, width: 5, height: 5}]), {visible: false});
        assert.equal(compute(rect, [], [{...rect, x: 100}]).visible, true);
        assert.deepEqual(compute({...rect, width: NaN}, []), {visible: false});
    });
    it("keeps the native map inside the measured editor edge during upward and downward scrolling", async () => {
        const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
        class Observer {
            observe() {}
            disconnect() {}
        }
        globalThis.MutationObserver = Observer as any;
        globalThis.ResizeObserver = Observer as any;
        const f = fixture();
        const scope = f.doc.defaultView;
        scope.innerWidth = 1920;
        scope.innerHeight = 655;
        Object.assign(f.rect, {x: 478, y: 375.5, width: 1290, height: 327.5});
        const editor = {parentElement: null as HTMLElement | null, offsetWidth: 1500, offsetHeight: 539,
            clientLeft: 0, clientTop: 0, clientWidth: 1490, clientHeight: 539,
            getBoundingClientRect: () => ({x: 378, y: 84, width: 1500, height: 539})};
        f.container.parentElement = editor;
        const getStyle = scope.getComputedStyle;
        scope.getComputedStyle = (element: unknown) => ({...getStyle(),
            overflowX: element === editor ? "auto" : "visible", overflowY: element === editor ? "auto" : "visible"});
        // 实测底栏从 y=623 开始，但半像素位置 622.5 已命中底栏。
        f.doc.elementFromPoint = (_x: number, y: number) => y >= 622.5 ? editor : f.container;
        try {
            await f.created();
            f.reply({type: "ready"});
            f.advance();
            const last = () => f.calls.filter(([name]) => name === "siyuan-map-geometry").at(-1)[1];
            assert.deepEqual(last().bounds, {x: 478, y: 375.5, width: 1290, height: 246.5});
            assert.deepEqual(last().logicalSize, {width: 1290, height: 327.5});
            for (const y of [400, 460, 375.5, 290, 375.5]) {
                f.rect.y = y;
                f.domListeners.get("scroll")();
                assert.equal(last().visible, true);
                assert.ok(last().bounds.y + last().bounds.height <= 622);
            }
            f.doc.elementFromPoint = () => editor;
            f.domListeners.get("scroll")();
            assert.equal(last().visible, false, "real occlusion must still hide the map");
        } finally {
            f.host.destroy();
            globalThis.MutationObserver = oldMutation;
            globalThis.ResizeObserver = oldResize;
        }
        const compute = computeDesktopAVMapGeometry;
        const rect = {x: 0, y: 0, width: 100, height: 100};
        assert.equal(compute(rect, [{...rect, height: 1.5}]).visible, false);
        assert.equal(visibleGeometry(compute(rect, [{...rect, height: 2}])).bounds.height, 1);
        assert.equal(compute(rect, [{...rect, y: 20, height: 2.5}]).visible, false);
        assert.equal(visibleGeometry(compute(rect, [{...rect, y: 20, height: 3}])).bounds.height, 1);
        assert.deepEqual(visibleGeometry(compute(rect, [rect])).bounds, rect, "uncropped maps retain their complete bounds");
        assert.deepEqual(visibleGeometry(compute(rect, [{x: -10, y: -10, width: 120, height: 120}])).bounds, rect);
        const clip = {...rect, height: 50};
        assert.equal(visibleGeometry(compute(rect, [clip, clip, clip])).bounds.height, 49, "nested clips inset only once");
        const {parseMapGeometry} = require("../../../../../electron/mapHostPolicy");
        assert.equal(parseMapGeometry(compute(rect, [{...rect, height: 2}]), 0.8, {width: 1000, height: 800}).visible, false);
    });
    it("fails closed for missing capability and omits Electron from browser compilation", async () => {
        assert.equal(await load(undefined, true).isDesktopAVMapHostSupported(), false);
        assert.equal(await load({invoke: async () => ({version: 1, supported: true})}).isDesktopAVMapHostSupported(), true);
        assert.equal(await load({invoke: async () => ({version: 2, supported: true})}).isDesktopAVMapHostSupported(), false);
        assert.equal(await load({invoke: async () => { throw new Error("old main"); }}).isDesktopAVMapHostSupported(), false);
    });
    it("selects the largest safe rectangle around one owned menu and retains the full logical map", () => {
        const compute = computeDesktopAVMapGeometry;
        const {parseMapGeometry} = require("../../../../../electron/mapHostPolicy");
        const rect = {x: 10, y: 20, width: 400, height: 300};
        const cases = [
            {menu: {...rect, width: 100}, bounds: {x: 111, y: 20, width: 299, height: 300}},
            {menu: {...rect, x: 310, width: 100}, bounds: {x: 10, y: 20, width: 299, height: 300}},
            {menu: {...rect, height: 100}, bounds: {x: 10, y: 121, width: 400, height: 199}},
            {menu: {...rect, y: 220, height: 100}, bounds: {x: 10, y: 20, width: 400, height: 199}},
            {menu: {x: 160, y: 120, width: 100, height: 100}, bounds: {x: 10, y: 20, width: 149, height: 300}},
        ];
        for (const {menu, bounds} of cases) {
            const geometry = visibleGeometry(compute(rect, [], [], [menu]));
            assert.deepEqual(geometry.bounds, bounds);
            assert.deepEqual(geometry.logicalSize, {width: rect.width, height: rect.height});
            assert.deepEqual(geometry.crop, {x: bounds.x - rect.x, y: bounds.y - rect.y});
            for (const zoom of [0.8, 0.9, 1, 1.25, 1.5, 2]) {
                const native = parseMapGeometry(geometry, zoom, {width: 4000, height: 3000});
                assert.equal(native?.visible, true);
                assert.ok(native.bounds.x >= rect.x * zoom && native.bounds.y >= rect.y * zoom);
                assert.ok(native.bounds.x + native.bounds.width <= (rect.x + rect.width) * zoom);
                assert.ok(native.bounds.y + native.bounds.height <= (rect.y + rect.height) * zoom);
                assert.ok(native.bounds.x + native.bounds.width <= menu.x * zoom ||
                    native.bounds.x >= (menu.x + menu.width) * zoom ||
                    native.bounds.y + native.bounds.height <= menu.y * zoom ||
                    native.bounds.y >= (menu.y + menu.height) * zoom);
            }
        }
        const menu = {...rect, width: 100};
        assert.deepEqual(compute(rect, [], [menu]), {visible: false}, "ordinary menus never opt into cropping");
        assert.deepEqual(compute(rect, [], [{...rect, width: 2}], [menu]), {visible: false},
            "a second overlay hides the map even when it would lie outside the chosen crop");
        assert.deepEqual(compute(rect, [], [], [menu, {...menu, x: 300}]), {visible: false});
        assert.deepEqual(compute(rect, [], [], [rect]), {visible: false});
        assert.deepEqual(compute(rect, [], [], [{...rect, width: 380}]), {visible: false});
        assert.deepEqual(compute({...rect, height: 100}, [], [], [{...rect, width: 360}]), {visible: false});
        assert.deepEqual(compute(rect, [], [], [{...menu, x: NaN}]), {visible: false});
        const fractional = {x: 10.25, y: 20.75, width: 400.5, height: 300.5};
        const geometry = visibleGeometry(compute(fractional, [{x: 30.5, y: 50.25, width: 340, height: 220}], [],
            [{x: 290.5, y: 30, width: 100, height: 290}]));
        assert.deepEqual(geometry.bounds, {x: 32, y: 52, width: 257, height: 217});
        assert.deepEqual(geometry.crop, {x: 21.75, y: 31.25});
        assert.deepEqual(geometry.logicalSize, {width: 400.5, height: 300.5});
    });
    it("clips only its own live unplaced menu including shadows and restores without refitting or recreating", async () => {
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
        const rect = {x: 310, y: 30, width: 100, height: 260};
        const submenu = {getClientRects: () => [rect]};
        let submenus: unknown[] = [];
        const menu: any = {contains: () => false, getClientRects: () => [rect], getBoundingClientRect: () => rect,
            querySelectorAll: () => submenus};
        const getStyle = f.doc.defaultView.getComputedStyle;
        let shadow = "rgba(0, 0, 0, 0.2) 0px 8px 24px 0px";
        let extraStyle = {};
        f.doc.defaultView.getComputedStyle = (element: unknown) => ({...getStyle(),
            ...(element === menu ? {boxShadow: shadow, ...extraStyle} : {})});
        const lastGeometry = () => f.calls.filter(([name]) => name === "siyuan-map-geometry").at(-1)[1];
        let release = unplacedMenu.registerMapUnplacedMenu(menu, f.container);
        try {
            await f.created();
            f.reply({type: "ready"});
            f.advance();
            const commands = f.calls.filter(([name]) => name === "siyuan-map-command").length;
            f.doc.querySelectorAll = () => [menu];
            callbacks[0]();
            f.advance();
            assert.deepEqual(lastGeometry().bounds, {x: 10, y: 20, width: 251, height: 300});
            assert.deepEqual(lastGeometry().logicalSize, {width: 400, height: 300});
            const scroll = f.domListeners.get("scroll");
            rect.height = 40;
            scroll();
            assert.deepEqual(lastGeometry().bounds, {x: 10, y: 127, width: 400, height: 193},
                "a shorter result list can leave a larger rectangle below the menu");
            rect.height = 260;
            rect.x = 270;
            scroll();
            assert.equal(lastGeometry().bounds.width, 211, "moving or growing the menu refreshes its crop");
            shadow = "rgba(0, 0, 0, 0.8) -8px -4px 3px 2px, rgb(255, 255, 255) 0px 0px 0px 2px";
            scroll();
            assert.equal(lastGeometry().bounds.width, 243, "every shadow and negative offset must be covered");
            shadow = "rgb(0 0 0 / 0.5) 0px 0px 100px 0px inset";
            scroll();
            assert.equal(lastGeometry().bounds.width, 259, "inset shadows do not extend the menu");
            extraStyle = {outlineStyle: "solid", outlineWidth: "4px", outlineOffset: "2px"};
            scroll();
            assert.equal(lastGeometry().bounds.width, 253, "outline pixels also remain outside the map");
            extraStyle = {};
            for (const unsupported of ["color(display-p3 1 0 0) 0px 0px 10px 0px", "rgb(0, 0, 0) 0px 0px invalid",
                "rgb(0, 0, 0) 0px 0px -1px 0px"]) {
                shadow = unsupported;
                scroll();
                assert.equal(lastGeometry().visible, false, "unsupported effects fail closed");
            }
            shadow = "none";
            for (const style of [{transform: "matrix(1, 0, 0, 1, 1, 1)"}, {filter: "blur(2px)"},
                {scale: "1.1"}, {getPropertyValue: () => "1.5"},
                {outlineStyle: "solid", outlineWidth: "invalid", outlineOffset: "0px"}]) {
                extraStyle = style;
                scroll();
                assert.equal(lastGeometry().visible, false);
            }
            extraStyle = {};
            const parent = {};
            menu.parentElement = parent;
            f.doc.defaultView.getComputedStyle = (element: unknown) => ({...getStyle(),
                ...(element === parent ? {getPropertyValue: () => "1.5"} : {})});
            scroll();
            assert.equal(lastGeometry().visible, false, "ancestor CSS zoom cannot leave underestimated shadow bounds");
            menu.parentElement = null;
            f.doc.defaultView.getComputedStyle = getStyle;
            submenus = [submenu];
            scroll();
            assert.equal(lastGeometry().visible, false, "a visible submenu is not covered by the root rectangle");
            submenus = [];
            const otherMenu = {contains: () => false, getClientRects: () => [rect], getBoundingClientRect: () => rect};
            f.doc.querySelectorAll = () => [menu, otherMenu];
            scroll();
            assert.equal(lastGeometry().visible, false, "a second overlapping menu retains full hiding");
            f.doc.querySelectorAll = () => [menu];
            f.doc.elementFromPoint = () => ({});
            scroll();
            assert.equal(lastGeometry().visible, false, "unknown overlays still fail the final hit test");
            f.doc.elementFromPoint = () => f.container;
            release();
            scroll();
            assert.equal(lastGeometry().visible, false, "a reused common menu loses the crop exception on close");
            release = unplacedMenu.registerMapUnplacedMenu(menu, {} as HTMLElement);
            scroll();
            assert.equal(lastGeometry().visible, false, "another split view cannot claim this map's menu");
            release();
            release = unplacedMenu.registerMapUnplacedMenu(menu, f.container);
            scroll();
            assert.equal(lastGeometry().visible, true);
            f.doc.querySelectorAll = (): HTMLElement[] => [];
            callbacks[0]();
            f.advance();
            assert.deepEqual(lastGeometry().bounds, f.rect);
            assert.deepEqual(lastGeometry().crop, {x: 0, y: 0});
            assert.equal(f.calls.filter(([name]) => name === "siyuan-map-create").length, 1);
            assert.equal(f.calls.filter(([name]) => name === "siyuan-map-command").length, commands,
                "menu geometry changes must not send fit or recreate map state");
        } finally {
            release();
            f.host.destroy();
            globalThis.MutationObserver = oldMutation;
            globalThis.ResizeObserver = oldResize;
        }
    });
    it("keeps replacement menu ownership when an older registration is released", () => {
        const menu = {} as HTMLElement, first = {} as HTMLElement, second = {} as HTMLElement;
        const releaseFirst = unplacedMenu.registerMapUnplacedMenu(menu, first);
        const releaseSecond = unplacedMenu.registerMapUnplacedMenu(menu, second);
        releaseFirst();
        assert.equal(unplacedMenu.isMapUnplacedMenu(menu, first), false);
        assert.equal(unplacedMenu.isMapUnplacedMenu(menu, second), true);
        releaseSecond();
        assert.equal(unplacedMenu.isMapUnplacedMenu(menu, second), false);
    });
    it("preserves fractional geometry through native validation at every clipped edge and zoom", () => {
        const compute = computeDesktopAVMapGeometry;
        const {parseMapGeometry} = require("../../../../../electron/mapHostPolicy");
        const rect = {x: 155.55555555555554, y: 555.5555555555555, width: 1433.3333333333333, height: 480};
        assert.ok(rect.y + rect.height - rect.y > rect.height, "the fixture must reproduce floating-point expansion");
        const cases = [
            {clips: [], width: rect.width, height: rect.height, cropX: 0, cropY: 0},
            {clips: [{x: rect.x + 40, y: 0, width: 2000, height: 1400}],
                width: rect.width - 41, height: rect.height, cropX: 41, cropY: 0},
            {clips: [{x: 0, y: 0, width: rect.x + rect.width - 40, height: 1400}],
                width: rect.width - 41, height: rect.height, cropX: 0, cropY: 0},
            {clips: [{x: 0, y: rect.y + 40, width: 2000, height: 1400}],
                width: rect.width, height: rect.height - 41, cropX: 0, cropY: 41},
            {clips: [{x: 0, y: 0, width: 2000, height: rect.y + rect.height - 40}],
                width: rect.width, height: rect.height - 41, cropX: 0, cropY: 0},
            {clips: [{x: rect.x + 10, y: rect.y + 30, width: rect.width - 30, height: rect.height - 70}],
                width: rect.width - 32, height: rect.height - 72, cropX: 11, cropY: 31},
        ];
        for (const entry of cases) {
            const geometry = visibleGeometry(compute(rect, entry.clips));
            assert.ok(geometry.bounds.width <= rect.width);
            assert.ok(geometry.bounds.height <= rect.height);
            assert.ok(Math.abs(geometry.bounds.width - entry.width) < 1e-9);
            assert.ok(Math.abs(geometry.bounds.height - entry.height) < 1e-9);
            assert.ok(Math.abs(geometry.crop.x - entry.cropX) < 1e-9);
            assert.ok(Math.abs(geometry.crop.y - entry.cropY) < 1e-9);
            for (const zoom of [0.8, 0.9, 1, 1.1, 1.25, 1.5, 2]) {
                const native = parseMapGeometry(geometry, zoom, {width: 4000, height: 3000});
                assert.equal(native?.visible, true, `native validation must retain the map at zoom ${zoom}`);
                assert.ok(native.bounds.x >= geometry.bounds.x * zoom);
                assert.ok(native.bounds.y >= geometry.bounds.y * zoom);
                assert.ok(native.bounds.x + native.bounds.width <= (geometry.bounds.x + geometry.bounds.width) * zoom);
                assert.ok(native.bounds.y + native.bounds.height <= (geometry.bounds.y + geometry.bounds.height) * zoom);
            }
        }
        const widthRect = {...rect, x: rect.y, width: rect.height};
        assert.ok(widthRect.x + widthRect.width - widthRect.x > widthRect.width);
        const geometry = visibleGeometry(compute(widthRect, []));
        assert.equal(geometry.bounds.width, widthRect.width);
        assert.equal(parseMapGeometry(geometry, 1.25, {width: 4000, height: 3000})?.visible, true);
    });
    it("keeps all visibility and hit-test checks without logging normal geometry transitions", async () => {
        const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
        class Observer { observe() {} disconnect() {} }
        globalThis.MutationObserver = Observer as any;
        globalThis.ResizeObserver = Observer as any;
        const warnings: unknown[][] = [];
        const f = fixture(warnings);
        const getStyle = f.doc.defaultView.getComputedStyle;
        const lastGeometry = () => f.calls.filter(([name]) => name === "siyuan-map-geometry").at(-1)[1];
        f.container.id = "private-block-id";
        f.container.textContent = "private-document-content";
        try {
            await f.created();
            assert.equal(lastGeometry().visible, false);
            f.advance();
            assert.equal(lastGeometry().visible, true);
            const scroll = f.domListeners.get("scroll");
            const expectHidden = (reason: string) => {
                scroll();
                assert.equal(lastGeometry().visible, false, reason);
                for (let i = 0; i < 10; i++) f.advance(30);
                assert.equal(warnings.length, 0, "normal geometry changes must not log warnings");
            };
            f.doc.hidden = true;
            expectHidden("documentHidden");
            f.doc.hidden = false;
            f.container.isConnected = false;
            expectHidden("disconnected");
            f.container.isConnected = true;
            f.container.getClientRects = (): DOMRect[] => [];
            expectHidden("noClientRects");
            f.container.getClientRects = () => [f.rect];
            f.doc.defaultView.getComputedStyle = () => ({...getStyle(), visibility: "hidden"});
            expectHidden("hiddenStyle");
            f.doc.defaultView.getComputedStyle = getStyle;
            f.rect.width = 0;
            expectHidden("zeroRect");
            f.rect.width = 400;
            f.rect.x = NaN;
            expectHidden("invalidGeometry");
            f.rect.x = 10;
            f.rect.y = 900;
            expectHidden("outsideViewport");
            f.rect.y = 20;
            const parent = {parentElement: null as HTMLElement | null, getBoundingClientRect: () => ({x: 0, y: 0, width: 1000, height: 800}),
                offsetWidth: 1000, offsetHeight: 800, clientWidth: 1000, clientHeight: 0, clientLeft: 0, clientTop: 0};
            f.container.parentElement = parent;
            f.doc.defaultView.getComputedStyle = (element: unknown) => ({...getStyle(),
                overflowY: element === parent ? "hidden" : "visible"});
            expectHidden("clipped");
            f.container.parentElement = null;
            f.doc.defaultView.getComputedStyle = getStyle;
            f.doc.querySelectorAll = () => [{contains: () => false, getClientRects: () => [f.rect],
                getBoundingClientRect: () => f.rect, textContent: "private-overlay-content"}];
            expectHidden("overlay");
            f.doc.querySelectorAll = (): HTMLElement[] => [];
            for (const [y, reason] of [[f.rect.y + 0.5, "hitTestTop"],
                [f.rect.y + f.rect.height / 2, "hitTestMiddle"], [f.rect.y + f.rect.height - 0.5, "hitTestBottom"]] as const) {
                f.doc.elementFromPoint = (_x: number, pointY: number) => pointY === y ?
                    {textContent: "private-hit-content", id: "private-overlay-id"} : f.container;
                expectHidden(reason);
            }
            f.doc.elementFromPoint = () => f.container;
            scroll();
            assert.equal(lastGeometry().visible, true);
            for (let i = 0; i < 100; i++) {
                f.doc.hidden = i % 2 === 0;
                scroll();
                assert.equal(lastGeometry().visible, !f.doc.hidden, "repeated changes must not interrupt geometry updates");
            }
            assert.equal(warnings.length, 0);
            f.host.destroy();
            scroll();
            f.advance();
            assert.equal(warnings.length, 0);
        } finally {
            f.host.destroy();
            globalThis.MutationObserver = oldMutation;
            globalThis.ResizeObserver = oldResize;
        }
    });
    it("caches ready commands, validates replies and recovers from scroll, occlusion and visibility changes", async () => {
        const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
        let disconnects = 0;
        class Observer { observe() {} disconnect() { disconnects++; } }
        globalThis.MutationObserver = Observer as any;
        globalThis.ResizeObserver = Observer as any;
        const f = fixture();
        try {
            const point = {id: "row", longitude: 1, latitude: 2, name: "private"};
            f.host.setPoints([point], 1);
            f.host.setTheme("dark");
            assert.equal(f.calls[0][1].credentials, undefined);
            assert.match(f.calls[0][1].instanceID, /^[a-f0-9]{48}$/);
            await f.created();
            f.reply({type: "ready", instanceID: "old"});
            assert.equal(f.ready(), 0);
            f.reply({type: "ready"});
            f.reply({type: "ready"});
            assert.equal(f.ready(), 1);
            const commands = f.calls.filter(([name]) => name === "siyuan-map-command").map(([, value]) => value);
            assert.deepEqual(commands.map((value) => value.type), ["setPoints", "theme"]);
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
            assert.equal(lastGeometry().visible, true);
            f.advance();
            assert.equal(lastGeometry().visible, true);
            f.domListeners.get("scroll")();
            assert.equal(lastGeometry().visible, true);
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
    it("keeps the map visible when focus returns from attribution while rechecking real occlusion", async () => {
        const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
        class Observer { observe() {} disconnect() {} }
        globalThis.MutationObserver = Observer as any;
        globalThis.ResizeObserver = Observer as any;
        const f = fixture();
        const geometryCalls = () => f.calls.filter(([name]) => name === "siyuan-map-geometry");
        const lastGeometry = () => geometryCalls().at(-1)[1];
        try {
            await f.created();
            f.reply({type: "ready"});
            f.advance();
            const count = geometryCalls().length;
            assert.equal(f.domListeners.has("blur"), false, "the map receives focus without hiding its native view");
            for (let i = 0; i < 3; i++) {
                f.domListeners.get("focus")();
                assert.equal(lastGeometry().visible, true, "clicking outside attribution must not blank the map");
                f.advance(30);
            }
            assert.equal(geometryCalls().length, count, "unchanged focus returns must not send hidden geometry");
            const menu = {contains: () => false, getClientRects: () => [f.rect],
                getBoundingClientRect: () => ({...f.rect, width: 5, height: 5})};
            f.doc.querySelectorAll = () => [menu];
            f.domListeners.get("focus")();
            assert.equal(lastGeometry().visible, false, "an overlapping app menu must hide the map immediately on focus");
            f.doc.querySelectorAll = (): HTMLElement[] => [];
            f.domListeners.get("focus")();
            f.advance(119);
            assert.equal(lastGeometry().visible, false);
            f.advance(1);
            assert.equal(lastGeometry().visible, true);
            f.rect.x += 10;
            f.domListeners.get("focus")();
            assert.equal(lastGeometry().visible, false, "changed geometry still waits for layout to settle");
            f.advance();
            assert.equal(lastGeometry().bounds.x, f.rect.x);
            f.doc.hidden = true;
            f.domListeners.get("focus")();
            assert.equal(lastGeometry().visible, false, "a genuinely hidden document remains hidden");
            f.doc.hidden = false;
            f.doc.elementFromPoint = () => ({});
            f.domListeners.get("focus")();
            assert.equal(lastGeometry().visible, false, "unknown owner overlays retain the hit-test safeguard");
            f.doc.elementFromPoint = () => f.container;
            f.domListeners.get("focus")();
            f.advance();
            assert.equal(lastGeometry().visible, true);
            assert.deepEqual(f.errors, []);
        } finally {
            f.host.destroy();
            globalThis.MutationObserver = oldMutation;
            globalThis.ResizeObserver = oldResize;
        }
    });
    it("clips beneath its own fixed database tabs while retaining menu and unknown occlusion checks", async () => {
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
        const lastGeometry = () => f.calls.filter(([name]) => name === "siyuan-map-geometry").at(-1)[1];
        const tabsRect = {x: 10, y: 90, width: 400, height: 33};
        const tabs = {getClientRects: () => [tabsRect], getBoundingClientRect: () => tabsRect};
        const av = {querySelector: (selector: string) => {
            assert.equal(selector, ":scope > .av__container > .av__header > .av__views--fixed");
            return tabs;
        }};
        f.container.closest = (selector: string) => {
            assert.equal(selector, ".av[data-type='NodeAttributeView']");
            return av;
        };
        const getStyle = f.doc.defaultView.getComputedStyle;
        f.doc.defaultView.getComputedStyle = (element: unknown) => ({...getStyle(element), position: element === tabs ? "fixed" : "static"});
        f.rect.y = 60;
        f.doc.elementFromPoint = (_x: number, y: number) => y >= tabsRect.y && y < tabsRect.y + tabsRect.height ? tabs : f.container;
        try {
            await f.created();
            f.reply({type: "ready"});
            f.advance();
            assert.deepEqual(lastGeometry().bounds, {x: 10, y: 124, width: 400, height: 236});
            assert.deepEqual(lastGeometry().logicalSize, {width: 400, height: 300});
            assert.deepEqual(lastGeometry().crop, {x: 0, y: 64});
            f.rect.y = 40;
            f.domListeners.get("scroll")();
            assert.deepEqual(lastGeometry().bounds, {x: 10, y: 124, width: 400, height: 216});
            tabsRect.height += 5;
            callbacks[0]();
            assert.deepEqual(lastGeometry().bounds, {x: 10, y: 129, width: 400, height: 211});
            assert.deepEqual(lastGeometry().crop, {x: 0, y: 89});
            const menu = {contains: () => false, getClientRects: () => [f.rect],
                getBoundingClientRect: () => ({x: 30, y: 160, width: 40, height: 40})};
            f.doc.querySelectorAll = () => [menu];
            callbacks[0]();
            assert.equal(lastGeometry().visible, false);
            f.doc.querySelectorAll = (): HTMLElement[] => [];
            f.doc.elementFromPoint = () => ({});
            callbacks[0]();
            f.advance();
            assert.equal(lastGeometry().visible, false, "other database bars and unknown overlays must still hide the map");
            f.doc.elementFromPoint = () => f.container;
            callbacks[0]();
            f.advance();
            assert.equal(lastGeometry().visible, true);
        } finally {
            f.host.destroy();
            globalThis.MutationObserver = oldMutation;
            globalThis.ResizeObserver = oldResize;
        }
    });
    it("updates throughout continuous scrolling while hiding occlusion and stopping after disposal", async () => {
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
            f.rect.y = 180;
            await f.created();
            f.reply({type: "ready"});
            f.advance();
            const first = geometryCalls().length;
            const scroll = f.domListeners.get("scroll");
            for (let i = 0; i < 8; i++) {
                f.rect.y -= 7;
                scroll();
                assert.equal(lastGeometry().bounds.y, f.rect.y);
                f.advance(30);
                f.rect.y -= 1;
                callbacks[0]();
                assert.equal(lastGeometry().bounds.y, f.rect.y, "layout mutations during scrolling must not restart hiding");
            }
            assert.ok(geometryCalls().slice(first).every(([, value]) => value.visible));
            const menu = {contains: () => false, getClientRects: () => [f.rect], getBoundingClientRect: () => f.rect};
            f.doc.querySelectorAll = () => [menu];
            scroll();
            assert.equal(lastGeometry().visible, false, "scrolling elsewhere must still hide a newly overlapping menu");
            callbacks[0]();
            assert.equal(lastGeometry().visible, false);
            f.advance(30);
            f.doc.querySelectorAll = (): HTMLElement[] => [];
            f.doc.elementFromPoint = () => ({});
            callbacks[0]();
            assert.equal(lastGeometry().visible, false);
            f.doc.elementFromPoint = () => f.container;
            callbacks[0]();
            assert.equal(lastGeometry().visible, true);
            f.container.isConnected = false;
            scroll();
            assert.equal(lastGeometry().visible, false);
            f.host.destroy();
            const count = f.calls.length;
            scroll();
            callbacks[0]();
            f.advance();
            assert.equal(f.calls.length, count);
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
