import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isIfStatement, Node, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("cell.ts", readFileSync("src/protyle/render/av/cell.ts", "utf8"), ScriptTarget.ES2022, true);
let loading: string;
const visit = (node: Node) => {
    if (isIfStatement(node) && node.expression.getText(source) === 'type === "template"' &&
        node.thenStatement.getText(source).includes('fetchPost("/api/av/renderAttributeView"')) {
        loading = node.thenStatement.getText(source);
    }
    forEachChild(node, visit);
};
visit(source);
assert.ok(loading);
const saving = source.statements.find(node => node.getText(source).startsWith("const updateCellValueByInput ="));
const compile = (code: string) => transpileModule(code, {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;

const fixture = () => {
    const input = {value: "old query result", disabled: false, dataset: {} as Record<string, string>, focus() {}, select() {}};
    const mask = {isConnected: true, querySelector: () => input, remove: () => { mask.isConnected = false; }};
    const block = {dataset: {avId: "database", nodeId: "carrier"},
        getAttribute: (name: string) => name === "data-av-type" ? "table" : null, setAttribute() {}};
    const transactions: Array<[IOperation[], IOperation[]]> = [];
    let respond: (response: unknown) => void;
    let request: {ignoreRows?: boolean};
    const context = {inputElement: input, avMaskElement: mask, blockElement: block,
        cellElements: [{dataset: {}, classList: {add() {}}}], viewType: "table",
        getColId: () => "template", isTableLikeView: () => true,
        getFieldsByData: (data: {view: {columns: unknown[]}}) => data.view.columns,
        isAVRenderData: (data: {view?: unknown}) => !!data?.view,
        fetchPost: (_url: string, data: typeof request, callback: typeof respond) => { request = data; respond = callback; },
        document: {querySelector: () => mask, querySelectorAll: () => [mask]},
        hasClosestByClassName: (_element: unknown, name: string) => name === "av__row" ? {dataset: {id: "row"}} : null,
        addDragFill() {}, transaction: (_editor: unknown, operations: IOperation[], undo: IOperation[]) => transactions.push([operations, undo]),
    };
    runInNewContext(compile(loading), context);
    const close = runInNewContext(compile(saving.getText(source)) + "\nupdateCellValueByInput;", context);
    return {input, transactions, request: () => request,
        close: () => close({}, "template", block, context.cellElements, false),
        reply: () => respond({code: 0, data: {view: {columns: [{id: "template", template: "source code"}]}}})};
};

test("closing a template cell before its source arrives never saves the displayed HTTP result", () => {
    const f = fixture();
    assert.equal(f.request().ignoreRows, true);
    assert.equal(f.input.disabled, true);
    assert.equal(f.input.value, "");
    f.close();
    f.reply();
    assert.equal(f.transactions.length, 0);
    assert.equal(f.input.value, "");
});

test("unchanged template source is not saved and intentional edits preserve the undo source", () => {
    const unchanged = fixture();
    unchanged.reply();
    unchanged.close();
    assert.equal(unchanged.transactions.length, 0);
    const changed = fixture();
    changed.reply();
    assert.equal(changed.input.disabled, false);
    changed.input.value = "new source";
    changed.close();
    assert.equal(changed.transactions.length, 1);
    assert.equal(changed.transactions[0][0][0].data, "new source");
    assert.equal(changed.transactions[0][1][0].data, "source code");
});
