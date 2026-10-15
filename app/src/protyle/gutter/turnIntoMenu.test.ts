import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import {getEntryCatalogChildren} from "../../config/entryVisibility/catalog";
import {mergeEntryOrderPreservingUnknown, reorderEntrySlots, resolveEntryOrder} from "../../config/entryVisibility/order";
import {normalizeEntryVisibilityImportProfile} from "../../config/entryVisibility/profile";
import {orderGutterTurnIntoItems} from "./turnIntoMenu";
import {CALLOUT_PRESETS} from "../wysiwyg/calloutType";

const headings = ["heading1", "heading2", "heading3", "heading4", "heading5", "heading6"];
const common = ["paragraph", ...headings, "list", "orderedList", "check", "quote", "callout"];
const legacyOrder = (multi: boolean) => [
    "removeList", "list", "orderedList", "check", ...(!multi ? ["listMindmap"] : []), "includeSublists",
    "paragraph", "quote", "callout", "calloutNote", "calloutTip", "calloutImportant", "calloutWarning",
    "calloutCaution", "calloutCustom", ...(!multi ? ["tabs"] : []), ...headings,
    ...(!multi ? ["superBlock"] : []), "code", "table", "line", "math",
];

test("default conversion order matches the toolbar while retaining every extra item", () => {
    for (const multi of [false, true]) {
        const defaults = getEntryCatalogChildren(`gutter.${multi ? "multi" : "single"}.turnInto`).map(item => item.key);
        assert.deepEqual(defaults.filter(key => common.includes(key)), common);
        assert.deepEqual([...defaults].sort(), legacyOrder(multi).sort());
        assert.deepEqual(defaults.filter(key => !common.includes(key)), legacyOrder(multi).filter(key => !common.includes(key)));
        assert.deepEqual(resolveEntryOrder(defaults, undefined, new Set()), defaults);
        assert.deepEqual(resolveEntryOrder(defaults, [], new Set()), defaults);
        assert.deepEqual(orderGutterTurnIntoItems(legacyOrder(multi), key => key), defaults);
    }
});

test("partial paragraph and heading menus keep their candidates and callbacks", () => {
    const cases = [
        {input: ["list", "orderedList", "check", "quote", "callout", ...headings],
            expected: [...headings, "list", "orderedList", "check", "quote", "callout"]},
        {input: ["paragraph", "quote", "callout", ...headings.filter(key => key !== "heading2")],
            expected: ["paragraph", ...headings.filter(key => key !== "heading2"), "quote", "callout"]},
        {input: ["removeList", "check", "paragraph", "heading2", "heading1"],
            expected: ["paragraph", "heading1", "heading2", "removeList", "check"]},
    ];
    for (const {input, expected} of cases) {
        const items = input.map(id => ({id, label: id, accelerator: id, click: () => id}));
        const sorted = orderGutterTurnIntoItems(items, item => item.id);
        assert.deepEqual(sorted.map(item => item.id), expected);
        assert.deepEqual(items.map(item => item.id), input);
        sorted.forEach(item => assert.equal(item, items.find(original => original.id === item.id)));
    }
});

test("tabs expose direct mind map conversion through the existing configurable entry", () => {
    const source = readFileSync(resolve(process.cwd(), "src/protyle/gutter/index.ts"), "utf8");
    const tabsMenu = source.slice(source.indexOf('} else if (type === "NodeTabs" && allowStructuralMutation)'),
        source.indexOf('} else if (type === "NodeBlockquote" && allowStructuralMutation)'));
    assert.match(tabsMenu, /menuId: "listMindmap", icon: "iconMindmap", label: "mindmap", type: "Tabs2Mindmap"/);
    const catalog = getEntryCatalogChildren("gutter.single.turnInto");
    assert.equal(catalog.filter(item => item.key === "listMindmap").length, 1);
    assert.equal(catalog.find(item => item.key === "listMindmap").simple, true);
    assert.deepEqual(orderGutterTurnIntoItems(["superBlock", "listMindmap", "check", "list", "orderedList"], key => key),
        ["list", "orderedList", "check", "listMindmap", "superBlock"]);
});

