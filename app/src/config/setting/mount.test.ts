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
        const owner = {plugins: [{name: "main-only"}]};
        const tab = {
            scanSearch: () => ({visibleItemIds}),
            mount: async (element: typeof root, search: {visibleItemIds?: Set<string>}, app: unknown, rebuild: boolean) => {
                assert.equal(app, owner);
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
                if (name === "./windowContext") return {getSettingsOwnerApp: () => owner};
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
        getSettingsOwnerApp: () => ({}),
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
        getSettingsOwnerApp: () => ({}),
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

for (const detail of ["provider", "capability", "skill"]) {
    test(`AI ${detail} details preserve drafts when unfocused and refresh after closing`, async () => {
        const code = transpileModule(readFileSync("src/config/setting/mount.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        let visible = true;
        let mounted = 0;
        const listeners = new Map<string, () => void>();
        const timers: Array<() => void> = [];
        const root = {innerHTML: "unsaved draft", scrollTop: 12, scrollLeft: 0, contains: () => false,
            querySelector: (selector: string) => visible && selector.includes(".config__view--show:not(.fn__none)") ? {} : null};
        const exports = {} as {remountOpenSettingTab: (tab: string) => Promise<void>};
        runInNewContext(code, {exports,
            require: () => ({Constants: {DIALOG_SETTING: "settings"}, getSearchKeywordsLower: () => "",
                getSettingsOwnerApp: () => ({}), getSettingTab: () => ({mount: async () => { mounted++; }})}),
            document: {activeElement: {}, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback)},
            setTimeout: (callback: () => void) => timers.push(callback),
            window: {siyuan: {dialogs: [{element: {getAttribute: () => "settings", querySelector: () => root}}]}}});
        await exports.remountOpenSettingTab("ai");
        listeners.get("focusout")();
        timers.splice(0).forEach(callback => callback());
        await Promise.resolve();
        assert.equal(mounted, 0);
        assert.equal(root.innerHTML, "unsaved draft");
        visible = false;
        listeners.get("siyuan-setting-detail-closed")();
        timers.splice(0).forEach(callback => callback());
        await Promise.resolve();
        assert.equal(mounted, 1);
    });
}

test("deferred refresh preserves a pressed label until its click completes or is canceled", async () => {
    const code = transpileModule(readFileSync("src/config/setting/mount.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const input = {};
    const label = {};
    let mounted = 0;
    const listeners = new Map<string, (event?: {target: object}) => void>();
    const timers: Array<() => void> = [];
    const root = {innerHTML: "settings", scrollTop: 12, scrollLeft: 0,
        contains: (element: unknown) => element === input || element === label,
        querySelector: (): Element | null => null};
    const document = {activeElement: input,
        addEventListener: (name: string, callback: (event?: {target: object}) => void) => listeners.set(name, callback)};
    const exports = {} as {remountOpenSettingTab: (tab: string) => Promise<void>; watchSettingTabInteractions: () => void};
    runInNewContext(code, {exports, document, setTimeout: (callback: () => void) => timers.push(callback),
        require: () => ({Constants: {DIALOG_SETTING: "settings"}, getSearchKeywordsLower: () => "",
            getSettingsOwnerApp: () => ({}),
            getSettingTab: () => ({mount: async () => { mounted++; }})}),
        window: {siyuan: {ws: {app: {}}, dialogs: [{element: {getAttribute: () => "settings", querySelector: () => root}}]}}});
    exports.watchSettingTabInteractions();
    await exports.remountOpenSettingTab("editor");
    listeners.get("pointerdown")({target: label});
    document.activeElement = {};
    listeners.get("focusout")();
    timers.splice(0).forEach(callback => callback());
    await Promise.resolve();
    assert.equal(mounted, 0);
    listeners.get("pointerup")();
    assert.equal(mounted, 0);
    document.activeElement = input;
    timers.splice(0).forEach(callback => callback());
    await Promise.resolve();
    assert.equal(mounted, 0);
    listeners.get("pointerdown")({target: label});
    document.activeElement = {};
    listeners.get("focusout")();
    timers.splice(0).forEach(callback => callback());
    listeners.get("pointercancel")();
    timers.splice(0).forEach(callback => callback());
    await Promise.resolve();
    assert.equal(mounted, 1);
});

test("AI remount preserves an unfocused decision draft through discard confirmation and closing animation", async () => {
    const code = transpileModule(readFileSync("src/config/setting/mount.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const draft = {apiKey: "unsaved-openai-key"};
    const card = {};
    let view: object = draft;
    let mounted = 0;
    const listeners = new Map<string, () => void>();
    const timers: Array<() => void> = [];
    const root = {innerHTML: "decision settings", scrollTop: 25, scrollLeft: 0,
        contains: (element: unknown) => element === card,
        querySelector: (selector: string) => selector.includes("[data-decision-profile-view]") ? view : null};
    const document = {activeElement: {}, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback)};
    const exports = {} as {remountOpenSettingTab: (tab: string) => Promise<void>};
    runInNewContext(code, {exports, document,
        setTimeout: (callback: () => void) => timers.push(callback),
        require: () => ({Constants: {DIALOG_SETTING: "settings"}, getSearchKeywordsLower: () => "",
            getSettingsOwnerApp: () => ({}), getSettingTab: () => ({mount: async () => {
                mounted++;
                root.innerHTML = "refreshed";
            }})}),
        window: {siyuan: {dialogs: [{element: {getAttribute: () => "settings", querySelector: () => root}}]}}});
    const flush = async () => {
        timers.splice(0).forEach(callback => callback());
        await Promise.resolve();
    };
    // 外部 AI 更新到达时，焦点在空白区域，仍需保留详情中的未保存密钥。
    await exports.remountOpenSettingTab("ai");
    assert.equal(mounted, 0);
    document.activeElement = {modal: "discard confirmation"};
    listeners.get("focusout")();
    await flush();
    await exports.remountOpenSettingTab("ai");
    assert.equal(mounted, 0);
    assert.equal((view as typeof draft).apiKey, "unsaved-openai-key");
    // 动画未结束时详情仍在 DOM，关闭通知也不能提前重建。
    listeners.get("siyuan-decision-profile-closed")();
    await flush();
    assert.equal(mounted, 0);
    view = undefined;
    document.activeElement = card;
    listeners.get("siyuan-decision-profile-closed")();
    await flush();
    assert.equal(mounted, 0);
    // 返回后的卡片焦点不得被刷新替换，真正离开设置面板后再恢复待执行刷新。
    document.activeElement = {};
    listeners.get("focusout")();
    await flush();
    assert.equal(mounted, 1);
    assert.equal(root.innerHTML, "refreshed");
    assert.equal(root.scrollTop, 25);
});
