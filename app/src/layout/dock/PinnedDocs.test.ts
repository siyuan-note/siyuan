import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {getPinnedDropPosition} from "../../util/pinnedDocsDrop";
import {ParentDocClick} from "./parentDocClick";
import {setTimeout as delay} from "node:timers/promises";
import {escapeHtml, escapeHtmlTextAndAttr, escapeTooltipTextAttr} from "../../util/escape";

interface IPanelHarness {
    parentDocClick: ParentDocClick;
    element: unknown;
    heading: unknown;
    sourceTree: unknown;
    clearSelection(): void;
    updateDocActions(): void;
    refresh(): Promise<void>;
    onFileTreeMessage(data: {cmd: string, data?: {id?: string, rootID?: string} & Partial<IFile>}): void;
    collapse(): void;
    docTree: unknown;
    restored: boolean;
    list: unknown;
    generation: number;
    renderRow(item: unknown): {tagName: string, draggable: boolean, dataset: Record<string, string>};
    drop(ids: string[], x: number, y: number, allowSource?: boolean): Promise<void>;
    click(event: unknown): void;
    menu(row: unknown, position: {x: number, y: number, h: number}): void;
    toggle(row: unknown, expand?: boolean, prefetched?: unknown): void;
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
    bindTouch(): void;
}

