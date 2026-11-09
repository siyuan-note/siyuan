import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {posix} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getEntryCatalogChildren} from "../config/entryVisibility/catalog";
import * as navigationSelection from "./navigationSelection";
import type {DocTreeController} from "../layout/dock/docTree/DocTreeController";
import type {IDocTreeItem} from "../layout/dock/docTree/types";

const {parse} = require("ifdef-loader/preprocessor");

const menuTarget = (id: string, notebookId = "notebook", kind: "document" | "notebook" = "document"): IDocTreeItem => ({
    id, notebookId, kind, path: kind === "notebook" ? "/" : `/${id}.sy`, name: id,
    subFileCount: 0, childrenSortMode: null, effectiveSortMode: 6, parentID: "", occurrenceKey: `${kind}:${id}`,
    depth: 0, index: 0, setSize: 1,
});

const setup = (mobile = false, readonly = false, controller?: Partial<DocTreeController>, subscribed = true, encrypted: string[] = []) => {
    const exports = {} as typeof import("./navigation");
    const items: IMenu[] = [];
    const requests: {url: string, data: unknown}[] = [];
    const renames: Parameters<typeof import("./commonMenuItem").renameMenu>[0][] = [];
    const histories: Parameters<typeof import("../history/doc").openDocHistory>[0][] = [];
    const databases: unknown[][] = [];
    const confirmations: unknown[][] = [];
    const icons: unknown[][] = [];
    const deletions: string[][] = [];
    const treeDeletions: unknown[][] = [];
    const moves: unknown[] = [];
    const events: {detail: {elements: NodeListOf<HTMLElement>, items: {
        id: string, path: string, notebookId: string, effectiveSortMode: number, childrenSortMode?: number | null,
    }[]}}[] = [];
    const fileTree = {parentDocTitleClickMode: 1, sort: 0};
    const created: unknown[][] = [];
    const flashcards: unknown[][] = [];
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
                    }, renameMenu: (options: typeof renames[number]) => { renames.push(options); return {id: "rename"}; }},
                "../util/pathName": {pathPosix: () => posix, isEncryptedBox: (id: string) => encrypted.includes(id),
                    getNotebookName: (id: string) => id,
                    getDisplayName: (name: string) => name.replace(/\.sy$/, "")},
                "../util/pinnedDocs": {pinnedDocIDs: new Set()},
                "../util/fetch": {fetchPost: (url: string, data: unknown, callback?: (response: unknown) => void) => {
                    requests.push({url, data}); callback?.({code: 0, data: {ial: {}}});
                }},
                "../config/util/resourceConfig": {
                    saveNotebookConf: (_id: string, _config: unknown, callback: (response: unknown) => void) => callback({code: 0}),
                    saveNotebookConfSync: async () => ({code: 0}),
                },
                "../dialog/mobileConfirmDialog": {mobileConfirmDialog: (...args: unknown[]) => confirmations.push(args)},
                "../emoji": {openEmojiPanel: (...args: unknown[]) => icons.push(args)},
                "../config/encryptedAssets": {canCleanEncryptedNotebookAssets: () => false},
                "../util/contractFormData": {ContractFormData: class {}},
                "../constants": {Constants: {MENU_DOC_TREE_MORE: "doctree", MENU_FROM_DOC_TREE_MORE_DOC: "doc", HELP_PATH: {}}},
                "../util/newFile": {newFileInTree: (...args: unknown[]) => created.push(args)},
                "../protyle/util/hasClosest": {hasClosestByTag: (row: {tree: unknown}) => row.tree},
                "../editor/deleteFile": {deleteFile: (...args: string[]) => deletions.push(args),
                    deleteDocTreeItems: (items: unknown[]) => treeDeletions.push(items)},
                "../layout/tabUtil": {getDockByType: (): undefined => undefined},
                "../layout/dock/docTree/DocTreeController": {getDocTreeController: () => controller},
                "../card/openCard": {openCardByScope: (_app: object, ...scope: unknown[]) => flashcards.push(["study", ...scope])},
                "../card/flashcardV2": {openFlashcardV2ManagementByRoots: (...scope: unknown[]) => flashcards.push(["manage", ...scope])},
                "../mobile/util/closePanel": {closePanel() {}},
                "../layout/dock/docTree/rowData": {getDocTreeItem: (element: Element) => controller?.getItemFromElement?.(element)},
                "./navigationSelection": navigationSelection,
                "../history/doc": {openDocHistory: (options: typeof histories[number]) => histories.push(options)},
                "./util": {openEditorTab: () => menu.append({id: "openBy"})},
                "../plugin/EventBus": {emitOpenMenu: (event: {detail: typeof events[number]["detail"] | (() => typeof events[number]["detail"])}) => {
                    if (!subscribed) return;
                    events.push({detail: typeof event.detail === "function" ? event.detail() : event.detail});
                    menu.append({id: "separator_pluginTop", type: "separator"}); menu.append({id: "plugin"});
                }},
                "../protyle/render/av/addToDatabase": {addBlocksToDatabase: (...args: unknown[]) => databases.push(args)},
                "../util/fileTreeSort": {getConfiguredChildrenSortMode: (element: Element) =>
                    controller?.getItemFromElement?.(element)?.childrenSortMode ?? null},
                "../util/hostCapabilities": {getHostCapabilities: () => ({documentImportExport: true})},
            };
            return dependencies[name] || {};
        },
        window: {siyuan: {notebooks: [], menus: {menu}, languages: {}, mobile: {docks: {}},
            config: {readonly, fileTree, flashcard: {deck: true},
                keymap: {general: keymap, editor: {general: keymap}}}}},
    });
    const options: Parameters<typeof exports.initDocumentMenu>[1] = {
        id: "doc", notebookId: "notebook", path: "/parent/doc.sy", name: "Document",
        subFileCount: 2, childrenSortMode: 0, effectiveSortMode: 0, customSort: false,
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
    return {exports, open, click, options, items, requests, renames, histories, databases, confirmations, icons, deletions, treeDeletions, moves, events, created, menuAttributes, flashcards, fileTree};
};

