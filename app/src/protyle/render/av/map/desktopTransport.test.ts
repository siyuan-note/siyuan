import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";
import {describe, it} from "node:test";
import * as ts from "typescript";
import * as protocol from "./protocol";
import * as loadingBudget from "./loadingBudget";
import {getAVMapVisibility} from "./host";

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
        if (name === "./loadingBudget") { return loadingBudget; }
        if (name === "./host") { return {getAVMapVisibility}; }
        assert.equal(name, "electron");
        assert.equal(browser, false, "browser must not import Electron");
        return {ipcRenderer: ipc};
    };
    new Function("require", "exports", "console", ts.transpileModule(code, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    }).outputText)(requireModule, result, {warn: (...values: unknown[]) => warnings.push(values)});
    return result;
};

const fixture = (warnings: unknown[][] = [], origin = "http://127.0.0.1:6806") => {
    const calls: Array<[string, any]> = [];
    const listeners = new Map<string, (...args: any[]) => void>();
    const domListeners = new Map<string, () => void>();
    const frames = new Map<number, () => void>();
    const timers = new Map<number, {callback: () => void; delay: number}>();
    let resolveCreate: (value: unknown) => void;
    let rejectCreate: (value: unknown) => void;
    let nextFrame = 0, nextTimer = 0;
    const ipc = {
        invoke: (name: string, value: unknown) => {
            calls.push([name, value]);
            return new Promise((resolve, reject) => { resolveCreate = resolve; rejectCreate = reject; });
        },
        send: (name: string, value: unknown) => calls.push([name, value]),
        on: (name: string, fn: (...args: any[]) => void) => listeners.set(name, fn),
        removeListener: (name: string) => listeners.delete(name),
    };
    const rect = {x: 10, y: 20, width: 400, height: 300, get left() { return this.x; }, get top() { return this.y; },
        get right() { return this.x + this.width; }, get bottom() { return this.y + this.height; }};
    const guests: Array<{tag: string; attributes: Map<string, string>; style: {cssText: string}; removed: boolean;
        setAttribute: (name: string, value: string) => void; remove: () => void}> = [];
    const attachments: unknown[] = [];
    const doc: any = {hidden: false, documentElement: {}, querySelectorAll: (): HTMLElement[] => [],
        elementFromPoint: () => container,
        createElement: (tag: string) => {
            const attributes = new Map<string, string>();
            const guest = {tag, attributes, style: {cssText: ""}, removed: false,
                setAttribute: (name: string, value: string) => attributes.set(name, value),
                remove: () => { guest.removed = true; }};
            guests.push(guest);
            return guest;
        },
        addEventListener: (name: string, fn: () => void) => domListeners.set(name, fn),
        removeEventListener: (name: string) => domListeners.delete(name)};
    const scope = {crypto: webcrypto, location: {origin},
        innerWidth: 1000, innerHeight: 800,
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
        clientWidth: 400, clientHeight: 300, append: (guest: unknown) => attachments.push(guest),
        getClientRects: () => [rect], getBoundingClientRect: () => rect, contains: (target: unknown) => target === container || attachments.includes(target)};
    const errors: string[] = [], clicks: unknown[] = [], attributionClicks: string[] = [];
    let ready = 0;
    const api = load(ipc, false, warnings);
    const host = api.createDesktopAVMapHost(container, {provider: "openfreemap", theme: "light",
        onError: (value: string) => errors.push(value),
        onAttributionClick: (link: string) => attributionClicks.push(link),
        onMarkerClick: (...args: unknown[]) => clicks.push(args), onReady: () => ready++});
    const instanceID = calls[0][1].instanceID;
    return {host, calls, listeners, domListeners, frames, timers, errors, clicks, attributionClicks, doc, container, rect, guests, attachments,
        api, instanceID,
        ready: () => ready,
        reply: (value: object) => listeners.get("siyuan-map-reply")?.({}, {version: 1, instanceID, ...value}),
        rejected: async () => {
            rejectCreate(new Error("https://private.invalid/?key=secret"));
            await new Promise<void>((resolve) => setImmediate(resolve));
        },
        created: async (overrides: object = {}) => {
            resolveCreate({version: 1, instanceID, mode: "webview",
                src: `${origin}/stage/map/index.html?provider=openfreemap#${instanceID}:${"b".repeat(48)}`,
                partition: `siyuan-map-${"c".repeat(48)}`, ...overrides});
            await new Promise<void>((resolve) => setImmediate(resolve));
        },
        advance: () => {
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach((fn) => fn());
        }};
};

