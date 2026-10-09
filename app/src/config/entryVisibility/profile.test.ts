import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
    getEntryCatalogChildren,
    getEntryCatalogCustomDefaultVisibility,
    getEntryCatalogDefaultVisibility,
    getEntryCatalogNode,
} from "./catalog";
import {TOOLBAR_ENTRY_ROOT_PATH} from "../../protyle/toolbar/defaults";
import {
    getBuiltinProfileEntryVisibility,
    getProfileEntryVisibility,
    getSavedEntryOrder,
    isEntryVisibilityImportVersionSupported,
    normalizeEntryVisibilityImportProfile,
    resetEntryProfileOrder,
} from "./profile";
import {getMobileToolbarContextPath} from "./mobileToolbarContext";
import {mergeEntryOrderPreservingUnknown, resolveEntryOrder} from "./order";

const frequentPath = "editor.slash.menu.frequent";

test("mobile toolbar contexts expose relevant entries and hide caret references by default", () => {
    const input = getMobileToolbarContextPath(false);
    const selection = getMobileToolbarContextPath(true);
    const inputKeys = getEntryCatalogChildren(input).map(item => item.key);
    const selectionKeys = getEntryCatalogChildren(selection).map(item => item.key);
    assert.ok(inputKeys.includes("mobile-add") && inputKeys.includes("mobile-indent") && inputKeys.includes("block-ref"));
    assert.equal(inputKeys.includes("strong"), false);
    assert.ok(selectionKeys.includes("strong") && selectionKeys.includes("block-ref"));
    assert.equal(selectionKeys.some(key => key.startsWith("mobile-")), false);
    assert.equal(selectionKeys.includes("block-type"), false);
    for (const template of ["full", "simple"] as const) {
        for (const [path, expected] of [[`${input}.block-ref`, false], [`${selection}.block-ref`, true]] as const) {
            const node = getEntryCatalogNode(path);
            assert.equal(getBuiltinProfileEntryVisibility(template, node.simple,
                getEntryCatalogDefaultVisibility(path)), expected);
        }
    }
});

test("mobile context visibility inherits legacy choices and permits independent overrides", () => {
    const input = getMobileToolbarContextPath(false);
    const selection = getMobileToolbarContextPath(true);
    const profile: {entries: Record<string, boolean>} = {entries: {"editor.toolbar.block-ref": false}};
    assert.equal(getProfileEntryVisibility(profile, `${input}.block-ref`,
        getEntryCatalogCustomDefaultVisibility(`${input}.block-ref`)), false);
    assert.equal(getProfileEntryVisibility(profile, `${selection}.block-ref`, true), false);
    profile.entries[`${selection}.block-ref`] = true;
    assert.equal(getProfileEntryVisibility(profile, `${selection}.block-ref`, false), true);
    assert.equal(getProfileEntryVisibility(profile, `${input}.block-ref`,
        getEntryCatalogCustomDefaultVisibility(`${input}.block-ref`)), false);
    assert.equal(getProfileEntryVisibility(profile, "editor.toolbar.block-ref", true), false);
    assert.equal(getProfileEntryVisibility({entries: {}}, `${input}.block-ref`,
        getEntryCatalogCustomDefaultVisibility(`${input}.block-ref`)), false);
    assert.equal(getProfileEntryVisibility({entries: {"editor.toolbar.block-ref": true}}, `${input}.block-ref`,
        getEntryCatalogCustomDefaultVisibility(`${input}.block-ref`)), false);
});

