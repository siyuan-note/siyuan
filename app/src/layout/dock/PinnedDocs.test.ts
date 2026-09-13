import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

interface IPanelHarness {
    element: unknown;
    heading: unknown;
    sourceTree: unknown;
    clearSelection(): void;
    refresh(): Promise<void>;
    collapse(): void;
    expanded: Set<string>;
    list: unknown;
    generation: number;
    names: Map<string, string>;
    appendDoc(...args: unknown[]): Promise<void>;
    loadChildren(row: unknown, children: unknown, generation: number): Promise<void>;
    drop(ids: string[], x: number, y: number): Promise<void>;
    click(event: unknown): void;
    menu(row: unknown, x: number, y: number): void;
    toggle(row: unknown): void;
    open(id: string, notebook: string): void;
    mobile?: boolean;
    previewDrop(): void;
    clearDrop(): void;
    scheduleRefresh(): void;
    dropTarget?: {id: string, position: string};
    suppressClick?: boolean;
}

const loadPanel = (fetchCode = 0) => {
    const storage = new Map<string, string>();
    const docs: {id: string, notebook: string, name: string}[] = [];
    const config = {readonly: false, fileTree: {docIconClickExpand: false, parentDocClickExpand: false}};
    const calls: {kind: string, args: unknown[]}[] = [];
    const record = (kind: string) => async (...args: unknown[]) => {
        calls.push({kind, args});
        return {code: kind === "http" ? fetchCode : 0, data: docs};
    };
    const exports: {PinnedDocs?: {prototype: object}} = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, "PinnedDocs.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        localStorage: {setItem: (key: string, value: string) => storage.set(key, value)},
        window: {siyuan: {config, notebooks: [], languages: {}}},
        document: {activeElement: null, createElement: (tagName: string) => ({
            tagName, style: {setProperty: () => {}},
            setAttribute: () => {}, addEventListener: () => {},
            dataset: {}, children: [] as unknown[],
            append(child: unknown) { this.children.push(child); },
        })},
        require: (name: string) => {
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
    return {panel, calls, config, docs, storage};
};

test("collapse clears descendant expansion and persists the closed section", async () => {
    const {panel, storage, calls} = loadPanel();
    panel.generation = 3;
    panel.expanded = new Set(["root", "root/child"]);
    const states: unknown[] = [];
    const row = {
        nextElementSibling: {replaceChildren: () => states.push("clear"), classList: {add: (name: string) => states.push(name)}},
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
    panel.click({
        stopPropagation: () => {}, clientX: 10, clientY: 20,
        target: {closest: (selector: string) => selector === "[data-pin-row]" || selector === "[data-pin-more]" ? row : null},
    });
    assert.equal(calls[0].kind, "menu");
    assert.deepEqual(calls[0].args.slice(1), ["notebook", "/document.sy", row]);
    assert.equal(calls[1].kind, "popup");
    panel.mobile = true;
    panel.menu(row, 10, 20);
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
    panel.previewDrop = () => { panel.dropTarget = {id: "parent", position: "pin-before"}; };
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
    docs.push({id: "document", notebook: "notebook", name: "Document"});
    await panel.refresh();
    docs.length = 0;
    await panel.refresh();
    docs.push({id: "synced", notebook: "notebook", name: "Synced"});
    await panel.refresh();
    assert.deepEqual(states, [true, false, true, false]);
    assert.ok(calls.every(call => call.kind === "http" && call.args[0] === "/api/filetree/getPinnedDocs"));
});
