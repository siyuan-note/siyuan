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
    let pending: (() => void) | undefined;
    const browser = Object.assign(new EventTarget(), {
        innerHeight: 812, visualViewport: viewport,
        setTimeout: (callback: () => void) => { pending = callback; return 1; },
        clearTimeout: () => { pending = undefined; },
    });
    const bounds = {top: 0, bottom: 812};
    const input = {};
    const root = Object.assign(new EventTarget(), {
        isConnected: true, style: {maxHeight: ""}, contains: (element: unknown) => element === input,
        getBoundingClientRect: () => ({top: 48}), remove() {},
    });
    let options: {bindEvent: (element: unknown) => void; destroyCallback: () => void};
    let scrolls = 0;
    const exports = {} as {openSettingTab: (app: unknown, tab: unknown) => void};
    const document = {activeElement: input};
    runInNewContext(compiled, {exports, window: browser, document,
        require: () => ({
            isInIOS: () => true, isMobile: () => true,
            Constants: {TIMEOUT_TRANSITION: 300},
            openModel: (value: typeof options) => { options = value; },
            watchSettingTabInteractions() {}, bindSettingSaveDelegation() {},
            getSettingTab: () => ({mount: () => new Promise(() => {})}),
            getVisibleViewportBounds: () => bounds,
            scrollInputIntoView: (element: unknown) => {assert.equal(element, input); scrolls++;},
        })});
    exports.openSettingTab({}, {id: "flashcard", title: "Settings"});
    options.bindEvent({firstElementChild: root});
    assert.equal(root.style.maxHeight, "");
    assert.equal(scrolls, 1);
    bounds.bottom = 483;
    viewport.dispatchEvent(new Event("resize"));
    assert.equal(root.style.maxHeight, "435px");
    assert.equal(scrolls, 2);
    root.dispatchEvent(new Event("focusin"));
    assert.equal(scrolls, 3);

    // 键盘可以同步缩小布局视口和可见视口。
    browser.innerHeight = 483;
    browser.dispatchEvent(new Event("resize"));
    assert.equal(root.style.maxHeight, "");
    assert.equal(scrolls, 4);
    viewport.dispatchEvent(new Event("resize"));
    assert.equal(scrolls, 5);
    // 原生滚动可能在视口事件之后发生。
    assert.ok(pending);
    pending();
    assert.equal(scrolls, 6);

    document.activeElement = {};
    browser.innerHeight = 812;
    bounds.bottom = 812;
    viewport.dispatchEvent(new Event("resize"));
    assert.equal(root.style.maxHeight, "");
    document.activeElement = input;
    root.dispatchEvent(new Event("focusin"));
    assert.ok(pending);
    options.destroyCallback();
    assert.equal(pending, undefined);
    bounds.bottom = 483;
    viewport.dispatchEvent(new Event("scroll"));
    browser.dispatchEvent(new Event("resize"));
    root.dispatchEvent(new Event("focusin"));
    assert.equal(root.style.maxHeight, "");
    assert.equal(scrolls, 7);
});
