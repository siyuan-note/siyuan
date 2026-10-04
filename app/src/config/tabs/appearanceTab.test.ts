import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [true, false]) {
    test(`appearance registration includes toolbar settings on first load (mobile=${mobile})`, () => {
        const source = readFileSync(resolve(process.cwd(), "src/config/tabs/appearanceTab.ts"), "utf8");
        const processed = parse(source, {MOBILE: mobile, BROWSER: true}, false, true);
        const code = transpileModule(processed, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
        let mounted = false;
        const toolbarSettings = {
            genEntryVisibilityHtml: () => "toolbar-settings",
            mountEntryVisibility: () => {
                mounted = true;
            },
        };
        const moduleExports: {registerAppearanceTab?: (tab: unknown) => void} = {};
        runInNewContext(code, {
            exports: moduleExports,
            window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)}), config: {langs: []}}},
            require: (name: string) => name === "../entryVisibility/ui" ? toolbarSettings :
                new Proxy({}, {get: () => () => ({})}),
        });
        const groups: string[] = [];
        const slots: Array<{key: string; html: () => string; afterMount: () => void}> = [];
        const group = new Proxy({}, {
            get: (_, method) => (...args: unknown[]) => {
                if (method === "slot") {
                    slots.push(args[0] as typeof slots[number]);
                }
            },
        });
        moduleExports.registerAppearanceTab({group: (name: string) => {
            groups.push(name);
            return group;
        }});
        assert.deepEqual(groups, ["content", "interface", "controls"]);
        const entry = slots.find(item => item.key === "entryVisibility");
        assert.ok(entry);
        assert.equal(entry.html(), "toolbar-settings");
        entry.afterMount();
        assert.equal(mounted, true);
        assert.equal(slots.some(item => item.key === "mobileBottomBar"), mobile);
        assert.equal(slots.some(item => item.key === "mobileBarsAutoHide"), mobile);
        assert.equal(slots.some(item => item.key === "mobileSidebarAccess"), mobile);
    });
}

const createPendingFontMenu = (key: string) => {
    const listeners = new Map<string, () => Promise<void>>();
    const attributes = new Map<string, string>();
    const state = {opened: 0, focused: 0, items: 0};
    let resolveFonts: (fonts: unknown[]) => void;
    const input = {style: {removeProperty() {}}, isConnected: true,
        addEventListener: (name: string, callback: () => Promise<void>) => listeners.set(name, callback),
        getBoundingClientRect: () => ({left: 700, bottom: 200, height: 28})};
    const selected = {innerHTML: "", classList: {toggle() {}}, querySelectorAll: (): unknown[] => [], addEventListener() {}};
    const element = {
        contains: (target: unknown) => target === element,
        getAttribute: (name: string) => attributes.get(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        querySelector: (selector: string) => selector === ".b3-menu__items" ? {setAttribute() {}} :
            {focus: () => state.focused++},
    };
    const menu = {element, removeCB: undefined as (() => void),
        remove() {
            const callback = this.removeCB;
            this.removeCB = undefined;
            callback?.();
            attributes.clear();
        },
        addItem: () => state.items++, popup: () => state.opened++,
    };
    const window = {siyuan: {menus: {menu}, languages: {default: "Default"},
        config: {appearance: {globalFontFamilies: [] as unknown[]},
            editor: {fontFamilies: [] as unknown[], codeFontFamilies: [] as unknown[]}}}};
    const load = (file: string, modules: Record<string, unknown> = {}, suffix = "") => {
        const exports: Record<string, any> = {};
        runInNewContext(transpileModule(readFileSync(file, "utf8") + suffix, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText, {exports, window, CSS: {escape: (text: string) => text},
            getSelection: () => ({rangeCount: 0}), document: {}, require: (name: string) => modules[name] || {}});
        return exports;
    };
    const pluginMenu = load("src/plugin/Menu.ts");
    const click = load("src/menus/menuClick.ts", {
        "../protyle/util/hasClosest": {hasClosestByAttribute: (target: unknown) => target === input},
    });
    const appearance = load("src/config/tabs/appearanceTab.ts", {
        "../../plugin/Menu": pluginMenu,
        "../../util/customFont": {supportsCustomFonts: () => false},
        "../../util/systemFont": {loadSystemFonts: () => new Promise(resolve => { resolveFonts = resolve; })},
        "../../util/functions": {isMobile: () => false},
        "../../util/escape": {escapeAttr: (text: string) => text},
    }, "\nexports.mountAppearanceFontFamily = mountAppearanceFontFamily;");
    const root = {querySelector: () => ({querySelector: (selector: string) =>
        selector === '[data-type="selected-fonts"]' ? selected : input})};
    appearance.mountAppearanceFontFamily(root, key);
    return {state, element, input, finish: () => resolveFonts([]),
        outside: () => click.globalClickHideMenu({}),
        inside: () => click.globalClickHideMenu(element),
        trigger: () => click.globalClickHideMenu(input),
        open: () => (listeners.get("click") as (event: unknown) => Promise<void>)({stopPropagation() {}})};
};

for (const key of ["globalFontFamilies", "fontFamilies", "codeFontFamilies"]) {
    test(`outside clicks cancel pending ${key} menus without late reopening`, async () => {
        const menu = createPendingFontMenu(key);
        const opening = menu.open();
        menu.outside();
        menu.finish();
        await opening;
        assert.deepEqual(menu.state, {opened: 0, focused: 0, items: 0});
    });

    test(`repeated ${key} clicks toggle pending menus and allow later reopening`, async () => {
        const menu = createPendingFontMenu(key);
        const first = menu.open();
        await menu.open();
        menu.finish();
        await first;
        assert.equal(menu.state.opened, 0);
        const next = menu.open();
        menu.inside();
        menu.trigger();
        menu.finish();
        await next;
        assert.deepEqual(menu.state, {opened: 1, focused: 1, items: 1});
    });
}
