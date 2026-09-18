import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {getPinnedDropPosition} from "../../util/pinnedDocsDrop";

interface IPanelHarness {
    element: unknown;
    heading: unknown;
    sourceTree: unknown;
    clearSelection(): void;
    refresh(dirtyChildren?: Set<string>): Promise<void>;
    onFileTreeMessage(data: {cmd: string, data?: {id: string}}): void;
    collapse(): void;
    expanded: Set<string>;
    list: unknown;
    generation: number;
    rootSnapshot: string;
    names: Map<string, string>;
    appendDoc(...args: unknown[]): Promise<void>;
    loadChildren(row: unknown, children: unknown, generation: number): Promise<void>;
    drop(ids: string[], x: number, y: number, allowSource?: boolean): Promise<void>;
    click(event: unknown): void;
    menu(row: unknown, position: {x: number, y: number, h: number}): void;
    toggle(row: unknown): void;
    open(id: string, notebook: string): void;
    mobile?: boolean;
    previewDrop(x: number, y: number, allowSource?: boolean): boolean | void;
    clearDrop(): void;
    scheduleRefresh(changedID?: string): void;
    dropTarget?: {id: string, position: string};
    suppressClick?: boolean;
    touch?: {dragging: boolean};
    contextMenu(event: unknown): void;
    setDragImage(row: unknown, dataTransfer: unknown): void;
}

const loadPanel = (fetchCode = 0) => {
    const hitTest = {target: null as unknown};
    const storage = new Map<string, string>();
    const docs: {id: string, notebook: string, name: string}[] = [];
    const childData = {effectiveSortMode: 6, files: [] as {id: string, name: string, icon?: string}[]};
    const config = {readonly: false, fileTree: {docIconClickExpand: false, parentDocClickExpand: false}};
    const calls: {kind: string, args: unknown[]}[] = [];
    const timers: (() => void)[] = [];
    const runtime = {config, notebooks: [] as unknown[], languages: {pinDoc: "Pin", dragTipMoveChild: "Into ${x}",
        dragTipMoveBefore: "Before ${x}", dragTipMoveAfter: "After ${x}"}, dragElement: undefined as {innerText: string},
        dragTitle: "Document", touchDragActive: false, touchDragGhost: undefined as unknown};
    const tips: unknown[][] = [];
    const record = (kind: string) => async (...args: unknown[]) => {
        calls.push({kind, args});
        return {code: kind === "http" ? fetchCode : 0, data: args[0] === "/api/filetree/listDocsByPath" ? childData : docs};
    };
    const exports: {PinnedDocs?: {prototype: object}} = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, "PinnedDocs.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        localStorage: {setItem: (key: string, value: string) => storage.set(key, value)},
        window: {siyuan: runtime, setTimeout: (callback: () => void) => timers.push(callback)},
        document: {activeElement: null, body: {append: (ghost: unknown) => calls.push({kind: "ghost", args: [ghost]})},
            elementFromPoint: () => hitTest.target, createElement: (tagName: string) => ({
            tagName, style: {setProperty: () => {}},
            setAttribute: () => {}, addEventListener: () => {},
            dataset: {}, children: [] as unknown[],
            append(child: unknown) { this.children.push(child); },
            remove() { calls.push({kind: "removeGhost", args: [this]}); },
        })},
        require: (name: string) => {
            if (name.endsWith("/dragTip")) { return {setDragTipGhost: record("dragTipGhost"),
                showDragTip: (...args: unknown[]) => tips.push(args), hideDragTip: () => tips.push([])}; }
            if (name.endsWith("/fileTreeAnimation")) { return {setFileTreeVisibility: (element: HTMLElement, visible: boolean) => element.classList.toggle("fn__none", !visible)}; }
            if (name.endsWith("/pinnedDocsDrop")) { return {getPinnedDropPosition}; }
            if (name.endsWith("/dragover")) { return {dragOverScroll: () => {}}; }
            if (name.endsWith("/compatibility")) { return {isOnlyMeta: (event: MouseEvent) => Boolean(event.ctrlKey)}; }
            if (name.endsWith("/fileTreeIcon")) { return {getFileTreeIconHTML: () => ""}; }
            if (name.endsWith("/escape")) { return {escapeHtml: (value: string) => value}; }
            if (name.endsWith("/emoji")) { return {openEmojiPanel: record("icon")}; }
            if (name.endsWith("/navigation")) {
                return {initFileMenu: (...args: unknown[]) => {
                    calls.push({kind: "menu", args});
                    return {popup: record("popup"), fullscreen: record("fullscreen")};
                }};
            }
            if (name.endsWith("/pinnedDocs")) { return {updatePinnedDocs: record("pin"), pinnedDocIDs: new Set<string>()}; }
            if (name.endsWith("/fetch")) { return {fetchSyncPost: record("http")}; }
            if (name.endsWith("/fileTreeReorder")) { return {reorderSortedFileTree: record("reorder")}; }
            return {};
        },
    });
    const panel = Object.create(exports.PinnedDocs.prototype) as IPanelHarness;
    panel.clearDrop = () => { panel.dropTarget = undefined; };
    panel.scheduleRefresh = () => {};
    panel.list = {querySelectorAll: (): unknown[] => []};
    panel.sourceTree = {querySelectorAll: (): unknown[] => []};
    return {panel, calls, config, docs, storage, childData, hitTest, runtime, timers, tips};
};