for (const mobile of [false, true]) {
    test(`document tree events expose each target's effective and declared sorting (${mobile ? "mobile" : "desktop"})`, () => {
        const inherited: IDocTreeItem = {...menuTarget("inherited"), effectiveSortMode: 7, childrenSortMode: null};
        const custom = {...menuTarget("custom"), effectiveSortMode: 6, childrenSortMode: 0};
        const notebook = {...menuTarget("notebook", "notebook", "notebook"), effectiveSortMode: 15};
        const otherNotebook = {...menuTarget("other", "other", "notebook"), effectiveSortMode: 2};
        const notebookDoc = {...menuTarget("notebook"), effectiveSortMode: 15};
        for (const selected of [[inherited], [custom], [inherited, custom], [notebook], [notebook, otherNotebook],
            [notebook, inherited, custom], [notebookDoc]]) {
            const f = setup(mobile);
            for (const globalSort of [6, 1]) {
                f.fileTree.sort = globalSort;
                f.exports.initDocTreeMenu({} as never, {items: selected, elements: () => f.options.elements as NodeListOf<HTMLElement>,
                    target: f.options.target});
                assert.deepEqual(Array.from(f.events.at(-1).detail.items, item => ({...item})), selected.map(item => ({
                    id: item.id, path: item.path, notebookId: item.notebookId,
                    effectiveSortMode: item.effectiveSortMode === 15 ? globalSort : item.effectiveSortMode,
                    ...(item.kind === "document" ? {childrenSortMode: item.childrenSortMode} : {}),
                })));
            }
        }
    });

    test(`native document menu events preserve live row sorting (${mobile ? "mobile" : "desktop"})`, () => {
        const row = {} as HTMLElement;
        for (const effectiveSortMode of [0, 6, 7]) {
            for (const childrenSortMode of [null, 0, 6]) {
                const item = {...menuTarget("doc"), effectiveSortMode, childrenSortMode};
                const f = setup(mobile, false, {
                    getItemFromElement: () => item,
                    getSelectedItems: () => [item],
                    getSelectionElements: () => [row] as unknown as NodeListOf<HTMLElement>,
                });
                f.exports.initFileMenu({} as never, item.notebookId, item.path, row);
                assert.equal(f.events[0].detail.items[0].effectiveSortMode, effectiveSortMode);
                assert.equal(f.events[0].detail.items[0].childrenSortMode, childrenSortMode);
            }
        }
    });

    test(`shared menus preserve all five event kinds without touching tree selection (${mobile ? "mobile" : "desktop"})`, () => {
        const notebook = menuTarget("notebook", "notebook", "notebook");
        const otherNotebook = menuTarget("other", "other", "notebook");
        const doc = menuTarget("doc");
        const cases = [[doc], [doc, menuTarget("peer")], [notebook], [notebook, otherNotebook], [notebook, doc]];
        for (const [index, selected] of cases.entries()) {
            const f = setup(mobile, false, {
                getItemFromElement: () => { throw new Error("Plugin menus cannot read the official selection"); },
            });
            const elements = [] as unknown as NodeListOf<HTMLElement>;
            f.exports.initDocTreeMenu({} as never, {items: selected, elements: () => elements, target: {} as HTMLElement});
            assert.equal((f.events[0].detail as unknown as {type: string}).type, ["doc", "docs", "notebook", "notebooks", "items"][index]);
            assert.equal(f.events[0].detail.elements, elements);
            assert.equal(f.events[0].detail.items.length, selected.length);
            assert.ok(!f.items.some(item => item.id === "multiSelect"));
        }
    });

    test(`shared multi-document database menu retains the supplied anchor and position (${mobile ? "mobile" : "desktop"})`, async () => {
        const f = setup(mobile);
        f.exports.initDocTreeMenu({} as never, {items: [menuTarget("doc"), menuTarget("peer")],
            elements: () => f.options.elements as NodeListOf<HTMLElement>, target: f.options.target, position: f.options.position});
        await f.click("addToDatabase");
        assert.equal(f.databases[0][1], f.options.target);
        assert.equal(f.databases[0][2], f.options.position);
    });
}