const loadPanel = (fetchCode = 0) => {
    const hitTest = {target: null as unknown};
    const storage = new Map<string, string>();
    const docs: {id: string, notebook: string, name: string}[] = [];
    const config = {readonly: false, fileTree: {docIconClickMode: 0, parentDocTitleClickMode: 0}};
    const calls: {kind: string, args: unknown[]}[] = [];
    const timers: (() => void)[] = [];
    let menuVisible = false;
    const menu = {
        data: undefined as Element | undefined,
        element: {classList: {contains: () => !menuVisible}},
        remove: () => { menuVisible = false; menu.data = undefined; },
    };
    const runtime = {config, notebooks: [] as unknown[], languages: {pinDoc: "Pin", dragTipMoveChild: "Into ${x}",
        dragTipMoveBefore: "Before ${x}", dragTipMoveAfter: "After ${x}"}, dragElement: undefined as {innerText: string},
        storage: {} as Record<string, unknown>, dragTitle: "Document", touchDragActive: false, touchDragGhost: undefined as unknown, menus: {menu}};
    const tips: unknown[][] = [];
    const record = (kind: string) => async (...args: unknown[]) => {
        calls.push({kind, args});
        return {code: kind === "http" ? fetchCode : 0, data: docs};
    };
    const exports: {PinnedDocs?: {prototype: object}} = {};
    const tooltip = {};
    const escape = {escapeHtml, escapeHtmlTextAndAttr, escapeTooltipTextAttr};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "../../util/fileTreeTooltip.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText, {exports: tooltip, window: {siyuan: runtime}, require: (name: string) => {
        if (name.endsWith("/escape")) { return escape; }
        return {};
    }});
    const menuToggle = {};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "../../menus/menuToggle.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText, {exports: menuToggle, window: {siyuan: runtime}});
    const source = ts.transpileModule(readFileSync(join(__dirname, "PinnedDocs.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        localStorage: {setItem: (key: string, value: string) => storage.set(key, value)},
        window: {siyuan: runtime, setTimeout: (callback: () => void) => timers.push(callback), clearTimeout: () => {}},
        document: {activeElement: null, body: {append: (ghost: unknown) => calls.push({kind: "ghost", args: [ghost]})},
            elementFromPoint: () => hitTest.target, createElement: (tagName: string) => ({
            tagName, style: {setProperty: () => {}},
            setAttribute: () => {}, addEventListener: () => {},
            dataset: {}, children: [] as unknown[],
            append(child: unknown) { this.children.push(child); },
            remove() { calls.push({kind: "removeGhost", args: [this]}); },
        })},
        require: (name: string) => {
            if (name.endsWith("/constants")) { return {Constants: {TIMEOUT_LONGPRESS: 500, LOCAL_PINNED_DOC_TREE_STATE: "local-pinned-doc-tree-state"}}; }
            if (name.endsWith("/menuToggle")) { return menuToggle; }
            if (name.endsWith("/menuClick")) { return {globalClickHideMenu: () => {}}; }
            if (name.endsWith("/dragTip")) { return {setDragTipGhost: record("dragTipGhost"),
                showDragTip: (...args: unknown[]) => tips.push(args), hideDragTip: () => tips.push([])}; }
            if (name.endsWith("/fileTreeAnimation")) { return {setFileTreeVisibility: (element: HTMLElement, visible: boolean) => element.classList.toggle("fn__none", !visible)}; }
            if (name.endsWith("/pinnedDocsDrop")) { return {getPinnedDropPosition}; }
            if (name.endsWith("/dragover")) { return {dragOverScroll: () => {}}; }
            if (name.endsWith("/compatibility")) { return {isOnlyMeta: (event: MouseEvent) => Boolean(event.ctrlKey), setStorageVal: () => {}}; }
            if (name.endsWith("/fileTreeIcon")) { return {getFileTreeIconHTML: () => ""}; }
            if (name.endsWith("/escape")) { return escape; }
            if (name.endsWith("/fileTreeTooltip")) { return tooltip; }
            if (name.endsWith("/emoji")) { return {openEmojiPanel: record("icon")}; }
            if (name.endsWith("/navigation")) {
                return {initFileMenu: (...args: unknown[]) => {
                    menu.remove();
                    calls.push({kind: "menu", args});
                    return {
                        popup: (...position: unknown[]) => { menuVisible = true; return record("popup")(...position); },
                        fullscreen: (...position: unknown[]) => { menuVisible = true; return record("fullscreen")(...position); },
                    };
                }};
            }
            if (name.endsWith("/pinnedDocs")) { return {updatePinnedDocs: record("pin"), pinnedDocIDs: new Set<string>()}; }
            if (name.endsWith("/fetch")) { return {fetchSyncPost: record("http")}; }
            if (name.endsWith("/fileTreeReorder")) { return {reorderSortedFileTree: record("reorder")}; }
            return {};
        },
    });
    const panel = Object.create(exports.PinnedDocs.prototype) as IPanelHarness;
    panel.parentDocClick = new ParentDocClick();
    panel.clearDrop = () => { panel.dropTarget = undefined; };
    panel.scheduleRefresh = () => {};
    panel.list = {querySelectorAll: (): unknown[] => []};
    panel.sourceTree = {querySelectorAll: (): unknown[] => []};
    const selected = new Set<string>();
    const expansions = new Set<string>();
    const messages: {cmd: string, data?: unknown}[] = [];
    panel.restored = true;
    panel.docTree = {
        retain() {}, release() {},
        getItemFromElement: (row: {dataset: Record<string, string>}) => row && ({
            id: row.dataset.nodeId, notebookId: row.dataset.notebook,
            occurrenceKey: row.dataset.treeKey || row.dataset.pinRow || row.dataset.nodeId}),
        select: (key: string, options: {toggle?: boolean} = {}) => {
            if (!options.toggle) { selected.clear(); }
            if (options.toggle && selected.has(key)) { selected.delete(key); } else { selected.add(key); }
        },
        clearSelection: () => selected.clear(),
        getSelectedItems: () => [...selected].map(occurrenceKey => ({occurrenceKey})),
        toggle: (key: string, expand = !expansions.has(key)) => { if (expand) { expansions.add(key); } else { expansions.delete(key); } },
        isExpanded: (key: string) => expansions.has(key),
        itemAtDirectoryIndex: async (key: string, index: number) => { calls.push({kind: "range", args: [key, index]}); },
        collapseAll: () => expansions.clear(),
        getExpandedItems: () => [...expansions].map(occurrenceKey => ({occurrenceKey, notebookId: "box"})),
        setRoots() {}, handleMessage: (message: {cmd: string, data?: unknown}) => messages.push(message),
    };
    return {panel, calls, config, docs, storage, selected, expansions, messages, hitTest, runtime, timers, tips};
};

