import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
    ScriptTarget.ES2021, true);
const controller = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapController");
assert.ok(controller && isClassDeclaration(controller));
const methods = controller.members.filter(item => item.name && ["add", "change", "undo", "focusNode"].includes(item.name.getText(source)));
assert.equal(methods.length, 4);
let editorUndo = "";
const visit = (item: import("typescript").Node) => {
    if (isPropertyAssignment(item) && item.name.getText(source) === "onUndo" &&
        item.initializer.getText(source).includes("this.undo(redo, id)")) {
        editorUndo = item.initializer.getText(source);
    }
    item.forEachChild(visit);
};
visit(controller);
assert.ok(editorUndo);
const compiled = transpileModule(`class Controller {
    ${methods.map(item => item.getText(source)).join("\n")}
    makeEditorUndo(id) { return ${editorUndo}; }
}
globalThis.Controller = Controller;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

test("new mind map nodes become selected before editing", async () => {
    const steps: string[] = [];
    const item = {dataset: {nodeId: "new"}, classList: {replace: () => {}}};
    const context: any = {
        canEdit: () => true,
        genListItemElement: () => item,
        addListMindmapNode: () => true,
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
        edit: async (id: string) => { steps.push(`edit:${id}`); },
    });
    await target.add("root", "child");
    assert.deepEqual(steps, ["focus:new", "edit:new"]);
});

test("undo from a node editor restores that node or its previous sibling", async () => {
    const root = {id: "root", children: [{id: "existing"}, {id: "new"}]};
    const nodes = new Map<string, {id: string, parentId?: string, children?: {id: string}[]}>([
        ["root", root], ["existing", {id: "existing", parentId: "root"}],
        ["new", {id: "new", parentId: "root"}],
    ]);
    const selected: string[] = [];
    let removeNew = false;
    const owner = {undo: {undo: async () => {
        if (removeNew) {
            nodes.delete("new");
        }
    }}};
    const roots = new WeakMap();
    const context: any = {canEdit: () => true, roots};
    runInNewContext(compiled, context);
    const target = new context.Controller();
    Object.assign(target, {
        owner, list: {dataset: {nodeId: "map"}}, model: {nodes, root},
        view: {getSelectedId: () => "root", focusNode: (id: string) => selected.push(id)},
    });
    roots.set(owner, {restoreFocus: (_listID: string, ids: string[]) => target.focusNode(ids)});
    const onEditorUndo = target.makeEditorUndo("new");
    await onEditorUndo(false);
    assert.equal(selected.pop(), "new", "undoing node text keeps focus on the edited node");
    removeNew = true;
    await onEditorUndo(false);
    assert.equal(selected.pop(), "existing", "undoing node insertion focuses the previous sibling");
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
    const getModel = () => {
        const nodes = new Map(state.map(node => [node.id, {id: node.id, children: [], parentId: ""}]));
        state.forEach(node => {
            nodes.get(node.id).children = node.children.map(id => {
                const child = nodes.get(id);
                child.parentId = node.id;
                return child;
            });
        });
        return {nodes, root: nodes.get("root")};
    };
    const list = {isConnected: true, dataset: {nodeId: "map"}, get outerHTML() { return JSON.stringify(state); }};
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
    const owner = {undo: {
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
