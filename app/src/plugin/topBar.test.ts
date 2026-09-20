import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {setTopBarContextMenu, fillTopBarContextMenu} from "./topBarContextMenu";
import {getLegacyPluginTopBarEntryKey, getPluginTopBarEntryKey} from "./topBarKey";

const buildPluginMenu = (counts: number[], settings: boolean[], mobile = false, readonly = false,
                        initiallyUnpinned: string[] = []) => {
    const items: IMenu[] = [];
    const opened: number[] = [];
    const clicked: string[] = [];
    const unpinned = [...initiallyUnpinned];
    const mounted: string[] = [];
    const plugins = counts.map((count, index) => ({
        name: `plugin${index}`,
        displayName: `Plugin ${index}`,
        setting: settings[index],
        openSetting: () => opened.push(index),
        topBarIcons: Array.from({length: count}, (_, button) => ({
            id: `button${index}_${button}`,
            textContent: `Button ${index}_${button}`,
            getAttribute: () => `Button ${index}_${button}`,
            querySelector: (): null => null,
            dispatchEvent() { clicked.push(this.id); },
            classList: {add() {}, remove() {}},
        })),
    }));
    const addItem = (item: IMenu) => {
        if (item.ignore) {
            return;
        }
        items.push(item);
        return {remove: () => items.splice(items.indexOf(item), 1)};
    };
    const dependencies = {
        Menu: class {
            addItem = addItem;
            addSeparator(options: IMenu) { return addItem({...options, type: "separator"}); }
            open() {}
            fullscreen() {}
        },
        Constants: {LOCAL_PLUGINTOPUNPIN: "unpinned"},
        isBazaarAvailable: () => true,
        isMobile: () => mobile,
        hasPluginSetting: (plugin: typeof plugins[number]) => plugin.setting,
        setStorageVal() {},
    };
    const source = readFileSync(resolve(process.cwd(), "src/plugin/openTopBarMenu.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    const exports: {openTopBarMenu?: typeof import("./openTopBarMenu").openTopBarMenu} = {};
    runInNewContext(compiled, {
        exports,
        require: () => dependencies,
        CustomEvent: class {},
        document: {
            contains: (item: {id: string}) => !initiallyUnpinned.includes(item.id) || mounted.includes(item.id),
            getElementById: () => ({after: (item: {id: string}) => mounted.push(item.id)}),
        },
        window: {siyuan: {languages: {}, config: {readonly}, storage: {unpinned}}},
    });
    const target = {getBoundingClientRect: () => ({width: 10, right: 10, bottom: 10, height: 10})};
    exports.openTopBarMenu({plugins} as never, mobile ? undefined : target as never);
    return {items, opened, clicked, unpinned, mounted, plugins};
};

test("plugin settings appear once after all top bar buttons", () => {
    const {items, opened, clicked} = buildPluginMenu([0, 2, 1], [true, true, false]);
    assert.deepEqual(items.map(item => item.id), [
        "manage", "separator_1", "button1_0", "button1_1", "button2_0",
        "separator_settings", "plugin0", "plugin1",
    ]);
    const button = items.find(item => item.id === "button1_0");
    assert.equal(button.submenu, undefined);
    button.click(undefined, undefined);
    items.find(item => item.id === "plugin1").click(undefined, undefined);
    assert.deepEqual(clicked, ["button1_0"]);
    assert.deepEqual(opened, [1]);
});

test("plugin menu omits separators for missing groups and preserves empty state", () => {
    for (const readonly of [false, true]) {
        for (const [counts, settings] of [[[0], [true]], [[1], [false]], [[], []]] as [number[], boolean[]][]) {
            const {items} = buildPluginMenu(counts, settings, false, readonly);
            assert.equal(items.some(item => item.id === "separator_settings"), false);
            assert.notEqual(items[0]?.type, "separator");
            assert.notEqual(items.at(-1)?.type, "separator");
        }
    }
    assert.deepEqual(buildPluginMenu([], [], true, true).items.map(item => item.id), ["emptyContent"]);
});

test("mobile plugin buttons retain pinning and execution separately from settings", () => {
    const {items, opened, clicked, unpinned} = buildPluginMenu([1], [true], true);
    const button = items.find(item => item.id === "button0_0");
    assert.deepEqual(Array.from(button.submenu, item => item.id), ["unpin", "play"]);
    button.submenu[0].click(undefined, undefined);
    button.submenu[1].click(undefined, undefined);
    items.find(item => item.id === "plugin0").click(undefined, undefined);
    assert.deepEqual(unpinned, ["button0_0"]);
    assert.deepEqual(clicked, ["button0_0"]);
    assert.deepEqual(opened, [0]);
});

test("unpinned mobile buttons remain registered and can be mounted again", () => {
    const {items, unpinned, mounted, plugins, clicked} = buildPluginMenu([1], [false], true, false, ["button0_0"]);
    const button = items.find(item => item.id === "button0_0");
    assert.equal(plugins[0].topBarIcons.length, 1);
    assert.deepEqual(Array.from(button.submenu, item => item.id), ["pin", "play"]);
    button.submenu[1].click(undefined, undefined);
    assert.deepEqual(clicked, ["button0_0"]);
    button.submenu[0].click(undefined, undefined);
    assert.deepEqual(unpinned, []);
    assert.deepEqual(mounted, ["button0_0"]);
});

class TestElement {
    public attributes = new Map<string, string>();
    public className = "custom";
    public innerHTML = "Countdown";
    public onclick = () => "clicked";
    public replacement?: TestElement;
    public removed = false;
    public parentElement?: TestElement;

    get id() { return this.getAttribute("id"); }
    set id(value: string) { this.setAttribute("id", value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    replaceWith(element: TestElement) { this.replacement = element; }
    remove() { this.removed = true; }
}

const setup = (mobile = false, detached = false, mounted = false) => {
    const source = readFileSync(resolve(process.cwd(), "src/plugin/index.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    let refreshes = 0;
    const toolbar = new TestElement();
    const insertions: string[] = [];
    const dependencies = {
        setTopBarContextMenu,
        isMobile: () => mobile,
        isWindow: () => detached,
        getPluginTopBarEntryKey,
        getLegacyPluginTopBarEntryKey,
        applyTopBarEntryVisibility: () => refreshes++,
        resizeTopBar: (): void => undefined,
        setTabPosition: (): void => undefined,
    };
    const exports: {Plugin?: typeof import("./index").Plugin} = {};
    runInNewContext(compiled, {
        exports,
        require: () => dependencies,
        console: {error: (): void => undefined},
        document: {
            createElement: () => new TestElement(),
            contains: (element: TestElement) => !!element.parentElement,
            getElementById: () => toolbar,
            querySelector: (selector: string) => ({before: (element: TestElement) => {
                insertions.push(selector);
                element.parentElement = toolbar;
            }}),
        },
        window: {siyuan: {storage: mounted ? {} : undefined}},
    });
    const plugin = Object.create(exports.Plugin.prototype);
    Object.assign(plugin, {name: "test", topBarIcons: [], customTopBarElements: new WeakSet()});
    return {plugin, toolbar, insertions, refreshes: () => refreshes};
};

test("context menu callbacks are isolated and cleared on update, replacement and removal", () => {
    const {plugin} = setup();
    const calls: string[] = [];
    const menu = {} as import("../menus/Menu").subMenu;
    const first = plugin.addTopBar({id: "first", title: "First", icon: "iconClock", contextMenu: () => calls.push("first")});
    const second = plugin.addTopBar({id: "second", title: "Second", icon: "iconClock", contextMenu: () => calls.push("second")});
    fillTopBarContextMenu(first, menu);
    assert.deepEqual(calls, ["first"]);
    plugin.addTopBar({id: "first", title: "Updated", icon: "iconClock", contextMenu: () => calls.push("updated")});
    fillTopBarContextMenu(first, menu);
    plugin.addTopBar({id: "first", title: "Cleared", icon: "iconClock"});
    fillTopBarContextMenu(first, menu);
    const custom = plugin.addTopBar({id: "second", title: "Custom", element: new TestElement(), contextMenu: () => calls.push("custom")});
    fillTopBarContextMenu(second, menu);
    fillTopBarContextMenu(custom, menu);
    plugin.removeTopBar("second");
    fillTopBarContextMenu(custom, menu);
    assert.deepEqual(calls, ["first", "updated", "custom"]);
});

test("custom top bar preserves content and handlers and registers a configurable entry", () => {
    const {plugin, refreshes} = setup();
    const element = new TestElement();
    const onclick = element.onclick;
    assert.equal(plugin.addTopBar({id: "timer", title: "Timer", element, icon: "invalid", callback: (): void => undefined}), element);
    assert.equal(element.className, "custom");
    assert.equal(element.innerHTML, "Countdown");
    assert.equal(element.onclick, onclick);
    assert.equal(element.getAttribute("data-menu"), null);
    assert.equal(element.getAttribute("data-topbar-custom"), "true");
    assert.equal(element.id, "plugin_test:timer");
    assert.equal(element.getAttribute("data-id"), "timer");
    assert.equal(element.getAttribute("data-topbar-entry"), getPluginTopBarEntryKey("test", "timer"));
    assert.equal(element.getAttribute("data-location"), "right");
    assert.equal(element.getAttribute("aria-label"), "Timer");
    assert.equal(refreshes(), 1);
});

test("same ID replaces custom elements and supports switching between icons and custom content", () => {
    const {plugin} = setup();
    const icon = plugin.addTopBar({id: "timer", title: "Icon", icon: " iconClock "});
    const element = new TestElement();
    plugin.addTopBar({id: "timer", title: "Timer", element, position: "left"});
    assert.equal(icon.replacement, element);
    assert.equal(plugin.topBarIcons.length, 1);
    assert.equal(element.getAttribute("data-location"), "left");
    assert.equal(plugin.addTopBar({id: "timer", title: "Updated", element}), element);
    const replacement = new TestElement();
    plugin.addTopBar({id: "timer", title: "Replacement", element: replacement});
    assert.equal(element.replacement, replacement);
    const newIcon = plugin.addTopBar({id: "timer", title: "Icon", icon: "iconClock"});
    assert.equal(replacement.replacement, newIcon);
    assert.equal(replacement.innerHTML, "Countdown");
    assert.equal(newIcon.className, "toolbar__item ariaLabel");
    assert.equal(newIcon.getAttribute("data-topbar-custom"), null);
    assert.equal(plugin.topBarIcons.length, 1);
    plugin.removeTopBar("timer");
    assert.equal(newIcon.removed, true);
    assert.equal(plugin.topBarIcons.length, 0);
});

test("custom elements without IDs receive distinct legacy keys", () => {
    const {plugin} = setup();
    const first = plugin.addTopBar({title: "First", element: new TestElement()});
    const second = plugin.addTopBar({title: "Second", element: new TestElement()});
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.getAttribute("data-topbar-entry"), second.getAttribute("data-topbar-entry"));
});

test("unsupported windows skip custom entries and missing icons are rejected", () => {
    for (const {plugin} of [setup(true), setup(false, true)]) {
        assert.equal(plugin.addTopBar({title: "Timer", element: new TestElement()}), undefined);
        assert.equal(plugin.topBarIcons.length, 0);
    }
    const {plugin} = setup();
    assert.equal(plugin.addTopBar({title: "Missing"}), undefined);
    assert.equal(plugin.topBarIcons.length, 0);
});

test("reusing an element keeps a single registration and rejects conflicting IDs", () => {
    const {plugin} = setup();
    const element = new TestElement();
    plugin.addTopBar({title: "Timer", element});
    const id = element.id;
    plugin.addTopBar({title: "Updated", element});
    assert.equal(element.id, id);
    assert.equal(plugin.topBarIcons.length, 1);
    assert.equal(plugin.addTopBar({id: "other", title: "Conflict", element}), undefined);
    assert.equal(element.id, id);
    assert.equal(plugin.topBarIcons.length, 1);
});

test("custom elements move into the toolbar and keep their slot until their side changes", () => {
    const {plugin, toolbar, insertions} = setup(false, false, true);
    const element = new TestElement();
    element.parentElement = new TestElement();
    plugin.addTopBar({id: "timer", title: "Timer", element});
    assert.equal(element.parentElement, toolbar);
    assert.deepEqual(insertions, ["#barPlugins"]);
    plugin.addTopBar({id: "timer", title: "Updated", element});
    assert.deepEqual(insertions, ["#barPlugins"]);
    plugin.addTopBar({id: "timer", title: "Left", element, position: "left"});
    assert.deepEqual(insertions, ["#barPlugins", "#drag"]);
});

test("visibility menu leaves custom controls blank while preserving ordinary plugin icons", () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/menu.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    const custom = new TestElement();
    custom.setAttribute("data-topbar-entry", "custom");
    custom.setAttribute("data-topbar-custom", "true");
    Object.assign(custom, {querySelector: () => { throw new Error("Custom content must not be inspected"); }});
    const icon = new TestElement();
    icon.setAttribute("data-topbar-entry", "icon");
    Object.assign(icon, {querySelector: (selector: string) => selector === "use" ?
        {getAttribute: () => "#iconClock"} : null});
    const dependencies = {
        TOP_BAR_ROOT_PATH: "topBar",
        isInMobileApp: () => false,
        STATUS_BAR_ROOT_PATH: "statusBar",
        buildEntryVisibilityMenuItems: (_path: string, runtime: {getEntryIcon: (path: string) => object}) => [
            runtime.getEntryIcon("topBar.custom"), runtime.getEntryIcon("topBar.icon"),
        ],
    };
    const exports: {buildEntryVisibilityMenuItems?: (path: string) => Array<Pick<IMenu, "icon" | "iconHTML">>} = {};
    runInNewContext(compiled, {
        exports,
        require: () => dependencies,
        document: {querySelectorAll: () => [custom, icon]},
        window: {siyuan: {config: {readonly: false}, languages: {}}},
    });
    const items = exports.buildEntryVisibilityMenuItems("topBar");
    assert.equal(Object.keys(items[0]).length, 0);
    assert.equal(items[1].icon, "iconClock");
});

test("plugin menu supports custom content without SVG icons", () => {
    const source = readFileSync(resolve(process.cwd(), "src/plugin/openTopBarMenu.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    const items: IMenu[] = [];
    const dependencies = {
        Menu: class {
            addItem(item: IMenu) { items.push(item); }
            addSeparator(): void { return undefined; }
            open(): void { return undefined; }
        },
        Constants: {},
        isBazaarAvailable: () => true,
        isMobile: () => false,
        isInMobileApp: () => false,
        hasPluginSetting: () => false,
    };
    const exports: {openTopBarMenu?: typeof import("./openTopBarMenu").openTopBarMenu} = {};
    runInNewContext(compiled, {
        exports,
        require: () => dependencies,
        document: {contains: () => true},
        window: {siyuan: {languages: {}, config: {readonly: false}}},
    });
    const element = new TestElement();
    element.id = "plugin_test:timer";
    element.setAttribute("aria-label", "Timer");
    Object.assign(element, {querySelector: (): null => null});
    const target = {getBoundingClientRect: () => ({width: 10, right: 10, bottom: 10, height: 10})};
    exports.openTopBarMenu({plugins: [{topBarIcons: [element]}]} as never, target as never);
    const item = items.find(entry => entry.id === element.id);
    assert.equal(item.label, "Timer");
    assert.equal(item.icon, "iconInfo");
    assert.equal(item.iconHTML, undefined);
});
