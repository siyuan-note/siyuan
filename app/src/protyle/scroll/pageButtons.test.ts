import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {DynamicLoadState} from "./dynamicLoadState";

const {parse} = require("ifdef-loader/preprocessor");
const compile = (file: string, mobile = false) => transpileModule(parse(readFileSync(file, "utf8"), {
    MOBILE: mobile, BROWSER: true,
}, false, true), {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText;

class MockElement {
    public dataset: Record<string, string> = {};
    public attributes = new Map<string, string>();
    public listeners = new Map<string, (event: any) => void>();
    public classes = new Set<string>();
    public classList = {
        add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
        contains: (name: string) => this.classes.has(name),
        toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
    public firstElementChild: MockElement;
    public innerHTML = "";
    public selectors = new Map<string, MockElement>();
    public addEventListener(name: string, listener: (event: any) => void) { this.listeners.set(name, listener); }
    public dispatchEvent(event: {type: string}) { this.listeners.get(event.type)?.(event); }
    public querySelector(selector: string) { return this.selectors.get(selector); }
    public setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    public closest() { return this; }
}

const fixture = (mobile: boolean, renderScroll = true) => {
    const storage: Record<string, unknown> = {};
    const saves: Array<{key: string; value: unknown}> = [];
    const pages: Array<{protyle: unknown; direction: string}> = [];
    const groups: MockElement[] = [];
    const settingInput = {checked: false};
    const window = {siyuan: {
        storage, isPublish: false,
        languages: new Proxy({}, {get: (_, name) => String(name)}),
        config: {readonly: false, editor: {keepLoadedContent: false}, keymap: {editor: {general: {
            scrollPageUpWithoutMovingCaret: {custom: "Alt+PageUp"},
            scrollPageDownWithoutMovingCaret: {custom: "Alt+PageDown"},
        }}}},
    }};
    let currentParent: MockElement;
    const document = {
        createElement: () => currentParent,
        querySelectorAll: (selector: string) => selector === ".protyle-scroll__page" ? groups : [settingInput],
    };
    const preferences: any = {};
    runInNewContext(compile("src/protyle/scroll/pageButtons.ts", mobile), {
        exports: preferences, window, document, Event,
        require: (name: string) => name === "../../constants" ? {Constants: {LOCAL_PAGE_SCROLL_BUTTONS: "page-buttons"}} : {
            setStorageVal: (key: string, value: unknown) => saves.push({key, value}),
        },
    });
    const moduleExports: any = {};
    runInNewContext(compile("src/protyle/scroll/index.ts", mobile), {
        exports: moduleExports, window, document,
        require: (name: string) => {
            if (name === "./pageButtons") return preferences;
            if (name === "./dynamicLoadState") return {DynamicLoadState};
            if (name === "../../util/keymapBindings") return {
                getKeymapBindings: (binding?: {custom: string}): string[] => binding ? [binding.custom] : [],
            };
            if (name === "../util/compatibility") return {updateHotkeyTip: (key: string) => key};
            if (name === "./page") return {scrollPageWithLoading: (protyle: unknown, direction: string) => {
                pages.push({protyle, direction});
            }};
            return {};
        },
    });
    const createEditor = () => {
        const parent = new MockElement();
        const page = new MockElement();
        const bar = new MockElement();
        const up = new MockElement();
        const down = new MockElement();
        up.dataset.direction = "up";
        down.dataset.direction = "down";
        parent.selectors.set(".protyle-scroll__page", page);
        parent.selectors.set(".protyle-scroll__bar", bar);
        parent.selectors.set(".protyle-scroll__up", new MockElement());
        parent.selectors.set(".protyle-scroll__down", new MockElement());
        parent.selectors.set('.protyle-scroll__page [data-direction="up"]', up);
        parent.selectors.set('.protyle-scroll__page [data-direction="down"]', down);
        bar.firstElementChild = new MockElement();
        currentParent = parent;
        let resized = 0;
        const protyle: any = {element: new MockElement(), contentElement: {},
            options: {render: {scroll: renderScroll}}, getInstance: () => ({resize: () => resized++})};
        const scroll = new moduleExports.Scroll(protyle);
        protyle.scroll = scroll;
        groups.push(page);
        return {protyle, parent, page, up, down, resized: () => resized};
    };
    return {preferences, window, storage, saves, pages, settingInput, createEditor};
};

for (const mobile of [false, true]) {
    test(`page button preference defaults off and updates every editor and the setting (mobile=${mobile})`, () => {
        const f = fixture(mobile);
        assert.equal(f.preferences.isPageScrollButtonsEnabled(), false);
        const first = f.createEditor();
        const second = f.createEditor();
        assert.equal(first.page.classList.contains("fn__none"), true);
        f.preferences.setPageScrollButtonsEnabled(true);
        assert.equal(f.saves.length, 1);
        assert.equal(f.saves[0].value, true);
        assert.equal(first.page.classList.contains("fn__none"), false);
        assert.equal(second.page.classList.contains("fn__none"), false);
        assert.equal(first.protyle.element.classList.contains("protyle--page-scroll"), true);
        assert.equal(first.resized(), 1);
        assert.equal(f.settingInput.checked, true);
        delete f.storage["page-buttons"];
        f.preferences.onPageScrollButtonsStorageChanged("page-buttons");
        assert.equal(first.page.classList.contains("fn__none"), true);
        assert.equal(second.protyle.element.classList.contains("protyle--page-scroll"), false);
        assert.equal(f.settingInput.checked, false);
    });

    test(`button input preserves focus and scrolls only the owning editor (mobile=${mobile})`, () => {
        const f = fixture(mobile);
        f.preferences.setPageScrollButtonsEnabled(true);
        const editor = f.createEditor();
        f.createEditor();
        let prevented = 0;
        let stopped = 0;
        editor.page.dispatchEvent({type: "pointerdown", preventDefault: () => prevented++, stopPropagation: () => stopped++} as any);
        assert.equal(prevented, 1);
        editor.page.dispatchEvent({type: "click", target: editor.down, stopPropagation: () => stopped++} as any);
        editor.page.dispatchEvent({type: "click", target: editor.up, stopPropagation: () => stopped++} as any);
        assert.equal(stopped, 3);
        assert.deepEqual(f.pages.map(page => page.direction), ["down", "up"]);
        assert.ok(f.pages.every(page => page.protyle === editor.protyle));
        assert.equal(editor.up.attributes.get("aria-label"), "pageScrollUp Alt+PageUp");
        assert.equal(editor.down.attributes.get("aria-label"), "pageScrollDown Alt+PageDown");
    });
}

test("page buttons respect readonly storage and editor render options", () => {
    const f = fixture(false, false);
    f.window.siyuan.config.readonly = true;
    f.preferences.setPageScrollButtonsEnabled(true);
    assert.equal(f.preferences.isPageScrollButtonsEnabled(), false);
    assert.equal(f.saves.length, 0);
    f.storage["page-buttons"] = true;
    const editor = f.createEditor();
    assert.equal(editor.page.classList.contains("fn__none"), true);
    assert.equal(editor.protyle.element.classList.contains("protyle--page-scroll"), false);
});
