import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as state from "./state";
import * as protocol from "./protocol";
import * as escape from "../../../../util/escape";
import type {AVMapHost, AVMapHostOptions} from "./host";
import {DOMElement, DOMFixture, requireFixture} from "./testDOM";

const setup = (options: {published?: boolean; desktop?: boolean; hostSupported?: boolean | Promise<boolean>;
    online?: boolean; protocol?: string; source?: string; failDuringCreate?: boolean; runtime?: () => Promise<unknown>} = {}) => {
    const document = new DOMFixture();
    const roots: DOMElement[] = [];
    const block = document.createElement("div");
    block.dataset.avId = "database";
    block.dataset.nodeId = "carrier";
    block.innerHTML = '<div class="av__container"><div class="av__scroll"></div></div>';
    document.body.append(block);
    const records = block.querySelector(".av__scroll");
    let root: DOMElement;
    let lifecycle: {root: DOMElement; destroy: () => void};
    const languages = new Proxy<Record<string, string>>({mapPageScope: "Map covers ${shown} loaded records of ${total} filtered records",
        mapLoadedCount: "Loaded ${shown}/${total}", mapSkippedCount: "Skipped ${count}",
        mapSkippedLocations: "Skipped locations: ${empty} missing, ${invalid} invalid, ${projection} unsupported projection"},
    {get: (target, key: string) => target[key] || key});
    const events = new Map<string, () => void>();
    const observers: Array<{disconnected: boolean; disconnects: number}> = [];
    class Observer {
        disconnected = false;
        disconnects = 0;
        constructor() { observers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; this.disconnects++; }
    }
    const hosts: Array<{options: AVMapHostOptions; points: protocol.AVMapPoint[]; revision: number;
        container: DOMElement; destroyed: boolean; destroys: number}> = [];
    const opened: unknown[] = [];
    const openedLinks: unknown[] = [];
    const calls: string[] = [];
    const transactions: Array<{perform: IOperation[]; undo: IOperation[]; callback: () => void}> = [];
    const unplaced: Array<{options: Parameters<typeof import("./unplaced").bindMapUnplaced>[0]; destroyed: boolean}> = [];
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
        "../virtualScroll": {getAVData: () => data},
        "../../../../util/fetch": {fetchSyncPost: async (url: string, payload: unknown) => {
            assert.equal(JSON.stringify(payload), "{}");
            calls.push(url);
            return options.runtime ? options.runtime() : {code: 0, data: {provider: "openfreemap"}};
        }},
        "./protocol": protocol,
        "../../../../plugin/Menu": {Menu: class {}},
        "../../../../menus/Menu": {MenuItem: class {}},
        "../../../../util/functions": {isMobile: () => false},
        "./unplaced": {bindMapUnplaced: (options: Parameters<typeof import("./unplaced").bindMapUnplaced>[0]) => {
            const binding = {options, destroyed: false};
            unplaced.push(binding);
            return () => { binding.destroyed = true; };
        }},
        "../openDatabaseRow": {openDatabaseRowByData: (_protyle: unknown, row: unknown) => opened.push(row)},
        "./host": {isAVMapHostEnvironmentSupported: () => options.hostSupported ?? true,
            createAVMapHost: (container: DOMElement, configuration: AVMapHostOptions) => {
                assert.ok(container?.isConnected, "Map host needs its mounted canvas");
                assert.ok(container.classList.contains("av__map-canvas"));
                const host = {options: configuration, points: [] as protocol.AVMapPoint[], revision: -1,
                    container, destroyed: false, destroys: 0};
                hosts.push(host);
                if (options.failDuringCreate) configuration.onError("hostUnavailable");
                return {destroy: () => { host.destroyed = true; host.destroys++; },
                    setPoints: (points: protocol.AVMapPoint[], revision: number) => { host.points = points; host.revision = revision; },
                    resize() {}, setTheme() {}};
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
    }).outputText, {exports: openRecord, require: requireFixture(modules), window: {siyuan: {languages}}});
    modules["./openRecord"] = openRecord;
    const settings = {} as typeof import("./settings");
    const context = {siyuan: {languages, isPublish: options.published === true}};
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/map/settings.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: settings, require: requireFixture(modules), window: context});
    modules["./settings"] = settings;
    runInNewContext(transpileModule(options.source ?? readFileSync("src/protyle/render/av/map/render.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: methods, require: requireFixture(modules),
        window: {...context, location: {protocol: options.protocol || "https:"},
            open: (...args: unknown[]) => openedLinks.push(args),
            addEventListener: (type: string, callback: () => void) => events.set(type, callback),
            removeEventListener: (type: string) => events.delete(type)},
        navigator: {userAgent: "Mozilla/5.0", onLine: options.online !== false},
        document: {createElement: () => { root = document.createElement("div"); roots.push(root); return root; },
            documentElement: document.documentElement},
        MutationObserver: Observer, ResizeObserver: class {constructor() { assert.fail("Map hosts own their resize observers"); }},
        Lute: {NewNodeID: () => "new-location"}});
    return {data, protyle, calls, hosts, roots, records, block, opened, openedLinks, events, observers, destroyMap, transactions, context, unplaced,
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

test("map summary keeps loaded scope in one compact line and omits zero skipped locations", async () => {
    const scenario = setup();
    await scenario.render();
    assert.match(scenario.roots[0].innerHTML, /<span>Loaded 1\/12<\/span><span class="av__map-skipped"><\/span>/);
    assert.match(scenario.roots[0].innerHTML, /b3-tooltips b3-tooltips__nw" aria-label="Map covers 1 loaded records of 12 filtered records" tabindex="0"/);
    assert.equal(scenario.control(".av__map-skipped").textContent, "");
    assert.doesNotMatch(scenario.roots[0].innerHTML, /<div class="av__map-skipped|Skipped 0/);
});

test("map toolbar places the unplaced inbox after the summary and disposes its requests with the map", async () => {
    const scenario = setup();
    await scenario.render();
    const html = scenario.roots[0].innerHTML;
    assert.match(html, /av__map-toolbar/);
    const toggle = scenario.control("[data-map-unplaced-toggle]");
    assert.equal(toggle.getAttribute("data-position"), "4north");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.match(toggle.innerHTML, /#iconInbox/);
    assert.ok(html.indexOf("av__map-summary") < html.indexOf("data-map-unplaced-toggle"));
    assert.equal(scenario.unplaced.length, 1);
    assert.equal(scenario.unplaced[0].options.data, scenario.data);
    await scenario.render();
    assert.equal(scenario.unplaced[0].destroyed, true);
    assert.equal(scenario.unplaced[1].destroyed, false);
    scenario.destroyMap();
    assert.equal(scenario.unplaced[1].destroyed, true);
});

test("unplaced records remain accessible when the map is empty or its online host cannot load", async () => {
    for (const mode of ["empty", "unsupported", "offline"]) {
        const scenario = setup({hostSupported: mode !== "unsupported", online: mode !== "offline"});
        if (mode === "empty") (scenario.data.view as IAVTable).rows = [];
        await scenario.render();
        assert.equal(scenario.unplaced.length, 1, mode);
        assert.match(scenario.roots[0].innerHTML, /data-map-unplaced-toggle/);
    }
});

test("unplaced inbox matches calendar edit permissions and requires a valid selected location field", async () => {
    for (const mode of ["disabled", "published", "created", "snapshot", "missing", "changed-type"]) {
        const scenario = setup({published: mode === "published"});
        scenario.protyle.disabled = mode === "disabled";
        if (["created", "snapshot"].includes(mode)) scenario.protyle.options.history = {[mode]: "version"};
        if (mode === "missing") (scenario.data.view as IAVTable).map.locationKeyID = "removed";
        if (mode === "changed-type") (scenario.data.view as IAVTable).map.locationKeyID = "text";
        await scenario.render();
        assert.equal(scenario.unplaced.length, 0, mode);
        assert.doesNotMatch(scenario.roots[0].innerHTML, /data-map-unplaced-toggle/);
    }
});

test("map summary counts all skipped locations and keeps their reasons in its tooltip", async () => {
    const scenario = setup();
    const view = scenario.data.view as IAVTable;
    const row = view.rows[0];
    const withLocation = (id: string, location?: IAVCellLocationValue) => ({...row, id, cells: [{
        ...row.cells[0], value: {...row.cells[0].value, location},
    }]});
    view.rows.push(withLocation("empty"), withLocation("invalid", {latitude: 100, longitude: 0}),
        withLocation("projection", {latitude: 90, longitude: 0}));
    await scenario.render();
    assert.match(scenario.roots[0].innerHTML, /<span>Loaded 4\/12<\/span>/);
    assert.equal(scenario.control(".av__map-skipped").textContent, "Skipped 3");
    assert.equal(scenario.control(".av__map-summary").getAttribute("aria-label"),
        "Map covers 4 loaded records of 12 filtered records\nSkipped locations: 1 missing, 1 invalid, 1 unsupported projection");
    assert.equal(scenario.hosts[0].points.length, 1);
    view.rows = [row];
    await scenario.render();
    assert.match(scenario.roots[1].innerHTML, /<span>Loaded 1\/12<\/span>/);
    assert.equal(scenario.control(".av__map-skipped").textContent, "");
    assert.doesNotMatch(scenario.roots[1].innerHTML, /Skipped locations/);
});

test("map summary retains skipped counts when every loaded row lacks a compatible location", async () => {
    const scenario = setup();
    const view = scenario.data.view as IAVTable;
    view.rows[0].cells[0].value.location.latitude = 90;
    await scenario.render();
    assert.equal(scenario.status(), "mapNoMarkers");
    assert.equal(scenario.control(".av__map-skipped").textContent, "Skipped 1");
    assert.equal(scenario.control(".av__map-summary").getAttribute("aria-label"),
        "Map covers 1 loaded records of 12 filtered records\nSkipped locations: 0 missing, 0 invalid, 1 unsupported projection");
    assert.deepEqual(scenario.calls, []);
});

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
        assert.match(html, /#iconMap/);
        assert.match(html, locationKeyID ? /mapMissingLocationField/ : /mapSelectLocationField/);
        assert.match(html, /<label class="av__map-setting"><span>mapLocationField<\/span>/);
        const select = scenario.control("[data-map-location-field]");
        assert.equal(select.tagName, "SELECT");
        assert.equal(select.getAttribute("aria-label"), "mapLocationField");
        assert.equal(select.querySelector('[value="location"]').textContent, "<Location>");
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

test("map height is derived per view without changing the stored settings", async () => {
    for (const height of [undefined, 320, 480, 640, 800] as const) {
        const scenario = setup();
        const view = scenario.data.view as IAVTable;
        if (height !== undefined) view.map.height = height;
        const stored = JSON.stringify(view.map);
        await scenario.render();
        assert.equal(scenario.roots[0].dataset.mapHeight, (height || 480).toString());
        assert.equal(JSON.stringify(view.map), stored);
        assert.equal(scenario.hosts.length, 1);
        scenario.destroyMap();
    }
});

test("parsed templates do not manufacture missing controls and reject a canvas class mutation", async () => {
    const scenario = setup();
    await scenario.render();
    assert.equal(scenario.control("[data-map-create-field]"), null);
    assert.equal(scenario.hosts[0].container, scenario.control(".av__map-canvas"));
    assert.equal(scenario.hosts[0].container.classList.contains("fn__none"), false);
    const source = readFileSync("src/protyle/render/av/map/render.ts", "utf8");
    const mutated = source.replace('class="av__map-canvas fn__none"', 'class="av__wrong-canvas fn__none"');
    assert.notEqual(mutated, source);
    const broken = setup({source: mutated});
    await assert.rejects(broken.render(), /classList/);
    assert.equal(broken.hosts.length, 0);
});

test("render requires an existing records container and contains mounted map input events", async () => {
    const absent = setup();
    absent.records.remove();
    await absent.render();
    assert.equal(absent.roots.length, 0);
    const scenario = setup();
    await scenario.render();
    let escaped = 0;
    for (const type of ["click", "keydown", "pointerdown"]) {
        scenario.block.addEventListener(type, () => escaped++);
        scenario.control(".av__map-canvas").dispatch(type);
    }
    assert.equal(escaped, 0);
});

test("undeclared VM imports fail instead of silently returning an empty module", () => {
    assert.throws(() => requireFixture({})("./unlisted"), /Unexpected require: \.\/unlisted/);
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
    view.map.height = 640;
    const before = JSON.stringify(view);
    await scenario.render();
    const select = scenario.control("[data-map-location-field]");
    select.value = "text";
    select.dispatch("change");
    select.value = "";
    select.dispatch("change");
    assert.equal(scenario.transactions.length, 0);
    select.value = "location";
    select.dispatch("change");
    select.dispatch("change");
    scenario.control("[data-map-create-field]").dispatch("click");
    assert.equal(scenario.transactions.length, 1);
    assert.equal(select.disabled, true);
    assert.equal(scenario.control("[data-map-create-field]").disabled, true);
    const {perform, undo} = scenario.transactions[0];
    assert.equal(JSON.stringify(perform), JSON.stringify([{avID: "database", blockID: "carrier", viewID: "map-view",
        action: "setAttrViewMap", data: {locationKeyID: "location", height: 640}}]));
    assert.equal(JSON.stringify(undo[0].data), JSON.stringify({locationKeyID: "deleted", height: 640}));
    assert.equal(JSON.stringify(view), before);
    assert.equal(scenario.refreshes(), 0);
    await scenario.completeTransaction();
    assert.equal(scenario.refreshes(), 1);
    select.dispatch("change");
    assert.equal(scenario.transactions.length, 1);
});

test("adding a location field atomically creates, selects and hides it with an undo restoring the previous field", async () => {
    const scenario = setup();
    (scenario.data.view as IAVTable).map.locationKeyID = "";
    (scenario.data.view as IAVTable).columns = [];
    await scenario.render();
    const create = scenario.control("[data-map-create-field]");
    create.dispatch("click");
    create.dispatch("click");
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
        select.dispatch("change");
        create.dispatch("click");
        assert.equal(scenario.transactions.length, 0, mode);
    }
});

test("failed setup transactions reenable controls, while late completion cannot refresh a destroyed map", async () => {
    const scenario = setup();
    (scenario.data.view as IAVTable).map.locationKeyID = "";
    (scenario.data.view as IAVTable).columns = [];
    await scenario.render();
    const create = scenario.control("[data-map-create-field]");
    create.dispatch("click");
    assert.equal(create.disabled, true);
    await scenario.completeTransaction(false);
    assert.equal(create.disabled, false);
    assert.equal(scenario.refreshes(), 0);
    create.dispatch("click");
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
        scenario.control("[data-map-create-field]").dispatch("click");
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
    previous.options.onError("hostUnavailable");
    assert.equal(scenario.hosts[1].destroyed, false);
    assert.equal(scenario.status(), "mapLoading");
    previous.options.onMarkerClick("row", previous.revision);
    assert.equal(scenario.opened.length, 0);
    const next = scenario.hosts[1];
    next.options.onReady();
    next.options.onMarkerClick("row", next.revision);
    assert.equal(scenario.opened.length, 1);
    scenario.destroyMap();
});

test("host failure releases its observers once while preserving the unplaced inbox", async () => {
    for (const mode of ["offline", "error"]) {
        const scenario = setup();
        await scenario.render();
        const host = scenario.hosts[0];
        if (mode === "offline") scenario.events.get("offline")();
        else host.options.onError("hostUnavailable");
        assert.equal(host.destroys, 1, mode);
        assert.equal(scenario.observers.length, 1);
        assert.equal(scenario.observers[0].disconnects, 1);
        assert.equal(scenario.events.size, 0);
        assert.equal(scenario.unplaced[0].destroyed, false);
        assert.equal(scenario.control(".av__map-canvas").classList.contains("fn__none"), true);
        const status = scenario.status();
        host.options.onReady();
        host.options.onError("hostUnavailable");
        assert.equal(scenario.status(), status);
        scenario.destroyMap();
        scenario.destroyMap();
        assert.equal(host.destroys, 1);
        assert.equal(scenario.observers[0].disconnects, 1);
        assert.equal(scenario.unplaced[0].destroyed, true);
    }
});

test("a host that fails synchronously during creation never acquires view observers", async () => {
    const scenario = setup({failDuringCreate: true});
    await scenario.render();
    assert.equal(scenario.status(), "mapLoadError");
    assert.equal(scenario.hosts[0].destroys, 1);
    assert.equal(scenario.hosts[0].points.length, 0);
    assert.equal(scenario.observers.length, 0);
    assert.equal(scenario.events.size, 0);
    assert.equal(scenario.unplaced[0].destroyed, false);
    scenario.destroyMap();
    assert.equal(scenario.hosts[0].destroys, 1);
});

test("non-HTTP, both history modes and published views retain their own safe fallbacks", async () => {
    for (const mode of ["protocol", "created", "snapshot", "published"]) {
        const scenario = setup({protocol: mode === "protocol" ? "file:" : "https:", published: mode === "published"});
        if (mode === "created" || mode === "snapshot") scenario.protyle.options.history = {[mode]: "version"};
        await scenario.render();
        assert.equal(scenario.status(), mode === "published" ? "mapPublicFallback" : "mapUnsupportedClient");
        assert.deepEqual(scenario.calls, []);
        assert.equal(scenario.hosts.length, 0);
    }
});

test("authentication bypass reports its specific safe fallback without mounting the host", async () => {
    const scenario = setup({runtime: async () => ({code: -1, msg: "mapAuthenticationBypass", data: null})});
    await scenario.render();
    assert.equal(scenario.status(), "mapAuthenticationBypass");
    assert.equal(scenario.hosts.length, 0);
});
