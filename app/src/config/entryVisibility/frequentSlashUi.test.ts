import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import * as dockOrder from "./dockOrder";

const loadEditor = (builtin = false, initialEnabled = true) => {
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
            "[data-profile-field='name']": {focus() {}},
        }[selector]),
        addEventListener: (event: string, callback: typeof listeners.input) => { listeners[event] = callback; },
    };
    const entries = [{key: "template", label: () => "Template"}, {key: "heading1", label: () => "Heading 1"}];
    const rootEntry = {key: "menu", label: () => "Slash menu", displayChildrenDirectly: true, children: entries};
    const sections = [{key: "editor.slash", label: () => "Slash menu", children: [rootEntry]}];
    const config = {active: "custom", profiles: [{id: "custom", name: "Custom", entries: {}, orders: {}}]};
    const siyuan = {languages: new Proxy({slashMenuFrequent: "Frequently used"}, {
        get: (target, key) => target[key as keyof typeof target] || String(key),
    }), config: {appearance: {entryVisibility: config}}};
    let enabled = initialEnabled;
    let discardPrompts = 0;
    let allowDiscard = true;
    const writes: boolean[] = [];
    const emptyDock = dockOrder.createDockEntryOrderSnapshot({});
    const dependencies = {
        ...dockOrder,
        SLASH_MENU_ROOT_PATH: "editor.slash.menu",
        ENTRY_PROFILE_FULL: "full", ENTRY_PROFILE_SIMPLE: "simple",
        entryCatalog: sections,
        getSettingsOwnerApp: (): undefined => undefined,
        getSettingsWindowHost: (): undefined => undefined,
        isSettingsWindow: () => false,
        getEditorToolbarCatalogSnapshot: (): [] => [],
        refreshToolbarCatalogEntries() {}, refreshTopBarCatalog() {}, refreshDockCatalog() {}, refreshSlashMenuCatalog() {},
        getDockEntryOrderSnapshot: () => emptyDock,
        createEntryProfileSnapshot: () => ({}), createEntryOrderSnapshot: () => ({}),
        isMobile: () => false,
        isInMobileApp: () => false,
        isFrequentSlashEnabled: () => enabled,
        setFrequentSlashEnabled: (value: boolean) => { enabled = value; writes.push(value); },
        getHostCapabilities: () => ({importExport: false}),
        getEntryCatalogChildren: () => entries,
        getEntryCatalogPathChain: (_section: string, path: string) => [path],
        getSavedEntryOrder: (): undefined => undefined,
        resolveEntryOrder: (order: string[]) => order,
        getProfileEntryVisibility: () => true,
        getEntryCatalogCustomDefaultVisibility: () => true,
        isEntryCatalogNodeConfigurable: () => true,
        isEntryOrderSortable: () => true,
        escapeAttr: (value: string) => value,
        escapeHtml: (value: string) => value,
        saveEntryVisibility: (value: typeof config) => { siyuan.config.appearance.entryVisibility = value; },
        confirmDialog: (_title: string, _text: string, callback: () => void) => {
            discardPrompts++;
            if (allowDiscard) callback();
        },
    };
    const source = readFileSync(resolve("src/config/entryVisibility/ui.ts"), "utf8");
    const code = transpileModule(source + `
createEntryView = () => fixtureView;
removeEntryView = () => { fixtureView.closed = true; };
exports.open = openProfileEditor;`, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const exports = {} as {open: (root: any, id: string) => void};
    runInNewContext(code, {exports, require: () => dependencies, window: {siyuan}, fixtureView: view});
    const root = {querySelector: (): null => null};
    const open = () => { view.closed = false; exports.open(root, builtin ? "full" : "custom"); };
    open();
    return {browser, view, writes, open,
        config: () => siyuan.config.appearance.entryVisibility,
        enabled: () => enabled,
        discardPrompts: () => discardPrompts,
        preventDiscard: () => { allowDiscard = false; },
        externalChange: (value: boolean) => { enabled = value; },
        toggle: (checked: boolean) => listeners.change({target: {dataset: {type: "slash-menu-frequent"}, checked}}),
        rerender: () => listeners.search({}),
        search: (value: string) => { search.value = value; listeners.search({}); },
        action: (action: string) => listeners.click({target: {closest: (selector: string) =>
            selector === "[data-action]" ? {dataset: {action}} : null}}),
    };
};

