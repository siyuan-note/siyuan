import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {entryCatalog, TOP_BAR_ROOT_PATH} from "./catalog";
import {MOBILE_TOOLBAR_NAMES, TOOLBAR_ENTRY_ROOT_PATH} from "../../protyle/toolbar/defaults";
import * as dockOrder from "./dockOrder";
import {MOBILE_TOOLBAR_CONTEXT_KEYS} from "./mobileToolbarContext";

test("entry settings show exit only on native tablets without changing the persisted catalog", () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/ui.ts"), "utf8");
    const compiled = transpileModule(source + "\nexports.catalog = getVisibleEntryCatalog;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    let nativeTablet = false;
    let mobile = false;
    const exports = {} as {catalog: () => typeof entryCatalog};
    runInNewContext(compiled, {
        exports,
        require: () => ({
            entryCatalog, TOP_BAR_ROOT_PATH, MOBILE_TOOLBAR_NAMES, TOOLBAR_ENTRY_ROOT_PATH, MOBILE_TOOLBAR_CONTEXT_KEYS,
            isMobile: () => mobile,
            isInMobileApp: () => nativeTablet,
            DOCK_ORDER_SCOPES_BY_SIDE: {},
        }),
    });
    const hasExit = (catalog: typeof entryCatalog) => catalog.find(item => item.key === TOP_BAR_ROOT_PATH)
        .children.some(item => item.key === "barExit");
    assert.equal(hasExit(exports.catalog()), false);
    assert.equal(exports.catalog().find(item => item.key === TOOLBAR_ENTRY_ROOT_PATH)
        .children.some(item => item.key.startsWith("mobile-")), false);
    assert.equal(hasExit(entryCatalog), true);
    nativeTablet = true;
    assert.equal(hasExit(exports.catalog()), true);
    mobile = true;
    const catalog = exports.catalog();
    assert.deepEqual(Array.from(catalog, item => item.key), [TOOLBAR_ENTRY_ROOT_PATH, "editor.image", "editor.slash"]);
    assert.equal(catalog.find(item => item.key === "editor.slash"), entryCatalog.find(item => item.key === "editor.slash"));
    assert.deepEqual(Array.from(catalog[0].children, item => item.key), MOBILE_TOOLBAR_CONTEXT_KEYS);
    for (const name of ["undo", "indent", "heading1", "table", "template"]) {
        assert.ok(catalog[0].children[0].children.some(item => item.key === `mobile-${name}`));
    }
});

