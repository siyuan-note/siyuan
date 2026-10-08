import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {resolveEntryOrder} from "./order";
import {resetEntryProfileOrder} from "./profile";
import * as catalog from "./catalog";
import * as profileVisibility from "./profile";
import {TOOLBAR_ENTRY_ROOT_PATH} from "../../protyle/toolbar/defaults";
import {
    DOCK_ORDER_SCOPES,
    getDefaultDockEntryOrderSnapshot,
    isDockOrderScope,
    mergeDockEntryOrderSnapshot,
} from "./dockOrder";

test("frequent slash defaults and snapshots follow profiles on desktop and mobile", () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/runtime.ts"), "utf8");
    const compiled = transpileModule(source + "\nexports.writable = getWritableEntryProfile;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const path = catalog.SLASH_MENU_FREQUENT_PATH;
    const root = catalog.SLASH_MENU_ROOT_PATH;
    try {
        for (const mobile of [false, true]) {
            for (const template of ["simple", "full"] as const) {
                const config: Config.IEntryVisibility = {version: 6, active: template, profiles: []};
                const window = {siyuan: {
                    config: {appearance: {entryVisibility: config}},
                    languages: {entryCustomProfile: "Custom"},
                    ...(mobile ? {mobile: {}} : {}),
                }};
                Object.defineProperty(globalThis, "window", {configurable: true, value: window});
                const runtime = {} as typeof import("./runtime") & {
                    writable: (config: Config.IEntryVisibility) => Config.IEntryVisibilityProfile;
                };
                runInNewContext(compiled, {exports: runtime, window, require: () => ({
                    ...catalog, ...profileVisibility, TOOLBAR_ENTRY_ROOT_PATH, genUUID: () => "custom",
                })});
                const enabled = template === "full";
                assert.equal(runtime.getConfiguredEntryVisibility(path, root), enabled);
                assert.equal(runtime.getConfiguredEntryVisibility(path), enabled && !mobile);
                assert.equal(runtime.createEntryProfileSnapshot(template)[path], enabled);
                const custom = runtime.writable(config);
                assert.equal(custom.entries[path], enabled);
                custom.entries[root] = false;
                for (const visible of [false, true]) {
                    custom.entries[path] = visible;
                    assert.equal(runtime.getConfiguredEntryVisibility(path), false);
                    assert.equal(runtime.getConfiguredEntryVisibility(path, root), visible);
                }
                const saved = JSON.stringify(custom);
                config.active = "simple";
                assert.equal(runtime.getConfiguredEntryVisibility(path, root), false);
                config.active = "full";
                assert.equal(runtime.getConfiguredEntryVisibility(path, root), true);
                config.active = custom.id;
                assert.equal(JSON.stringify(custom), saved);
                assert.equal(runtime.getConfiguredEntryVisibility(path, root), true);
                delete custom.entries[path];
                assert.equal(runtime.getConfiguredEntryVisibility(path, root), true);
            }
        }
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, "window", descriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

test("daily note and flashcard presets preserve custom choices and mobile defaults", () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/runtime.ts"), "utf8");
    const compiled = transpileModule(source + "\nexports.writable = getWritableEntryProfile;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const paths = ["topBar.barDailyNote", "topBar.barRiffCard"];
    try {
        for (const mobile of [false, true]) {
            const config: Config.IEntryVisibility = {version: 6, active: "full", profiles: []};
            const window = {siyuan: {
                config: {appearance: {entryVisibility: config}},
                languages: {entryCustomProfile: "Custom"},
                ...(mobile ? {mobile: {}} : {}),
            }};
            Object.defineProperty(globalThis, "window", {configurable: true, value: window});
            const runtime = {} as typeof import("./runtime") & {
                writable: (config: Config.IEntryVisibility) => Config.IEntryVisibilityProfile;
            };
            runInNewContext(compiled, {exports: runtime, window, require: () => ({
                ...catalog, ...profileVisibility, TOOLBAR_ENTRY_ROOT_PATH, genUUID: () => "custom",
            })});
            for (const template of ["full", "simple"] as const) {
                config.active = template;
                const expected = template === "simple" || !mobile;
                const snapshot = runtime.createEntryProfileSnapshot(template);
                for (const path of paths) {
                    assert.equal(runtime.getConfiguredEntryVisibility(path), expected);
                    assert.equal(snapshot[path], expected);
                }
            }
            config.active = "full";
            const custom = runtime.writable(config);
            for (const path of paths) {
                assert.equal(custom.entries[path], !mobile);
                for (const visible of [false, true]) {
                    custom.entries[path] = visible;
                    assert.equal(runtime.getConfiguredEntryVisibility(path), visible);
                }
                delete custom.entries[path];
                assert.equal(runtime.getConfiguredEntryVisibility(path), false);
            }
            // 使用完整模板重置时采用当前默认值，不改写其他已保存方案。
            custom.entries = runtime.createEntryProfileSnapshot("full");
            for (const path of paths) {
                assert.equal(runtime.getConfiguredEntryVisibility(path), !mobile);
                custom.entries[path] = false;
            }
            const saved = JSON.stringify(custom);
            config.active = "full";
            for (const path of paths) {
                assert.equal(runtime.getConfiguredEntryVisibility(path), !mobile);
            }
            config.active = custom.id;
            for (const path of paths) {
                assert.equal(runtime.getConfiguredEntryVisibility(path), false);
            }
            assert.equal(JSON.stringify(custom), saved);
        }
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, "window", descriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

test("simple formatting defaults preserve color and full and custom toolbar choices", () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/runtime.ts"), "utf8");
    const compiled = transpileModule(source + "\nexports.writable = getWritableEntryProfile;", {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const advanced = ["sup", "sub", "kbd", "inline-math"];
    try {
        for (const mobile of [false, true]) {
            const root = mobile ? "editor.toolbar.mobile-selection" : "editor.toolbar";
            const config: Config.IEntryVisibility = {version: 6, active: "simple", profiles: []};
            const window = {siyuan: {
                config: {appearance: {entryVisibility: config}},
                languages: {entryCustomProfile: "Custom"},
                ...(mobile ? {mobile: {}} : {}),
            }};
            Object.defineProperty(globalThis, "window", {configurable: true, value: window});
            const runtime = {} as typeof import("./runtime") & {
                writable: (config: Config.IEntryVisibility) => Config.IEntryVisibilityProfile;
            };
            runInNewContext(compiled, {exports: runtime, window, require: () => ({
                ...catalog, ...profileVisibility, TOOLBAR_ENTRY_ROOT_PATH, genUUID: () => "custom",
            })});
            for (const template of ["simple", "full"] as const) {
                config.active = template;
                const snapshot = runtime.createEntryProfileSnapshot(template);
                for (const key of advanced) {
                    assert.equal(runtime.isEntryVisible(`${root}.${key}`), template === "full");
                    assert.equal(snapshot[`${root}.${key}`], template === "full");
                }
                for (const key of ["text", "strong", "em", "u", "s", "mark", "code", "tag", "inline-memo"]) {
                    assert.equal(runtime.isEntryVisible(`${root}.${key}`), true, `${template}: ${key}`);
                    assert.equal(snapshot[`${root}.${key}`], true);
                }
            }
            config.active = "simple";
            const custom = runtime.writable(config);
            for (const key of [...advanced, "text"]) {
                const path = `${root}.${key}`;
                assert.equal(custom.entries[path], key === "text");
                for (const visible of [false, true]) {
                    custom.entries[path] = visible;
                    assert.equal(runtime.isEntryVisible(path), visible);
                }
                delete custom.entries[path];
                if (mobile) {
                    const legacy = `editor.toolbar.${key}`;
                    for (const visible of [false, true]) {
                        custom.entries[legacy] = visible;
                        assert.equal(runtime.isEntryVisible(path), visible);
                    }
                    delete custom.entries[legacy];
                }
                assert.equal(runtime.isEntryVisible(path), true);
                custom.entries[path] = false;
            }
            const saved = JSON.stringify(custom);
            for (const template of ["simple", "full"] as const) {
                config.active = template;
                assert.equal(runtime.isEntryVisible(`${root}.text`), true);
            }
            config.active = custom.id;
            assert.equal(JSON.stringify(custom), saved);
            for (const key of [...advanced, "text"]) {
                assert.equal(runtime.isEntryVisible(`${root}.${key}`), false);
                assert.equal(catalog.getEntryCatalogNode(`editor.toolbar.mobile-input.${key}`), undefined);
            }
        }
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, "window", descriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

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