const frequentRow = (html: string) => html.match(/<label[^>]*>\s*<span[^>]*>Frequently used<\/span>[\s\S]*?<\/label>/)?.[0];

test("frequent slash setting uses the first compact row without profile or drag identifiers", () => {
    const fixture = loadEditor();
    const row = frequentRow(fixture.browser.innerHTML);
    assert.ok(row);
    assert.match(row, /config-entry-visibility__row--toggleable/);
    assert.match(row, /class="b3-switch"[^>]*data-type="slash-menu-frequent"[^>]* checked/);
    assert.doesNotMatch(row, /data-entry-|draggable|config-entry-visibility__drag|readonly|disabled/);
    assert.ok(fixture.browser.innerHTML.indexOf(row) < fixture.browser.innerHTML.indexOf('data-entry-key="template"'));
    assert.equal(fixture.writes.length, 0);
});

test("custom frequent slash changes are staged across rerenders and discarded on Cancel or Back", () => {
    for (const action of ["cancel", "back"]) {
        const fixture = loadEditor();
        const profile = JSON.stringify(fixture.config());
        fixture.toggle(false);
        fixture.rerender();
        assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), / checked/);
        assert.equal(fixture.enabled(), true);
        assert.equal(fixture.writes.length, 0);
        fixture.action(action);
        assert.equal(fixture.discardPrompts(), 1);
        assert.equal(fixture.view.closed, true);
        assert.equal(JSON.stringify(fixture.config()), profile);
        fixture.open();
        assert.match(frequentRow(fixture.browser.innerHTML), / checked/);
    }
});

test("searching the frequent label finds its workspace switch without adding a profile entry", () => {
    const fixture = loadEditor();
    const profile = JSON.stringify(fixture.config());
    fixture.toggle(false);
    fixture.search("frequently used");
    assert.ok(frequentRow(fixture.browser.innerHTML));
    assert.doesNotMatch(fixture.browser.innerHTML, /data-entry-key="template"|config-entry-visibility__drag/);
    assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), / checked/);
    fixture.search("");
    assert.match(fixture.browser.innerHTML, /data-entry-key="template"/);
    assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), / checked/);
    assert.equal(JSON.stringify(fixture.config()), profile);
});

test("custom frequent slash changes persist only with Confirm and stay out of profiles", () => {
    const fixture = loadEditor();
    const profile = JSON.stringify(fixture.config());
    fixture.toggle(false);
    fixture.action("confirm");
    assert.deepEqual(fixture.writes, [false]);
    assert.equal(fixture.enabled(), false);
    assert.equal(fixture.view.closed, true);
    assert.equal(JSON.stringify(fixture.config()), profile);
    fixture.open();
    assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), / checked/);
});

test("declining discard preserves a pending frequent slash change until Confirm", () => {
    const fixture = loadEditor();
    fixture.preventDiscard();
    fixture.toggle(false);
    fixture.action("cancel");
    assert.equal(fixture.view.closed, false);
    assert.equal(fixture.writes.length, 0);
    fixture.action("confirm");
    assert.deepEqual(fixture.writes, [false]);
});

test("unchanged or reverted custom settings do not overwrite a newer workspace preference", () => {
    for (const reverted of [false, true]) {
        const fixture = loadEditor();
        if (reverted) {
            fixture.toggle(false);
            fixture.toggle(true);
        }
        fixture.externalChange(false);
        fixture.action("confirm");
        assert.equal(fixture.enabled(), false);
        assert.equal(fixture.writes.length, 0);
    }
});

test("built-in profile viewers apply the independent workspace switch immediately", () => {
    const fixture = loadEditor(true);
    const profile = JSON.stringify(fixture.config());
    assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), /readonly|disabled/);
    assert.match(fixture.browser.innerHTML, /data-entry-readonly/);
    fixture.toggle(false);
    assert.deepEqual(fixture.writes, [false]);
    fixture.rerender();
    assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), / checked/);
    fixture.action("cancel");
    assert.equal(fixture.discardPrompts(), 0);
    assert.equal(fixture.view.closed, true);
    assert.equal(JSON.stringify(fixture.config()), profile);
    fixture.open();
    assert.doesNotMatch(frequentRow(fixture.browser.innerHTML), / checked/);
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