test("readonly shared document and mixed menus hide mutation actions", () => {
    for (const selected of [[menuTarget("doc"), menuTarget("peer")], [menuTarget("doc"), menuTarget("notebook", "notebook", "notebook")]]) {
        const f = setup(false, true);
        f.exports.initDocTreeMenu({} as never, {items: selected, elements: () => [] as unknown as NodeListOf<HTMLElement>, target: f.options.target});
        assert.ok(!f.items.some(item => ["move", "delete", "addToDatabase", "riffCard", "pinDoc"].includes(item.id)));
        const copy = f.items.find(item => item.id === "copy");
        assert.ok(!copy || (copy.submenu as IMenu[]).filter(item => item.id === "duplicate").every(item => item.ignore));
    }
});

test("a notebook document disables whole-selection move, delete and duplicate", () => {
    const f = setup();
    f.exports.initDocTreeMenu({} as never, {items: [menuTarget("doc"), menuTarget("notebook")],
        elements: () => [] as unknown as NodeListOf<HTMLElement>, target: f.options.target});
    assert.ok(!f.items.some(item => ["move", "delete"].includes(item.id)));
    const copy = f.items.find(item => item.id === "copy").submenu as IMenu[];
    assert.equal(copy.find(item => item.id === "duplicate").ignore, true);
});

