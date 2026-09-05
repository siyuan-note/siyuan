import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import {
    DESKTOP_TOOLBAR_ENTRIES,
    getDefaultToolbar,
    getPluginToolbarEntryKey,
    markPluginToolbarEntries,
    TOOLBAR_ENTRY_ROOT_PATH,
} from "../../protyle/toolbar/defaults";
import {
    entryCatalog,
    getEntryCatalogChildren,
    getEntryCatalogDefaultVisibility,
    getEntryCatalogNode,
    getEntryCatalogPathChain,
    getEntryCatalogSection,
    getDockEntryKey,
    getDockEntryPosition,
    getEntryParentPath,
    getEntryOrderParents,
    getEntryPaths,
    getLegacyPluginTopBarEntryKey,
    getPluginDockEntryKey,
    getPluginSlashEntryKey,
    getPluginTopBarEntryKey,
    getSlashMenuEntryPath,
    isEntryCatalogNodeConfigurable,
    isEntryOrderSortable,
    refreshDockCatalog,
    refreshSlashMenuCatalog,
    refreshTopBarCatalog,
    refreshToolbarCatalog,
    SLASH_MENU_ROOT_PATH,
    TOP_BAR_ROOT_PATH,
} from "./catalog";

const slashMenuBuiltinOrder = [
    "template",
    "widget",
    "assets",
    "ref",
    "blockEmbed",
    "aiWriting",
    "database",
    "newFileRef",
    "newSubDocRef",
    "separator_1",
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "heading5",
    "heading6",
    "list",
    "orderedList",
    "check",
    "quote",
    "tabs",
    "calloutNote",
    "calloutTip",
    "calloutImportant",
    "calloutWarning",
    "calloutCaution",
    "code",
    "table",
    "line",
    "math",
    "html",
    "databaseTableView",
    "databaseKanbanView",
    "databaseGalleryView",
    "separator_2",
    "emoji",
    "link",
    "bold",
    "italic",
    "underline",
    "strike",
    "mark",
    "sup",
    "sub",
    "inlineCode",
    "kbd",
    "tag",
    "inlineMath",
    "separator_3",
    "insertAsset",
    "insertHTMLFile",
    "insertIframeURL",
    "insertImgURL",
    "insertVideoURL",
    "insertAudioURL",
    "separator_4",
    "staff",
    "chart",
    "flowChart",
    "graph",
    "mermaid",
    "mindmap",
    "UML",
    "separator_5",
    "infoStyle",
    "successStyle",
    "warningStyle",
    "errorStyle",
    "clearFontStyle",
];

test("entry catalog paths are unique and indexed", () => {
    const paths: string[] = [];
    const visit = (prefix: string, nodes: typeof entryCatalog[number]["children"]) => {
        nodes.forEach((item) => {
            const path = `${prefix}.${item.key}`;
            paths.push(path);
            assert.equal(getEntryCatalogNode(path), item);
            assert.equal(getEntryParentPath(path), prefix);
            if (item.children) {
                visit(path, item.children);
            }
        });
    };
    entryCatalog.forEach((section) => visit(section.key, section.children));
    assert.equal(new Set(paths).size, paths.length);
    assert.deepEqual(new Set(getEntryPaths()), new Set(paths.filter((path) =>
        isEntryCatalogNodeConfigurable(getEntryCatalogNode(path)!))));
});

test("top bar catalog includes a fixed drag boundary in built-in DOM order", () => {
    assert.equal(TOP_BAR_ROOT_PATH, "topBar");
    assert.deepEqual(getEntryCatalogChildren(TOP_BAR_ROOT_PATH).map((item) => item.key), [
        "barSync",
        "barBack",
        "barForward",
        "drag",
        "toolbarVIP",
        "toolbarTitle",
        "barPlugins",
        "barCommand",
        "barSearch",
        "barZoom",
        "barMode",
        "barExit",
    ]);
    const drag = getEntryCatalogNode("topBar.drag")!;
    assert.equal(drag.fixed, true);
    assert.equal(isEntryCatalogNodeConfigurable(drag), false);
    assert.equal(getEntryPaths().includes("topBar.drag"), false);
    assert.equal(getEntryOrderParents().includes(TOP_BAR_ROOT_PATH), true);
    assert.equal(getEntryCatalogNode("topBar.barWorkspace"), undefined);
    assert.equal(getEntryCatalogNode("topBar.barMore"), undefined);
    assert.equal(getEntryCatalogNode("topBar.windowControls"), undefined);
});

test("top bar markup stays aligned with its configurable built-in catalog", () => {
    const source = readFileSync(resolve(process.cwd(), "src/layout/topBar.ts"), "utf8");
    const markupKeys = Array.from(source.matchAll(/data-topbar-entry="([^"]+)"/g), (match) => match[1]);
    const catalogKeys = getEntryCatalogChildren(TOP_BAR_ROOT_PATH)
        .filter(isEntryCatalogNodeConfigurable)
        .map((item) => item.key);
    assert.deepEqual(markupKeys, catalogKeys);
    assert.match(source, /id="drag"/);
    assert.doesNotMatch(source, /id="drag"[^>]*data-topbar-entry/);
});

