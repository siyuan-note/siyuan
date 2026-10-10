import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as state from "./state";
import * as protocol from "./protocol";
import * as escape from "../../../../util/escape";
import type {AVMapHost, AVMapHostOptions} from "./host";

class ElementStub {
    className = "";
    innerHTML = "";
    textContent = "";
    isConnected = true;
    readonly children = new Map<string, ElementStub>();
    readonly events = new Map<string, () => void>();
    readonly classes = new Set<string>();
    readonly classList = {add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
        remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
        toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name)};
    setAttribute() {}
    remove() { this.isConnected = false; }
    addEventListener(type: string, callback: () => void) { this.events.set(type, callback); }
    querySelector(selector: string) {
        if (!this.children.has(selector)) this.children.set(selector, new ElementStub());
        return this.children.get(selector);
    }
}

const setup = (options: {published?: boolean; desktop?: boolean; hostSupported?: boolean | Promise<boolean>;
    online?: boolean; runtime?: () => Promise<unknown>} = {}) => {
    const roots: ElementStub[] = [];
    const records = new ElementStub();
    let root: ElementStub;
    let lifecycle: {root: ElementStub; destroy: () => void};
    const block = {dataset: {avId: "database", nodeId: "carrier"}, querySelector: (selector: string) =>
        selector.endsWith(".av__map") ? root : records};
    Object.assign(records, {before: (element: ElementStub) => { root = element; roots.push(root); }});
    const languages = new Proxy<Record<string, string>>({mapPageScope: "${shown}/${total}",
        mapSkippedLocations: "${empty}/${invalid}/${unknown}/${mismatch}"}, {get: (target, key: string) => target[key] || key});
    const events = new Map<string, () => void>();
    const observers: Array<{disconnected: boolean}> = [];
    class Observer {
        disconnected = false;
        constructor() { observers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
    }
    const hosts: Array<{options: AVMapHostOptions; points: protocol.AVMapPoint[]; revision: number;
        destroyed: boolean; fitted: boolean}> = [];
    const opened: unknown[] = [];
    const calls: string[] = [];
    const data = {id: "database", name: "Database", views: [], viewID: "map-view", viewType: "map", view: {
        columns: [{id: "location", type: "location", hidden: true}], rowCount: 12,
        map: {locationKeyID: "location"},
        rows: [{id: "row", cells: [{id: "location-value", value: {type: "location", keyID: "location",
            location: {latitude: 0, longitude: 0, name: "Private name", originalInput: "Private input"}}},
        {id: "primary-value", valueType: "block", value: {type: "block", isDetached: true,
            block: {content: "Private title"}}}]}],
    }} as IAV;
    const protyle = {options: {}, app: {}, notebookId: "notebook"} as IProtyle;
    const destroyMap = () => {
        lifecycle?.destroy();
        lifecycle = undefined;
    };
    const methods = {} as typeof import("./render");
    const modules: Record<string, unknown> = {
        "./state": {...state, destroyMap, registerMap: (_block: unknown, next: typeof lifecycle) => {
            destroyMap(); lifecycle = next;
            return () => lifecycle === next && next.root.isConnected;
        }},
        "../../../../util/escape": escape,
        "../../../../util/fetch": {fetchSyncPost: async (url: string, payload: unknown) => {
            assert.equal(JSON.stringify(payload), "{}");
            calls.push(url);
            return options.runtime ? options.runtime() : {code: 0, data: {provider: "openfreemap"}};
        }},
        "./protocol": protocol,
        "../openDatabaseRow": {openDatabaseRowByData: (_protyle: unknown, row: unknown) => opened.push(row)},
        "./host": {isAVMapHostEnvironmentSupported: () => options.hostSupported ?? true,
            createAVMapHost: (_container: unknown, configuration: AVMapHostOptions) => {
                const host = {options: configuration, points: [] as protocol.AVMapPoint[], revision: -1,
                    destroyed: false, fitted: false};
                hosts.push(host);
                return {destroy: () => { host.destroyed = true; },
                    setPoints: (points: protocol.AVMapPoint[], revision: number) => { host.points = points; host.revision = revision; },
                    fit: () => { host.fitted = true; }, resize() {}, setTheme() {}};
            }},
    };
    modules["./desktopTransport"] = {
        isDesktopAVMapHostSupported: async () => options.desktop === true,
        createDesktopAVMapHost: (container: unknown, configuration: AVMapHostOptions) => {
            calls.push("desktop-host");
            return (modules["./host"] as {createAVMapHost: (container: unknown, options: AVMapHostOptions) => AVMapHost})
                .createAVMapHost(container, configuration);
        },
    };
    const openRecord = {} as typeof import("./openRecord");
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/map/openRecord.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: openRecord, require: (id: string) => modules[id] || {}, window: {siyuan: {languages}}});
    modules["./openRecord"] = openRecord;
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/map/render.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: methods, require: (id: string) => modules[id] || {},
        window: {siyuan: {languages, isPublish: options.published === true}, location: {protocol: "https:"},
            addEventListener: (type: string, callback: () => void) => events.set(type, callback),
            removeEventListener: (type: string) => events.delete(type)},
        navigator: {userAgent: "Mozilla/5.0", onLine: options.online !== false},
        document: {createElement: () => new ElementStub(), documentElement: {getAttribute: () => "light"}},
        MutationObserver: Observer, ResizeObserver: Observer});
    return {data, protyle, calls, hosts, roots, records, opened, events, observers, destroyMap,
        render: () => methods.renderMap(block as unknown as HTMLElement, protyle, data),
        status: () => root.querySelector(".av__map-status").textContent};
};

