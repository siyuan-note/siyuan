import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import * as dockOrder from "./dockOrder";
import * as profileHelpers from "./profile";
import * as orderHelpers from "./order";

const frequentPath = "editor.slash.menu.frequent";
const rootPath = "editor.slash.menu";

const loadEditor = (id = "custom", initialEnabled = true, mobile = false) => {
    const listeners: Record<string, (event: any) => void> = {};
    const search = {value: "", addEventListener: (_event: string, callback: typeof listeners.input) => {
        listeners.search = callback;
    }};
    const browser = {innerHTML: "", addEventListener() {}, querySelectorAll: (): [] => [], querySelector: (): null => null};
    const view = {closed: false,
        querySelector: (selector: string) => ({
            ".b3-dialog__body": {innerHTML: ""},
            "[data-type='entry-browser']": browser,
            "[data-type='entry-search']": search,
            "[data-type='entry-section']": {innerHTML: ""},
            "[data-type='entry-mobile-options']": {innerHTML: ""},
            "[data-profile-field='name']": {focus() {}},
        }[selector]),
        addEventListener: (event: string, callback: typeof listeners.input) => { listeners[event] = callback; },
    };
    const entries = [{key: "frequent", label: () => "Frequently used"}, {key: "template", label: () => "Template"}, {key: "heading1", label: () => "Heading 1"}];
    const rootEntry = {key: "menu", label: () => "Slash menu", displayChildrenDirectly: true, children: entries};
    const sections = [{key: "editor.slash", label: () => "Slash menu", children: [rootEntry]}];
    const config = {active: "custom", profiles: [{id: "custom", name: "Custom", entries: {[frequentPath]: initialEnabled, [rootPath]: !mobile},
        orders: {[rootPath]: ["heading1", "template", "frequent"]}},
        {id: "other", name: "Other", entries: {[frequentPath]: initialEnabled}, orders: {}}]};
    const siyuan = {languages: new Proxy({slashMenuFrequent: "Frequently used"}, {
        get: (target, key) => target[key as keyof typeof target] || String(key),
    }), config: {appearance: {entryVisibility: config}}};
    let discardPrompts = 0;
    let allowDiscard = true;
    const writes: unknown[] = [];
    let nextID = 0;
    const emptyDock = dockOrder.createDockEntryOrderSnapshot({});
    const dependencies = {
        ...dockOrder, ...profileHelpers, ...orderHelpers,
        SLASH_MENU_FREQUENT_PATH: frequentPath,
        genUUID: () => `new-${++nextID}`,
        bindTouchOrder: () => () => {},
        SLASH_MENU_ROOT_PATH: "editor.slash.menu",
        ENTRY_PROFILE_FULL: "full", ENTRY_PROFILE_SIMPLE: "simple",
        entryCatalog: sections,
        getSettingsOwnerApp: (): undefined => undefined,
        getSettingsWindowHost: (): undefined => undefined,
        isSettingsWindow: () => false,
        getEditorToolbarCatalogSnapshot: (): [] => [],
        refreshToolbarCatalogEntries() {}, refreshTopBarCatalog() {}, refreshDockCatalog() {}, refreshSlashMenuCatalog() {},
        getDockEntryOrderSnapshot: () => emptyDock,
        createEntryProfileSnapshot: (template: string) => ({[frequentPath]: template === "full", [rootPath]: !mobile}),
        createEntryOrderSnapshot: () => ({}),
        getEntryPaths: () => [rootPath, frequentPath],
        isEntryVisible: (path: string, stopAt?: string) => path === frequentPath
            ? (stopAt === rootPath || !mobile) && siyuan.config.appearance.entryVisibility.profiles[0].entries[frequentPath]
            : !mobile,
        getConfiguredEntryVisibility: (path: string, stopAt?: string) => path === frequentPath
            ? (stopAt === rootPath || !mobile) && siyuan.config.appearance.entryVisibility.profiles[0].entries[frequentPath]
            : !mobile,
        isMobile: () => mobile,
        isInMobileApp: () => false,
        getHostCapabilities: () => ({importExport: false}),
        getEntryCatalogChildren: () => entries,
        getEntryCatalogPathChain: (_section: string, path: string) => [path],
        getEntryCatalogCustomDefaultVisibility: () => true,
        isEntryCatalogNodeConfigurable: () => true,
        isEntryOrderSortable: () => true,
        escapeAttr: (value: string) => value,
        escapeHtml: (value: string) => value,
        saveEntryVisibility: (value: typeof config) => { siyuan.config.appearance.entryVisibility = value; writes.push(value); },
        confirmDialog: (_title: string, _text: string, callback: () => void) => {
            discardPrompts++;
            if (allowDiscard) callback();
        },
    };
    const source = readFileSync(resolve("src/config/entryVisibility/ui.ts"), "utf8");
    const code = transpileModule(source + `
createEntryView = () => fixtureView;
removeEntryView = () => { fixtureView.closed = true; };
exports.open = openProfileEditor;
exports.create = createProfile;
exports.duplicate = duplicateProfile;`, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const exports = {} as {open: (root: any, id: string) => void;
        create: (template: string, current?: boolean) => Config.IEntryVisibilityProfile;
        duplicate: (profile: any) => Config.IEntryVisibilityProfile};
    runInNewContext(code, {exports, require: () => dependencies, window: {siyuan}, fixtureView: view});
    const root = {querySelector: (): null => null};
    const open = () => { view.closed = false; exports.open(root, id); };
    open();
    return {browser, view, writes, open, create: exports.create, duplicate: exports.duplicate,
        config: () => siyuan.config.appearance.entryVisibility,
        enabled: () => siyuan.config.appearance.entryVisibility.profiles[0].entries[frequentPath],
        discardPrompts: () => discardPrompts,
        preventDiscard: () => { allowDiscard = false; },
        toggle: (checked: boolean) => listeners.change({target: {dataset: {entryPath: frequentPath}, checked, matches: () => true}}),
        template: (value: string) => listeners.change({target: {dataset: {profileField: "template"}, value, matches: () => false}}),
        rerender: () => listeners.search({}),
        search: (value: string) => { search.value = value; listeners.search({}); },
        action: (action: string) => listeners.click({target: {closest: (selector: string) =>
            selector === "[data-action]" ? {dataset: {action, entryParent: rootPath}} : null}}),
    };
};

const frequentRow = (html: string) => html.match(/<label[^>]*>\s*<span[^>]*>Frequently used<\/span>[\s\S]*?<\/label>/)?.[0];

for (const mobile of [false, true]) {
    test(`frequent is a pinned profile row on ${mobile ? "mobile" : "desktop"}`, () => {
        const fixture = loadEditor("custom", true, mobile);
        const row = frequentRow(fixture.browser.innerHTML);
        assert.ok(row);
        assert.match(row, /data-entry-path="editor.slash.menu.frequent"/);
        assert.match(row, / checked/);
        assert.doesNotMatch(row, /draggable|config-entry-visibility__drag|readonly|disabled/);
        assert.ok(fixture.browser.innerHTML.indexOf(row) < fixture.browser.innerHTML.indexOf('data-entry-key="template"'));
        fixture.action("reset-entry-order");
        assert.ok(fixture.browser.innerHTML.indexOf(frequentRow(fixture.browser.innerHTML)) <
            fixture.browser.innerHTML.indexOf('data-entry-key="template"'));
        fixture.toggle(false);
        fixture.action("confirm");
        assert.equal(fixture.enabled(), false);
        assert.equal(fixture.config().profiles[1].entries[frequentPath], true);
        assert.equal(fixture.writes.length, 1);
        fixture.open();
        assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), / checked/);
    });

    test(`built-in frequent defaults are readonly on ${mobile ? "mobile" : "desktop"}`, () => {
        for (const id of ["simple", "full"]) {
            const fixture = loadEditor(id, true, mobile);
            const row = frequentRow(fixture.browser.innerHTML);
            assert.match(row, /data-entry-readonly/);
            assert.equal(/ checked/.test(row), id === "full");
            fixture.toggle(id !== "full");
            fixture.rerender();
            assert.equal(/ checked/.test(frequentRow(fixture.browser.innerHTML)), id === "full");
            fixture.action("cancel");
            assert.equal(fixture.discardPrompts(), 0);
            assert.equal(fixture.writes.length, 0);
        }
    });

    test(`custom frequent drafts cancel and search correctly on ${mobile ? "mobile" : "desktop"}`, () => {
        for (const action of ["cancel", "back"]) {
            const fixture = loadEditor("custom", true, mobile);
            const original = JSON.stringify(fixture.config());
            fixture.toggle(false);
            fixture.search("frequently used");
            assert.ok(frequentRow(fixture.browser.innerHTML));
            assert.doesNotMatch(fixture.browser.innerHTML, /data-entry-key="template"|config-entry-visibility__drag/);
            assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), / checked/);
            fixture.search("");
            fixture.rerender();
            assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), / checked/);
            assert.equal(fixture.enabled(), true);
            fixture.action(action);
            assert.equal(fixture.discardPrompts(), 1);
            assert.equal(fixture.view.closed, true);
            assert.equal(fixture.writes.length, 0);
            assert.equal(JSON.stringify(fixture.config()), original);
            fixture.open();
            assert.match(frequentRow(fixture.browser.innerHTML), / checked/);
        }
    });

    test(`copy and template choices preserve frequent semantics on ${mobile ? "mobile" : "desktop"}`, () => {
        const fixture = loadEditor("custom", true, mobile);
        assert.equal(fixture.create("simple").entries[frequentPath], false);
        assert.equal(fixture.create("full").entries[frequentPath], true);
        assert.equal(fixture.create("full", true).entries[frequentPath], true);
        const copy = fixture.duplicate(fixture.config().profiles[0]);
        assert.equal(copy.entries[frequentPath], true);
        copy.entries[frequentPath] = false;
        assert.equal(fixture.enabled(), true);
        fixture.template("simple");
        assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), / checked/);
        fixture.template("full");
        assert.match(frequentRow(fixture.browser.innerHTML), / checked/);
        fixture.template("current");
        assert.match(frequentRow(fixture.browser.innerHTML), / checked/);
        fixture.action("cancel");
        assert.equal(fixture.enabled(), true);
    });
}

test("declining discard preserves a pending frequent profile change until Confirm", () => {
    const fixture = loadEditor();
    fixture.preventDiscard();
    fixture.toggle(false);
    fixture.action("cancel");
    assert.equal(fixture.view.closed, false);
    assert.equal(fixture.writes.length, 0);
    fixture.action("confirm");
    assert.equal(fixture.enabled(), false);
    assert.equal(fixture.writes.length, 1);
});

test("all bundled languages include a tab-indented frequent slash translation", () => {
    const files = readdirSync("appearance/langs").filter(file => file.endsWith(".json"));
    assert.equal(files.length, 22);
    for (const file of files) {
        const source = readFileSync(resolve("appearance/langs", file), "utf8");
        const language = JSON.parse(source);
        assert.ok(language.slashMenuFrequent.trim(), file);
        assert.match(source, /^\t"slashMenuFrequent":/m, file);
    }
});
