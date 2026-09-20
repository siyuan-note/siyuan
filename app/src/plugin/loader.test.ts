import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {getPluginDockEntryKey} from "./dockKey";
import {updatePluginDockShowStates} from "../layout/dock/pluginDockState";

const source = readFileSync(resolve(process.cwd(), "src/plugin/loader.ts"), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;

const createConfig = (): IPluginDockTab => ({
    position: "LeftTop",
    index: 1000,
    size: {width: 200, height: 240},
    show: true,
    icon: "iconClock",
    title: "Updated dock",
    hotkey: "new-hotkey",
});

const setup = (saved?: Partial<IPluginDockTab>, layoutTab?: Config.IUILayoutDockTab, visible = true) => {
    const plugin = {
        name: "sample",
        docks: {sampledock: {id: "stable-id", config: createConfig()}},
    };
    const storage: Record<string, Record<string, Partial<IPluginDockTab>>> = saved ? {sample: {sampledock: saved}} : {};
    const persisted: typeof storage[] = [];
    const mounted = new Set<string>();
    const buttons: Array<{
        position: TDockPosition,
        partition: number,
        index: number,
        tab: Config.IUILayoutDockTab & {entryId: string},
    }> = [];
    const createDock = (position: TDockPosition) => ({
        genButton: (tabs: Array<Config.IUILayoutDockTab & {entryId: string}>, partition: number, index: number) => {
            tabs.forEach(tab => {
                mounted.add(tab.type);
                buttons.push({position, partition, index, tab: structuredClone(tab)});
            });
        },
    });
    const dependencies = {
        Constants: {LOCAL_PLUGIN_DOCKS: "local-plugin-docks"},
        isWindow: () => false,
        getPluginDockEntryKey,
        refreshDockCatalog: (): void => undefined,
        dispatchMobilePluginDocksChange: (): void => undefined,
        applyDockEntryVisibility: (): void => undefined,
        isEntryVisible: () => visible,
        setStorageVal: (_key: string, value: typeof storage) => persisted.push(structuredClone(value)),
    };
    const exports: {addPluginDock?: typeof import("./loader").addPluginDock} = {};
    runInNewContext(compiled, {
        exports,
        require: () => dependencies,
        window: {siyuan: {
            ws: {app: {plugins: [plugin]}},
            storage: {"local-plugin-docks": storage},
            layout: {leftDock: createDock("Left"), rightDock: createDock("Right"), bottomDock: createDock("Bottom")},
            config: {uiLayout: {
                left: {data: []},
                right: {data: []},
                bottom: {data: layoutTab ? [[], [layoutTab]] : []},
            }},
        }},
        document: {
            querySelector: (selector: string) => mounted.has(selector.match(/data-type="([^"]+)"/)[1]) ? {} : null,
        },
    });
    const load = () => exports.addPluginDock(plugin as never);
    return {plugin, storage, persisted, buttons, load};
};

test("new plugin docks use the registered metadata and layout", () => {
    const {load, buttons} = setup();
    load();
    assert.deepEqual(buttons, [{
        position: "Left",
        partition: 0,
        index: 1000,
        tab: {
            type: "sampledock",
            entryId: getPluginDockEntryKey("sample", "stable-id"),
            icon: "iconClock",
            title: "Updated dock",
            size: {width: 200, height: 240},
            show: true,
        },
    }]);
});

test("cached dock layout preserves placement while plugin metadata updates across reloads", () => {
    let saved: Partial<IPluginDockTab> = {
        position: "RightBottom",
        index: 0,
        size: {width: 444, height: 333},
        show: false,
        icon: "iconInfo",
        title: "Old dock",
        hotkey: "old-hotkey",
    };
    for (const icon of ["iconClock", "iconInfo"]) {
        const {load, plugin, storage, persisted, buttons} = setup(saved);
        plugin.docks.sampledock.config.icon = icon;
        plugin.docks.sampledock.config.title = icon;
        load();
        assert.equal(buttons[0].tab.icon, icon);
        assert.equal(buttons[0].tab.title, icon);
        assert.equal(buttons[0].tab.entryId, getPluginDockEntryKey("sample", "stable-id"));
        assert.equal(buttons[0].tab.type, "sampledock");
        assert.equal(buttons[0].position, "Right");
        assert.equal(buttons[0].partition, 1);
        assert.equal(buttons[0].index, 0);
        assert.equal(buttons[0].tab.show, false);
        assert.deepEqual(buttons[0].tab.size, {width: 444, height: 333});
        assert.equal(plugin.docks.sampledock.config.hotkey, "new-hotkey");
        assert.equal(storage.sample.sampledock, plugin.docks.sampledock.config);
        saved = persisted.at(-1).sample.sampledock;
        assert.equal(saved.icon, icon);
        assert.equal(saved.title, icon);
        load();
        assert.equal(buttons.length, 1);
    }
});

test("partial cached layout keeps new defaults and does not restore removed metadata", () => {
    const {load, plugin, buttons} = setup({index: 0, show: false, size: {width: 444}, hotkey: "old-hotkey"});
    delete plugin.docks.sampledock.config.hotkey;
    load();
    assert.equal(buttons[0].position, "Left");
    assert.equal(buttons[0].index, 0);
    assert.equal(buttons[0].tab.show, false);
    assert.deepEqual(buttons[0].tab.size, {width: 444, height: 240});
    assert.equal(plugin.docks.sampledock.config.hotkey, undefined);
});

test("cached automatic dimensions remain null", () => {
    const {load, buttons} = setup({size: {width: null}});
    load();
    assert.deepEqual(buttons[0].tab.size, {width: null, height: 240});
});

test("saved UI layout updates placement while cached size and show remain authoritative", () => {
    const {load, buttons, storage} = setup({
        ...createConfig(), position: "RightTop", size: {width: 444, height: 333}, icon: "iconInfo", title: "Cached dock",
    }, {
        type: "sampledock", icon: "iconInfo", title: "Layout dock", show: false, size: {width: 500, height: 300},
    });
    load();
    assert.equal(buttons[0].position, "Bottom");
    assert.equal(buttons[0].partition, 1);
    assert.equal(buttons[0].index, 0);
    assert.equal(buttons[0].tab.icon, "iconClock");
    assert.equal(buttons[0].tab.title, "Updated dock");
    assert.equal(buttons[0].tab.show, true);
    assert.deepEqual(buttons[0].tab.size, {width: 444, height: 333});
    assert.equal(storage.sample.sampledock.position, "BottomRight");
});

test("layout snapshots seed missing cache fields without replacing explicit false or null", () => {
    const layoutTab = {
        type: "sampledock", show: true, size: {width: 500, height: 300},
    };
    const fresh = setup(undefined, layoutTab);
    fresh.plugin.docks.sampledock.config.show = false;
    fresh.load();
    assert.deepEqual(fresh.buttons[0].tab.size, layoutTab.size);
    assert.equal(fresh.buttons[0].tab.show, true);

    const partial = setup({show: false, size: {width: null}}, layoutTab);
    partial.load();
    assert.equal(partial.buttons[0].tab.show, false);
    assert.deepEqual(partial.buttons[0].tab.size, {width: null, height: 300});
});

test("invalid snapshot dimensions do not erase cached dimensions or registered defaults", () => {
    const layoutTab = {
        type: "sampledock", show: false, size: {width: NaN, height: Infinity},
    };
    const cached = setup({show: true, size: {width: 444}}, layoutTab);
    cached.load();
    assert.deepEqual(cached.buttons[0].tab.size, {width: 444, height: 240});
    assert.equal(cached.buttons[0].tab.show, true);

    const fresh = setup(undefined, layoutTab);
    fresh.load();
    assert.deepEqual(fresh.buttons[0].tab.size, {width: 200, height: 240});
});

test("entry visibility suppresses opening without overwriting the saved open state", () => {
    const {load, buttons, plugin} = setup({...createConfig(), icon: "iconInfo"}, undefined, false);
    load();
    assert.equal(buttons[0].tab.show, false);
    assert.equal(plugin.docks.sampledock.config.show, true);
    assert.equal(buttons[0].tab.icon, "iconClock");
});

test("removing a dock preserves its open state for re-enabling while explicitly closing saves false", () => {
    const dockSource = readFileSync(resolve(process.cwd(), "src/layout/dock/index.ts"), "utf8");
    const dockCompiled = ts.transpileModule(dockSource, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    for (const remove of [true, false]) {
        const storage = {sample: {sampledock: createConfig()}};
        let active = true;
        let removed = false;
        const classList = {
            contains: () => active,
            remove: () => { active = false; },
            add: (): void => undefined,
        };
        const target = {
            classList,
            getAttribute: (name: string) => name === "data-index" ? "0" : "sampledock",
            remove: () => { removed = true; },
        };
        const partition = {
            querySelector: () => active ? target : null,
            querySelectorAll: (selector: string) => selector === ".dock__item" || active ? [target] : [],
            parentElement: {
                querySelector: () => removed ? null : target,
                classList,
            },
        };
        const element = {
            classList,
            style: {},
            previousElementSibling: {classList},
            nextElementSibling: {classList},
        };
        const dependencies = {
            resizeTabs: (): void => undefined,
            adjustDockPadding: (): void => undefined,
            updatePluginDockShowStates,
            setStorageVal: (): void => undefined,
            Constants: {LOCAL_PLUGIN_DOCKS: "local-plugin-docks"},
        };
        const exports: {Dock?: {prototype: object}} = {};
        runInNewContext(dockCompiled, {
            exports,
            require: () => dependencies,
            document: {querySelector: (selector: string) => selector.includes("data-type") ? target : null},
            window: {siyuan: {storage: {"local-plugin-docks": storage}}},
            clearTimeout: (): void => undefined,
        });
        const dock = Object.assign(Object.create(exports.Dock.prototype), {
            app: {plugins: [{name: "sample", docks: {sampledock: {config: createConfig()}}}]},
            elements: [partition, {...partition, querySelector: (): null => null, querySelectorAll: (): typeof target[] => []}],
            layout: {element, children: [{element}, {element}]},
            data: {sampledock: {}},
            resizeElement: {classList},
            panelVisible: true,
            position: "Left",
            isFloating: () => true,
            hideDock: (): void => undefined,
            adjustSplit: (): void => undefined,
        });
        if (remove) {
            dock.remove("sampledock");
            assert.equal(removed, true);
            assert.equal(dock.data.sampledock, undefined);
        } else {
            dock.toggleModel("sampledock", false, true);
        }
        assert.equal(storage.sample.sampledock.show, remove);
        const restored = setup(storage.sample.sampledock, {
            type: "sampledock", show: false, size: {width: 500},
        });
        restored.load();
        assert.equal(restored.buttons[0].tab.show, remove);
    }
});
