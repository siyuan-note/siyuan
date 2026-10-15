import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

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
        const window = {siyuan: {layout: mode === "settings" ? {} : {layout: {children: []}},
            config: {appearance: {hideToolbar: false}}, languages: {}, storage: {}}};
        const dependencies = {
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
        assert.deepEqual(cleaned, ["kernel", "event bus", "icons", "style"]);
        assert.equal(app.plugins.length, 0);
        assert.deepEqual(updates, mode === "settings" ? [] : mode === "mobile" ? ["dock catalog"] :
            ["dock catalog", "top bar catalog", "top bar layout", "tab layout"]);
    });
}