test("collapse clears descendant expansion and persists the closed section", async () => {
    const {panel, storage, calls} = loadPanel();
    panel.generation = 3;
    panel.expanded = new Set(["root", "root/child"]);
    const states: unknown[] = [];
    const row = {
        nextElementSibling: {replaceChildren: () => states.push("clear"), removeAttribute: () => {}, classList: {add: (name: string) => states.push(name)}},
        querySelector: () => ({classList: {remove: (name: string) => states.push(name)}}),
        hasAttribute: () => true,
        setAttribute: (name: string, value: string) => states.push([name, value]),
    };
    panel.list = {querySelectorAll: () => [row], classList: {toggle: (name: string, value: boolean) => states.push([name, value])}};
    panel.heading = {
        setAttribute: (name: string, value: string) => states.push([name, value]),
        querySelector: () => ({classList: {toggle: () => {}}}),
    };
    panel.collapse();
    assert.equal(panel.generation, 4);
    assert.equal(panel.expanded.size, 0);
    assert.equal(storage.get("siyuan-pinned-docs-expanded"), "[]");
    assert.equal(storage.get("siyuan-pinned-docs-collapsed"), "true");
    assert.deepEqual(states, [["fn__none", true], ["aria-expanded", "false"], "clear", "fn__none",
        "b3-list-item__arrow--open", ["aria-expanded", "false"]]);
    await panel.loadChildren({dataset: {notebook: "notebook", path: "/root.sy", pinRow: "root"}}, {}, 3);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args[0], "/api/filetree/listDocsByPath");
});

test("pinned document more actions open the source document menu", () => {
    const {panel, calls} = loadPanel();
    const row = {dataset: {nodeId: "document", notebook: "notebook", path: "/document.sy"}};
    const button = {getBoundingClientRect: () => ({left: 180, bottom: 120, height: 24})};
    panel.click({
        stopPropagation: () => {}, clientX: 10, clientY: 20,
        target: {closest: (selector: string) => selector === "[data-pin-row]" ? row : selector === "[data-pin-more]" ? button : null},
    });
    assert.equal(calls[0].kind, "menu");
    assert.deepEqual(calls[0].args.slice(1), ["notebook", "/document.sy", row]);
    assert.equal(calls[1].kind, "popup");
    assert.deepEqual({...calls[1].args[0] as object}, {x: 180, y: 120, h: 24});
    panel.mobile = true;
    panel.menu(row, {x: 180, y: 120, h: 24});
    assert.equal(calls[3].kind, "fullscreen");
});

test("pinned roots share one list and retain each document notebook without wrapper lists", async () => {
    const {panel} = loadPanel();
    panel.expanded = new Set();
    const children: {tagName: string, dataset: Record<string, string>}[] = [];
    const parent = {append: (child: typeof children[number]) => children.push(child)};
    for (const notebook of ["first", "second"]) {
        await panel.appendDoc(parent, {id: notebook + "-doc", notebook, name: "Document", path: "/doc.sy", subFileCount: 0}, notebook, 0, 0);
    }
    assert.deepEqual(children.map(child => child.tagName), ["li", "ul", "li", "ul"]);
    assert.equal(children[0].dataset.notebook, "first");
    assert.equal(children[2].dataset.notebook, "second");
    assert.equal(children[1].dataset.url, "first");
    assert.equal(children[3].dataset.url, "second");
});

