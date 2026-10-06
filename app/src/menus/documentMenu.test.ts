import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {posix} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getEntryCatalogChildren} from "../config/entryVisibility/catalog";

const {parse} = require("ifdef-loader/preprocessor");

const setup = (mobile = false, readonly = false) => {
    const exports = {} as typeof import("./navigation");
    const items: IMenu[] = [];
    const requests: {url: string, data: unknown}[] = [];
    const histories: Parameters<typeof import("../history/doc").openDocHistory>[0][] = [];
    const databases: unknown[][] = [];
    const deletions: string[][] = [];
    const moves: unknown[] = [];
    const events: {detail: {elements: NodeListOf<HTMLElement>, items: {id: string}[]}}[] = [];
    const created: unknown[][] = [];
    const menuAttributes = new Map<string, string>();
    const menu = {element: {setAttribute: (name: string, value: string) => menuAttributes.set(name, value)},
        remove: () => { items.length = 0; }, append: (item: IMenu) => { if (!item.ignore) { items.push(item); } }};
    const keymap = Object.fromEntries(["addToDatabase", "spaceRepetition", "quickMakeCard", "search", "replace", "duplicate"]
        .map(key => [key, {custom: ""}]));
    runInNewContext(transpileModule(parse(readFileSync("src/menus/navigation.ts", "utf8"),
        {MOBILE: mobile, BROWSER: true}, false, true, "navigation.ts"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {
        exports,
        require: (name: string) => {
            const dependencies: Record<string, unknown> = {
                "./Menu": {MenuItem: class {element: IMenu; constructor(item: IMenu) { this.element = item; }}},
                "./commonMenuItem": {copySubMenu: () => [{id: "copyID"}], exportMd: () => ({id: "export"}),
                    movePathToMenu: (paths: string[], notebooks: string[]) => {
                        moves.push({paths, notebooks}); return {id: "move"};
                    }, renameMenu: () => ({id: "rename"})},
                "../util/pathName": {pathPosix: () => posix, isEncryptedBox: () => false,
                    getDisplayName: (name: string) => name.replace(/\.sy$/, "")},
                "../util/pinnedDocs": {pinnedDocIDs: new Set()},
                "../util/fetch": {fetchPost: (url: string, data: unknown, callback?: (response: unknown) => void) => {
                    requests.push({url, data}); callback?.({code: 0, data: {ial: {}}});
                }},
                "../util/contractFormData": {ContractFormData: class {}},
                "../constants": {Constants: {MENU_DOC_TREE_MORE: "doctree", MENU_FROM_DOC_TREE_MORE_DOC: "doc"}},
                "../util/newFile": {newFileInTree: (...args: unknown[]) => created.push(args)},
                "../protyle/util/hasClosest": {hasClosestByTag: (row: {tree: unknown}) => row.tree},
                "../editor/deleteFile": {deleteFile: (...args: string[]) => deletions.push(args)},
                "../layout/tabUtil": {getDockByType: (): undefined => undefined},
                "../history/doc": {openDocHistory: (options: typeof histories[number]) => histories.push(options)},
                "./util": {openEditorTab: () => menu.append({id: "openBy"})},
                "../plugin/EventBus": {emitOpenMenu: (event: typeof events[number]) => {
                    events.push(event); menu.append({id: "separator_pluginTop", type: "separator"}); menu.append({id: "plugin"});
                }},
                "../protyle/render/av/addToDatabase": {addBlocksToDatabase: (...args: unknown[]) => databases.push(args)},
                "../util/fileTreeSort": {getConfiguredChildrenSortMode: () => 0, isCustomFileTreeList: () => false},
                "../util/hostCapabilities": {getHostCapabilities: () => ({documentImportExport: true})},
            };
            return dependencies[name] || {};
        },
        window: {siyuan: {menus: {menu}, languages: {}, mobile: {docks: {}},
            config: {readonly, fileTree: {parentDocClickExpand: true}, flashcard: {deck: true},
                keymap: {general: keymap, editor: {general: keymap}}}}},
    });
    const options: Parameters<typeof exports.initDocumentMenu>[1] = {
        id: "doc", notebookId: "notebook", path: "/parent/doc.sy", name: "Document",
        subFileCount: 2, childrenSortMode: 0, customSort: false,
        target: {} as HTMLElement, elements: [] as unknown as NodeListOf<HTMLElement>,
        position: {x: 100, y: 120}, readonlyHistory: true,
    };
    const open = (overrides: Partial<typeof options> = {}) => exports.initDocumentMenu({} as Parameters<typeof exports.initDocumentMenu>[0],
        {...options, ...overrides});
    const click = (id: string) => {
        const item = items.find(item => item.id === id);
        assert.ok(item, id);
        return item.click(null, null);
    };
    return {exports, open, click, options, items, requests, histories, databases, deletions, moves, events, created, menuAttributes};
};

for (const mobile of [false, true]) {
    test(`complete document menu uses explicit document targets without a tree row (${mobile ? "mobile" : "desktop"})`, () => {
        const {open, click, items, moves, deletions, databases, histories, events, options} = setup(mobile);
        open();
        assert.deepEqual(items.map(item => item.id), [
            ...(mobile ? ["openInNewTab", "separator_open"] : []),
            "openDocument", "newSiblingDoc", "separator_1", "copy", "move", "addToDatabase", "delete", "separator_2",
            "rename", "attr", "pinDoc", "sort", "riffCard", "search", "replace", "separator_3", "openBy", "fileHistory",
            "import", "export", "separator_pluginTop", "plugin",
        ]);
        click("delete");
        assert.deepEqual(deletions, [["notebook", "/parent/doc.sy"]]);
        assert.equal(JSON.stringify(moves), '[{"paths":["/parent/doc.sy"],"notebooks":["notebook"]}]');
        click("addToDatabase");
        assert.equal(JSON.stringify(databases[0][0]), '["doc"]');
        assert.equal(databases[0][1], options.target);
        assert.equal(databases[0][2], options.position);
        click("fileHistory");
        assert.equal(histories[0].id, "doc");
        assert.equal(histories[0].readonly, true);
        assert.equal(events[0].detail.elements, options.elements);
        assert.equal(events[0].detail.items[0].id, "doc");
    });
}

test("document menu keeps the existing configurable IDs, hierarchy and built-in order", () => {
    const {open, items, menuAttributes} = setup();
    open();
    const catalog = getEntryCatalogChildren("docTree.document").map(item => item.key);
    const keys = items.filter(item => item.id !== "plugin" && item.id !== "separator_pluginTop").map(item => item.id);
    assert.deepEqual(keys, catalog.filter(key => keys.includes(key)));
    assert.equal(menuAttributes.get("data-name"), "doctree");
    assert.equal(menuAttributes.get("data-from"), "doc");
});

test("document menu applies inherited custom sorting and updates sort mode without a mounted file dock", () => {
    const {open, click, items, created, requests} = setup();
    open({customSort: true});
    click("newDocAbove");
    assert.equal(created[0][1], "notebook");
    assert.equal(created[0][2], "/parent");
    assert.equal(JSON.stringify(created[0][3]), '{"targetID":"doc","position":"before"}');
    assert.ok(!items.some(item => item.id === "newSiblingDoc"));
    const sort = items.find(item => item.id === "sort").submenu as IMenu[];
    assert.equal(sort.find(item => item.id === "fileNameASC").checked, true);
    sort.find(item => item.id === "sortByParent").click(null, null);
    assert.equal(requests[0].url, "/api/filetree/setDocSortMode");
    assert.equal(JSON.stringify(requests[0].data), '{"id":"doc","sortMode":null}');
});

test("readonly document menu retains opening and export while respecting existing mutation and history restrictions", () => {
    const {open, items} = setup(false, true);
    open();
    assert.deepEqual(items.map(item => item.id), ["openDocument", "openBy", "export", "separator_pluginTop", "plugin"]);
});

test("notebook documents do not expose regular document deletion, moving, renaming or duplication", () => {
    const {open, items} = setup();
    open({id: "notebook", path: "/notebook.sy", customSort: true});
    assert.ok(!items.some(item => ["delete", "move", "rename", "sort", "newDocAbove", "newDocBelow", "newSiblingDoc"].includes(item.id)));
    const copy = items.find(item => item.id === "copy").submenu as IMenu[];
    assert.ok(copy.filter(item => ["duplicate", "duplicateTree"].includes(item.id)).every(item => item.ignore));
});

test("document tree adapter preserves its real selection in plugin events", () => {
    const {exports, options, events} = setup();
    const rows = [options.target] as unknown as NodeListOf<HTMLElement>;
    const row = {tree: {querySelectorAll: () => rows}, classList: {contains: () => true},
        getAttribute: (name: string) => ({"data-node-id": "doc", "data-name": "Document.sy", "data-count": "2"})[name],
        parentElement: {}};
    exports.initFileMenu({} as Parameters<typeof exports.initFileMenu>[0], "notebook", "/doc.sy", row as unknown as Element);
    assert.equal(events[0].detail.elements, rows);
});

test("import reload tolerates a document absent from the file tree", () => {
    const {open, items, requests} = setup();
    open();
    const item = (items.find(item => item.id === "import").submenu as IMenu[])[0];
    let change: (event: unknown) => void;
    item.bind({querySelector: () => ({addEventListener: (_name: string, callback: typeof change) => { change = callback; }})} as unknown as HTMLElement);
    change({target: {files: [{}]}});
    assert.equal(requests[0].url, "/api/import/importSY");
});