const loadTouchPanel = () => {
    const fixture = loadPanel();
    const handlers = new Map<string, (event: unknown) => void>();
    fixture.panel.element = {addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler)};
    fixture.panel.bindTouch();
    const dispatch = (type: string, row: unknown, x = 10, y = 20, count = 1) => {
        const event = {
            target: {closest: () => row},
            touches: Array.from({length: count}, () => ({clientX: x, clientY: y})),
            changedTouches: [{clientX: x, clientY: y}],
            stopped: false, prevented: false,
            stopPropagation() { this.stopped = true; },
            preventDefault() { this.prevented = true; },
        };
        handlers.get(type)(event);
        return event;
    };
    return {...fixture, dispatch};
};

test("pinned headings and document rows allow ordinary sidebar swipes and taps", () => {
    for (const mode of ["heading", "document", "unavailable", "readonly"]) {
        const {panel, config, dispatch, timers, calls} = loadTouchPanel();
        config.readonly = mode === "readonly";
        const row = mode === "heading" ? null : {dataset: {nodeId: "document", unavailable: String(mode === "unavailable")}};
        const start = dispatch("touchstart", row);
        assert.equal(start.stopped, false);
        assert.equal(start.prevented, false);
        const move = dispatch("touchmove", row, 60);
        assert.equal(move.stopped, false);
        assert.equal(move.prevented, false);
        // 移动后取消长按，即使定时器已进入执行队列也不启动拖拽。
        timers[0]?.();
        assert.equal(calls.some(call => call.kind === "ghost"), false);
        assert.equal(panel.touch, undefined);
        const end = dispatch("touchend", row, 60);
        assert.equal(end.stopped, false);
        assert.equal(end.prevented, false);
        dispatch("touchstart", row);
        assert.equal(dispatch("touchend", row).stopped, false);
        assert.equal(dispatch("touchcancel", row).stopped, false);
    }
});

test("pinned long press drags consume moves and releases without closing the sidebar", () => {
    for (const finish of ["touchend", "touchcancel", "multitouch"]) {
        const {panel, dispatch, timers, calls} = loadTouchPanel();
        const row = {dataset: {nodeId: "document"}, cloneNode: () => ({})};
        const drops: unknown[][] = [];
        const previews: unknown[][] = [];
        panel.drop = async (...args) => { drops.push(args); };
        panel.previewDrop = (...args) => { previews.push(args); };
        dispatch("touchstart", row);
        timers[0]();
        assert.equal(panel.touch?.dragging, true);
        const move = dispatch("touchmove", row, 60, 80);
        assert.equal(move.stopped, true);
        assert.equal(move.prevented, true);
        assert.deepEqual(previews, [[60, 80, true]]);
        const end = finish === "multitouch" ? dispatch("touchmove", row, 60, 80, 2) : dispatch(finish, row, 60, 80);
        assert.equal(end.stopped, true);
        assert.equal(end.prevented, finish === "touchend");
        assert.deepEqual(JSON.parse(JSON.stringify(drops)), finish === "touchend" ? [[["document"], 60, 80, true]] : []);
        assert.equal(panel.touch, undefined);
        assert.equal(calls.some(call => call.kind === "removeGhost"), true);
        assert.equal(dispatch("touchstart", row).stopped, false);
        assert.equal(dispatch("touchcancel", row).stopped, false);
    }
});