test("mobile context orders retain legacy plugin slots and reset independently", () => {
    const input = getMobileToolbarContextPath(false);
    const selection = getMobileToolbarContextPath(true);
    const legacy = ["strong", "plugin:disabled:item", "block-ref", "mobile-add", "mobile-block"];
    const profile: Pick<Config.IEntryVisibilityProfile, "orders" | "entries" | "name"> = {
        orders: {"editor.toolbar": legacy}, entries: {}, name: "Custom",
    };
    const defaults = ["mobile-add", "mobile-block", "block-ref"];
    const inherited = getSavedEntryOrder(profile, input, defaults);
    assert.deepEqual(inherited, ["plugin:disabled:item", "block-ref", "mobile-add", "mobile-block"]);
    profile.orders[input] = mergeEntryOrderPreservingUnknown(defaults, inherited,
        ["mobile-block", "mobile-add", "block-ref"]);
    assert.ok(profile.orders[input].includes("plugin:disabled:item"));
    assert.deepEqual(getSavedEntryOrder(profile, selection, ["block-ref", "strong"]),
        ["strong", "plugin:disabled:item", "block-ref"]);
    assert.deepEqual(profile.orders["editor.toolbar"], legacy);
    resetEntryProfileOrder(profile, input);
    assert.deepEqual(resolveEntryOrder(defaults, getSavedEntryOrder(profile, input, defaults), new Set()), defaults);
    assert.deepEqual(profile.orders["editor.toolbar"], legacy);
    assert.deepEqual(normalizeEntryVisibilityImportProfile(profile, 6, {}), {
        ...profile, entries: {[frequentPath]: true},
    });
});

test("chart height migration retains shared visibility and plugin order", () => {
    for (const existing of [undefined, true, false]) {
        const entries: Record<string, boolean> = {"gutter.single.chart.height": false};
        if (existing !== undefined) {
            entries["gutter.single.height"] = existing;
        }
        const profile = normalizeEntryVisibilityImportProfile({name: "Custom", entries, orders: {
            "gutter.single": ["pluginBefore", "width", "height", "pluginAfter"],
            "gutter.single.chart": ["pluginBefore", "height", "update", "pluginAfter"],
        }}, 6, {});
        assert.deepEqual(profile.entries, {"gutter.single.height": existing ?? false, [frequentPath]: true});
        assert.deepEqual(profile.orders, {
            "gutter.single": ["pluginBefore", "width", "height", "pluginAfter"],
            "gutter.single.chart": ["pluginBefore", "update", "pluginAfter"],
        });
        assert.deepEqual(normalizeEntryVisibilityImportProfile(profile, 6, {}), profile);
    }
});

test("task state imports match kernel migrations and remain stable on reimport", () => {
    const fixtures = JSON.parse(readFileSync(resolve(process.cwd(), "../kernel/conf/testdata/task_status_menu.json"), "utf8"));
    for (const fixture of fixtures) {
        const profile = normalizeEntryVisibilityImportProfile({name: "Custom", ...fixture.input}, 5, {});
        assert.deepEqual(profile, {name: "Custom", ...fixture.expected,
            entries: {...fixture.expected.entries, [frequentPath]: true}}, fixture.name);
        assert.deepEqual(normalizeEntryVisibilityImportProfile(profile, 6, {}), profile);
        assert.deepEqual(normalizeEntryVisibilityImportProfile(profile, 5, {}), profile);
    }
});

test("database submenu migration preserves visibility, order and plugin slots", () => {
    const profile = normalizeEntryVisibilityImportProfile({
        name: "Custom",
        entries: {"gutter.single.exportCSV": false, "gutter.single.showDatabaseInFolder": true},
        orders: {"gutter.single": ["pluginBefore", "separator_exportCSV", "showDatabaseInFolder", "pluginMiddle", "exportCSV", "pluginAfter"]},
    }, 4, {});
    assert.deepEqual(profile.entries, {
        "gutter.single.database.exportCSV": false,
        "gutter.single.database.showDatabaseInFolder": true,
        [frequentPath]: true,
    });
    assert.deepEqual(profile.orders, {
        "gutter.single": ["pluginBefore", "separator_exportCSV", "database", "pluginMiddle", "pluginAfter"],
        "gutter.single.database": ["showDatabaseInFolder", "exportCSV"],
    });
    assert.deepEqual(normalizeEntryVisibilityImportProfile(profile, 5, {}), profile);
});