test("touch long press suppresses the context menu before and during dragging", () => {
    const {panel, calls} = loadPanel();
    const row = {dataset: {nodeId: "document", notebook: "notebook", path: "/document.sy"},
        getBoundingClientRect: () => ({left: 0, bottom: 120, height: 28})};
    let prevented = 0;
    const event = {stopPropagation: () => {}, preventDefault: () => prevented++,
        target: {closest: () => row}, clientX: 10, clientY: 20};
    for (const dragging of [false, true]) {
        panel.touch = {dragging};
        panel.contextMenu(event);
    }
    panel.touch = undefined;
    panel.suppressClick = true;
    panel.contextMenu(event);
    assert.equal(calls.length, 0);
    assert.equal(prevented, 3);
    panel.suppressClick = false;
    panel.contextMenu(event);
    assert.equal(calls[0].kind, "menu");
    assert.deepEqual({...calls[1].args[0] as object}, {x: 10, y: 120, h: 28});
    panel.contextMenu({...event, clientX: 200, clientY: 115});
    assert.deepEqual({...calls[3].args[0] as object}, {x: 200, y: 120, h: 28});
});

test("mobile pinned rows use touch dragging without native HTML dragging", async () => {
    const {panel} = loadPanel();
    panel.expanded = new Set();
    for (const mobile of [false, true]) {
        panel.mobile = mobile;
        const children: {draggable?: boolean}[] = [];
        const parent = {append: (child: typeof children[number]) => children.push(child)};
        await panel.appendDoc(parent, {id: "doc", notebook: "box", name: "Document", path: "/doc.sy", subFileCount: 0}, "doc", 0, 0);
        assert.equal(children[0].draggable, !mobile);
    }
});

test("pinned icons respect editing, expansion and readonly settings", () => {
    const {panel, calls, config} = loadPanel();
    const row = {dataset: {nodeId: "document", notebook: "notebook", count: "1"}, classList: {add: () => {}}};
    const icon = {getBoundingClientRect: () => ({left: 1, bottom: 2, height: 3, width: 4}), querySelector: (): Element | null => null};
    const event = {stopPropagation: () => {}, target: {closest: (selector: string) =>
        selector === "[data-pin-row]" ? row : selector === ".b3-list-item__icon" ? icon : null}};
    panel.click(event);
    assert.equal(calls[0].kind, "icon");
    assert.deepEqual(calls[0].args.slice(0, 2), ["document", "doc"]);
    config.readonly = true;
    panel.click(event);
    assert.equal(calls.length, 1);
    config.fileTree.docIconClickExpand = true;
    panel.toggle = () => { calls.push({kind: "toggle", args: []}); };
    panel.open = () => { calls.push({kind: "open", args: []}); };
    panel.click(event);
    assert.equal(calls[1].kind, "toggle");
    row.dataset.count = "0";
    panel.click(event);
    assert.equal(calls[2].kind, "open");
});

test("root drops create an entry without invoking source movement", async () => {
    const {panel, calls} = loadPanel();
    panel.previewDrop = () => { panel.dropTarget = {id: "parent", position: "pin-before"}; return true; };
    await panel.drop(["child"], 0, 0);
    assert.deepEqual(calls, [{kind: "pin", args: [["child"], "pin", "parent", false]}]);
});

test("child ordering uses the existing conflict confirmation and inside drops move the source", async () => {
    const {panel, calls} = loadPanel();
    panel.previewDrop = () => { panel.dropTarget = {id: "sibling", position: "after"}; };
    await panel.drop(["child"], 0, 0);
    assert.deepEqual(calls, [{kind: "reorder", args: [["child"], "sibling", true]}]);
    calls.length = 0;
    panel.previewDrop = () => { panel.dropTarget = {id: "parent", position: "inside"}; };
    await panel.drop(["child"], 0, 0);
    assert.equal(calls[0].kind, "http");
    assert.equal(calls[0].args[0], "/api/filetree/moveDocsByID");
    assert.equal(JSON.stringify(calls[0].args[1]), JSON.stringify({fromIDs: ["child"], toID: "parent"}));
});

