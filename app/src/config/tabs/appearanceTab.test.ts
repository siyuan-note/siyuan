import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {genStackHtml} from "../render/render";
const {loadMenuToggle} = require("../../../tests/menu-toggle-fixture.cjs");

const {parse} = require("ifdef-loader/preprocessor");

test("mobile workspace global font picker shows system fonts without custom fonts and persists selection", async () => {
    const font = {family: "Mobile System Sans", displayName: "Mobile System Sans Regular", weight: 400};
    const config = {appearance: {globalFontFamilies: [] as typeof font[]}, editor: {fontFamilies: [] as typeof font[], codeFontFamilies: [] as typeof font[]}};
    const window = {siyuan: {config, languages: new Proxy({}, {get: (_, key) => String(key)})}};
    const load = (file: string, modules: Record<string, unknown>, suffix = "") => {
        const exports: Record<string, any> = {};
        runInNewContext(transpileModule(readFileSync(file, "utf8") + suffix, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText, {exports, window, console, CSS: {escape: (value: string) => value},
            document: {createTextNode: (value: string) => value, querySelectorAll: (): unknown[] => []},
            require: (name: string) => modules[name] || {}});
        return exports;
    };
    let systemLoads = 0;
    let customLoads = 0;
    const available = load("src/util/availableFont.ts", {
        "./systemFont": {loadSystemFonts: async () => {systemLoads++; return [font];}},
        "./customFont": {supportsCustomFonts: () => true, loadCustomFonts: async (): Promise<unknown[]> => {customLoads++; return [];}, syncCustomFonts() {}},
    });
    let open: (event: unknown) => Promise<void>;
    let click: (event: unknown) => void;
    let checked = false;
    let hidden = false;
    const label = {dataset: {family: font.family, weight: "400", name: font.displayName, search: font.displayName.toLowerCase()},
        replaceChildren() {}, parentElement: undefined as unknown};
    const item = {dataset: {}, querySelector: (selector: string) => selector === ".b3-menu__label" ? label :
        checked ? {remove: () => {checked = false;}} : undefined,
    insertAdjacentHTML: () => {checked = true;},
    classList: {add() {}, remove() {}, toggle: (_name: string, value: boolean) => {hidden = value;}}};
    label.parentElement = item;
    const list = {querySelectorAll: (selector: string) => selector === ".b3-list-item" ? [item] : [label],
        querySelector: () => item, addEventListener: (name: string, handler: typeof click) => {if (name === "click") click = handler;}};
    const search = {value: "", addEventListener() {}, focus: () => assert.fail("mobile picker must not force keyboard focus")};
    const menuBody = {querySelector: (selector: string) => selector === '[data-type="available-fonts"]' ? list :
        selector === '[data-type="font-search"]' ? search : undefined};
    const selected = {innerHTML: "", classList: {toggle() {}}, querySelectorAll: (): unknown[] => [], addEventListener() {}};
    const input = {value: "", isConnected: true, style: {removeProperty() {}},
        addEventListener: (_name: string, callback: typeof open) => {open = callback;},
        getBoundingClientRect: () => ({left: 0, bottom: 100, height: 28})};
    const fontElement = {querySelector: (selector: string) => selector === '[data-type="selected-fonts"]' ? selected : input};
    const writes: Array<{key: string; fonts: typeof font[]}> = [];
    let opened = false;
    class FontMenu {
        isOpen = false;
        element = menuBody;
        addItem(option: {label: string; bind(element: unknown): void}) {
            assert.ok(option.label.includes(`data-family="${font.family}"`), "system family is rendered in the menu");
            assert.ok(!option.label.includes('data-type="delete-font"'), "system fonts are not treated as imported custom fonts");
            option.bind(menuBody);
        }
        open() {opened = true;}
    }
    const appearance = load("src/config/tabs/appearanceTab.ts", {
        "../../util/availableFont": available,
        "../../menus/menuToggle": {toggleMenu: async (options: {build(menu: unknown, session: unknown): Promise<void>}) =>
            options.build(undefined, {isCurrent: () => true, show: (callback: () => void) => callback()})},
        "../../menus/Menu": {markMenuInnerScroll() {}},
        "../../plugin/Menu": {Menu: FontMenu},
        "../../util/functions": {isMobile: () => true},
        "../../util/escape": {escapeAttr: (value: string) => value, escapeHtml: (value: string) => value},
        "../../util/fontPreview": {observeFontPreview: () => () => {}},
        "./appearanceRuntime": {appearanceConfigApi: {patch: (key: string, fonts: typeof font[], refresh: () => void) => {
            writes.push({key, fonts}); config.appearance.globalFontFamilies = fonts; refresh(); return Promise.resolve();
        }}},
        "./editorRuntime": {editorConfigApi: {patch: () => assert.fail("global font must use appearance configuration")}},
    }, "\nexports.mountAppearanceFontFamily = mountAppearanceFontFamily;");
    appearance.mountAppearanceFontFamily({querySelector: () => fontElement}, "globalFontFamilies");
    await open({stopPropagation() {}});
    assert.equal(opened, true);
    assert.equal(systemLoads, 1);
    assert.equal(customLoads, 1);
    assert.equal(hidden, false);
    click({target: {closest: (selector: string) => selector === ".b3-list-item" ? item : undefined}});
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, "globalFontFamilies");
    assert.deepEqual(JSON.parse(JSON.stringify(writes[0].fonts)), [font]);
    assert.equal(checked, true);
    assert.ok(selected.innerHTML.includes(font.family));
    assert.equal(input.value, font.displayName);
});

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
                } else if (method === "stack" && (args[0] as {key: string}).key === "statusBar") {
                    (args[1] as (stack: unknown) => void)(group);
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
        assert.equal(switches.some(item => item.id === "appearance.showFloatingDockBar"), !mobile);
        assert.equal(switches.some(item => item.id === "appearance.showFloatingStatusBar"), !mobile);
        if (!mobile) {
            const toolbarIndex = switches.findIndex(item => item.id === "appearance.hideToolbar");
            assert.equal(switches[toolbarIndex + 1].id, "appearance.showFloatingDockBar");
        }
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

for (const field of ["statusBar", "notifications"] as const) {
    test(`${field} mobile close waits for persistence and preserves a failed draft`, async () => {
        const statusKeys = ["msgTaskDatabaseIndexCommitDisabled", "msgTaskAssetDatabaseIndexCommitDisabled",
            "msgTaskHistoryDatabaseIndexCommitDisabled", "msgTaskHistoryGenerateFileDisabled", "msgDataSyncDisabled"];
        const notificationKeys = ["docTreeMaxList", "tagMaxList", "workspaceNotSSD", "browserCompatibility",
            "selectAllTip", "selectAllIncompleteTip", "formatPainterTip"];
        const keys = field === "statusBar" ? statusKeys : notificationKeys;
        const config = {statusBar: Object.fromEntries(statusKeys.map(key => [key, false])),
            notifications: Object.fromEntries(notificationKeys.map(key => [key, true]))};
        const inputs = new Map(keys.map(key => [key, {checked: true}]));
        let open: () => void;
        let options: {mobileSheet: {beforeClose: () => Promise<boolean>}; destroyCallback: () => void};
        let writes = 0;
        let release: () => void;
        let fail = true;
        const exports: Record<string, (root: unknown) => void> = {};
        const source = readFileSync("src/config/tabs/appearanceTab.ts", "utf8") +
            "\nexports.mountStatus = mountAppearanceSetStatusBar; exports.mountNotifications = mountAppearanceSetNotifications;";
        runInNewContext(transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, {
            exports, CSS: {escape: (value: string) => value},
            window: {siyuan: {config: {appearance: config}, languages: new Proxy({}, {get: () => ({})})}},
            require: (name: string) => name === "../../dialog/mobileDialog" ? {
                MobileDialog: class {
                    element = {querySelector: (selector: string) => inputs.get(selector.slice(1))};
                    constructor(value: typeof options) { options = value; }
                },
            } : name === "../../util/functions" ? {
                isMobile: () => true,
                objEquals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
            } : name === "./appearanceRuntime" ? {appearanceConfigApi: {
                patch: async (key: typeof field, value: Record<string, boolean>) => {
                    writes++;
                    await new Promise<void>(resolve => { release = resolve; });
                    if (fail) throw new Error("save failed");
                    config[key] = value;
                },
            }} : name === "../render/fragments" ? {genListSwitchItemHtml: () => ""} : {},
        });
        exports[field === "statusBar" ? "mountStatus" : "mountNotifications"]({querySelector: () => ({
            addEventListener: (_event: string, callback: () => void) => { open = callback; },
        })});
        open();
        assert.equal(await options.mobileSheet.beforeClose(), true);
        assert.equal(writes, 0, "unchanged close does not write");
        inputs.get(keys[0]).checked = !inputs.get(keys[0]).checked;
        const failed = options.mobileSheet.beforeClose();
        assert.equal(writes, 1);
        release();
        await assert.rejects(failed, /save failed/);
        assert.equal(config[field][keys[0]], field !== "statusBar");
        assert.equal(inputs.get(keys[0]).checked, false);
        fail = false;
        const retry = options.mobileSheet.beforeClose();
        release();
        assert.equal(await retry, true);
        assert.equal(config[field][keys[0]], field === "statusBar");
        options.destroyCallback();
        assert.equal(writes, 2, "mobile destroy does not issue another save");
    });
}

const createPendingFontMenu = (key: string) => {
    const document: {defaultView?: unknown} = {};
    const listeners = new Map<string, () => Promise<void>>();
    const attributes = new Map<string, string>();
    const state = {opened: 0, focused: 0, items: 0};
    let visible = false;
    let innerScroll = false;
    let resolveFonts: (fonts: unknown[]) => void;
    const input = {ownerDocument: document, style: {removeProperty() {}}, isConnected: true, closest: (): null => null, setAttribute() {},
        addEventListener: (name: string, callback: () => Promise<void>) => listeners.set(name, callback),
        getBoundingClientRect: () => ({left: 700, bottom: 200, height: 28})};
    const selected = {innerHTML: "", classList: {toggle() {}}, querySelectorAll: (): unknown[] => [], addEventListener() {}};
    const element = {
        ownerDocument: document,
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
    const window = {document, siyuan: {menus: {menu}, languages: {default: "Default"},
        config: {appearance: {globalFontFamilies: [] as unknown[]},
            editor: {fontFamilies: [] as unknown[], codeFontFamilies: [] as unknown[]}}}};
    document.defaultView = window;
    const load = (file: string, modules: Record<string, unknown> = {}, suffix = "") => {
        const exports: Record<string, any> = {};
        runInNewContext(transpileModule(readFileSync(file, "utf8") + suffix, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText, {exports, window, CSS: {escape: (text: string) => text},
            getSelection: () => ({rangeCount: 0}), document, require: (name: string) => modules[name] || {}});
        return exports;
    };
    const pluginMenu = load("src/plugin/Menu.ts", {
        "../menus/overlayOwnership": load("src/menus/overlayOwnership.ts"),
    });
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
        outside: () => click.globalClickHideMenu({ownerDocument: document}),
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
