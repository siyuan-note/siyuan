import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {getLegacyPluginTopBarEntryKey, getPluginTopBarEntryKey} from "./topBarKey";

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