test("dropping on a notebook resolves its outer list ID with or without root documents", async () => {
    const {panel, calls, hitTest} = loadPanel();
    const highlights: string[] = [];
    const row = {dataset: {type: "navigation-root", nodeId: ""},
        querySelector: () => ({textContent: "Notebook"}),
        closest: (selector: string) => selector === "ul[data-url]" ? {dataset: {url: "notebook"}} : null,
        getBoundingClientRect: () => ({top: 0, height: 30}), classList: {add: (name: string) => highlights.push(name)}};
    hitTest.target = {closest: () => row};
    panel.sourceTree = {contains: () => true, getBoundingClientRect: () => ({})};
    panel.element = {contains: () => false};
    for (const id of ["", "notebook"]) {
        row.dataset.nodeId = id;
        await panel.drop(["document"], 10, 15, true);
    }
    assert.deepEqual(highlights, ["dragover", "dragover"]);
    assert.equal(calls.length, 2);
    calls.forEach(call => {
        assert.equal(call.args[0], "/api/filetree/moveDocsByID");
        assert.equal(JSON.stringify(call.args[1]), JSON.stringify({fromIDs: ["document"], toID: "notebook"}));
    });
});

test("pinned heading highlights the whole row while root reorder keeps insertion lines", () => {
    const {panel, hitTest} = loadPanel();
    const highlights: string[] = [];
    panel.sourceTree = {contains: () => false};
    panel.element = {contains: () => true};
    panel.list = {getBoundingClientRect: () => ({})};
    panel.heading = {classList: {add: (name: string) => highlights.push(name)}};
    hitTest.target = {closest: (selector: string) => selector === "[data-pin-heading]" ? {} : null};
    panel.previewDrop(10, 0);
    assert.deepEqual(highlights, ["dragover"]);
    assert.equal(panel.dropTarget.id, "");
    hitTest.target = {closest: (): Element | null => null};
    assert.equal(panel.previewDrop(10, 20), false);
    assert.equal(panel.dropTarget, undefined);
    assert.deepEqual(highlights, ["dragover"]);
    const row = {dataset: {pinRoot: "true", nodeId: "document"},
        querySelector: () => ({textContent: "Document"}),
        getBoundingClientRect: () => ({top: 0, height: 30}), classList: {add: (name: string) => highlights.push(name)}};
    hitTest.target = {closest: () => row};
    panel.previewDrop(10, 1);
    assert.equal(highlights[1], "dragover__top");
});

test("desktop pinned drags create an unclipped ghost and preserve synthetic touch ghosts", () => {
    for (const touchDragActive of [false, true]) {
        const {panel, calls, runtime, timers} = loadPanel();
        runtime.touchDragActive = touchDragActive;
        const clone = {};
        const images: unknown[][] = [];
        panel.setDragImage({cloneNode: () => clone}, {setDragImage: (...args: unknown[]) => images.push(args)});
        const ghost = calls[0].args[0] as {children: unknown[], className: string, style: {cssText: string}};
        assert.equal(calls[0].kind, "ghost");
        assert.equal(ghost.children[0], clone);
        assert.equal(ghost.className, "b3-list b3-list--background");
        assert.match(ghost.style.cssText, /position:fixed/);
        assert.deepEqual(images[0], [ghost, 16, 16]);
        if (touchDragActive) {
            assert.equal(runtime.touchDragGhost, ghost);
            assert.equal(timers.length, 0);
        } else {
            assert.equal(calls.some(call => call.kind === "removeGhost"), false);
            timers[0]();
            assert.equal(calls.at(-1).kind, "removeGhost");
        }
    }
});