test("top bar account entries use legacy account switches only as defaults", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            siyuan: {
                config: {
                    account: {
                        displayVIP: false,
                        displayTitle: true,
                    },
                },
            },
        },
    });
    try {
        assert.equal(getEntryCatalogDefaultVisibility("topBar.toolbarVIP"), false);
        assert.equal(getEntryCatalogDefaultVisibility("topBar.toolbarTitle"), true);
        assert.equal(getEntryCatalogDefaultVisibility("topBar.barSearch"), true);
        assert.equal(getEntryCatalogDefaultVisibility("topBar.drag"), true);
    } finally {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

const topBarElement = (attributes: Record<string, string>) => ({
    getAttribute: (name: string) => attributes[name] ?? null,
}) as unknown as Element;

test("top bar catalog inserts plugin entries on their declared side of the fixed boundary", () => {
    const leftKey = getPluginTopBarEntryKey("plugin.one", "left.item");
    const rightKey = getPluginTopBarEntryKey("plugin.two", "right.item");
    const legacyKey = getLegacyPluginTopBarEntryKey("plugin.two", 1);
    try {
        refreshTopBarCatalog([{
            name: "plugin.one",
            displayName: "Plugin One",
            topBarIcons: [topBarElement({
                id: "plugin_one:left.item",
                "data-id": "left.item",
                "data-topbar-entry": leftKey,
                "data-location": "left",
                "aria-label": "Left Item",
            })],
        }, {
            name: "plugin.two",
            topBarIcons: [topBarElement({
                id: "plugin_two:right.item",
                "data-id": "right.item",
                "data-topbar-entry": rightKey,
                "data-location": "right",
                "aria-label": "Right Item",
            }), topBarElement({
                id: "plugin_two_1",
                "data-topbar-entry": legacyKey,
                "data-location": "right",
                "aria-label": "Legacy Item",
            })],
        }]);
        const children = getEntryCatalogChildren(TOP_BAR_ROOT_PATH);
        const keys = children.map((item) => item.key);
        assert.deepEqual(keys.slice(0, 5), ["barSync", "barBack", "barForward", leftKey, "drag"]);
        assert.deepEqual(keys.slice(keys.indexOf("toolbarTitle"), keys.indexOf("barCommand")), [
            "toolbarTitle",
            rightKey,
            legacyKey,
            "barPlugins",
        ]);
        assert.equal(getEntryCatalogNode(`${TOP_BAR_ROOT_PATH}.${leftKey}`)?.label(),
            "Plugin One - Left Item");
        assert.equal(getEntryCatalogNode(`${TOP_BAR_ROOT_PATH}.${rightKey}`)?.label(),
            "plugin.two - Right Item");
        assert.equal(getEntryParentPath(`${TOP_BAR_ROOT_PATH}.${legacyKey}`), TOP_BAR_ROOT_PATH);
    } finally {
        refreshTopBarCatalog([]);
    }
    assert.equal(getEntryCatalogNode(`${TOP_BAR_ROOT_PATH}.${leftKey}`), undefined);
    assert.equal(getEntryCatalogNode(`${TOP_BAR_ROOT_PATH}.${rightKey}`), undefined);
});

test("top bar catalog keeps the assigned key when a legacy item changes array index", () => {
    const key = getLegacyPluginTopBarEntryKey("plugin.name", 2);
    try {
        refreshTopBarCatalog([{
            name: "plugin.name",
            topBarIcons: [topBarElement({
                id: "plugin_name_2",
                "data-topbar-entry": key,
                "data-location": "right",
                "aria-label": "Legacy Item",
            })],
        }]);
        assert.equal(getEntryCatalogNode(`${TOP_BAR_ROOT_PATH}.${key}`)?.key, key);
        assert.equal(getEntryCatalogNode(`${TOP_BAR_ROOT_PATH}.${getLegacyPluginTopBarEntryKey("plugin.name", 0)}`),
            undefined);
    } finally {
        refreshTopBarCatalog([]);
    }
});

test("plugin top bar entries use the legacy unpinned list as their default visibility", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const key = getPluginTopBarEntryKey("plugin.name", "item");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            siyuan: {
                storage: {
                    "local-plugintopunpin": ["plugin_name:item"],
                },
            },
        },
    });
    try {
        refreshTopBarCatalog([{
            name: "plugin.name",
            topBarIcons: [topBarElement({
                id: "plugin_name:item",
                "data-id": "item",
                "data-location": "right",
                "aria-label": "Item",
            })],
        }]);
        assert.equal(getEntryCatalogDefaultVisibility(`${TOP_BAR_ROOT_PATH}.${key}`), false);
        window.siyuan.storage["local-plugintopunpin"] = [];
        assert.equal(getEntryCatalogDefaultVisibility(`${TOP_BAR_ROOT_PATH}.${key}`), true);
    } finally {
        refreshTopBarCatalog([]);
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

test("toolbar catalog follows the default toolbar declaration", () => {
    const children = getEntryCatalogChildren(TOOLBAR_ENTRY_ROOT_PATH);
    assert.deepEqual(children.map((item) => item.key), DESKTOP_TOOLBAR_ENTRIES.map((item) => item.key));
    assert.equal(children.filter((item) => item.type === "separator").length, 2);
    assert.equal(children.every((item) => item.simple), true);
});

test("toolbar catalog follows plugin insertion slots and removes unloaded plugin entries", () => {
    const defaults = getDefaultToolbar(false).map((item) => typeof item === "string" ? {name: item} : item);
    const pluginItem = {name: "shared.item"};
    const pluginKey = getPluginToolbarEntryKey("plugin.name", pluginItem.name);
    const pluginSeparatorKey = getPluginToolbarEntryKey("plugin.name", "1", "separator");
    try {
        const toolbar = markPluginToolbarEntries(defaults,
            [defaults[0], pluginItem, "|", ...defaults.slice(1)], "plugin.name", () => "Plugin Name - Shared Item")
            .map((item) => typeof item === "string" ? {name: item} : item);
        refreshToolbarCatalog(toolbar);
        const children = getEntryCatalogChildren(TOOLBAR_ENTRY_ROOT_PATH);
        assert.deepEqual(children.slice(0, 4).map((item) => item.key), [
            DESKTOP_TOOLBAR_ENTRIES[0].key,
            pluginKey,
            pluginSeparatorKey,
            DESKTOP_TOOLBAR_ENTRIES[1].key,
        ]);
        assert.equal(getEntryCatalogNode(`${TOOLBAR_ENTRY_ROOT_PATH}.${pluginKey}`)?.label(),
            "Plugin Name - Shared Item");
        assert.equal(getEntryCatalogNode(`${TOOLBAR_ENTRY_ROOT_PATH}.${pluginSeparatorKey}`)?.type, "separator");
        assert.equal(getEntryParentPath(`${TOOLBAR_ENTRY_ROOT_PATH}.${pluginKey}`), TOOLBAR_ENTRY_ROOT_PATH);
    } finally {
        refreshToolbarCatalog(defaults);
    }
    assert.equal(getEntryCatalogNode(`${TOOLBAR_ENTRY_ROOT_PATH}.${pluginKey}`), undefined);
});

test("dock catalog refreshes unique plugin docks and removes unloaded entries", () => {
    const firstKey = getPluginDockEntryKey("plugin.one", "shared.id");
    const secondKey = getPluginDockEntryKey("plugin.two", "shared.id");
    try {
        refreshDockCatalog([{
            name: "plugin.one",
            displayName: "Plugin One",
            docks: {
                first: {
                    id: "shared.id",
                    config: {title: "First Dock", position: "LeftTop", index: 0},
                },
                duplicate: {
                    id: "shared.id",
                    config: {title: "Duplicate Dock", position: "RightBottom", index: 1},
                },
            },
        }, {
            name: "plugin.two",
            displayName: "Plugin Two",
            docks: {
                second: {
                    id: "shared.id",
                    config: {title: "Second Dock", position: "BottomRight", index: 2},
                },
            },
        }]);

        const children = getEntryCatalogChildren("dock");
        assert.deepEqual(children.slice(-2).map((item) => item.key), [firstKey, secondKey]);
        assert.equal(children.filter((item) => item.key === firstKey).length, 1);
        assert.equal(getEntryCatalogNode(`dock.${firstKey}`)?.label(), "Plugin One - First Dock");
        assert.equal(getEntryCatalogNode(`dock.${secondKey}`)?.label(), "Plugin Two - Second Dock");
        assert.equal(getEntryParentPath(`dock.${firstKey}`), "dock");
        assert.equal(getDockEntryPosition(firstKey), "LeftTop");
        assert.equal(getDockEntryPosition(secondKey), "BottomRight");
    } finally {
        refreshDockCatalog([]);
    }
    assert.equal(getEntryCatalogNode(`dock.${firstKey}`), undefined);
    assert.equal(getDockEntryPosition(firstKey), undefined);
});

test("dock catalog exposes the built-in default positions", () => {
    const positions = {
        file: "LeftTop",
        outline: "LeftTop",
        bookmark: "LeftBottom",
        tag: "LeftBottom",
        backlink: "RightBottom",
        agentChat: "RightTop",
        inbox: "LeftTop",
        graph: "RightTop",
        globalGraph: "RightTop",
    };
    Object.entries(positions).forEach(([key, position]) => {
        assert.equal(getDockEntryPosition(key), position, key);
    });
});

test("dock catalog refreshes plugin placement metadata and resolves runtime types", () => {
    const runtimeType = "plugin.runtime-dock";
    const stableKey = getPluginDockEntryKey("plugin.runtime", "stable.id");
    const plugins = (position: TPluginDockPosition, index: number) => [{
        name: "plugin.runtime",
        docks: {
            [runtimeType]: {
                id: "stable.id",
                config: {title: "Runtime Dock", position, index},
            },
        },
    }];
    const element = (attributes: Record<string, string>) => ({
        getAttribute: (name: string) => attributes[name] ?? null,
    }) as unknown as Element;
    try {
        refreshDockCatalog(plugins("LeftTop", 0));
        const initialChildren = getEntryCatalogChildren("dock");
        assert.equal(getDockEntryKey(element({"data-type": runtimeType})), stableKey);
        assert.equal(getDockEntryKey(element({
            "data-entry-id": "explicit-entry",
            "data-type": runtimeType,
        })), "explicit-entry");
        assert.equal(getDockEntryPosition(stableKey), "LeftTop");

        refreshDockCatalog(plugins("LeftTop", 1));
        const indexChangedChildren = getEntryCatalogChildren("dock");
        assert.notEqual(indexChangedChildren, initialChildren);
        refreshDockCatalog(plugins("LeftTop", 1));
        assert.equal(getEntryCatalogChildren("dock"), indexChangedChildren);

        refreshDockCatalog(plugins("RightBottom", 1));
        assert.equal(getDockEntryPosition(stableKey), "RightBottom");
    } finally {
        refreshDockCatalog([]);
    }
    assert.equal(getDockEntryKey(element({"data-type": runtimeType})), runtimeType);
    assert.equal(getDockEntryPosition(stableKey), undefined);
    assert.equal(getDockEntryPosition("file"), "LeftTop");
});

test("plugin dock keys encode dotted names and IDs without ambiguity", () => {
    const dottedPlugin = getPluginDockEntryKey("plugin.name", "entry");
    const dottedEntry = getPluginDockEntryKey("plugin", "name.entry");
    assert.equal(dottedPlugin, "plugin:plugin%2Ename:entry");
    assert.equal(dottedEntry, "plugin:plugin:name%2Eentry");
    assert.notEqual(dottedPlugin, dottedEntry);
    assert.equal(dottedPlugin.includes("."), false);
    assert.equal(dottedEntry.includes("."), false);
});

test("slash menu catalog follows the built-in hint order", () => {
    const section = getEntryCatalogSection("editor.slash");
    assert.deepEqual(section?.children.map((item) => item.key), ["menu"]);
    const children = getEntryCatalogChildren(SLASH_MENU_ROOT_PATH);
    assert.deepEqual(children.map((item) => item.key), slashMenuBuiltinOrder);
    assert.equal(children.filter((item) => item.type === "entry").length, 64);
    assert.equal(children.filter((item) => item.type === "separator").length, 5);
    assert.equal(children.every((item) => item.simple), true);
});

test("slash menu catalog stays aligned with the built-in hint declarations", () => {
    const source = readFileSync(resolve(process.cwd(), "src/protyle/hint/extend.ts"), "utf8");
    const start = source.indexOf("export const getBuiltinSlashMenuItems");
    const end = source.indexOf("export const hintSlash", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const hintOrder = Array.from(source.slice(start, end).matchAll(/\bid: "([^"]+)"/g), (match) => match[1]);
    assert.deepEqual(hintOrder, [...slashMenuBuiltinOrder, "separator_6"]);
});

test("slash menu entries are indexed below their total switch", () => {
    const templatePath = getSlashMenuEntryPath("template");
    assert.equal(SLASH_MENU_ROOT_PATH, "editor.slash.menu");
    assert.equal(templatePath, "editor.slash.menu.template");
    assert.equal(getEntryCatalogNode(SLASH_MENU_ROOT_PATH)?.displayChildrenDirectly, true);
    assert.equal(getEntryCatalogNode(templatePath)?.key, "template");
    assert.equal(getEntryParentPath(templatePath), SLASH_MENU_ROOT_PATH);
    assert.deepEqual(getEntryCatalogPathChain("editor.slash", templatePath), [
        SLASH_MENU_ROOT_PATH,
        templatePath,
    ]);
});

test("plugin slash keys encode dotted names and IDs without ambiguity", () => {
    const dottedPlugin = getPluginSlashEntryKey("plugin.name", "entry");
    const dottedEntry = getPluginSlashEntryKey("plugin", "name.entry");
    const pluginSeparator = getPluginSlashEntryKey("plugin.name", "entry", "separator");
    assert.equal(dottedPlugin, "plugin:plugin%2Ename:entry");
    assert.equal(dottedEntry, "plugin:plugin:name%2Eentry");
    assert.equal(pluginSeparator, "plugin-separator:plugin%2Ename:entry");
    assert.notEqual(dottedPlugin, dottedEntry);
    assert.notEqual(dottedPlugin, pluginSeparator);
    assert.equal(dottedPlugin.includes("."), false);
    assert.equal(dottedEntry.includes("."), false);
});

test("slash menu catalog refreshes unique plugin entries and its plugin separator", () => {
    const firstKey = getPluginSlashEntryKey("plugin.one", "shared.id");
    const secondKey = getPluginSlashEntryKey("plugin.two", "shared.id");
    const fallbackKey = getPluginSlashEntryKey("plugin.three", "fallback");
    try {
        refreshSlashMenuCatalog([{
            name: "plugin.one",
            displayName: "Plugin One",
            protyleSlash: [{
                id: "shared.id",
                html: '<span class="b3-list-item__text">HTML label</span>',
                filter: ["Filter label"],
            }, {
                id: "shared.id",
                html: '<span class="b3-list-item__text">Duplicate</span>',
            }],
        }, {
            name: "plugin.two",
            displayName: "Plugin Two",
            protyleSlash: [{
                id: "shared.id",
                html: "<span>Missing text class</span>",
                filter: ["Filter label"],
            }],
        }, {
            name: "plugin.three",
            displayName: "Plugin Three",
            protyleSlash: [{
                id: "fallback",
                html: "<span>Missing text class</span>",
            }],
        }]);

        const children = getEntryCatalogChildren(SLASH_MENU_ROOT_PATH);
        assert.deepEqual(children.slice(-4).map((item) => item.key), [
            "separator_6",
            firstKey,
            secondKey,
            fallbackKey,
        ]);
        assert.notEqual(firstKey, secondKey);
        assert.equal(children.filter((item) => item.key === firstKey).length, 1);
        assert.equal(getEntryCatalogNode(getSlashMenuEntryPath(firstKey))?.label(), "Plugin One - HTML label");
        assert.equal(getEntryCatalogNode(getSlashMenuEntryPath(secondKey))?.label(), "Plugin Two - Filter label");
        assert.equal(getEntryCatalogNode(getSlashMenuEntryPath(fallbackKey))?.label(), "Plugin Three - fallback");
        assert.equal(getEntryParentPath(getSlashMenuEntryPath(firstKey)), SLASH_MENU_ROOT_PATH);
    } finally {
        refreshSlashMenuCatalog([]);
    }
    assert.equal(getEntryCatalogChildren(SLASH_MENU_ROOT_PATH).some((item) => item.key === "separator_6"), false);
    assert.equal(getEntryCatalogNode(getSlashMenuEntryPath(firstKey)), undefined);
});

test("slash menu catalog keeps only renderable plugin separators", () => {
    const leadingKey = getPluginSlashEntryKey("plugin.separators", "leading", "separator");
    const firstKey = getPluginSlashEntryKey("plugin.separators", "first");
    const middleKey = getPluginSlashEntryKey("plugin.separators", "middle", "separator");
    const consecutiveKey = getPluginSlashEntryKey("plugin.separators", "consecutive", "separator");
    const secondKey = getPluginSlashEntryKey("plugin.separators", "second");
    const trailingKey = getPluginSlashEntryKey("plugin.separators", "trailing", "separator");
    try {
        refreshSlashMenuCatalog([{
            name: "plugin.separators",
            protyleSlash: [{
                id: "leading",
                html: "separator",
            }, {
                id: "first",
                html: "First",
            }, {
                id: "middle",
                html: "separator",
            }, {
                id: "consecutive",
                html: "separator",
            }, {
                id: "second",
                html: "Second",
            }, {
                id: "trailing",
                html: "separator",
            }],
        }]);
        const children = getEntryCatalogChildren(SLASH_MENU_ROOT_PATH);
        assert.deepEqual(children.slice(-4).map((item) => item.key), [
            "separator_6",
            firstKey,
            middleKey,
            secondKey,
        ]);
        assert.equal(getEntryCatalogNode(getSlashMenuEntryPath(middleKey))?.type, "separator");
        [leadingKey, consecutiveKey, trailingKey].forEach((key) => {
            assert.equal(getEntryCatalogNode(getSlashMenuEntryPath(key)), undefined);
        });
    } finally {
        refreshSlashMenuCatalog([]);
    }
});

test("entry order sortability follows its section and parent entry", () => {
    assert.equal(isEntryOrderSortable("editor.slash"), false);
    assert.equal(isEntryOrderSortable(SLASH_MENU_ROOT_PATH), true);
    assert.equal(isEntryOrderSortable("dock"), false);
    assert.equal(isEntryOrderSortable("document.more"), true);
    assert.equal(isEntryOrderSortable("gutter.single.turnInto"), true);
    assert.equal(isEntryOrderSortable("missing"), false);
    assert.equal(getEntryOrderParents().includes("editor.slash"), false);
    assert.equal(getEntryOrderParents().includes(SLASH_MENU_ROOT_PATH), true);
    assert.equal(getEntryOrderParents().includes(TOOLBAR_ENTRY_ROOT_PATH), true);
});

test("callout presets stay aligned across block menu scopes", () => {
    const presetKeys = [
        "calloutNote",
        "calloutTip",
        "calloutImportant",
        "calloutWarning",
        "calloutCaution",
        "calloutCustom",
    ];
    ["gutter.single.turnInto", "gutter.multi.turnInto"].forEach((path) => {
        const keys = getEntryCatalogChildren(path).map(item => item.key);
        const calloutIndex = keys.indexOf("callout");
        assert.notEqual(calloutIndex, -1);
        assert.deepEqual(keys.slice(calloutIndex + 1, calloutIndex + 1 + presetKeys.length), presetKeys);
    });
});

test("conditional block resource menus have distinct configuration labels", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            siyuan: {
                languages: {
                    assets: "Assets",
                    audio: "Audio",
                    video: "Video",
                },
            },
        },
    });
    try {
        assert.equal(getEntryCatalogNode("gutter.single.assetVideo")?.label(), "Video - Assets");
        assert.equal(getEntryCatalogNode("gutter.single.assetAudio")?.label(), "Audio - Assets");
        assert.equal(getEntryCatalogNode("gutter.single.assetIFrame")?.label(), "IFrame - Assets");
    } finally {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

test("sortable entry catalog groups contain valid separator positions", () => {
    getEntryOrderParents().forEach((parentPath) => {
        const children = getEntryCatalogChildren(parentPath);
        assert.ok(children.length > 0, parentPath);
        assert.notEqual(children[0].type, "separator", parentPath);
        assert.notEqual(children[children.length - 1].type, "separator", parentPath);
        children.forEach((item, index) => {
            if (item.type === "separator") {
                assert.notEqual(children[index - 1]?.type, "separator", parentPath);
            }
        });
        assert.equal(new Set(children.map((item) => item.key)).size, children.length, parentPath);
    });
});

test("list block submenu follows the base block entries", () => {
    const children = getEntryCatalogChildren("gutter.single");
    const deleteIndex = children.findIndex((item) => item.key === "delete");
    const separator = children[deleteIndex + 1];
    const listBlock = children[deleteIndex + 2];

    assert.ok(0 <= deleteIndex);
    assert.equal(separator?.key, "separator_listBlock");
    assert.equal(separator?.type, "separator");
    assert.equal(listBlock?.key, "listBlock");
    assert.equal(listBlock?.type, "entry");
    assert.equal(listBlock?.simple, true);
    assert.deepEqual(listBlock?.children?.map((item) => item.key), [
        "orderedListStart",
        "continueListNumbering",
        "separator_numbering",
        "prependListItem",
        "appendListItem",
    ]);
});

test("super block actions and vertical alignment use their respective menu groups", () => {
    assert.deepEqual(getEntryCatalogChildren("gutter.single.superBlock").map((item) => item.key), [
        "cancelSuperBlock",
        "turnIntoVLayout",
        "turnIntoHLayout",
    ]);

    const singleLayoutKeys = getEntryCatalogChildren("gutter.single.layout").map((item) => item.key);
    const horizontalSeparatorIndex = singleLayoutKeys.indexOf("separator_1");
    assert.deepEqual(singleLayoutKeys.slice(horizontalSeparatorIndex + 1, horizontalSeparatorIndex + 6), [
        "alignTop",
        "alignMiddle",
        "alignBottom",
        "useDefaultVerticalAlign",
        "separator_verticalAlign",
    ]);
    assert.equal(getEntryCatalogChildren("gutter.multi.layout").some((item) => item.key === "alignTop"), false);
});

test("gutter height menus follow width and stay aligned across selection scopes", () => {
    const expectedHeightOrder = [
        "heightInput",
        "height_25%",
        "height_33%",
        "height_50%",
        "height_67%",
        "height_75%",
        "height_100%",
        "separator_1",
        "heightDrag",
        "separator_2",
        "default",
    ];

    ["gutter.single", "gutter.multi"].forEach((scope) => {
        const scopeChildren = getEntryCatalogChildren(scope);
        const widthIndex = scopeChildren.findIndex((item) => item.key === "width");
        const width = getEntryCatalogNode(`${scope}.width`);
        const height = getEntryCatalogNode(`${scope}.height`);

        assert.ok(0 <= widthIndex, scope);
        assert.equal(scopeChildren[widthIndex + 1]?.key, "height", scope);
        assert.deepEqual(height?.children?.map((item) => item.key), expectedHeightOrder, scope);
        assert.equal(height?.simple, width?.simple, scope);
        assert.deepEqual(height?.children?.map((item) => item.simple),
            width?.children?.map((item) => item.simple), scope);
        assert.deepEqual(height?.children?.map((item) => item.type),
            width?.children?.map((item) => item.type), scope);
    });
});

test("super block column insertion actions follow block insertion actions", () => {
    const keys = getEntryCatalogChildren("gutter.single").map((item) => item.key);
    const insertBeforeIndex = keys.indexOf("insertBefore");
    assert.deepEqual(keys.slice(insertBeforeIndex, insertBeforeIndex + 4), [
        "insertBefore",
        "insertAfter",
        "insertSuperBlockLeft",
        "insertSuperBlockRight",
    ]);
});

test("table block width actions keep current-column and whole-table scopes together", () => {
    assert.deepEqual(getEntryCatalogChildren("gutter.single.table").slice(0, 3).map((item) => item.key), [
        "useDefaultWidth",
        "distributeAllColWidths",
        "useDefaultWidthForAllColumns",
    ]);
});

test("code block actions follow the code block menu order", () => {
    assert.deepEqual(getEntryCatalogChildren("gutter.single.code").map((item) => item.key), [
        "md29",
        "md31",
        "md2",
        "md27",
        "saveCodeBlockAsFile",
    ]);
    assert.deepEqual(getEntryCatalogChildren("gutter.single.code.md29").map((item) => item.key), [
        "default",
        "tabSpaces0",
        "tabSpaces2",
        "tabSpaces4",
        "tabSpaces6",
        "tabSpaces8",
    ]);
});

test("multiple block heading transform follows the regular transform menu", () => {
    const children = getEntryCatalogChildren("gutter.multi");

    assert.deepEqual(children.slice(0, 3).map((item) => item.key), [
        "turnInto",
        "tWithSubtitle",
        "mergeSuperBlock",
    ]);
    assert.deepEqual(getEntryCatalogChildren("gutter.multi.tWithSubtitle").map((item) => item.key), [
        "heading1",
        "heading2",
        "heading3",
        "heading4",
        "heading5",
        "heading6",
    ]);
});

test("document loading actions follow the document menu order", () => {
    const children = getEntryCatalogChildren("document.more");
    const loadAllIndex = children.findIndex((item) => item.key === "loadAllContent");

    assert.ok(0 <= loadAllIndex);
    assert.equal(children[loadAllIndex + 1]?.key, "keepLazyLoad");
    assert.equal(children[loadAllIndex + 2]?.key, "separator_1");
});

test("document mode switch is a direct configurable entry", () => {
    const editMode = getEntryCatalogNode("document.more.editMode");
    assert.equal(editMode?.type, "entry");
    assert.equal(editMode?.simple, true);
    assert.equal(editMode?.children, undefined);
});

test("multiple document and notebook entries follow their document tree menus", () => {
    assert.deepEqual(getEntryCatalogChildren("docTree.panel").map((item) => item.key), [
        "newNotebook",
        "newEncryptedNotebook",
        "importNotebook",
        "rebuildDataIndex",
        "sort",
        "publishAccess",
    ]);
    assert.deepEqual(getEntryCatalogChildren("docTree.notebooks").map((item) => item.key), [
        "sort",
        "search",
        "replace",
        "separator_1",
        "close",
        "delete",
        "separator_2",
        "export",
    ]);
    assert.deepEqual(getEntryCatalogChildren("docTree.notebooks.export").map((item) => item.key), [
        "exportSiYuanZip",
        "exportMarkdown",
    ]);
    assert.ok(getEntryCatalogChildren("docTree.multi").some((item) => item.key === "delete"));
});

test("document tree configuration groups notebook scopes before document scopes", () => {
    const panelIndex = entryCatalog.findIndex((item) => item.key === "docTree.panel");
    assert.deepEqual(entryCatalog.slice(panelIndex, panelIndex + 5).map((item) => item.key), [
        "docTree.panel",
        "docTree.notebook",
        "docTree.notebooks",
        "docTree.document",
        "docTree.multi",
    ]);
});

test("tab menu catalog follows its conditional menu declarations", () => {
    assert.deepEqual(getEntryCatalogChildren("tab").map((item) => item.key), [
        "close",
        "closeOthers",
        "closeAll",
        "closeUnmodified",
        "closeLeft",
        "closeRight",
        "separator_1",
        "split",
        "copy",
        "pin",
        "unpin",
        "tabToWindow",
    ]);
    assert.deepEqual(getEntryCatalogChildren("tab.split").map((item) => item.key), [
        "splitLR",
        "splitMoveR",
        "splitTB",
        "splitMoveB",
        "unsplit",
        "unsplitAll",
    ]);
    assert.deepEqual(getEntryCatalogChildren("tab.copy").map((item) => item.key), [
        "copyBlockRef",
        "copyBlockEmbed",
        "copyProtocol",
        "copyProtocolInMd",
        "copyWebURL",
        "copyHPath",
        "copyID",
    ]);
});

test("tab menu is connected to its entry visibility scope", () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/runtime.ts"), "utf8");
    assert.match(source, /case Constants\.MENU_TAB:\s*return "tab";/);
});

