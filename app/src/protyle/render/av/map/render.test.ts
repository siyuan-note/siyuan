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
    disabled = false;
    value = "";
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
    const block = {dataset: {avId: "database", nodeId: "carrier"}, removeAttribute() {}, querySelector: (selector: string) =>
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
    const openedLinks: unknown[] = [];
    const calls: string[] = [];
    const transactions: Array<{perform: IOperation[]; undo: IOperation[]; callback: () => void}> = [];
    let settleTransaction: () => void;
    let transactionPromise = Promise.resolve();
    let refreshes = 0;
    const data = {id: "database", name: "Database", views: [], viewID: "map-view", viewType: "map", view: {
        columns: [{id: "location", name: "<Location>", type: "location", hidden: true},
            {id: "text", name: "Text field", type: "text"}], rowCount: 12,
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
        "../../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[],
            options: {callback: () => void}) => {
            transactions.push({perform, undo, callback: options.callback});
            transactionPromise = new Promise(resolve => { settleTransaction = resolve; });
        }},
        "../../../util/transactionQueue": {waitForPendingTransactions: () => transactionPromise},
        "../render": {avRender: () => { refreshes++; }},
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
    const settings = {} as typeof import("./settings");
    const context = {siyuan: {languages, isPublish: options.published === true}};
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/map/settings.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: settings, require: (id: string) => modules[id] || {}, window: context});
    modules["./settings"] = settings;
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/map/render.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: methods, require: (id: string) => modules[id] || {},
        window: {...context, location: {protocol: "https:"},
            open: (...args: unknown[]) => openedLinks.push(args),
            addEventListener: (type: string, callback: () => void) => events.set(type, callback),
            removeEventListener: (type: string) => events.delete(type)},
        navigator: {userAgent: "Mozilla/5.0", onLine: options.online !== false},
        document: {createElement: () => new ElementStub(), documentElement: {getAttribute: () => "light"}},
        MutationObserver: Observer, ResizeObserver: Observer, Lute: {NewNodeID: () => "new-location"}});
    return {data, protyle, calls, hosts, roots, records, opened, openedLinks, events, observers, destroyMap, transactions, context,
        refreshes: () => refreshes,
        completeTransaction: async (success = true) => {
            if (success) transactions[transactions.length - 1].callback();
            settleTransaction();
            await transactionPromise;
            await new Promise(resolve => setImmediate(resolve));
        },
        render: () => methods.renderMap(block as unknown as HTMLElement, protyle, data),
        setupHTML: () => root.querySelector(".av__map-status").innerHTML,
        control: (selector: string) => root.querySelector(selector),
        status: () => root.querySelector(".av__map-status").textContent};
};

test("map attribution stays inside the control and parent opens only fixed current destinations", async () => {
    const scenario = setup();
    await scenario.render();
    const {options} = scenario.hosts[0];
    assert.doesNotMatch(scenario.roots[0].innerHTML, /data-map-attribution/);
    options.onAttributionClick("maplibre");
    options.onAttributionClick("https://evil.invalid/" as any);
    assert.deepEqual(scenario.openedLinks, [["https://maplibre.org/", "_blank", "noopener,noreferrer"]]);
    scenario.destroyMap();
    options.onAttributionClick("openstreetmap");
    assert.equal(scenario.openedLinks.length, 1);
});

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
        if (!Object.keys(option).length) (scenario.data.view as IAVTable).columns = [];
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

