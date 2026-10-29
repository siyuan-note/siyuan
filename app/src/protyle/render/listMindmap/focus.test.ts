import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
    ScriptTarget.ES2021, true);
const controller = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapController");
assert.ok(controller && isClassDeclaration(controller));
const methods = controller.members.filter(item => item.name &&
    ["add", "deleteNode", "change", "undo", "focusNode", "edit"].includes(item.name.getText(source)));
assert.equal(methods.length, 6);
let editorUndo = "";
const visit = (item: import("typescript").Node) => {
    if (isPropertyAssignment(item) && item.name.getText(source) === "onUndo" &&
        item.initializer.getText(source).includes("this.undo(redo, id,")) {
        editorUndo = item.initializer.getText(source);
    }
    item.forEachChild(visit);
};
visit(controller);
assert.ok(editorUndo);
const compiled = transpileModule(readFileSync("src/protyle/undo/viewport.ts", "utf8").replace(/^export /gm, "") + `
class Controller {
    ${methods.map(item => item.getText(source)).join("\n")}
    makeEditorUndo(id) { return ${editorUndo}; }
}
globalThis.Controller = Controller;
globalThis.isUndoViewportPreserved = isUndoViewportPreserved;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

test("explicit mind map additions stay selected while clipboard additions still open the editor", async () => {
    const steps: string[] = [];
    const item = {dataset: {nodeId: "new"}, classList: {replace: () => {}}, outerHTML: "new node"};
    const clipboard = {textPlain: "Pasted content"};
    const context: any = {
        canEdit: () => true,
        genListItemElement: () => item,
        addListMindmapNode: () => true,
        cleanListMindmapHTML: (html: string) => html,
    };
    runInNewContext(compiled, context);
    const target = new context.Controller();
    Object.assign(target, {
        owner: {}, list: {dataset: {type: "NodeMindmap"}, children: []},
        model: {nodes: new Map([["root", {id: "root"}]])},
        change: async (action: () => unknown) => action(),
        view: {focusNode: (id: string) => steps.push(`focus:${id}`),
            getContentHost: () => ({}),
        },
        edit: async (id: string, _host: unknown, replace: unknown, data: unknown) => {
            assert.equal(replace, undefined);
            assert.equal(data, clipboard);
            steps.push(`edit:${id}`);
        },
    });
    for (const type of ["NodeList", "NodeMindmap"]) {
        target.list.dataset.type = type;
        for (const kind of ["child", "sibling"]) {
            steps.length = 0;
            await target.add("root", kind);
            assert.deepEqual(steps, ["focus:new"], `${type} ${kind} keeps node selection without opening the editor`);
            steps.length = 0;
            await target.add("root", kind, clipboard);
            assert.deepEqual(steps, ["focus:new", "edit:new"], `${type} ${kind} imports clipboard content through the editor`);
        }
    }
    target.change = async () => false;
    steps.length = 0;
    await target.add("root", "child");
    await target.add("root", "sibling", clipboard);
    assert.deepEqual(steps, [], "failed additions neither move focus nor open the editor");
});

test("canceling new nodes restores their origin without overriding changed content, failed deletes or newer selection", async () => {
    for (const scenario of ["new", "changed", "replaced", "missing origin", "ordinary", "failed", "newer selection"]) {
        const original = {outerHTML: "new node"};
        const element = scenario === "replaced" ? {...original} : original;
        if (scenario === "changed") {
            element.outerHTML = "changed content";
        }
        const nodes = new Map([["new", {element}], ["origin", {}], ["other", {}]]);
        if (scenario === "missing origin") {
            nodes.delete("origin");
        }
        let selected: string = "new";
        let focusID: string;
        const origins = new WeakMap();
        if (scenario !== "ordinary") {
            origins.set(original, {id: "origin", html: "new node"});
        }
        const context: any = {cleanListMindmapHTML: (html: string) => html,
            deleteListMindmapNode: (_list: unknown, id: string) => scenario !== "failed" && nodes.delete(id)};
        runInNewContext(compiled, context);
        const target = Object.assign(new context.Controller(), {
            list: {contains: (node: unknown) => node === element}, model: {nodes}, newNodeOrigins: origins,
            view: {getSelectedId: () => selected, focusNode: (id: string) => { selected = id; }},
            change: async (action: () => boolean, _editing: boolean, nextID: string) => {
                focusID = nextID;
                const changed = action();
                if (changed) {
                    selected = scenario === "newer selection" ? "other" : undefined;
                }
                return changed;
            },
        });
        assert.equal(await target.deleteNode("new"), scenario !== "failed", scenario);
        const special = ["new", "failed", "newer selection"].includes(scenario);
        assert.equal(focusID, special ? "origin" : undefined, `${scenario}: transaction uses the same destination`);
        assert.equal(selected, scenario === "new" ? "origin" : scenario === "failed" ? "new" :
            scenario === "newer selection" ? "other" : undefined, `${scenario}: focus follows the current interaction`);
        assert.equal(origins.has(element), scenario === "failed", `${scenario}: successful deletion clears creation state`);
    }
});

test("entering a new node editor permanently cancels its creation-origin shortcut", async () => {
    const element = {};
    const origins = new WeakMap([[element, {id: "origin", html: "new node"}]]);
    const context: any = {roots: new WeakMap(), canEdit: () => true, openListMindmapEditor: () => ({})};
    runInNewContext(compiled, context);
    const target = Object.assign(new context.Controller(), {
        owner: {}, list: {closest: (): null => null}, model: {nodes: new Map([["new", {element}]])},
        newNodeOrigins: origins, view: {setEditing: () => {}}, editRequest: 0,
    });
    await target.edit("new", {isConnected: true});
    assert.equal(origins.has(element), false, "even an editor closed without text changes counts as entering editing");
});

test("canvas undo and redo preserve the viewport throughout replay and release it on errors", async () => {
    const editor = {isConnected: true};
    let fail = false;
    const history = async () => {
        assert.equal(context.isUndoViewportPreserved(editor), true);
        await Promise.resolve();
        assert.equal(context.isUndoViewportPreserved(editor), true);
        if (fail) { throw new Error("history failed"); }
    };
    const owner = {block: {rootID: "doc"}, wysiwyg: {element: editor}, undo: {undo: history, redo: history}};
    const roots = new WeakMap([[owner, {focusRevision: 0, restoreFocus() {}}]]);
    const context: any = {roots, canEdit: () => true, cleanListMindmapHTML: (html: string) => html,
        hasMindmapFocusOverlay: () => false};
    runInNewContext(compiled, context);
    const target = Object.assign(new context.Controller(), {owner,
        list: {dataset: {nodeId: "map"}, outerHTML: "map", isConnected: true, closest: (): null => null},
        model: {nodes: new Map()}, view: {getSelectedId: (): undefined => undefined},
    });
    for (const redo of [false, true]) {
        await target.undo(redo);
        assert.equal(context.isUndoViewportPreserved(editor), false);
        fail = true;
        await assert.rejects(target.undo(redo), /history failed/);
        assert.equal(context.isUndoViewportPreserved(editor), false);
        fail = false;
    }
});

test("embedded history uses the source document and transaction owner without depending on the selection", async () => {
    for (const lite of [false, true]) {
        const submitted: unknown[] = [];
        const mainOwner = {lite: false, wysiwyg: {element: {}}};
        const owner = {lite, block: {rootID: "host-document"}, wysiwyg: {element: {isConnected: true}},
            undo: {undo: assert.fail, redo: assert.fail}};
        const embed = {dataset: {rootId: "source-document"}};
        const list = {dataset: {nodeId: "map"}, isConnected: true, outerHTML: "snapshot", closest: () => embed};
        const context: any = {canEdit: () => true, roots: new WeakMap(), cleanListMindmapHTML: (html: string) => html,
            hasMindmapFocusOverlay: () => false,
            getProtyleTransactionOwner: (_owner: unknown, operations: {id: string}[]) => {
                assert.equal(operations[0].id, "map");
                return mainOwner;
            },
            requestUndo: (target: unknown, rootID: string) => submitted.push([target, rootID, "undo"]),
            requestRedo: (target: unknown, rootID: string) => submitted.push([target, rootID, "redo"]),
            fetchSyncPost: async (_url: string, data: {id: string}) => {
                assert.equal(data.id, "map");
                return {code: 0, data: {dom: "canonical history snapshot"}};
            },
        };
        runInNewContext(compiled, context);
        const target = Object.assign(new context.Controller(), {owner, list,
            model: {nodes: new Map(), root: {id: "map"}}, view: {getSelectedId: () => "map"},
            replay: (html: string) => { assert.equal(html, "canonical history snapshot"); return true; }});
        await target.undo(false);
        await target.undo(true);
        assert.deepEqual(submitted, [[lite ? mainOwner : owner, "source-document", "undo"],
            [lite ? mainOwner : owner, "source-document", "redo"]]);
    }
});

test("undo from a node editor restores that node or its previous sibling", async () => {
    const root = {id: "root", children: [{id: "existing"}, {id: "new"}]};
    const nodes = new Map<string, {id: string, parentId?: string, children?: {id: string}[]}>([
        ["root", root], ["existing", {id: "existing", parentId: "root"}],
        ["new", {id: "new", parentId: "root"}],
    ]);
    const selected: string[] = [];
    let removeNew = false;
    const owner = {wysiwyg: {element: {isConnected: true}}, block: {rootID: "document"}, undo: {undo: async () => {
        if (removeNew) {
            nodes.delete("new");
        }
    }}};
    const roots = new WeakMap();
    const context: any = {canEdit: () => true, roots, cleanListMindmapHTML: (html: string) => html,
        hasMindmapFocusOverlay: () => false};
    runInNewContext(compiled, context);
    const target = new context.Controller();
    Object.assign(target, {
        owner, list: {dataset: {nodeId: "map"}, isConnected: true, outerHTML: "map", closest: (): null => null}, model: {nodes, root},
        view: {getSelectedId: () => "root", focusNode: (id: string, reveal: boolean) => {
            assert.equal(reveal, false, "history selection must not reveal or pan to the node");
            selected.push(id);
        }},
    });
    roots.set(owner, {restoreFocus: (_listID: string, ids: string[]) => target.focusNode(ids)});
    const onEditorUndo = target.makeEditorUndo("new");
    await onEditorUndo(false);
    assert.equal(selected.pop(), "new", "undoing node text keeps focus on the edited node");
    removeNew = true;
    await onEditorUndo(false);
    assert.equal(selected.pop(), "existing", "undoing node insertion focuses the previous sibling");
});

test("text history records the edited node even when selection changes before its save", async () => {
    const nodes = new Map([["root", {id: "root", children: [{id: "child"}]}],
        ["child", {id: "child", parentId: "root", children: []}]]);
    const list = {isConnected: true, dataset: {nodeId: "map"}, outerHTML: "before", closest: (): null => null};
    const operations: {undo: Record<string, string>, redo: Record<string, string>}[] = [];
    const context: any = {
        canEdit: () => true, readListMindmap: () => ({nodes, root: nodes.get("root"),
            metadata: {version: 1, nodes: {}, relations: [] as unknown[]}}),
        cleanListMindmapHTML: (html: string) => html, getListMindmapSiblingIDs: () => new Map(),
        normalizeListMindmapSummaryMetadata: () => {},
        updateTransaction: (_owner: unknown, _list: unknown, _before: string, undo: Record<string, string>,
                            additional: {context: Record<string, string>}) => operations.push({undo, redo: additional.context}),
        console, showMessage: assert.fail, window: {siyuan: {languages: {listMindmapInvalid: "save failed"}}},
    };
    runInNewContext(compiled, context);
    const target = Object.assign(new context.Controller(), {owner: {}, list, refresh() {},
        view: {getSelectedId: () => "root"}});
    const undo = {undoFocusId: "paragraph", undoFocusStart: "2", undoFocusEnd: "2"};
    const redo = {...undo, undoFocusStart: "5", undoFocusEnd: "5"};
    assert.equal(await target.change(() => { list.outerHTML = "after"; }, true, "child", {undo, redo}), true);
    assert.equal(operations[0].undo.undoFocusId, "child", "undo must reopen the edited child instead of the selected root");
    assert.equal(operations[0].redo.undoFocusId, "child");
    assert.deepEqual(JSON.parse(operations[0].undo.undoFocusMindmapSelection), undo);
    assert.deepEqual(JSON.parse(operations[0].redo.undoFocusMindmapSelection), redo);
});

test("mind map transaction focus survives insertion, deletion and repeated undo/redo", async () => {
    type FocusContext = {undoFocusId: string, undoFocusStart: string, undoFocusEnd: string};
    type State = {id: string, children: string[]}[];
    type Operation = {before: string, after: string, undo: FocusContext, redo: FocusContext};
    const operations: Operation[] = [];
    const redoOperations: Operation[] = [];
    let state: State = [{id: "root", children: ["existing"]}, {id: "existing", children: []}];
    let selectedID = "existing";
    let target: any;
    type ModelNode = {id: string; children: ModelNode[]; parentId: string};
    const getModel = () => {
        const nodes = new Map<string, ModelNode>(state.map((node): [string, ModelNode] => [node.id, {id: node.id, children: [], parentId: ""}]));
        state.forEach(node => {
            nodes.get(node.id).children = node.children.map(id => {
                const child = nodes.get(id);
                child.parentId = node.id;
                return child;
            });
        });
        return {nodes, root: nodes.get("root"), metadata: {version: 1, nodes: {}, relations: [] as unknown[]}};
    };
    const list = {isConnected: true, dataset: {nodeId: "map"}, closest: (): null => null,
        get outerHTML() { return JSON.stringify(state); }};
    const roots = new WeakMap();
    const root = {focusRevision: 0, restoreFocus: (_listID: string, ids: string[]) => {
        root.focusRevision++;
        target.focusNode(ids);
    }};
    const replay = (operation: Operation, redo: boolean) => {
        state = JSON.parse(redo ? operation.after : operation.before);
        // 回放替换 DOM 后创建新的控制器，不能依赖旧控制器保存的选择。
        target = createController();
        selectedID = "root";
        root.restoreFocus("map", [(redo ? operation.redo : operation.undo).undoFocusId]);
    };
    const owner = {wysiwyg: {element: {isConnected: true}}, block: {rootID: "document"}, undo: {
        undo: async () => {
            const operation = operations.pop();
            if (operation) {
                redoOperations.push(operation);
                replay(operation, false);
            }
        },
        redo: async () => {
            const operation = redoOperations.pop();
            if (operation) {
                operations.push(operation);
                replay(operation, true);
            }
        },
    }};
    roots.set(owner, root);
    const context: any = {
        roots, canEdit: () => true, readListMindmap: getModel, cleanListMindmapHTML: (html: string) => html,
        hasMindmapFocusOverlay: () => false,
        getListMindmapSiblingIDs: () => new Map(), normalizeListMindmapSummaryMetadata: () => {},
        updateTransaction: (_owner: unknown, _list: unknown, before: string, undo: FocusContext,
                            additional: {context: FocusContext}) => {
            operations.push({before, after: list.outerHTML, undo, redo: additional.context});
            redoOperations.length = 0;
        },
        showMessage: (message: string) => assert.fail(message),
        window: {siyuan: {languages: {listMindmapInvalid: "Mind map mutation failed"}}}, console,
    };
    runInNewContext(compiled, context);
    const createController = () => Object.assign(new context.Controller(), {
        owner, list, model: getModel(), refresh() { this.model = getModel(); },
        view: {getSelectedId: () => selectedID, focusNode: (id: string) => { selectedID = id; }},
    });
    target = createController();
    await target.change(() => {
        state[0].children.push("new");
        state.push({id: "new", children: []});
    }, false, "new");
    selectedID = "new";
    assert.equal(operations[0].undo.undoFocusId, "existing");
    assert.equal(operations[0].redo.undoFocusId, "new");
    for (let i = 0; i < 2; i++) {
        await target.undo(false);
        assert.equal(selectedID, "existing");
        await target.undo(true);
        assert.equal(selectedID, "new", "redo focus must not be overwritten by the selected sibling");
    }
    await target.change(() => {
        state[0].children = ["existing"];
        state = state.filter(node => node.id !== "new");
    });
    selectedID = "existing";
    await target.undo(false);
    assert.equal(selectedID, "new", "undoing deletion returns to the restored node");
    await target.undo(true);
    assert.equal(selectedID, "existing", "redoing deletion selects the surviving sibling");
    const count = operations.length;
    await target.change(() => {});
    assert.equal(operations.length, count, "unchanged content must not add a focus-only transaction");
});

test("empty or canceled history restores the current text selection unless a newer interaction took over", async () => {
    const selection = {undoFocusId: "body", undoFocusStart: "2", undoFocusEnd: "5"};
    const opened: unknown[] = [];
    const body = {getAttribute: () => "body", querySelectorAll: (): Element[] => []};
    const node = {id: "item", contentBlocks: [body]};
    const nodes = new Map([["item", node]]);
    let release: () => void;
    const owner = {block: {rootID: "document"}, wysiwyg: {element: {isConnected: true}},
        undo: {undo: async () => {}}};
    const roots = new WeakMap();
    const context: any = {roots, canEdit: () => true, cleanListMindmapHTML: (html: string) => html,
        hasMindmapFocusOverlay: () => false};
    runInNewContext(compiled, context);
    const target = Object.assign(new context.Controller(), {
        owner, list: {dataset: {nodeId: "map"}, outerHTML: "same", isConnected: true, closest: (): null => null}, model: {root: node, nodes},
        view: {getSelectedId: () => "item", focusNode: () => {}, getContentHost: () => ({isConnected: true})},
        edit: async (...args: unknown[]) => opened.push(args[4]),
    });
    const state = {focusRevision: 0, interactionRevision: 0,
        restoreFocus: (_id: string, ids: string[], saved: unknown) => target.focusNode(ids, saved)};
    roots.set(owner, state);
    await target.undo(false, "item", selection);
    assert.deepEqual(opened, [selection]);
    owner.undo.undo = () => new Promise<void>(resolve => { release = resolve; });
    const pending = target.undo(false, "item", selection);
    state.interactionRevision++;
    release();
    await pending;
    assert.equal(opened.length, 1, "late history completion must not steal focus after a click or new edit");
    assert.equal(roots.get(owner).undoPending, false);
});

test("history reopening does not invalidate its own guard and stale editor cleanup cannot clear a newer editor", async () => {
    const owner = {};
    const roots = new WeakMap([[owner, {interactionRevision: 0}]]);
    const options: any[] = [];
    const editors: any[] = [];
    const context: any = {roots, canEdit: () => true, openListMindmapEditor: (value: unknown) => {
        options.push(value);
        const editor = {finish: async () => true};
        editors.push(editor);
        return editor;
    }};
    runInNewContext(compiled, context);
    const target = Object.assign(new context.Controller(), {
        owner, editRequest: 0, list: {closest: (): null => null}, model: {nodes: new Map([["item", {id: "item"}]])},
        view: {setEditing: () => {}, update: () => {}},
    });
    const saved = {undoFocusId: "body", undoFocusStart: "1", undoFocusEnd: "1"};
    await target.edit("item", {isConnected: true}, undefined, undefined, saved,
        () => roots.get(owner).interactionRevision === 0);
    assert.equal(editors.length, 1);
    assert.equal(options[0].selection, saved);
    const newer = {finish: async () => true};
    target.activeEditor = newer;
    options[0].onFinish();
    assert.equal(target.activeEditor, newer);
});
