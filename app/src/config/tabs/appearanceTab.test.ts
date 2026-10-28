import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {genStackHtml} from "../render/render";
const {loadMenuToggle} = require("../../../tests/menu-toggle-fixture.cjs");

const {parse} = require("ifdef-loader/preprocessor");

for (const mobile of [true, false]) {
    test(`appearance settings expose toolbar controls and all color managers (mobile=${mobile})`, () => {
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
        const openedColors: string[] = [];
        const windowContext = {siyuan: {
            languages: new Proxy({}, {get: (_, key) => String(key)}),
            config: {langs: [] as unknown[], readonly: false},
            isPublish: false,
        }};
        const moduleExports: {registerAppearanceTab?: (tab: unknown) => void} = {};
        runInNewContext(code, {
            exports: moduleExports,
            window: windowContext,
            require: (name: string) => name === "./compactMode" ? {
                isCompactModeAvailable: () => !mobile,
                isCompactModeEnabled: () => false,
                setCompactModeEnabled: () => {},
            } : name === "../entryVisibility/ui" ? toolbarSettings :
                name === "../../protyle/toolbar/inlineStyleDialog" ? {
                    openInlineStyleDialog: (type: string) => openedColors.push(type),
                } : name === "../render/render" ? {genStackHtml} :
                new Proxy({}, {get: () => () => ({})}),
        });
        const groups: string[] = [];
        const slots: Array<{key: string; keywords: string[]; html: () => string; afterMount: (root?: unknown) => void}> = [];
        const switches: Array<{id: string; spec: {title: string; readConfig?: () => boolean; save?: unknown}}> = [];
        const group = new Proxy({}, {
            get: (_, method) => (...args: unknown[]) => {
                if (method === "slot") {
                    slots.push(args[0] as typeof slots[number]);
                } else if (method === "switch") {
                    switches.push({id: args[0] as string, spec: args[1] as typeof switches[number]["spec"]});
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
        assert.equal(switches.some(item => item.id === "pageScrollButtons" || item.id === "editor.pageScrollButtons"), false);
        assert.equal(switches.some(item => item.id === "compactMode"), !mobile);
        const colors = slots.find(item => item.key === "manageColors");
        assert.ok(colors);
        assert.equal(colors.keywords.join(","), "manageColors,color,colorFont,colorPrimary");
        const html = colors.html();
        assert.equal((html.match(/<button /g) || []).length, 3);
        assert.equal((html.match(/xlink:href="#iconSettings"/g) || []).length, 3);
        const buttons = new Map(["style1", "color", "backgroundColor"].map(type => {
            const selector = `#manageColors-${type}`;
            assert.ok(html.includes(`id="${selector.slice(1)}"`));
            return [selector, {disabled: true, click: () => {},
                addEventListener(_name: string, listener: () => void) { this.click = listener; }}] as const;
        }));
        const root = {querySelector: (selector: string) => buttons.get(selector)};
        colors.afterMount(root);
        buttons.forEach(button => {
            assert.equal(button.disabled, false);
            button.click();
        });
        assert.deepEqual(openedColors, ["style1", "color", "backgroundColor"]);
        windowContext.siyuan.config.readonly = true;
        colors.afterMount(root);
        buttons.forEach(button => assert.equal(button.disabled, true));
        windowContext.siyuan.config.readonly = false;
        windowContext.siyuan.isPublish = true;
        colors.afterMount(root);
        buttons.forEach(button => assert.equal(button.disabled, true));
    });
}

const createPendingFontMenu = (key: string) => {
    const listeners = new Map<string, () => Promise<void>>();
    const attributes = new Map<string, string>();
    const state = {opened: 0, focused: 0, items: 0};
    let visible = false;
    let innerScroll = false;
    let resolveFonts: (fonts: unknown[]) => void;
    const input = {style: {removeProperty() {}}, isConnected: true, closest: (): null => null, setAttribute() {},
        addEventListener: (name: string, callback: () => Promise<void>) => listeners.set(name, callback),
        getBoundingClientRect: () => ({left: 700, bottom: 200, height: 28})};
    const selected = {innerHTML: "", classList: {toggle() {}}, querySelectorAll: (): unknown[] => [], addEventListener() {}};
    const element = {
        classList: {contains: () => !visible},
        contains: (target: unknown) => target === element,
        getAttribute: (name: string) => attributes.get(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        querySelector: () => ({focus: () => state.focused++}),
    };
    const menu = {element, data: undefined as Element, removeCB: undefined as (() => void),
        remove() {
            visible = false;
            innerScroll = false;
            this.data = undefined;
            const callback = this.removeCB;
            this.removeCB = undefined;
            callback?.();
            attributes.clear();
        },
        addItem: () => state.items++, popup: () => {
            assert.equal(innerScroll, true, "enable inner scrolling before measuring the font menu");
            visible = true;
            state.opened++;
        },
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
        "../../menus/menuToggle": loadMenuToggle({window}),
        "../../menus/Menu": {markMenuInnerScroll: (target: unknown) => {
            assert.equal(target, element);
            innerScroll = true;
        }},
        "../../plugin/Menu": pluginMenu,
        "../../util/availableFont": {loadAvailableFonts: () => new Promise(resolve => {
            resolveFonts = fonts => resolve({customFontSupported: false, customFonts: [], fontItems: fonts});
        })},
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
