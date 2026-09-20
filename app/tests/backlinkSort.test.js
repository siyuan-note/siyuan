const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");

const compiled = transpileModule(readFileSync("src/layout/dock/BacklinkContent.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createPanel = () => {
    const menuItems = [];
    const requests = [];
    const editor = {backlinkSort: 3, backmentionSort: 2, backlinkBlockSort: 0};
    const languages = new Proxy({}, {get: (_, key) => key});
    const exports = {};
    runInNewContext(compiled, {
        exports,
        require: () => ({
            Model: class {},
            MenuItem: class {
                constructor(options) { this.element = options; }
            },
            fetchPost: (path, data) => {
                requests.push({path, data: {...data}});
                return Promise.resolve();
            },
        }),
        window: {siyuan: {config: {editor}, languages, menus: {menu: {
            remove: () => { menuItems.length = 0; },
            append: item => menuItems.push(item),
        }}}},
    });
    const panel = Object.create(exports.BacklinkContent.prototype);
    panel.tree = {element: {querySelectorAll: () => []}};
    panel.contextRequestVersions = [0, 0];
    const record = open => ({
        headerElement: {querySelector: () => ({classList: {contains: () => open}})},
        contextDirty: false,
    });
    const opened = record(true);
    const folded = record(false);
    const mention = record(true);
    panel.itemRecords = [new Map([["open", opened], ["folded", folded]]), new Map([["mention", mention]])];
    const loaded = [];
    panel.loadContext = (header, isMention) => loaded.push({header, isMention});
    return {panel, editor, menuItems, requests, opened, folded, mention, loaded};
};

test("anchor sorting is independent, persisted, and refreshes only backlink contexts", () => {
    const state = createPanel();
    state.panel.showSortMenu("sort", "3");
    for (const label of ["backlinkDocumentSort", "backlinkBlockSort"]) {
        assert.equal(state.menuItems.find(item => item.label === label).iconHTML, "");
    }
    assert.equal(state.menuItems.find(item => item.label === "backlinkBodyOrder").checked, true);
    state.menuItems.find(item => item.label === "backlinkAnchorASC").click();
    assert.equal(state.editor.backlinkBlockSort, 1);
    assert.equal(state.editor.backlinkSort, 3);
    assert.equal(state.editor.backmentionSort, 2);
    assert.equal(state.requests[0].path, "/api/setting/setEditor");
    assert.equal(state.requests[0].data.backlinkBlockSort, 1);
    assert.equal(state.panel.contextRequestVersions[0], 1);
    assert.equal(state.panel.contextRequestVersions[1], 0);
    assert.equal(state.folded.contextDirty, true);
    assert.equal(state.mention.contextDirty, false);
    assert.equal(state.loaded.length, 1);
    assert.equal(state.loaded[0].header, state.opened.headerElement);
    assert.equal(state.loaded[0].isMention, false);
    state.panel.showSortMenu("sort", "3");
    assert.equal(state.menuItems.find(item => item.label === "backlinkAnchorASC").checked, true);
    state.menuItems.find(item => item.label === "backlinkAnchorDESC").click();
    assert.equal(state.editor.backlinkBlockSort, 2);
    state.panel.showSortMenu("sort", "3");
    state.menuItems.find(item => item.label === "backlinkBodyOrder").click();
    assert.equal(state.editor.backlinkBlockSort, 0);
});

test("mention sorting does not offer anchor sorting", () => {
    const state = createPanel();
    state.panel.showSortMenu("mSort", "2");
    assert.equal(state.menuItems.some(item => item.label?.startsWith("backlink")), false);
});

test("global sorting selects a flat mode and document sorting restores grouping", () => {
    const state = createPanel();
    let searches = 0;
    state.panel.searchBacklinks = () => searches++;
    state.panel.tree.element.previousElementSibling = {querySelector: () => ({setAttribute() {}})};
    state.panel.showSortMenu("sort", "3");
    const header = state.menuItems.findIndex(item => item.label === "backlinkGlobalSort");
    state.menuItems[header + 1].click();
    assert.equal(state.editor.backlinkGlobalSort, 1);
    assert.equal(state.requests[0].data.backlinkGlobalSort, 1);
    state.panel.showSortMenu("sort", "3");
    assert.equal(state.menuItems.filter(item => item.checked).length, 1);
    assert.equal(state.menuItems[header + 1].checked, true);
    state.menuItems[header + 2].click();
    assert.equal(state.editor.backlinkGlobalSort, 2);
    state.menuItems.find(item => item.label === "modifiedDESC").click();
    assert.equal(state.editor.backlinkGlobalSort, 0);
    assert.equal(searches, 3);
});