test("detached entry settings read the owner's plugin toolbar catalog", () => {
    const code = transpileModule(readFileSync("src/config/entryVisibility/ui.ts", "utf8") +
        "\nexports.refreshToolbar = refreshEditorToolbarCatalog;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const exports = {} as {refreshToolbar: (plugins: unknown[]) => void};
    const plugins = [{name: "local"}];
    const owner = [{key: "plugin:owner:item", label: "Owner item", separator: false}];
    const seen: Array<Array<{key: string}>> = [];
    let host: {getEditorToolbarCatalogSnapshot: () => typeof owner} | undefined = {
        getEditorToolbarCatalogSnapshot: () => owner,
    };
    runInNewContext(code, {exports, require: () => ({
        getSettingsWindowHost: () => host,
        getEditorToolbarCatalogSnapshot: (items: Array<{name: string}>) => [{key: items[0].name}],
        refreshToolbarCatalogEntries: (items: Array<{key: string}>) => seen.push(items),
        DOCK_ORDER_SCOPES_BY_SIDE: {},
    })});
    exports.refreshToolbar(plugins);
    assert.equal(seen[0], owner);
    host = undefined;
    exports.refreshToolbar(plugins);
    assert.equal(seen[1][0].key, "local");
});

const loadDockSnapshot = () => {
    const code = transpileModule(readFileSync("src/config/entryVisibility/ui.ts", "utf8") +
        "\nexports.snapshot = getProfileDockOrderSnapshot;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    let settingsWindow = true;
    let reads = 0;
    let ownerSnapshot: unknown = dockOrder.createDockEntryOrderSnapshot({
        RightBottom: ["outline", "plugin:unavailable:dock", "file"], BottomLeft: ["graph"],
    });
    const localSnapshot = dockOrder.createDockEntryOrderSnapshot({LeftTop: ["file", "outline"]});
    const exports = {} as {snapshot: (builtin: boolean) => dockOrder.TDockOrderSnapshot};
    runInNewContext(code, {exports, console: {warn() {}}, require: () => ({
        ...dockOrder,
        isSettingsWindow: () => settingsWindow,
        getSettingsWindowHost: () => ({getDockOrderSnapshot: () => {
            reads++;
            if (ownerSnapshot instanceof Error) throw ownerSnapshot;
            return ownerSnapshot;
        }}),
        getDockEntryOrderSnapshot: () => localSnapshot,
    })});
    return {snapshot: exports.snapshot, localSnapshot, reads: () => reads,
        owner: () => ownerSnapshot as dockOrder.TDockOrderSnapshot,
        setOwner: (snapshot: unknown) => { ownerSnapshot = snapshot; },
        local: () => { settingsWindow = false; }};
};

test("detached entry editors use an isolated owner snapshot and retain unknown dock slots", () => {
    const fixture = loadDockSnapshot();
    const builtin = fixture.snapshot(true);
    const custom = fixture.snapshot(false);
    assert.deepEqual(Array.from(builtin["dock.order.RightBottom"]), ["outline", "plugin:unavailable:dock", "file"]);
    assert.deepEqual(Array.from(custom["dock.order.RightBottom"]), ["file", "plugin:unavailable:dock", "outline"]);
    assert.deepEqual(Array.from(custom["dock.order.BottomLeft"]), ["graph"]);
    assert.deepEqual(Array.from(custom["dock.order.LeftTop"]), []);
    fixture.owner()["dock.order.RightBottom"].push("plugin:new:dock");
    assert.equal(builtin["dock.order.RightBottom"].includes("plugin:new:dock"), false);
    assert.equal(custom["dock.order.RightBottom"].includes("plugin:new:dock"), false);
    assert.equal(fixture.snapshot(true)["dock.order.RightBottom"].includes("plugin:new:dock"), true);
    assert.equal(fixture.reads(), 3);
});

test("owner dock placement merges saved orders without changing configuration or plugin IDs", () => {
    const fixture = loadDockSnapshot();
    const saved = {
        "dock.order.RightBottom": ["outline", "plugin:unavailable:dock", "file"],
        "dock.order.LeftBottom": ["graph", "plugin:disabled:dock"],
        "desktopMenu.plugin:disabled": ["plugin:unknown:item"],
    };
    const original = JSON.stringify(saved);
    const merged = dockOrder.mergeDockEntryOrderSnapshot(fixture.snapshot(false), saved);
    assert.deepEqual(merged["dock.order.RightBottom"], ["outline", "plugin:unavailable:dock", "file"]);
    assert.deepEqual(merged["dock.order.LeftBottom"], ["graph", "plugin:disabled:dock"]);
    assert.deepEqual(merged["dock.order.BottomLeft"], []);
    assert.equal(JSON.stringify(saved), original);
});

test("in-app and mobile entry editors retain local dock defaults", () => {
    const fixture = loadDockSnapshot();
    fixture.local();
    assert.equal(fixture.snapshot(true), fixture.localSnapshot);
    assert.deepEqual(fixture.snapshot(false)["dock.order.LeftTop"], ["file", "outline"]);
    assert.equal(fixture.reads(), 0);
});

test("unavailable or invalid owner dock snapshots fall back to the local layout", () => {
    const fixture = loadDockSnapshot();
    const malformed = dockOrder.createDockEntryOrderSnapshot({});
    for (const owner of [undefined, {}, new Error("owner closed"),
        {...malformed, "dock.order.LeftTop": [42]},
        {...malformed, "dock.order.LeftTop": ["file"], "dock.order.RightTop": ["file"]}]) {
        fixture.setOwner(owner);
        assert.equal(fixture.snapshot(true), fixture.localSnapshot);
    }
});

test("closing an entry editor flushes deferred settings once, after the view is removed", () => {
    const code = transpileModule(readFileSync("src/config/entryVisibility/ui.ts", "utf8") +
        "\nexports.remove = removeEntryView;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    let transition: (event: {propertyName: string}) => void;
    let timeout: () => void;
    let dispatched = 0;
    const view = {parentElement: {}, classList: {remove() {}}, remove: () => { view.parentElement = null; },
        addEventListener: (_name: string, callback: typeof transition) => { transition = callback; }};
    const root = {dispatchEvent: (event: {type: string; bubbles: boolean}) => {
        assert.equal(view.parentElement, null);
        assert.equal(event.type, "siyuan-entry-profile-closed");
        assert.equal(event.bubbles, true);
        dispatched++;
    }};
    const exports = {} as {remove: (root: any, view: any) => void};
    runInNewContext(code, {exports, require: () => ({DOCK_ORDER_SCOPES_BY_SIDE: {}}),
        window: {setTimeout: (callback: () => void) => { timeout = callback; }},
        CustomEvent: class {
            public bubbles: boolean;
            constructor(public type: string, options: {bubbles: boolean}) { this.bubbles = options.bubbles; }
        }});
    exports.remove(root, view);
    assert.equal(dispatched, 0);
    transition({propertyName: "opacity"});
    assert.equal(dispatched, 1);
    timeout();
    assert.equal(dispatched, 1);
});