test("font toolbar entries are visible in Full, hidden in Simple and preserve explicit profile choices", () => {
    for (const key of ["font-family", "font-size"]) {
        const path = `${TOOLBAR_ENTRY_ROOT_PATH}.${key}`;
        const defaultVisible = getEntryCatalogDefaultVisibility(path);
        const entry = getEntryCatalogNode(path);
        assert.equal(defaultVisible, true);
        assert.equal(getBuiltinProfileEntryVisibility("full", entry.simple, defaultVisible), true);
        assert.equal(getBuiltinProfileEntryVisibility("simple", entry.simple, defaultVisible), false);
        const customDefaultVisible = getEntryCatalogCustomDefaultVisibility(path);
        assert.equal(customDefaultVisible, false);
        assert.equal(getProfileEntryVisibility({entries: {}}, path, customDefaultVisible), false);
        assert.equal(getProfileEntryVisibility({entries: {[path]: true}}, path, customDefaultVisible), true);
        assert.equal(getProfileEntryVisibility({entries: {[path]: false}}, path, customDefaultVisible), false);
    }
    assert.equal(getEntryCatalogDefaultVisibility(`${TOOLBAR_ENTRY_ROOT_PATH}.text`), true);
    assert.equal(getEntryCatalogCustomDefaultVisibility(`${TOOLBAR_ENTRY_ROOT_PATH}.text`), true);
});

