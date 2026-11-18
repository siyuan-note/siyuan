import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/mobile/menu/settingPanel.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

test("mobile authentication panels rebuild conditional settings when reopened", async () => {
    for (const id of ["access", "appearance"]) {
        let options: {html: string; bindEvent: (element: unknown) => void};
        let rebuilt: boolean;
        let watched = 0;
        const root = {isConnected: true, querySelector: (): Element | null => null, classList: {toggle: () => {}}};
        const app = {};
        const exports = {} as {openSettingTab: (app: unknown, tab: unknown) => void};
        runInNewContext(compiled, {exports, require: () => ({
            isMobile: () => true,
            isInIOS: () => false,
            openModel: (value: typeof options) => { options = value; },
            bindSettingSaveDelegation: () => {},
            watchSettingTabInteractions: () => { watched++; },
            getSettingTab: () => ({mount: async (element: unknown, _search: unknown, owner: unknown, rebuild: boolean) => {
                assert.equal(element, root);
                assert.equal(owner, app);
                rebuilt = rebuild;
            }}),
        })});
        exports.openSettingTab(app, {id, title: "Settings"});
        assert.ok(options.html.includes(`data-setting-tab="${id}"`));
        options.bindEvent({firstElementChild: root});
        await Promise.resolve();
        assert.equal(watched, 1);
        assert.equal(rebuilt, id === "access");
    }
});

test("iOS settings keep focused inputs reachable during keyboard resize and remove viewport listeners when closed", () => {
    const viewport = new EventTarget();
    const bounds = {top: 0, bottom: 812};
    const input = {};
    const root = Object.assign(new EventTarget(), {
        isConnected: true, style: {maxHeight: ""}, contains: (element: unknown) => element === input,
        getBoundingClientRect: () => ({top: 48}), remove() {},
    });
    let options: {bindEvent: (element: unknown) => void; destroyCallback: () => void};
    let scrolls = 0;
    const exports = {} as {openSettingTab: (app: unknown, tab: unknown) => void};
    runInNewContext(compiled, {exports, window: {innerHeight: 812, visualViewport: viewport}, document: {activeElement: input},
        require: () => ({
            isInIOS: () => true, isMobile: () => true,
            openModel: (value: typeof options) => { options = value; },
            watchSettingTabInteractions() {}, bindSettingSaveDelegation() {},
            getSettingTab: () => ({mount: () => new Promise(() => {})}),
            getVisibleViewportBounds: () => bounds,
            scrollInputIntoView: (element: unknown) => {assert.equal(element, input); scrolls++;},
        })});
    exports.openSettingTab({}, {id: "flashcard", title: "Settings"});
    options.bindEvent({firstElementChild: root});
    assert.equal(root.style.maxHeight, "");
    bounds.bottom = 483;
    viewport.dispatchEvent(new Event("resize"));
    assert.equal(root.style.maxHeight, "435px");
    assert.equal(scrolls, 1);
    root.dispatchEvent(new Event("focusin"));
    assert.equal(scrolls, 2);
    bounds.bottom = 812;
    viewport.dispatchEvent(new Event("resize"));
    assert.equal(root.style.maxHeight, "");
    options.destroyCallback();
    bounds.bottom = 483;
    viewport.dispatchEvent(new Event("scroll"));
    root.dispatchEvent(new Event("focusin"));
    assert.equal(root.style.maxHeight, "");
    assert.equal(scrolls, 2);
});
