import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as customTabOwner from "./customTabOwner";
import {cancelPluginColorPickers, getColorPickerOwner, registerColorPickerOwner} from "../colorPicker/owners";
import {cancelPluginDatePickers, getDatePickerOwner, registerDatePickerOwner} from "../datePicker/owners";

const compiled = (file: string, mobile: boolean) => transpileModule(require("ifdef-loader/preprocessor").parse(
    readFileSync(file, "utf8"), {MOBILE: mobile, BROWSER: mobile}, false, true), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

for (const mode of ["settings", "main", "document", "mobile"]) {
    test(`plugin teardown preserves resource cleanup and scopes layout updates (${mode})`, () => {
        const updates: string[] = [];
        const cleaned: string[] = [];
        const errors: unknown[][] = [];
        const plugin = {name: "sample", models: {}, docks: {}, topBarIcons: [] as Element[], statusBarIcons: [] as Element[],
            agentCapabilities: [] as Array<{id: string; generation: number}>,
            kernel: {destroy: () => cleaned.push("kernel")}, eventBus: {}};
        const app = {plugins: [plugin]};
        registerColorPickerOwner(plugin);
        getColorPickerOwner(plugin).sessions.add(() => cleaned.push("color picker"));
        registerDatePickerOwner(plugin);
        getDatePickerOwner(plugin).sessions.add(() => cleaned.push("date picker"));
        const window = {siyuan: {layout: mode === "settings" ? {} : {layout: {children: []}},
            config: {appearance: {hideToolbar: false}}, languages: {}, storage: {}}};
        const dependencies = {
            cancelPluginColorPickers,
            cancelPluginDatePickers,
            Constants: {}, isSettingsWindow: () => mode === "settings", isWindow: () => ["settings", "document"].includes(mode),
            getAllModels: () => ({custom: [] as unknown[]}), getAllEditor: (): unknown[] => [],
            unregisterPluginCommands() {}, cancelAssetUploadsByPlugin() {}, releaseTrackedRangesByPlugin() {},
            removeBreadcrumbButtons() {}, destroyEventBus: () => cleaned.push("event bus"),
            refreshDockCatalog: () => updates.push("dock catalog"),
            applyTopBarEntryVisibility: () => updates.push("top bar catalog"),
            resizeTopBar: () => updates.push("top bar layout"),
        };
        const document = {querySelector: (selector: string) => selector.startsWith("svg") ? {remove: () => cleaned.push("icons")} : null,
            getElementById: () => ({remove: () => cleaned.push("style")})};
        const load = (file: string, modules: Record<string, unknown> = {}): Record<string, any> => {
            const exports = {};
            runInNewContext(compiled(file, mode === "mobile"), {exports, window, document,
                console: {error: (...args: unknown[]) => errors.push(args)},
                require: (name: string) => modules[name] || dependencies});
            return exports;
        };
        const layouts = load("src/layout/getAll.ts");
        const tabs = load("src/layout/tabUtil.ts", {"./getAll": layouts});
        const teardown = load("src/plugin/uninstall.ts", {"../layout/tabUtil": {
            setTabPosition: (...args: unknown[]) => {
                updates.push("tab layout");
                return tabs.setTabPosition(...args);
            },
        }});
        teardown.destroyPlugin(app, plugin, false);
        assert.deepEqual(errors, []);
        assert.deepEqual(cleaned, ["color picker", "date picker", "kernel", "event bus", "icons", "style"]);
        assert.throws(() => getDatePickerOwner(plugin), /live Plugin/);
        assert.equal(app.plugins.length, 0);
        assert.deepEqual(updates, mode === "settings" ? [] : mode === "mobile" ? ["dock catalog"] :
            ["dock catalog", "top bar catalog", "top bar layout", "tab layout"]);
    });
}

for (const reenabled of [false, true]) {
    test(`plugin uninstall closes owned live and lazy tabs after disable (reenabled=${reenabled})`, () => {
        const removed: string[] = [];
        const storage = {"plugin-docks": {foo: {position: "LeftTop"}, other: {}},
            "closed-tabs": [
                {instance: "Tab", children: {instance: "Custom", customModelType: "fooview"}},
                {instance: "Tab", children: {instance: "Custom", customModelType: "other-view"}},
            ]};
        const app = {plugins: reenabled ? [{name: "foo", models: {}}] : []} as unknown as import("../index").App;
        class Custom {type = "foobar";}
        const tab = (id: string, type: string, model?: Custom) => ({id, model,
            headElement: {getAttribute: () => JSON.stringify({instance: "Custom", customModelType: type})},
            parent: {removeTab: (value: string) => removed.push(value)}});
        const live = tab("live", "foobar", new Custom());
        customTabOwner.setCustomTabOwner(live as unknown as import("../layout/Tab").Tab, "foo");
        const lazy = tab("lazy", "fooview");
        const ambiguous = tab("ambiguous", "foobar");
        const builtin = tab("builtin", "siyuan-card");
        customTabOwner.rememberCustomTabPlugins(app, ["foo", "foob", "other"]);
        const dependencies = {...customTabOwner, Custom,
            Constants: {LOCAL_PLUGIN_DOCKS: "plugin-docks", LOCAL_CLOSED_TABS: "closed-tabs"},
            isSettingsWindow: () => false, getAllTabs: () => [live, lazy, ambiguous, builtin],
            setStorageVal() {}};
        const exports: Record<string, any> = {};
        runInNewContext(compiled("src/plugin/uninstall.ts", false), {exports,
            window: {siyuan: {storage}}, console,
            document: {querySelector: (): null => null, getElementById: (): null => null},
            require: () => dependencies});
        exports.destroyPluginByName(app, "foo");
        assert.deepEqual(removed, ["live", "lazy"]);
        assert.equal(customTabOwner.isCustomTabUninstalled(live as unknown as import("../layout/Tab").Tab), true);
        assert.equal(Object.hasOwn(storage["plugin-docks"], "foo"), false);
        assert.equal(Object.hasOwn(storage["plugin-docks"], "other"), true);
        assert.deepEqual(storage["closed-tabs"].map(item => item.children.customModelType), ["other-view"]);
    });
}