test("mobile source tree skips bubbled pinned touches and still starts ordinary document drags", () => {
    const source = ts.createSourceFile("MobileFiles.ts", readFileSync(join(__dirname, "../../mobile/dock/MobileFiles.ts"), "utf8"),
        ts.ScriptTarget.Latest, true);
    let handler: ts.ArrowFunction;
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "filesElement.addEventListener" &&
            node.arguments[0].getText(source) === '"touchstart"' && ts.isArrowFunction(node.arguments[1]) &&
            node.arguments[1].getText(source).includes("this.touchDragState =")) {
            handler = node.arguments[1];
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(handler);
    const timers: (() => void)[] = [];
    const callback = runInNewContext(ts.transpileModule(`const callback = function(event) ${handler.body.getText(source)}; callback;`, {
        compilerOptions: {target: ts.ScriptTarget.ES2020},
    }).outputText, {
        window: {siyuan: {config: {readonly: false}}, setTimeout: (callback: () => void) => timers.push(callback)},
        Constants: {TIMEOUT_LONGPRESS: 500}, isMousePointerTouchEvent: () => false,
    }) as (event: unknown) => void;
    for (const pinned of [true, false]) {
        const starts: unknown[][] = [];
        const panel = {
            pinnedDocs: {element: {contains: () => pinned}},
            touchDragState: undefined as {selectedElement: unknown},
            startTouchDrag: (...args: unknown[]) => starts.push(args),
        };
        const row = {getAttribute: () => "navigation-file"};
        callback.call(panel, {touches: [{target: {closest: () => row}, clientX: 10, clientY: 20}]});
        if (pinned) {
            assert.equal(panel.touchDragState, undefined);
            assert.equal(timers.length, 0);
        } else {
            assert.equal(panel.touchDragState.selectedElement, row);
            assert.equal(timers.length, 1);
            timers[0]();
            assert.equal(starts.length, 1);
            assert.deepEqual(starts[0].slice(1), [10, 20, true]);
        }
    }
});

test("collapse clears controller expansion and persists the closed section", () => {
    const {panel, runtime, expansions} = loadPanel();
    expansions.add("pin:root");
    expansions.add("pin:root/child");
    const states: unknown[] = [];
    panel.list = {classList: {toggle: (name: string, value: boolean) => states.push([name, value])}};
    let expanded = "true";
    panel.heading = {getAttribute: () => expanded,
        setAttribute: (_name: string, value: string) => { expanded = value; },
        querySelector: () => ({classList: {toggle() {}}})};
    panel.collapse();
    assert.equal(expansions.size, 0);
    assert.equal(JSON.stringify(runtime.storage["local-pinned-doc-tree-state"]), JSON.stringify({version: 2, collapsed: true, expanded: []}));
    assert.deepEqual(states, [["fn__none", true]]);
});

test("pinned document more actions open the source document menu and toggle on repeated clicks", () => {
    const {panel, calls} = loadPanel();
    const row = {dataset: {nodeId: "document", notebook: "notebook", path: "/document.sy"}};
    const button = {closest: (): null => null, setAttribute: () => {},
        getBoundingClientRect: () => ({left: 180, bottom: 120, height: 24})};
    const event = {
        stopPropagation: () => {}, clientX: 10, clientY: 20,
        target: {closest: (selector: string) => selector === "[data-pin-row]" ? row : selector === "[data-pin-more]" ? button : null},
    };
    panel.click(event);
    assert.equal(calls[0].kind, "menu");
    assert.deepEqual(calls[0].args.slice(1), ["notebook", "/document.sy", row]);
    assert.equal(calls[1].kind, "popup");
    assert.deepEqual({...calls[1].args[0] as object}, {x: 180, y: 120, h: 24});
    panel.mobile = true;
    panel.menu(row, {x: 180, y: 120, h: 24});
    assert.equal(calls[3].kind, "fullscreen");
    panel.click(event);
    assert.equal(calls.length, 6);
    panel.click(event);
    assert.equal(calls.length, 6);
    panel.click(event);
    assert.equal(calls.length, 8);
});