test("blockquote callout types retain existing catalog identities and saved orders", () => {
    const path = "gutter.single.turnInto";
    const types = [...CALLOUT_PRESETS.map(item => item.id), "calloutCustom"];
    const catalog = getEntryCatalogChildren(path);
    assert.deepEqual(catalog.filter(item => types.includes(item.key)).map(item => item.key), types);
    types.forEach(key => {
        const entry = catalog.find(item => item.key === key);
        assert.equal(entry.type, "entry");
        assert.equal(entry.simple, true);
    });
    const defaults = catalog.map(item => item.key);
    const saved = ["calloutWarning", "plugin:example:item", "paragraph", "callout", "calloutNote"];
    const profile = normalizeEntryVisibilityImportProfile({name: "Custom", entries: {
        [`${path}.callout`]: false, [`${path}.calloutTip`]: false,
    }, orders: {[path]: saved}}, 6, {[path]: defaults});
    assert.equal(profile.entries[`${path}.callout`], false);
    assert.equal(profile.entries[`${path}.calloutTip`], false);
    assert.deepEqual(profile.orders[path], saved);
    const visible = ["paragraph", ...types].filter(key => profile.entries[`${path}.${key}`] !== false);
    const ordered = reorderEntrySlots(orderGutterTurnIntoItems(visible, key => key),
        resolveEntryOrder(defaults, saved, new Set()), key => key);
    assert.deepEqual(ordered.filter(key => saved.includes(key)), ["calloutWarning", "paragraph", "calloutNote"]);
    const source = readFileSync(resolve(process.cwd(), "src/protyle/gutter/index.ts"), "utf8");
    const quoteMenu = source.slice(source.indexOf('} else if (type === "NodeBlockquote" && allowStructuralMutation)'),
        source.indexOf('} else if (type === "NodeCallout" && allowStructuralMutation)'));
    assert.match(quoteMenu, /this\.calloutTypeMenus\(protyle, \[nodeElement as HTMLElement\]\)/);
    assert.doesNotMatch(quoteMenu, /Blockquote2Callout/);
});

test("saved conversion orders and visibility survive profile migration and default changes", () => {
    for (const multi of [false, true]) {
        const path = `gutter.${multi ? "multi" : "single"}.turnInto`;
        const defaults = getEntryCatalogChildren(path).map(item => item.key);
        const saved = legacyOrder(multi);
        saved.splice(2, 0, "plugin:example:item");
        const input = {name: "Custom", entries: {[`${path}.quote`]: false}, orders: {[path]: saved}};
        for (const version of [3, 4, 5, 6]) {
            const profile = normalizeEntryVisibilityImportProfile(input, version, {[path]: defaults});
            assert.deepEqual(profile, {...input, entries: {...input.entries, "editor.slash.menu.frequent": true}});
            assert.deepEqual(mergeEntryOrderPreservingUnknown(defaults, profile.orders[path]), saved);
            assert.deepEqual(resolveEntryOrder(defaults, profile.orders[path], new Set()),
                saved.filter(key => key !== "plugin:example:item"));
        }
        const custom = ["callout", "heading2", "paragraph", "list"];
        const resolved = resolveEntryOrder(defaults, custom, new Set());
        assert.deepEqual(resolved.filter(key => custom.includes(key)), custom);
        const items = orderGutterTurnIntoItems(custom, key => key);
        assert.deepEqual(reorderEntrySlots(items, resolved, key => key), custom);
    }
});

test("conversion ordering preserves plugin slots and separators", () => {
    const separator = {type: "separator"};
    const plugin = {id: "plugin:example:item"};
    const items: Array<{id?: string, type?: string}> = [
        {id: "list"}, plugin, {id: "quote"}, separator, {id: "heading2"}, {id: "paragraph"},
    ];
    const sorted = orderGutterTurnIntoItems(items, item => item.id);
    assert.deepEqual(sorted.map(item => item.id || item.type),
        ["paragraph", "plugin:example:item", "heading2", "separator", "list", "quote"]);
    assert.equal(sorted[1], plugin);
    assert.equal(sorted[3], separator);
    assert.notEqual(sorted[0].type, "separator");
    assert.notEqual(sorted[sorted.length - 1].type, "separator");
});

test("single, multiple and list-item menus share ordering before platform configuration", () => {
    const source = readFileSync(resolve(process.cwd(), "src/protyle/gutter/index.ts"), "utf8");
    assert.equal(Array.from(source.matchAll(/submenu: orderGutterTurnIntoItems\(turnIntoSubmenu, item => item.id\)/g)).length, 2);
    assert.match(source, /const submenu = this.listTurnIntoMenu\(protyle, selectsElement\);[\s\S]*?submenu: orderGutterTurnIntoItems\(submenu, item => item.id\)/);
});