test("published maps render a status without inline settings, runtime admission, or SDK calls", async () => {
    const scenario = setup({published: true});
    await scenario.render();
    assert.deepEqual(scenario.calls, []);
    assert.equal(scenario.hosts.length, 0);
    assert.equal(scenario.status(), "mapPublicFallback");
    assert.doesNotMatch(scenario.roots[0].innerHTML, /av__map-settings|data-map-setting|data-map-configure|av__map-actions|data-map-fit|data-map-retry/);
});

test("missing field, unavailable host, offline and unsupported projection maps never request runtime admission", async () => {
    for (const option of [{hostSupported: false}, {online: false}, {}]) {
        const scenario = setup(option);
        if (!Object.keys(option).length) (scenario.data.view as IAVTable).map.locationKeyID = "";
        await scenario.render();
        assert.deepEqual(scenario.calls, []);
        assert.equal(scenario.hosts.length, 0);
    }
    const incompatible = setup();
    (incompatible.data.view as IAVTable).rows[0].cells[0].value.location.latitude = 90;
    await incompatible.render();
    assert.deepEqual(incompatible.calls, []);
    assert.equal(incompatible.status(), "mapNoMarkers");
});

test("map sends only IDs and coordinates and opens the existing row detail for a current marker", async () => {
    const scenario = setup();
    await scenario.render();
    assert.deepEqual(scenario.calls, ["/api/map/getRuntime"]);
    const host = scenario.hosts[0];
    assert.equal(JSON.stringify(host.points), JSON.stringify([{id: "row", longitude: 0, latitude: 0}]));
    assert.doesNotMatch(JSON.stringify(host.options), /Private|primary-value|notebook/);
    host.options.onReady();
    assert.doesNotMatch(scenario.roots[0].innerHTML, /av__map-settings|data-map-setting|data-map-configure|av__map-actions|data-map-fit|data-map-retry/);
    host.options.onMarkerClick("other", host.revision);
    host.options.onMarkerClick("row", host.revision - 1);
    assert.equal(scenario.opened.length, 0);
    host.options.onMarkerClick("row", host.revision);
    assert.equal((scenario.opened[0] as {itemID: string}).itemID, "row");
    scenario.events.get("offline")();
    assert.equal(host.destroyed, true);
    assert.equal(scenario.status(), "mapOffline");
    host.options.onMarkerClick("row", host.revision);
    assert.equal(scenario.opened.length, 1);
    scenario.destroyMap();
    assert.equal(scenario.observers.every(observer => observer.disconnected), true);
    assert.equal(scenario.events.size, 0);
});

test("an independently secured desktop host is selected instead of a renderer iframe", async () => {
    const scenario = setup({desktop: true, hostSupported: false});
    await scenario.render();
    assert.deepEqual(scenario.calls, ["/api/map/getRuntime", "desktop-host"]);
    assert.equal(scenario.hosts.length, 1);
});

test("late native capability replies cannot initialize a removed map", async () => {
    let report: (supported: boolean) => void;
    const scenario = setup({hostSupported: new Promise<boolean>(resolve => { report = resolve; })});
    const pending = scenario.render();
    await new Promise(resolve => setImmediate(resolve));
    scenario.destroyMap();
    report(true);
    await pending;
    assert.deepEqual(scenario.calls, []);
    assert.equal(scenario.hosts.length, 0);
});

test("stale runtime responses cannot mount a map after the view is removed", async () => {
    let respond: (value: unknown) => void;
    const scenario = setup({runtime: () => new Promise(resolve => { respond = resolve; })});
    const rendering = scenario.render();
    await new Promise(resolve => setImmediate(resolve));
    scenario.roots[0].remove();
    respond({code: 0, data: {provider: "openfreemap"}});
    await rendering;
    assert.equal(scenario.hosts.length, 0);
});

test("history and oversized loaded pages report status without fetching runtime admission", async () => {
    const history = setup();
    history.protyle.options.history = {created: "version"};
    await history.render();
    assert.deepEqual(history.calls, []);
    const scenario = setup();
    const view = scenario.data.view as IAVTable;
    view.rows = Array.from({length: protocol.AV_MAP_MAX_POINTS + 1}, (_, index) => ({...view.rows[0], id: `row-${index}`}));
    await scenario.render();
    assert.deepEqual(scenario.calls, []);
    assert.equal(scenario.status(), "mapTooManyMarkers");
    assert.equal(scenario.hosts.length, 0);
});

test("rerendering a map destroys the old host and invalidates its callbacks", async () => {
    const scenario = setup();
    await scenario.render();
    const previous = scenario.hosts[0];
    previous.options.onReady();
    await scenario.render();
    assert.equal(previous.destroyed, true);
    previous.options.onMarkerClick("row", previous.revision);
    assert.equal(scenario.opened.length, 0);
    const next = scenario.hosts[1];
    next.options.onReady();
    next.options.onMarkerClick("row", next.revision);
    assert.equal(scenario.opened.length, 1);
    scenario.destroyMap();
});

test("authentication bypass reports its specific safe fallback without mounting the host", async () => {
    const scenario = setup({runtime: async () => ({code: -1, msg: "mapAuthenticationBypass", data: null})});
    await scenario.render();
    assert.equal(scenario.status(), "mapAuthenticationBypass");
    assert.equal(scenario.hosts.length, 0);
});