test("pinned rows retain notebook and occurrence metadata without creating descendant wrappers", () => {
    const {panel} = loadPanel();
    const rows = ["first", "second"].map(notebookId => panel.renderRow({id: "doc", notebookId,
        occurrenceKey: "pin:" + notebookId, depth: 0, unavailable: false,
        file: {id: "doc", name: "Document", path: "/doc.sy", subFileCount: 0}}));
    assert.deepEqual(rows.map(row => row.tagName), ["li", "li"]);
    assert.equal(rows[0].dataset.notebook, "first");
    assert.equal(rows[1].dataset.notebook, "second");
    assert.equal(rows[0].dataset.pinRow, "pin:first");
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

test("mobile pinned rows use touch dragging without native HTML dragging", () => {
    const {panel} = loadPanel();
    for (const mobile of [false, true]) {
        panel.mobile = mobile;
        const row = panel.renderRow({id: "doc", notebookId: "box", occurrenceKey: "pin:doc", depth: 0,
            file: {id: "doc", name: "Document", path: "/doc.sy", subFileCount: 0}});
        assert.equal(row.draggable, !mobile);
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
    config.fileTree.docIconClickMode = 1;
    panel.toggle = () => { calls.push({kind: "toggle", args: []}); };
    panel.open = () => { calls.push({kind: "open", args: []}); };
    panel.click(event);
    assert.equal(calls[1].kind, "toggle");
    row.dataset.count = "0";
    panel.click(event);
    assert.equal(calls[2].kind, "open");
});

test("document action updates refresh existing pinned icons without reloading their documents", () => {
    const {panel, config, runtime, calls, expansions} = loadPanel();
    Object.assign(runtime.languages, {changeIcon: "Change icon", docIconClickExpand: "Expand children", openDocument: "Open"});
    const makeRow = (count: number) => {
        const attributes = new Map<string, string>();
        const classes = new Set<string>();
        const icon = {
            classList: {toggle: (name: string, enabled: boolean) => {
                if (enabled) { classes.add(name); } else { classes.delete(name); }
            }},
            setAttribute: (name: string, value: string) => attributes.set(name, value),
            removeAttribute: (name: string) => attributes.delete(name),
        };
        return {dataset: {count: String(count)}, querySelector: () => icon, attributes, classes};
    };
    const rows = [makeRow(2), makeRow(0)];
    panel.list = {querySelectorAll: () => rows};
    expansions.add("parent");
    const file = "Files.ts";
    const source = ts.createSourceFile(file, readFileSync(join(__dirname, file), "utf8"), ts.ScriptTarget.Latest, true);
    let method: ts.MethodDeclaration;
    const visit = (node: ts.Node) => {
        if (ts.isMethodDeclaration(node) && node.name.getText(source) === "updateDocActions") { method = node; }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(method?.body);
    const exports = {} as {update: () => void};
    runInNewContext(ts.transpileModule(`exports.update = function() ${method.body.getText(source)};`, {
        compilerOptions: {target: ts.ScriptTarget.ES2020},
    }).outputText, {exports});
    const regularRow = {};
    const regularUpdates: unknown[] = [];
    const files = {pinnedDocs: panel, element: {querySelectorAll: () => [regularRow]},
        updateDocActionElement: (row: unknown) => regularUpdates.push(row)};
    for (const mode of [1, 0, 1]) {
        config.fileTree.docIconClickMode = mode;
        exports.update.call(files);
        rows.forEach(row => {
            assert.equal(row.classes.has("ariaLabel"), mode === 0);
            assert.equal(row.attributes.get("aria-label"), mode === 0 ? "Change icon" : undefined);
        });
    }
    assert.equal(regularUpdates.length, 3);
    assert.equal(regularUpdates[0], regularRow);
    assert.deepEqual([...expansions], ["parent"]);
    assert.equal(calls.length, 0);
    panel.mobile = true;
    for (const mode of [0, 1]) {
        config.fileTree.docIconClickMode = mode;
        panel.updateDocActions();
        assert.equal(rows[0].attributes.get("aria-label"), "Expand children");
        assert.equal(rows[1].attributes.get("aria-label"), "Open");
        assert.equal(rows.every(row => row.classes.has("ariaLabel")), true);
    }
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

test("dropping on a notebook resolves row metadata with or without root documents", async () => {
    const {panel, calls, hitTest} = loadPanel();
    const highlights: string[] = [];
    const row = {dataset: {type: "navigation-root", nodeId: "", notebookId: "notebook"},
        querySelector: () => ({textContent: "Notebook"}),
        closest: (): null => null,
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
    assert.deepEqual(tips.at(-1), ["Document", "Pin", 10, 1, "Target"]);
    source = true;
    row.dataset.pinRoot = "false";
    panel.previewDrop(10, 15, true);
    assert.deepEqual(tips.at(-1), ["Document", "Into ${x}", 10, 15, "Target"]);
    panel.previewDrop(10, 1, true);
    assert.deepEqual(tips.at(-1), ["Document", "Before ${x}", 10, 1, "Target"]);
    panel.previewDrop(10, 29, true);
    assert.deepEqual(tips.at(-1), ["Document", "After ${x}", 10, 29, "Target"]);
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

test("modifier clicks change logical selection without opening and ordinary clicks select the target", () => {
    const {panel, selected} = loadPanel();
    let opened = 0;
    const row = {dataset: {nodeId: "doc", notebook: "box", pinRow: "pin:doc"}};
    panel.open = () => opened++;
    selected.add("pin:doc");
    const event = {ctrlKey: true, stopPropagation() {}, preventDefault() {},
        target: {closest: (selector: string) => selector === "[data-pin-row]" ? row : null}};
    panel.click(event);
    assert.equal(selected.size, 0);
    panel.click(event);
    assert.equal(selected.has("pin:doc"), true);
    assert.equal(opened, 0);
    event.ctrlKey = false;
    panel.click(event);
    assert.equal(opened, 1);
    assert.deepEqual([...selected], ["pin:doc"]);
    panel.clearSelection();
    assert.equal(selected.size, 0);
});

test("notebook root expansion delegates to the controller using occurrence identity", async () => {
    const {panel, expansions} = loadPanel();
    for (const id of ["notebook", "document"]) {
        await panel.toggle({dataset: {notebook: "notebook", nodeId: id, pinRow: "pin:" + id, count: "2"}}, true);
    }
    assert.deepEqual([...expansions], ["pin:notebook", "pin:document"]);
});

test("double clicks open without expanding pinned rows while the first child range is prefetched", async () => {
    for (const {expanded, mobile} of [
        {expanded: false, mobile: false}, {expanded: true, mobile: false},
        {expanded: false, mobile: true}, {expanded: true, mobile: true},
    ]) {
        const {panel, config, calls, expansions} = loadPanel();
        config.fileTree.parentDocTitleClickMode = 2;
        panel.mobile = mobile;
        panel.generation = 0;
        if (expanded) { expansions.add("doc"); }
        const row = {isConnected: true, dataset: {nodeId: "doc", notebook: "box", treeKey: "doc", pinRow: "doc", path: "/doc.sy", count: "1"},
            classList: {add: () => {}}};
        const event = {stopPropagation: () => {}, target: {closest: (selector: string) =>
            selector === "[data-pin-row]" || selector === ".b3-list-item__text" ? row : null}};
        panel.open = () => calls.push({kind: "open", args: []});
        panel.toggle = (...args) => { calls.push({kind: "toggle", args}); };
        panel.click(event);
        assert.equal(calls.filter(call => call.kind === "http").length, 0);
        assert.equal(calls.filter(call => call.kind === "range").length, expanded ? 0 : 1);
        await delay(0);
        assert.equal(calls.filter(call => call.kind === "toggle").length, 0);
        panel.click(event);
        await delay(330);
        assert.equal(calls.filter(call => call.kind === "open").length, 1);
        assert.equal(calls.filter(call => call.kind === "toggle").length, 0);
        assert.equal(expansions.has("doc"), expanded);
    }
});

test("single parent click uses the prefetched child range after the double click window", async () => {
    const {panel, config, calls} = loadPanel();
    config.fileTree.parentDocTitleClickMode = 2;
    panel.generation = 0;
    const row = {isConnected: true, dataset: {nodeId: "doc", notebook: "box", treeKey: "doc", pinRow: "doc", path: "/doc.sy", count: "1"},
        classList: {add: () => {}}};
    const event = {stopPropagation: () => {}, target: {closest: (selector: string) =>
        selector === "[data-pin-row]" || selector === ".b3-list-item__text" ? row : null}};
    panel.open = () => assert.fail("unexpected open");
    panel.toggle = (...args) => { calls.push({kind: "toggle", args}); };
    panel.click(event);
    await delay(330);
    assert.equal(calls.filter(call => call.kind === "http").length, 0);
    assert.equal(calls.filter(call => call.kind === "range").length, 1);
    assert.deepEqual(calls.find(call => call.kind === "toggle").args, [row, true]);
});

test("expand-only mode toggles pinned parent titles immediately on desktop and mobile", () => {
    for (const mobile of [false, true]) {
        const {panel, config, calls} = loadPanel();
        config.fileTree.parentDocTitleClickMode = 1;
        panel.mobile = mobile;
        const row = {dataset: {nodeId: "doc", notebook: "box", count: "4"}, classList: {add() {}}};
        const event = {stopPropagation() {}, target: {closest: (selector: string) =>
            selector === "[data-pin-row]" || selector === ".b3-list-item__text" ? row : null}};
        panel.toggle = () => { panel.parentDocClick.cancel(); calls.push({kind: "toggle", args: []}); };
        panel.open = () => assert.fail("expand-only mode must not open the document");
        panel.click(event);
        assert.deepEqual(calls.map(call => call.kind), ["toggle"]);
        panel.click(event);
        assert.equal(calls.filter(call => call.kind === "http").length, 0);
    }
});

test("pinned area follows list contents on initial load, pin, unpin and sync", async () => {
    const {panel, calls, docs} = loadPanel();
    const states: boolean[] = [];
    panel.generation = 0;
    panel.list = {scrollTop: 0, contains: () => false,
        querySelectorAll: (): unknown[] => [], replaceChildren: () => {}};
    panel.element = {classList: {toggle: (name: string, hidden: boolean) => {
        assert.equal(name, "fn__none");
        states.push(hidden);
    }}};
    await panel.refresh();
    await panel.refresh();
    docs.push({id: "document", notebook: "notebook", name: "Document"});
    await panel.refresh();
    docs.length = 0;
    await panel.refresh();
    docs.push({id: "synced", notebook: "notebook", name: "Synced"});
    await panel.refresh();
    assert.deepEqual(states, [true, true, false, true, false]);
    assert.ok(calls.every(call => call.kind === "http" && call.args[0] === "/api/filetree/getPinnedDocs"));
});

test("document info delegates metadata updates to the shared controller without reloading roots", () => {
    const {panel, messages} = loadPanel();
    const scheduled: unknown[] = [];
    panel.scheduleRefresh = id => scheduled.push(id);
    const info = {rootID: "document", name: 'A "title" <tag>', hSize: "2 KB", subFileCount: 2};
    panel.onFileTreeMessage({cmd: "reloadDocInfo", data: info});
    assert.equal(messages[0].data, info);
    assert.equal(scheduled.length, 0);
});

test("root changes schedule refresh while metadata updates stay within the shared controller", () => {
    const {panel, messages} = loadPanel();
    const updates: unknown[] = [];
    panel.scheduleRefresh = id => updates.push(id);
    for (const cmd of ["rename", "reloadDocInfo", "reloadNotebookInfo", "reloadFiletree", "pinnedDocsChanged", "moveDocs"]) {
        panel.onFileTreeMessage({cmd, data: {id: "document", rootID: "document"}});
    }
    assert.equal(updates.length, 4);
    assert.equal(messages.length, 6);
});