test("configuration labels distinguish block scopes and size controls", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            siyuan: {
                languages: {
                    editor: "Editor",
                    entryGutterMenu: "Block icon menu",
                    entrySingleBlock: "Single block",
                    entryMultipleBlocks: "Multiple blocks",
                    entryPixelWidth: "Pixel width",
                    entryPercentageWidth: "Percentage width",
                    entryPixelHeight: "Pixel height",
                    entryPercentageHeight: "Percentage height",
                    entryDock: "Dock",
                    height: "Height",
                    entryDocumentStatistics: "Document statistics",
                },
            },
        },
    });
    try {
        assert.equal(getEntryCatalogSection("dock")?.label(), "Dock");
        assert.equal(getEntryCatalogSection("gutter.single")?.label(),
            "Editor - Block icon menu - Single block");
        assert.equal(getEntryCatalogSection("gutter.multi")?.label(),
            "Editor - Block icon menu - Multiple blocks");
        assert.equal(getEntryCatalogNode("gutter.single.width.widthInput")?.label(), "Pixel width");
        assert.equal(getEntryCatalogNode("gutter.single.width.widthDrag")?.label(), "Percentage width");
        assert.equal(getEntryCatalogNode("gutter.single.height")?.label(), "Height");
        assert.equal(getEntryCatalogNode("gutter.single.height.heightInput")?.label(), "Pixel height");
        assert.equal(getEntryCatalogNode("gutter.single.height.heightDrag")?.label(), "Percentage height");
        assert.equal(getEntryCatalogNode("gutter.multi.height.heightInput")?.label(), "Pixel height");
        assert.equal(getEntryCatalogNode("gutter.multi.height.heightDrag")?.label(), "Percentage height");
        assert.equal(getEntryCatalogNode("inline.image.height.heightInput")?.label(), "Pixel height");
        assert.equal(getEntryCatalogNode("inline.image.height.heightDrag")?.label(), "Percentage height");
        assert.equal(getEntryCatalogNode("document.more.docInfo")?.label(), "Document statistics");
    } finally {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

test("document tree creation entries match menu order and remain available in the Simple profile", () => {
    const entries = getEntryCatalogChildren("docTree.document");
    const creationKeys = ["newDocAbove", "newDocBelow", "newSiblingDoc"];
    assert.deepEqual(entries.slice(0, 6).map((item) => item.key), [
        "openDocument", ...creationKeys, "separator_1", "copy",
    ]);
    creationKeys.forEach((key) => {
        const entry = getEntryCatalogNode(`docTree.document.${key}`);
        assert.equal(entry?.type, "entry");
        assert.equal(entry?.simple, true);
    });
    assert.equal(entries[4].type, "separator");
    assert.equal(getEntryCatalogNode("docTree.documents.newSiblingDoc"), undefined);

    const source = readFileSync(resolve(process.cwd(), "src/menus/navigation.ts"), "utf8");
    const menuSource = source.slice(source.indexOf("export const initFileMenu"));
    const ids = Array.from(menuSource.matchAll(/id: "([^"]+)"/g), (match) => match[1]);
    const start = ids.indexOf("newDocAbove");
    assert.deepEqual(ids.slice(start, start + 5), [...creationKeys, "separator_1", "copy"]);
});

test("document tree sort menus follow their scope inheritance options", () => {
    const documentEntries = getEntryCatalogChildren("docTree.document");
    const attrIndex = documentEntries.findIndex((item) => item.key === "attr");
    assert.deepEqual(documentEntries.slice(attrIndex, attrIndex + 3).map((item) => item.key), [
        "attr",
        "sort",
        "riffCard",
    ]);

    const commonSortEntries = [
        "fileNameASC",
        "fileNameDESC",
        "fileNameNatASC",
        "fileNameNatDESC",
        "separator_1",
        "createdASC",
        "createdDESC",
        "modifiedASC",
        "modifiedDESC",
        "separator_2",
        "refCountASC",
        "refCountDESC",
        "separator_3",
        "docSizeASC",
        "docSizeDESC",
        "separator_4",
        "subDocCountASC",
        "subDocCountDESC",
        "separator_5",
        "customSort",
    ];
    assert.deepEqual(getEntryCatalogChildren("docTree.panel.sort").map((item) => item.key), commonSortEntries);
    assert.deepEqual(getEntryCatalogChildren("docTree.notebooks.sort").map((item) => item.key), [
        ...commonSortEntries,
        "sortByFiletree",
    ]);
    assert.deepEqual(getEntryCatalogChildren("docTree.notebook.sort").map((item) => item.key), [
        ...commonSortEntries,
        "sortByFiletree",
    ]);
    assert.deepEqual(getEntryCatalogChildren("docTree.document.sort").map((item) => item.key), [
        ...commonSortEntries,
        "sortByParent",
    ]);
});

test("multiple document and notebook settings have distinct labels", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            siyuan: {
                languages: {
                    agentCatDoc: "Document",
                    agentCatNotebook: "Notebook",
                    entryDocPanel: "Document panel",
                    more: "More",
                    multiSelect: "Multi-select",
                },
            },
        },
    });
    try {
        assert.equal(entryCatalog.find((item) => item.key === "docTree.multi")?.label(),
            "Document panel - Document - Multi-select - More");
        assert.equal(entryCatalog.find((item) => item.key === "docTree.notebooks")?.label(),
            "Document panel - Notebook - Multi-select - More");
    } finally {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

test("HTML file insertion follows general asset insertion", () => {
    const children = getEntryCatalogChildren("document.more");
    const insertAssetIndex = children.findIndex((item) => item.key === "insertAsset");

    assert.ok(0 <= insertAssetIndex);
    assert.equal(children[insertAssetIndex + 1]?.key, "insertHTMLFile");
});

test("copy as PNG is available for documents and single blocks", () => {
    const documentCopy = getEntryCatalogChildren("document.title.copy").map((item) => item.key);
    const blockCopy = getEntryCatalogChildren("gutter.single.copy").map((item) => item.key);
    assert.ok(getEntryCatalogNode("document.title.copy.copyAsPNG"));
    assert.ok(getEntryCatalogNode("gutter.single.copy.copyAsPNG"));
    assert.equal(getEntryCatalogNode("gutter.multi.copy.copyAsPNG"), undefined);
    assert.equal(documentCopy[documentCopy.indexOf("copyMarkdown") + 1], "copyAsPNG");
    assert.equal(blockCopy[blockCopy.indexOf("copyPlainText") + 1], "copyAsPNG");
});

test("simple profile follows the reviewed defaults", () => {
    const shown = [
        "document.title.copy.copyBlockEmbed",
        "document.title.copy.copyAsPNG",
        "document.title.export.exportTemplate",
        "document.title.export.exportImage",
        "gutter.single.addToAgent",
        "gutter.single.copy.copyAsPNG",
        "gutter.single.turnInto.code",
        "gutter.single.layout.alignTop",
        "gutter.single.layout.alignMiddle",
        "gutter.single.layout.alignBottom",
        "gutter.single.layout.useDefaultVerticalAlign",
        "gutter.single.table.tableHeaderRow",
        "gutter.single.table.tableHeaderColumn",
        "gutter.single.table.distributeAllColWidths",
        "gutter.single.table.useDefaultWidthForAllColumns",
        "gutter.single.table.alignment.alignTop",
        "gutter.single.table.alignment.alignMiddle",
        "gutter.single.table.alignment.alignBottom",
        "gutter.single.table.alignment.useDefaultVerticalAlign",
        "inline.text.more.tableHeaderRow",
        "inline.text.more.tableHeaderColumn",
        "document.more.loadAllContent",
        "document.more.keepLazyLoad",
        "document.more.headingNumber",
        "docTree.notebook.sort.fileNameNatASC",
        "docTree.document.sort.fileNameNatASC",
        "docTree.document.sort.sortByParent",
    ];
    const hidden = [
        "document.title.copy.copyDoc",
        "document.title.copy.copyProtocol",
        "gutter.single.addToDatabase",
        "gutter.single.enterBack",
        "gutter.single.jumpTo",
        "gutter.single.wechatReminder",
        "document.more.netAssets2LocalAssets",
        "document.more.fullWidth",
        "docTree.notebook.sort.fileNameASC",
        "docTree.document.sort.fileNameASC",
        "inline.image.copyFile",
    ];
    shown.forEach((path) => assert.equal(getEntryCatalogNode(path)?.simple, true, path));
    hidden.forEach((path) => assert.equal(getEntryCatalogNode(path)?.simple, false, path));
});

test("entry catalog resolves navigation columns for deeply nested entries", () => {
    assert.equal(getEntryCatalogSection("gutter.single"), entryCatalog.find((item) => item.key === "gutter.single"));
    assert.deepEqual(getEntryCatalogPathChain("gutter.single",
        "gutter.single.turnInto.includeSublists.recursiveParagraph"), [
        "gutter.single.turnInto",
        "gutter.single.turnInto.includeSublists",
        "gutter.single.turnInto.includeSublists.recursiveParagraph",
    ]);
    assert.deepEqual(getEntryCatalogPathChain("document.title",
        "gutter.single.turnInto.includeSublists.recursiveParagraph"), []);
    assert.deepEqual(getEntryCatalogPathChain("gutter.single", "gutter.single.missing"), []);
});