test("deleted and changed-type map fields show a repairable location setup", async () => {
    for (const locationKeyID of ["deleted", "text"]) {
        const scenario = setup();
        (scenario.data.view as IAVTable).map.locationKeyID = locationKeyID;
        await scenario.render();
        const html = scenario.setupHTML();
        assert.match(html, /class="av__map-empty"/);
        assert.match(html, /#iconGlobe/);
        assert.match(html, locationKeyID ? /mapMissingLocationField/ : /mapSelectLocationField/);
        assert.match(html, /<label class="av__map-setting"><span>mapLocationField<\/span>/);
        assert.match(html, /<select class="b3-select" data-map-location-field aria-label="mapLocationField">/);
        assert.match(html, /<option value="location">&lt;Location><\/option>/);
        assert.match(html, /class="b3-button b3-button--outline" data-map-create-field/);
        assert.doesNotMatch(html, /value="text"|<Location>|provider|CRS|serviceID/);
        assert.deepEqual(scenario.calls, []);
    }
    const empty = setup();
    (empty.data.view as IAVTable).map.locationKeyID = "";
    (empty.data.view as IAVTable).columns = [];
    await empty.render();
    assert.match(empty.setupHTML(), /data-map-create-field/);
    assert.match(empty.setupHTML(), /mapSelectLocationField/);
});

test("unconfigured maps render existing location fields without submitting settings transactions", async () => {
    for (const mode of ["editable", "readonly", "published", "history"]) {
        const scenario = setup({published: mode === "published"});
        const view = scenario.data.view as IAVTable;
        view.map.locationKeyID = "";
        scenario.protyle.disabled = mode === "readonly";
        if (mode === "history") scenario.protyle.options.history = {created: "version"};
        const before = JSON.stringify(view);
        await scenario.render();
        assert.equal(JSON.stringify(view), before);
        assert.equal(scenario.transactions.length, 0);
        assert.equal(scenario.hosts.length, mode === "editable" || mode === "readonly" ? 1 : 0);
        assert.doesNotMatch(scenario.setupHTML(), /data-map-create-field/);
    }
});

test("selecting an existing location field submits one undoable transaction and refreshes after success", async () => {
    const scenario = setup();
    const view = scenario.data.view as IAVTable;
    view.map.locationKeyID = "deleted";
    const before = JSON.stringify(view);
    await scenario.render();
    const select = scenario.control("[data-map-location-field]");
    select.value = "text";
    select.events.get("change")();
    select.value = "";
    select.events.get("change")();
    assert.equal(scenario.transactions.length, 0);
    select.value = "location";
    select.events.get("change")();
    select.events.get("change")();
    scenario.control("[data-map-create-field]").events.get("click")();
    assert.equal(scenario.transactions.length, 1);
    assert.equal(select.disabled, true);
    assert.equal(scenario.control("[data-map-create-field]").disabled, true);
    const {perform, undo} = scenario.transactions[0];
    assert.equal(JSON.stringify(perform), JSON.stringify([{avID: "database", blockID: "carrier", viewID: "map-view",
        action: "setAttrViewMap", data: {locationKeyID: "location"}}]));
    assert.equal(JSON.stringify(undo[0].data), JSON.stringify({locationKeyID: "deleted"}));
    assert.equal(JSON.stringify(view), before);
    assert.equal(scenario.refreshes(), 0);
    await scenario.completeTransaction();
    assert.equal(scenario.refreshes(), 1);
    select.events.get("change")();
    assert.equal(scenario.transactions.length, 1);
});

test("adding a location field atomically creates, selects and hides it with an undo restoring the previous field", async () => {
    const scenario = setup();
    (scenario.data.view as IAVTable).map.locationKeyID = "";
    (scenario.data.view as IAVTable).columns = [];
    await scenario.render();
    const create = scenario.control("[data-map-create-field]");
    create.events.get("click")();
    create.events.get("click")();
    assert.equal(scenario.transactions.length, 1);
    const {perform, undo} = scenario.transactions[0];
    assert.equal(JSON.stringify(perform), JSON.stringify([
        {avID: "database", blockID: "carrier", viewID: "map-view", action: "addAttrViewCol",
            id: "new-location", type: "location", name: "location"},
        {avID: "database", blockID: "carrier", viewID: "map-view", action: "setAttrViewMap", data: {locationKeyID: "new-location"}},
        {avID: "database", blockID: "carrier", viewID: "map-view", action: "setAttrViewColHidden",
            id: "new-location", viewIDs: ["map-view"], data: true},
    ]));
    assert.equal(JSON.stringify(undo), JSON.stringify([
        {avID: "database", blockID: "carrier", viewID: "map-view", action: "setAttrViewMap", data: {locationKeyID: ""}},
        {avID: "database", blockID: "carrier", viewID: "map-view", action: "removeAttrViewCol", id: "new-location"},
    ]));
    await scenario.completeTransaction();
    assert.equal(scenario.refreshes(), 1);
});

test("map setup hides write controls for readonly, published and history modes", async () => {
    for (const mode of ["disabled", "published", "created", "snapshot"]) {
        const scenario = setup({published: mode === "published"});
        scenario.protyle.disabled = mode === "disabled";
        if (["created", "snapshot"].includes(mode)) scenario.protyle.options.history = {[mode]: "version"};
        (scenario.data.view as IAVTable).map.locationKeyID = "deleted";
        await scenario.render();
        assert.doesNotMatch(scenario.setupHTML(), /data-map-location-field|data-map-create-field/);
        if (mode === "disabled") assert.match(scenario.setupHTML(), /av__map-empty/);
        assert.deepEqual(scenario.transactions, []);
    }
});

test("stale setup controls and permissions changed after render cannot submit a transaction", async () => {
    for (const mode of ["disabled", "published", "created", "snapshot", "destroyed", "removed", "rerendered"]) {
        const scenario = setup();
        (scenario.data.view as IAVTable).map.locationKeyID = "deleted";
        await scenario.render();
        const select = scenario.control("[data-map-location-field]");
        const create = scenario.control("[data-map-create-field]");
        if (mode === "disabled") scenario.protyle.disabled = true;
        if (mode === "published") scenario.context.siyuan.isPublish = true;
        if (["created", "snapshot"].includes(mode)) scenario.protyle.options.history = {[mode]: "version"};
        if (mode === "destroyed") scenario.destroyMap();
        if (mode === "removed") scenario.roots[0].remove();
        if (mode === "rerendered") await scenario.render();
        select.value = "location";
        select.events.get("change")();
        create.events.get("click")();
        assert.equal(scenario.transactions.length, 0, mode);
    }
});

test("failed setup transactions reenable controls, while late completion cannot refresh a destroyed map", async () => {
    const scenario = setup();
    (scenario.data.view as IAVTable).map.locationKeyID = "";
    (scenario.data.view as IAVTable).columns = [];
    await scenario.render();
    const create = scenario.control("[data-map-create-field]");
    create.events.get("click")();
    assert.equal(create.disabled, true);
    await scenario.completeTransaction(false);
    assert.equal(create.disabled, false);
    assert.equal(scenario.refreshes(), 0);
    create.events.get("click")();
    assert.equal(scenario.transactions.length, 2);
    scenario.destroyMap();
    await scenario.completeTransaction();
    assert.equal(scenario.refreshes(), 0);
});

test("late setup transaction completions cannot refresh a removed or superseded view", async () => {
    for (const mode of ["removed", "rerendered"]) {
        const scenario = setup();
        (scenario.data.view as IAVTable).map.locationKeyID = "deleted";
        await scenario.render();
        scenario.control("[data-map-create-field]").events.get("click")();
        if (mode === "removed") scenario.roots[0].remove();
        else await scenario.render();
        await scenario.completeTransaction();
        assert.equal(scenario.refreshes(), 0);
    }
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