test("pin drop tips describe pinning and source moves, and self targets clear feedback", () => {
    const {panel, hitTest, runtime, tips} = loadPanel();
    const highlights: string[] = [];
    let source = false;
    const row = {dataset: {pinRoot: "true", nodeId: "target"}, querySelector: () => ({textContent: "Target"}),
        getBoundingClientRect: () => ({top: 0, height: 30}), classList: {add: (name: string) => highlights.push(name)},
        closest: (): Element | null => null};
    hitTest.target = {closest: () => row};
    panel.sourceTree = {contains: () => source, getBoundingClientRect: () => ({})};
    panel.element = {contains: () => !source};
    panel.list = {getBoundingClientRect: () => ({})};
    runtime.dragElement = {innerText: "source"};
    panel.previewDrop(10, 1);
    assert.deepEqual(tips.at(-1), ["Document", "Pin", 10, 1]);
    source = true;
    row.dataset.pinRoot = "false";
    panel.previewDrop(10, 15, true);
    assert.deepEqual(tips.at(-1), ["Document", "Into Target", 10, 15]);
    panel.previewDrop(10, 1, true);
    assert.deepEqual(tips.at(-1), ["Document", "Before Target", 10, 1]);
    panel.previewDrop(10, 29, true);
    assert.deepEqual(tips.at(-1), ["Document", "After Target", 10, 29]);
    for (source of [true, false]) {
        runtime.dragElement.innerText = "target";
        const count = highlights.length;
        assert.equal(panel.previewDrop(10, 15, true), false);
        assert.equal(panel.dropTarget, undefined);
        assert.equal(highlights.length, count);
        assert.deepEqual(tips.at(-1), []);
    }
});

test("invalid drop targets and self moves do not mutate source documents", async () => {
    const {panel, calls} = loadPanel();
    panel.previewDrop = () => { panel.dropTarget = undefined; };
    await panel.drop(["child"], 0, 0);
    panel.previewDrop = () => { panel.dropTarget = {id: "child", position: "inside"}; };
    await panel.drop(["child"], 0, 0);
    await panel.drop([], 0, 0);
    assert.equal(calls.length, 0);
});

test("panel clicks never bubble into the mobile source tree handler", () => {
    const {panel} = loadPanel();
    let stopped = 0;
    let prevented = 0;
    panel.suppressClick = true;
    panel.click({stopPropagation: () => stopped++, preventDefault: () => prevented++});
    panel.suppressClick = false;
    panel.click({stopPropagation: () => stopped++, target: {closest: (): Element | null => null}});
    assert.equal(stopped, 2);
    assert.equal(prevented, 1);
});

test("modifier clicks toggle pins without opening and ordinary clicks clear source selection", () => {
    const {panel} = loadPanel();
    let focused = true;
    let opened = 0;
    let sourceCleared = 0;
    const row = {dataset: {nodeId: "doc", notebook: "box"}, classList: {
        toggle: () => { focused = !focused; }, add: () => { focused = true; }, remove: () => { focused = false; },
    }, removeAttribute: () => {}};
    panel.list = {querySelectorAll: () => [row]};
    panel.sourceTree = {querySelectorAll: () => [{classList: {remove: () => sourceCleared++}, removeAttribute: () => {}}]};
    panel.open = () => opened++;
    const event = {ctrlKey: true, stopPropagation: () => {}, preventDefault: () => {},
        target: {closest: (selector: string) => selector === "[data-pin-row]" ? row : null}};
    panel.click(event);
    assert.equal(focused, false);
    panel.click(event);
    assert.equal(focused, true);
    assert.equal(opened, 0);
    event.ctrlKey = false;
    panel.click(event);
    assert.equal(opened, 1);
    assert.equal(sourceCleared, 1);
    panel.clearSelection();
    assert.equal(focused, false);
});

test("notebook root expansion requests physical root while documents keep their own paths", async () => {
    const {panel, calls} = loadPanel(-1);
    for (const id of ["notebook", "document"]) {
        await panel.loadChildren({dataset: {notebook: "notebook", nodeId: id, path: `/${id}.sy`}}, {}, 0);
    }
    assert.equal(JSON.stringify(calls[0].args[1]), JSON.stringify({notebook: "notebook", path: "/", maxListCount: 0}));
    assert.equal(JSON.stringify(calls[1].args[1]), JSON.stringify({notebook: "notebook", path: "/document.sy", maxListCount: 0}));
});

