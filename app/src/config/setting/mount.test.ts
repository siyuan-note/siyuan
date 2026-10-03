import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

for (const keywords of ["", "gradient"]) {
    test(`remount restores scroll after asynchronous initialization and search (keywords=${keywords})`, async () => {
        const source = readFileSync(resolve(process.cwd(), "src/config/setting/mount.ts"), "utf8");
        const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
        const root = {innerHTML: "settings", scrollTop: 235.5, scrollLeft: 12, contains: () => false,
            querySelector: (): Element | null => null};
        const visibleItemIds = new Set(["bodyGradient"]);
        const tab = {
            scanSearch: () => ({visibleItemIds}),
            mount: async (element: typeof root, search: {visibleItemIds?: Set<string>}, _app: unknown, rebuild: boolean) => {
                assert.equal(element, root);
                assert.equal(rebuild, true);
                assert.equal(search.visibleItemIds, keywords ? visibleItemIds : undefined);
                element.scrollTop = 0;
                element.scrollLeft = 0;
                await Promise.resolve();
                element.scrollTop = 210;
            },
        };
        const moduleExports: {remountOpenSettingTab?: (tabId: string) => Promise<void>} = {};
        runInNewContext(code, {
            exports: moduleExports,
            document: {activeElement: null},
            window: {siyuan: {ws: {app: {}}, dialogs: [{element: {
                getAttribute: () => "settings",
                querySelector: () => root,
            }}]}},
            require: (name: string) => {
                if (name === "../../constants") {
                    return {Constants: {DIALOG_SETTING: "settings"}};
                }
                if (name === "../search/normalize") {
                    return {getSearchKeywordsLower: () => keywords};
                }
                if (name === "./tabs") {
                    return {getSettingTab: () => tab};
                }
                return {};
            },
        });
        await moduleExports.remountOpenSettingTab("appearance");
        assert.equal(root.scrollTop, 235.5);
        assert.equal(root.scrollLeft, 12);
    });
}

test("all settings refreshes preserve focused inputs and remount when focus leaves", async () => {
    const code = transpileModule(readFileSync("src/config/setting/mount.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const input = {};
    const root = {innerHTML: "settings", scrollTop: 12, scrollLeft: 0, contains: (element: unknown) => element === input,
        querySelector: (): Element | null => null};
    let mounted = 0;
    let focusout: () => void;
    const timers: Array<() => void> = [];
    const document = {activeElement: input, addEventListener: (_name: string, callback: () => void) => { focusout = callback; }};
    const dependencies = {Constants: {DIALOG_SETTING: "settings"}, getSearchKeywordsLower: () => "",
        getSettingTab: () => ({mount: async () => { mounted++; }})};
    const exports = {} as {remountOpenSettingTab: (tab: string) => Promise<void>};
    runInNewContext(code, {exports, require: () => dependencies, document,
        setTimeout: (callback: () => void) => timers.push(callback),
        window: {siyuan: {ws: {app: {}}, dialogs: [{element: {getAttribute: () => "settings", querySelector: () => root}}]}}});
    await exports.remountOpenSettingTab("appearance");
    assert.equal(mounted, 0);
    document.activeElement = {};
    focusout();
    timers.forEach(callback => callback());
    await Promise.resolve();
    assert.equal(mounted, 1);
    assert.equal(root.scrollTop, 12);
});

test("settings refresh preserves an unfocused profile draft and resumes after the editor closes", async () => {
    const code = transpileModule(readFileSync("src/config/setting/mount.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    let view: object = {};
    let mounted = 0;
    const listeners = new Map<string, () => void>();
    const timers: Array<() => void> = [];
    const root = {innerHTML: "draft", scrollTop: 12, scrollLeft: 0, contains: () => false,
        querySelector: () => view};
    const dependencies = {Constants: {DIALOG_SETTING: "settings"}, getSearchKeywordsLower: () => "",
        getSettingTab: () => ({mount: async () => { mounted++; root.innerHTML = "refreshed"; }})};
    const exports = {} as {remountOpenSettingTab: (tab: string) => Promise<void>};
    runInNewContext(code, {exports, require: () => dependencies,
        document: {activeElement: {}, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback)},
        setTimeout: (callback: () => void) => timers.push(callback),
        window: {siyuan: {ws: {app: {}}, dialogs: [{element: {getAttribute: () => "settings", querySelector: () => root}}]}}});
    await exports.remountOpenSettingTab("appearance");
    await exports.remountOpenSettingTab("appearance");
    assert.equal(mounted, 0);
    assert.equal(root.innerHTML, "draft");
    listeners.get("focusout")();
    timers.splice(0).forEach(callback => callback());
    await Promise.resolve();
    assert.equal(mounted, 0);
    view = undefined;
    listeners.get("siyuan-entry-profile-closed")();
    timers.splice(0).forEach(callback => callback());
    await Promise.resolve();
    assert.equal(mounted, 1);
    assert.equal(root.innerHTML, "refreshed");
    listeners.get("siyuan-entry-profile-closed")();
    timers.splice(0).forEach(callback => callback());
    await Promise.resolve();
    assert.equal(mounted, 1);
});