test("mobile font entries default to hidden and preserve explicit profile choices", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {configurable: true, value: {siyuan: {mobile: {}}}});
    try {
        for (const key of ["font-family", "font-size"]) {
            const path = `${TOOLBAR_ENTRY_ROOT_PATH}.${key}`;
            const defaultVisible = getEntryCatalogDefaultVisibility(path);
            const entry = getEntryCatalogNode(path);
            assert.equal(defaultVisible, false);
            assert.equal(getBuiltinProfileEntryVisibility("full", entry.simple, defaultVisible), false);
            assert.equal(getBuiltinProfileEntryVisibility("simple", entry.simple, defaultVisible), false);
            const customDefaultVisible = getEntryCatalogCustomDefaultVisibility(path);
            assert.equal(getProfileEntryVisibility({entries: {}}, path, customDefaultVisible), false);
            assert.equal(getProfileEntryVisibility({entries: {[path]: true}}, path, customDefaultVisible), true);
            assert.equal(getProfileEntryVisibility({entries: {[path]: false}}, path, customDefaultVisible), false);
        }
        assert.equal(getEntryCatalogDefaultVisibility(`${TOOLBAR_ENTRY_ROOT_PATH}.text`), true);
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, "window", descriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

test("built-in profiles honor entry defaults", () => {
    assert.equal(getBuiltinProfileEntryVisibility("full", false, true), true);
    assert.equal(getBuiltinProfileEntryVisibility("full", true, false), false);
    assert.equal(getBuiltinProfileEntryVisibility("simple", true, true), true);
    assert.equal(getBuiltinProfileEntryVisibility("simple", false, true), false);
    assert.equal(getBuiltinProfileEntryVisibility("simple", true, false), false);
    assert.equal(getBuiltinProfileEntryVisibility("simple", true, false, true), true);
    assert.equal(getBuiltinProfileEntryVisibility("full", true, false, true), false);
    assert.equal(getBuiltinProfileEntryVisibility("simple", true, true, false), false);
});

test("custom entry visibility preserves saved values", () => {
    const profile = {entries: {visible: true, hidden: false}};
    assert.equal(getProfileEntryVisibility(profile, "visible"), true);
    assert.equal(getProfileEntryVisibility(profile, "hidden"), false);
});

test("custom entry visibility shows missing entries", () => {
    assert.equal(getProfileEntryVisibility({entries: {}}, "new-entry"), true);
    assert.equal(getProfileEntryVisibility(undefined, "new-entry"), true);
});

test("custom entry visibility uses a caller-provided default only when the entry is missing", () => {
    const profile = {entries: {visible: true, hidden: false}};
    assert.equal(getProfileEntryVisibility(profile, "missing", false), false);
    assert.equal(getProfileEntryVisibility(profile, "visible", false), true);
    assert.equal(getProfileEntryVisibility(profile, "hidden", true), false);
});

test("entry visibility import supports versions 1 through 6", () => {
    for (const version of [1, 2, 3, 4, 5, 6]) {
        assert.equal(isEntryVisibilityImportVersionSupported(version, 6), true);
    }
    assert.equal(isEntryVisibilityImportVersionSupported(7, 6), false);
});

test("legacy entry visibility imports require base without persisting it", () => {
    const profile = normalizeEntryVisibilityImportProfile({
        name: "Legacy",
        base: "simple",
        entries: {visible: true, hidden: false, invalid: "false"},
        orders: {menu: ["known", 1, "plugin"]},
    }, 2, {});
    assert.deepEqual(profile, {
        name: "Legacy",
        entries: {visible: true, hidden: false, [frequentPath]: true},
        orders: {menu: ["known", "plugin"]},
    });
    assert.equal(normalizeEntryVisibilityImportProfile({
        name: "Legacy",
        entries: {},
    }, 2, {}), undefined);
});

test("current entry visibility imports do not require base", () => {
    const defaultOrders = {menu: ["default"]};
    assert.deepEqual(normalizeEntryVisibilityImportProfile({
        name: "Current",
        entries: {},
    }, 4, defaultOrders), {
        name: "Current",
        entries: {[frequentPath]: true},
        orders: defaultOrders,
    });
});

test("version 1 entry visibility imports use default orders", () => {
    const defaultOrders = {menu: ["default"]};
    assert.deepEqual(normalizeEntryVisibilityImportProfile({
        name: "Version 1",
        base: "full",
        entries: {},
    }, 1, defaultOrders), {
        name: "Version 1",
        entries: {[frequentPath]: true},
        orders: defaultOrders,
    });
});

test("version 3 entry visibility imports migrate the edit mode submenu", () => {
    assert.deepEqual(normalizeEntryVisibilityImportProfile({
        name: "Legacy edit mode",
        entries: {
            "document.more.editMode": true,
            "document.more.editMode.wysiwyg": false,
            "document.more.editMode.preview": false,
        },
        orders: {
            "document.more.editMode": ["preview", "wysiwyg"],
        },
    }, 3, {}), {
        name: "Legacy edit mode",
        entries: {"document.more.editMode": false, [frequentPath]: true},
        orders: {},
    });
});

test("version 3 entry visibility imports keep the merged mode entry when a legacy child is visible", () => {
    assert.deepEqual(normalizeEntryVisibilityImportProfile({
        name: "Partially visible edit mode",
        entries: {
            "document.more.editMode": true,
            "document.more.editMode.wysiwyg": false,
            "document.more.editMode.preview": true,
        },
    }, 3, {}), {
        name: "Partially visible edit mode",
        entries: {"document.more.editMode": true, [frequentPath]: true},
        orders: {},
    });
});

test("legacy profile imports materialize the frequent default across every supported version", () => {
    for (const version of [1, 2, 3, 4, 5, 6]) {
        const input = {name: "Legacy", base: "simple", entries: {"editor.slash.menu": false}};
        const profile = normalizeEntryVisibilityImportProfile(input, version, {});
        assert.equal(profile.entries[frequentPath], true);
        assert.equal(profile.entries["editor.slash.menu"], false);
        assert.equal(Object.prototype.hasOwnProperty.call(input.entries, frequentPath), false);
        const exported = JSON.parse(JSON.stringify({version: 6, profile}));
        assert.deepEqual(normalizeEntryVisibilityImportProfile(exported.profile, exported.version, {}), profile);
    }
});

test("frequent profile choices survive import and export without changing order or plugin entries", () => {
    for (const enabled of [false, true]) {
        const input = {name: "Custom", entries: {
            [frequentPath]: enabled, "editor.slash.menu.plugin:example:item": false,
        }, orders: {"editor.slash.menu": ["plugin:example:item", "template"]}};
        const profile = normalizeEntryVisibilityImportProfile(input, 6, {});
        assert.deepEqual(profile, input);
        const exported = JSON.parse(JSON.stringify({version: 6, profile}));
        assert.deepEqual(normalizeEntryVisibilityImportProfile(exported.profile, exported.version, {}), input);
    }
});

test("invalid imported frequent values use the explicit default", () => {
    for (const invalid of [null, "false", 0, {}, []]) {
        const profile = normalizeEntryVisibilityImportProfile({
            name: "Custom", entries: {[frequentPath]: invalid},
        }, 6, {});
        assert.deepEqual(profile.entries, {[frequentPath]: true});
    }
});