test("pinned area follows list contents on initial load, pin, unpin and sync", async () => {
    const {panel, calls, docs} = loadPanel();
    const states: boolean[] = [];
    panel.generation = 0;
    panel.names = new Map();
    panel.appendDoc = async () => {};
    panel.list = {scrollTop: 0, contains: () => false,
        querySelectorAll: (): unknown[] => [], replaceChildren: () => {}};
    panel.element = {classList: {toggle: (name: string, hidden: boolean) => {
        assert.equal(name, "fn__none");
        states.push(hidden);
    }}};
    await panel.refresh();
    await panel.refresh(new Set());
    docs.push({id: "document", notebook: "notebook", name: "Document"});
    await panel.refresh();
    docs.length = 0;
    await panel.refresh();
    docs.push({id: "synced", notebook: "notebook", name: "Synced"});
    await panel.refresh();
    assert.deepEqual(states, [true, false, true, false]);
    assert.ok(calls.every(call => call.kind === "http" && call.args[0] === "/api/filetree/getPinnedDocs"));
});

test("rename refresh is not repeated by delayed document info or notebook info pushes", () => {
    const {panel} = loadPanel();
    const updates: (string | undefined)[] = [];
    panel.scheduleRefresh = id => updates.push(id);
    panel.onFileTreeMessage({cmd: "rename", data: {id: "document"}});
    panel.onFileTreeMessage({cmd: "reloadDocInfo"});
    panel.onFileTreeMessage({cmd: "reloadNotebookInfo"});
    panel.onFileTreeMessage({cmd: "reloadFiletree"});
    assert.deepEqual(updates, ["document"]);
    panel.onFileTreeMessage({cmd: "pinnedDocsChanged"});
    panel.onFileTreeMessage({cmd: "moveDocs"});
    assert.deepEqual(updates, ["document", "", undefined]);
});

test("unchanged child lists preserve DOM while title, icon and order changes rebuild", async () => {
    const {panel, childData} = loadPanel();
    panel.generation = 1;
    panel.expanded = new Set(["root"]);
    panel.appendDoc = async () => {};
    let rebuilds = 0;
    const children = {dataset: {} as Record<string, string>, replaceChildren: () => rebuilds++,
        setAttribute: () => {}, querySelectorAll: (): unknown[] => [], classList: {remove: () => {}}};
    const row = {dataset: {notebook: "box", nodeId: "root", path: "/root.sy", pinRow: "root"},
        querySelector: () => ({classList: {add: () => {}}}), setAttribute: () => {}};
    childData.files.push({id: "one", name: "One"}, {id: "two", name: "Two"});
    await panel.loadChildren(row, children, 1);
    await panel.loadChildren(row, children, 1);
    assert.equal(rebuilds, 1);
    childData.files[0].name = "Renamed";
    await panel.loadChildren(row, children, 1);
    childData.files[0].icon = "1f600";
    await panel.loadChildren(row, children, 1);
    childData.files.reverse();
    await panel.loadChildren(row, children, 1);
    assert.equal(rebuilds, 4);
});

test("unchanged roots still refresh the affected expanded child list without replacing root rows", async () => {
    const {panel, docs} = loadPanel();
    docs.push({id: "root", notebook: "box", name: "Root"});
    panel.rootSnapshot = JSON.stringify(docs);
    panel.generation = 0;
    panel.expanded = new Set(["root", "root/parent", "other"]);
    const keys = ["root", "root/parent", "other"];
    const rows = keys.map(key => ({dataset: {pinRow: key, pinRoot: String(!key.includes("/"))}}));
    panel.list = {scrollTop: 0, contains: () => false, querySelectorAll: (selector: string) =>
        selector === "[data-pin-row]" ? rows : [], replaceChildren: () => assert.fail("root DOM was rebuilt")};
    const refreshed: string[] = [];
    panel.loadChildren = async (row: typeof rows[number]) => { refreshed.push(row.dataset.pinRow); };
    await panel.refresh(new Set(["root/parent"]));
    assert.deepEqual(refreshed, ["root/parent"]);
    refreshed.length = 0;
    await panel.refresh(new Set());
    assert.deepEqual(refreshed, []);
    await panel.refresh();
    assert.deepEqual(refreshed, ["root", "other"]);
});