describe("desktop map transport", () => {
    it("accepts only the fixed owner-origin map document and ephemeral webview partition", () => {
        const api = load({});
        const instanceID = "a".repeat(48);
        const origin = "http://127.0.0.1:6806";
        const src = `${origin}/stage/map/index.html?provider=openfreemap#${instanceID}:${"b".repeat(48)}`;
        const partition = `siyuan-map-${"c".repeat(48)}`;
        const valid = {version: 1, instanceID, mode: "webview", src, partition};
        assert.deepEqual(api.parseDesktopMapCreation(valid, instanceID, origin), {mode: "webview", src, partition});
        assert.equal(api.parseDesktopMapCreation({version: 1, instanceID, mode: "native"}, instanceID, origin), undefined);
        const invalidCreations: unknown[] = [null, [], {version: 1, instanceID}, {...valid, mode: "iframe"},
            {...valid, src: undefined}, {...valid, partition: undefined}, {...valid, preload: "/private/preload.js"},
            {...valid, mode: "native"}, {...valid, partition: "persist:" + partition}, {...valid, partition: "siyuan-map-other"},
            {...valid, src: src.replace(origin, "https://other.invalid")}, {...valid, src: src.replace("index.html", "../index.html")},
            {...valid, src: src.replace("provider=openfreemap", "provider=other")}, {...valid, src: src + "?extra"},
            {...valid, src: src.replace(instanceID, "d".repeat(48))}, {...valid, src: src.slice(0, -1)}];
        for (const value of invalidCreations) {
            assert.equal(api.parseDesktopMapCreation(value, instanceID, origin), undefined, JSON.stringify(value));
        }
    });

    for (const origin of ["http://127.0.0.1:6806", "https://notes.example.test"]) {
        it(`keeps the same webview through menus, scrolling and resize for ${origin}`, async () => {
            const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
            let mutations = 0, resizes = 0, disconnects = 0;
            globalThis.MutationObserver = class {
                constructor() { mutations++; }
                observe() {}
                disconnect() {}
            } as any;
            globalThis.ResizeObserver = class {
                constructor() { resizes++; }
                observe() {}
                disconnect() { disconnects++; }
            } as any;
            const f = fixture([], origin);
            const src = `${f.doc.defaultView.location.origin}/stage/map/index.html?provider=openfreemap#${f.instanceID}:${"b".repeat(48)}`;
            const partition = `siyuan-map-${"c".repeat(48)}`;
            const command = () => f.calls.filter(([name, value]) => name === "siyuan-map-command" && value.type === "visibility").at(-1)?.[1];
            try {
                f.host.setPoints([{id: "row", longitude: 1, latitude: 2, name: "private"}], 1);
                f.host.setTheme("dark");
                await f.created({mode: "webview", src, partition});
                assert.equal(f.guests.length, 1);
                const guest = f.guests[0];
                assert.equal(guest.tag, "webview");
                assert.deepEqual([...guest.attributes], [["title", ""], ["partition", partition], ["src", src]]);
                assert.deepEqual(f.attachments, [guest]);
                assert.equal(mutations, 0, "webview composition must not install a stability/occlusion observer");
                assert.equal(resizes, 1);
                f.reply({type: "ready"});
                assert.equal(f.ready(), 1);
                assert.deepEqual(command().viewport, {x: 0, y: 0, width: 400, height: 300});
                const pointCommand = f.calls.find(([name, value]) => name === "siyuan-map-command" && value.type === "setPoints")[1];
                assert.equal(pointCommand.points[0].name, undefined);
                const themeCommand = f.calls.find(([name, value]) => name === "siyuan-map-command" && value.type === "theme")[1];
                assert.equal(themeCommand.theme, "dark");
                const scrim = {className: "av__panel", contains: () => false, getClientRects: () => [f.rect],
                    getBoundingClientRect: () => f.rect};
                f.doc.querySelectorAll = () => [scrim];
                f.doc.elementFromPoint = () => scrim;
                f.advance();
                assert.equal(command().visible, false, "a full menu scrim suppresses attribution interaction only");
                assert.equal(guest.removed, false, "menus cannot detach or hide the guest map");
                assert.deepEqual([...guest.attributes], [["title", ""], ["partition", partition], ["src", src]]);
                f.doc.querySelectorAll = (): HTMLElement[] => [];
                f.doc.elementFromPoint = () => f.container;
                f.rect.y = -40;
                f.domListeners.get("scroll")();
                assert.equal(command().visible, true, "scrolling has no native settle delay");
                assert.deepEqual(command().viewport, {x: 0, y: 40, width: 400, height: 260});
                f.host.resize();
                assert.ok(f.calls.some(([name, value]) => name === "siyuan-map-command" && value.type === "resize"));
                assert.equal(f.calls.some(([name]) => name === "siyuan-map-geometry"), false);
                assert.equal(f.guests.length, 1);
                f.doc.hidden = true;
                f.domListeners.get("visibilitychange")();
                assert.equal(command().visible, false);
                f.host.destroy();
                assert.equal(guest.removed, true);
                assert.equal(disconnects, 1);
                assert.equal(f.frames.size, 0);
                assert.equal(f.listeners.size, 0);
                assert.equal(f.domListeners.size, 0);
                assert.deepEqual(f.errors, []);
            } finally {
                f.host.destroy();
                globalThis.MutationObserver = oldMutation;
                globalThis.ResizeObserver = oldResize;
            }
        });
    }

    it("dismisses existing menus only for fixed trusted-main signals from the live visible map", async () => {
        const oldResize = globalThis.ResizeObserver, oldWindow = globalThis.window;
        globalThis.ResizeObserver = class { observe() {} disconnect() {} } as any;
        let dismissed = 0;
        globalThis.window = {siyuan: {menus: {menu: {remove: () => dismissed++}}}} as any;
        const f = fixture();
        try {
            const src = `${f.doc.defaultView.location.origin}/stage/map/index.html?provider=openfreemap#${f.instanceID}:${"b".repeat(48)}`;
            await f.created({mode: "webview", src, partition: `siyuan-map-${"c".repeat(48)}`});
            f.reply({type: "dismissMenu"});
            assert.equal(dismissed, 0);
            f.reply({type: "ready"});
            f.reply({type: "dismissMenu", instanceID: "other"});
            f.reply({type: "dismissMenu", event: "click"});
            assert.equal(dismissed, 0);
            f.reply({type: "dismissMenu"});
            assert.equal(dismissed, 1);
            f.doc.hidden = true;
            f.reply({type: "dismissMenu"});
            f.doc.hidden = false;
            f.container.isConnected = false;
            f.reply({type: "dismissMenu"});
            f.host.destroy();
            f.reply({type: "dismissMenu"});
            assert.equal(dismissed, 1);
        } finally {
            f.host.destroy();
            globalThis.ResizeObserver = oldResize;
            globalThis.window = oldWindow;
        }
    });

    it("fails closed on missing modes and defers early ready callbacks until creation is validated", async () => {
        const invalidReplies: Array<Record<string, unknown>> = [
            {mode: undefined}, {mode: "other"}, {mode: "native"}, {src: undefined}, {partition: undefined},
        ];
        for (const invalid of invalidReplies) {
            const f = fixture();
            f.host.setPoints([{id: "row", longitude: 1, latitude: 2}], 1);
            f.reply({type: "ready"});
            assert.equal(f.ready(), 0);
            await f.created(invalid);
            assert.equal(f.ready(), 0);
            assert.deepEqual(f.errors, ["hostCreateInvalidResponse"]);
            assert.equal(f.guests.length, 0);
            assert.equal(f.calls.some(([name]) => name === "siyuan-map-command"), false);
        }
        const disposed = fixture();
        const src = `${disposed.doc.defaultView.location.origin}/stage/map/index.html?provider=openfreemap#${disposed.instanceID}:${"b".repeat(48)}`;
        disposed.host.destroy();
        await disposed.created({mode: "webview", src, partition: `siyuan-map-${"c".repeat(48)}`});
        assert.equal(disposed.guests.length, 0, "a late response cannot recreate a disposed guest");
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

    it("releases buffered commands only after validated creation and ready, and rejects stale marker replies", async () => {
        const oldResize = globalThis.ResizeObserver;
        globalThis.ResizeObserver = class { observe() {} disconnect() {} } as any;
        const f = fixture([], "https://notes.example.test");
        try {
            f.host.setPoints([{id: "row", latitude: 2, longitude: 1, name: "private"}], 1);
            f.host.setTheme("dark");
            f.host.resize();
            f.reply({type: "ready", instanceID: "old"});
            f.reply({type: "ready"});
            assert.equal(f.ready(), 0);
            assert.equal(f.calls.some(([name]) => name === "siyuan-map-command"), false);
            await f.created();
            assert.equal(f.ready(), 1);
            f.reply({type: "ready"});
            assert.equal(f.ready(), 1);
            const commands = f.calls.filter(([name]) => name === "siyuan-map-command").map(([, value]) => value);
            assert.deepEqual(commands.map(command => command.type), ["setPoints", "theme", "visibility"]);
            assert.equal(commands[0].points[0].name, undefined);
            assert.equal(commands[1].theme, "dark");
            assert.equal(commands[2].visible, true);
            assert.match(f.instanceID, /^[a-f0-9]{48}$/);
            assert.equal(f.calls[0][1].credentials, undefined);
            for (const mismatch of [{instanceID: "old"}, {revision: 0}, {id: "missing"}]) {
                f.reply({type: "markerClick", id: "row", revision: 1, ...mismatch});
            }
            assert.deepEqual(f.clicks, []);
            f.reply({type: "markerClick", id: "row", revision: 1});
            assert.deepEqual(f.clicks, [["row", 1]]);
            f.host.setPoints([], 2);
            f.host.setPoints([{id: "row", latitude: 2, longitude: 1}], 1);
            f.reply({type: "markerClick", id: "row", revision: 2});
            assert.equal(f.clicks.length, 1);
            f.host.destroy();
            const sent = f.calls.length;
            f.host.resize();
            f.host.setPoints([], 3);
            f.host.setTheme("light");
            f.reply({type: "markerClick", id: "row", revision: 1});
            f.advance();
            assert.equal(f.calls.length, sent);
            assert.equal(f.frames.size, 0);
            assert.equal(f.timers.size, 0);
            assert.equal(f.listeners.size, 0);
            assert.equal(f.domListeners.size, 0);
            assert.equal(f.guests[0].removed, true);
        } finally {
            f.host.destroy();
            globalThis.ResizeObserver = oldResize;
        }
    });

    it("updates attribution visibility through clipping, overlap, focus and hidden owners without changing the guest", async () => {
        const oldResize = globalThis.ResizeObserver;
        globalThis.ResizeObserver = class { observe() {} disconnect() {} } as any;
        const warnings: unknown[][] = [];
        const f = fixture(warnings, "https://notes.example.test");
        const visibility = () => f.calls.filter(([name, value]) => name === "siyuan-map-command" &&
            value.type === "visibility").at(-1)?.[1];
        try {
            await f.created();
            f.reply({type: "ready"});
            const guest = f.guests[0];
            const attributes = [...guest.attributes];
            const scroll = f.domListeners.get("scroll");
            const focus = f.domListeners.get("focus");
            assert.equal(f.domListeners.has("blur"), false);
            focus();
            assert.equal(visibility().visible, true);
            const menu = {contains: () => false, getClientRects: () => [f.rect],
                getBoundingClientRect: () => ({...f.rect, width: 5, height: 5})};
            f.doc.querySelectorAll = () => [menu];
            focus();
            assert.equal(visibility().visible, true, "a small menu leaves ordinary map composition active");
            assert.equal(visibility().viewport, undefined, "overlap suppresses attribution interaction");
            f.doc.querySelectorAll = (): unknown[] => [];
            f.doc.elementFromPoint = (_x: number, y: number) => y < 100 ? menu : f.container;
            scroll();
            assert.equal(visibility().visible, true);
            assert.equal(visibility().viewport, undefined, "partial unknown occlusion cannot authorize attribution");
            f.doc.elementFromPoint = () => menu;
            f.advance();
            assert.equal(visibility().visible, false);
            f.doc.elementFromPoint = () => f.container;
            for (let i = 0; i < 8; i++) {
                f.rect.y = -10 - i * 7;
                scroll();
                assert.equal(visibility().visible, true);
                assert.equal(visibility().viewport.y, -f.rect.y);
            }
            f.doc.hidden = true;
            f.domListeners.get("visibilitychange")();
            assert.equal(visibility().visible, false);
            f.doc.hidden = false;
            f.container.isConnected = false;
            focus();
            assert.equal(visibility().visible, false);
            f.container.isConnected = true;
            f.advance();
            assert.equal(visibility().visible, true);
            assert.deepEqual([...guest.attributes], attributes);
            assert.equal(guest.removed, false);
            assert.equal(f.guests.length, 1);
            assert.deepEqual(warnings, []);
            f.host.destroy();
            const sent = f.calls.length;
            scroll();
            focus();
            f.advance();
            assert.equal(f.calls.length, sent);
        } finally {
            f.host.destroy();
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
    it("fails closed for missing capability and omits Electron from browser compilation", async () => {
        assert.equal(await load(undefined, true).isDesktopAVMapHostSupported(), false);
        assert.equal(await load({invoke: async () => ({version: 1, supported: true})}).isDesktopAVMapHostSupported(), true);
        assert.equal(await load({invoke: async () => ({version: 2, supported: true})}).isDesktopAVMapHostSupported(), false);
        assert.equal(await load({invoke: async () => { throw new Error("old main"); }}).isDesktopAVMapHostSupported(), false);
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
