import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
    ScriptTarget.ES2021, true);
const controller = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapController");
assert.ok(controller && isClassDeclaration(controller));
const methods = controller.members.filter(item => item.name && ["add", "undo", "focusNode"].includes(item.name.getText(source)));
assert.equal(methods.length, 3);
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