test("mixed deletion is covered by selected notebooks while events keep every target", () => {
    const f = setup();
    f.exports.initDocTreeMenu({} as never, {items: [menuTarget("notebook"), menuTarget("notebook", "notebook", "notebook"), menuTarget("doc")],
        elements: () => [] as unknown as NodeListOf<HTMLElement>, target: f.options.target});
    f.click("delete");
    assert.equal(f.events[0].detail.items.length, 3);
    assert.equal(f.treeDeletions[0].length, 1);
    assert.equal((f.treeDeletions[0][0] as IDocTreeItem).kind, "notebook");
    const uncovered = setup();
    uncovered.exports.initDocTreeMenu({} as never, {items: [menuTarget("notebook"), menuTarget("other", "other", "notebook")],
        elements: () => [] as unknown as NodeListOf<HTMLElement>, target: uncovered.options.target});
    assert.ok(!uncovered.items.some(item => item.id === "delete"));
});

test("cross-notebook flashcard and export permissions inspect every document", () => {
    for (const encryptedFirst of [false, true]) {
        const f = setup(false, false, undefined, true, ["encrypted"]);
        const selected = [menuTarget("doc"), menuTarget("secret", "encrypted")];
        if (encryptedFirst) selected.reverse();
        f.exports.initDocTreeMenu({} as never, {items: selected,
            elements: () => [] as unknown as NodeListOf<HTMLElement>, target: f.options.target});
        assert.ok(!f.items.some(item => ["riffCard", "pinDoc"].includes(item.id)));
        const exports = f.items.find(item => item.id === "export").submenu as IMenu[];
        exports.find(item => item.id === "exportMarkdown").click(null, null);
        assert.equal(f.confirmations.length, 1);
        assert.equal(f.requests.length, 0);
    }
});

test("shared notebook sorting tolerates an absent desktop or mobile file dock", async () => {
    for (const mobile of [false, true]) {
        for (const count of [1, 2]) {
            const f = setup(mobile);
            f.exports.initDocTreeMenu({} as never, {items: Array.from({length: count}, (_, index) => menuTarget(`box${index}`, `box${index}`, "notebook")),
                elements: () => [] as unknown as NodeListOf<HTMLElement>, target: f.options.target});
            const sort = f.items.find(item => item.id === "sort").submenu as IMenu[];
            await sort.find(item => item.id === "fileNameASC").click(null, null);
        }
    }
});

test("mobile notebook icon menu uses the API position and internal anchor", () => {
    const f = setup(true);
    const target = {getBoundingClientRect: () => ({left: 1, bottom: 2, width: 3, height: 4})} as HTMLElement;
    f.exports.initDocTreeMenu({} as never, {items: [menuTarget("notebook", "notebook", "notebook")],
        elements: () => [] as unknown as NodeListOf<HTMLElement>, target, position: f.options.position});
    f.click("changeIcon");
    assert.equal(f.icons[0][2], f.options.position);
});

for (const mobile of [false, true]) {
    test(`document menu keeps flashcard v2 study and management scopes without a mounted tree row (${mobile ? "mobile" : "desktop"})`, () => {
        const {open, items, flashcards} = setup(mobile);
        open();
        const cardItems = items.find(item => item.id === "riffCard").submenu as IMenu[];
        cardItems.find(item => item.id === "spaceRepetition").click(null, null);
        cardItems.find(item => item.id === "manage").click(null, null);
        assert.equal(JSON.stringify(flashcards), JSON.stringify([
            ["study", "doc", "doc", "Document"], ["manage", ["doc"], "Document"],
        ]));
    });

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

test("an unresolved tree row cannot reuse another document selection for its menu", () => {
    const {exports, items} = setup(false, false, {
        getItemFromElement: () => undefined,
        getSelectedItems: () => { throw new Error("Unrelated selections must not become menu targets"); },
    });
    exports.initFileMenu({} as Parameters<typeof exports.initFileMenu>[0], "notebook", "/target.sy", {} as Element);
    assert.equal(items.length, 0);
});

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
    const item: Partial<import("../layout/dock/docTree/types").IDocTreeItem> = {id: "doc", notebookId: "notebook", path: "/doc.sy", name: "Document", kind: "document", subFileCount: 2, childrenSortMode: null, effectiveSortMode: 0, occurrenceKey: "doc"};
    const row = {} as HTMLElement;
    const rows = [row] as unknown as NodeListOf<HTMLElement>;
    const controller = {getItemFromElement: () => item, getSelectedItems: () => [item], getSelectionElements: () => rows} as unknown as Partial<DocTreeController>;
    const {exports, options, events} = setup(false, false, controller);
    exports.initFileMenu({} as Parameters<typeof exports.initFileMenu>[0], "notebook", "/doc.sy", row as unknown as Element);
    assert.equal(events[0].detail.elements, rows);
    assert.equal(events[0].detail.items[0].id, options.id);
});

