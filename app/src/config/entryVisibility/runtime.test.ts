import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {resolveEntryOrder} from "./order";
import {resetEntryProfileOrder} from "./profile";
import {
    DOCK_ORDER_SCOPES,
    getDefaultDockEntryOrderSnapshot,
    isDockOrderScope,
    mergeDockEntryOrderSnapshot,
} from "./dockOrder";

test("visibility edits on a built-in profile leave untouched orders following catalog updates", () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/runtime.ts"), "utf8");
    const compiled = transpileModule(source + "\nexports.writable = getWritableEntryProfile;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const config: Config.IEntryVisibility = {version: 6, active: "simple", profiles: []};
    const exports = {} as {
        writable: (config: Config.IEntryVisibility) => Config.IEntryVisibilityProfile;
        createEntryOrderSnapshot: (current?: boolean) => Record<string, string[]>;
    };
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {config: {appearance: {entryVisibility: config}}, languages: {entryCustomProfile: "Custom"}}},
        require: () => ({
            genUUID: () => "custom",
            getEntryPaths: () => ["topBar.search"],
            getEntryCatalogNode: () => ({simple: true}),
            getEntryCatalogDefaultVisibility: () => true,
            getBuiltinProfileEntryVisibility: () => true,
        }),
    });
    const profile = exports.writable(config);
    profile.entries["topBar.search"] = false;
    assert.equal(config.active, profile.id);
    assert.equal(Object.keys(profile.orders).length, 0);
    assert.deepEqual(resolveEntryOrder(["second", "first"], profile.orders.menu, new Set()), ["second", "first"]);
    profile.orders.menu = ["first", "plugin:disabled:item", "second"];
    assert.equal(exports.writable(config), profile);
    assert.equal(Object.keys(exports.createEntryOrderSnapshot()).length, 0);
    const copy = exports.createEntryOrderSnapshot(true);
    assert.equal(JSON.stringify(copy), JSON.stringify(profile.orders));
    copy.menu.reverse();
    assert.deepEqual(profile.orders.menu, ["first", "plugin:disabled:item", "second"]);
    resetEntryProfileOrder(profile, "menu");
    assert.deepEqual(resolveEntryOrder(["second", "first"], profile.orders.menu, new Set()), ["second", "first"]);
    assert.equal(profile.entries["topBar.search"], false);
});

test("dock visibility menus follow profile scope order instead of the catalog order", () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/runtime.ts"), "utf8");
    const compiled = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const current = Object.fromEntries(DOCK_ORDER_SCOPES.map(scope => [scope, []]));
    current["dock.order.LeftTop"] = ["file", "outline"];
    const config: Config.IEntryVisibility = {version: 6, active: "custom", profiles: [{
        id: "custom", name: "Custom", entries: {}, orders: {"dock.order.LeftTop": ["outline", "file"]},
    }]};
    const exports = {} as {getEntryOrder: (path: string) => string[]};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {config: {appearance: {entryVisibility: config}}}},
        require: () => ({
            DOCK_ORDER_SCOPES, isDockOrderScope, mergeDockEntryOrderSnapshot, getDefaultDockEntryOrderSnapshot,
            getDockEntryOrderSnapshot: () => current,
        }),
    });
    assert.deepEqual(Array.from(exports.getEntryOrder("dock")), ["outline", "file"]);
    resetEntryProfileOrder(config.profiles[0], "dock.order.LeftTop");
    assert.deepEqual(Array.from(exports.getEntryOrder("dock")), ["file", "outline"]);
});

test("entry profile saves in settings windows send requests and flush pending changes", () => {
    const initial: Config.IEntryVisibility = {version: 6, active: "full", profiles: []};
    const events: string[] = [];
    const requests: Array<{url: string; config: Config.IEntryVisibility;
        respond: (response: {code: number; data: Config.IEntryVisibility}) => void}> = [];
    const window = {
        siyuan: {layout: {}, config: {appearance: {entryVisibility: initial}}},
        dispatchEvent: (event: {type: string}) => events.push(event.type),
    };
    const context = {
        window,
        document: {querySelectorAll: (): HTMLElement[] => [], querySelector: (): Element => null,
            getElementById: (): HTMLElement => null},
        CustomEvent: class {constructor(public type: string) {}},
    };
    const bar = {} as typeof import("../../layout/dock/barVisibility");
    const compile = (path: string) => transpileModule(readFileSync(resolve(process.cwd(), "src", path), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    runInNewContext(compile("layout/dock/barVisibility.ts"), {...context, exports: bar});
    const exports = {} as typeof import("./runtime");
    runInNewContext(compile("config/entryVisibility/runtime.ts"), {...context, exports, require: () => ({
        syncDockBarVisibility: bar.syncDockBarVisibility,
        refreshDockCatalog: () => {},
        getSettingsOwnerApp: (): undefined => undefined,
        getDockEntryOrderSnapshot: () => Object.fromEntries(DOCK_ORDER_SCOPES.map(scope => [scope, []])),
        mergeDockEntryOrderSnapshot,
        applyDockEntryOrderSnapshot: () => {},
        fetchPost: (url: string, config: Config.IEntryVisibility,
                    respond: (response: {code: number; data: Config.IEntryVisibility}) => void) => {
            requests.push({url, config, respond});
        },
    })});
    const simple = {...initial, active: "simple"};
    const full = {...initial};
    exports.saveEntryVisibility(simple);
    assert.equal(window.siyuan.config.appearance.entryVisibility, simple);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/setting/setEntryVisibility");
    assert.equal(requests[0].config, simple);
    assert.deepEqual(events, ["siyuan-entry-visibility"]);
    exports.saveEntryVisibility(full);
    assert.equal(requests.length, 1);
    requests[0].respond({code: 0, data: simple});
    assert.equal(requests.length, 2);
    assert.equal(requests[1].config, full);
    assert.equal(window.siyuan.config.appearance.entryVisibility, full);
    requests[1].respond({code: 0, data: full});
    assert.deepEqual(events, ["siyuan-entry-visibility", "siyuan-entry-visibility", "siyuan-entry-visibility"]);
});