test("plugin and official document menus preserve raw titles in rename and history", () => {
    for (const name of ["report.sy", "folder/report.sy", "folder/report", "/report.sy"]) {
        for (const mobile of [false, true]) {
            for (const plugin of [false, true]) {
                const item = {...menuTarget("doc"), name};
                const row = {} as HTMLElement;
                const rows = [row] as unknown as NodeListOf<HTMLElement>;
                const controller = {getItemFromElement: () => item, getSelectedItems: () => [item],
                    getSelectionElements: () => rows} as unknown as Partial<DocTreeController>;
                const f = setup(mobile, false, controller);
                if (plugin) {
                    f.exports.initDocTreeMenu({} as never, {items: [item], elements: () => rows, target: row});
                } else {
                    f.exports.initFileMenu({} as never, item.notebookId, item.path, row);
                }
                assert.equal(f.renames[0].name, name);
                f.click("fileHistory");
                assert.equal(f.histories[0].pathString, name);
            }
        }
    }
});

test("large virtual selections build native menus from complete metadata without DOM snapshots", () => {
    const selected = Array.from({length: 10000}, (_, index): IDocTreeItem => ({...menuTarget(String(index)),
        occurrenceKey: `root/${index}`}));
    selected.push({...selected[0], occurrenceKey: "pinned/0"});
    const controller = {
        getSelectedItems: () => selected,
        getItemFromElement: () => selected[0],
        getSelectionElements: () => { throw new Error("unsubscribed menus must not build selection DOM"); },
    } as unknown as Partial<DocTreeController>;
    const {exports, click, treeDeletions, events, moves} = setup(false, false, controller, false);
    exports.initFileMenu({} as Parameters<typeof exports.initFileMenu>[0], "notebook", "/0.sy", {} as Element);
    assert.equal(events.length, 0);
    click("delete");
    assert.equal(treeDeletions[0].length, 10000);
    assert.equal((moves[0] as {paths: string[]}).paths.length, 10000);
});

test("subscribed virtual menu events preserve all occurrence snapshots while actions deduplicate documents", () => {
    const selected = ["root", "pinned"].map((root): IDocTreeItem => ({...menuTarget("doc"), name: "Document",
        occurrenceKey: `${root}/doc`}));
    const rows = [{}, {}] as unknown as NodeListOf<HTMLElement>;
    let snapshots = 0;
    const controller = {
        getSelectedItems: () => selected,
        getItemFromElement: () => selected[0],
        getSelectionElements: () => { snapshots++; return rows; },
    } as unknown as Partial<DocTreeController>;
    const {exports, click, treeDeletions, events} = setup(false, false, controller);
    exports.initFileMenu({} as Parameters<typeof exports.initFileMenu>[0], "notebook", "/doc.sy", {} as Element);
    assert.equal(snapshots, 1);
    assert.equal(events[0].detail.elements, rows);
    assert.equal(events[0].detail.items.length, 2);
    click("delete");
    assert.equal(treeDeletions[0].length, 1);
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
