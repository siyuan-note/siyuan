import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {createAVCellUpdateOperation} from "./cellValue";
import {isAVReadonlyType} from "./capabilities";
import {getAVHostIdentity} from "./host";

const source = createSourceFile("cell.ts", readFileSync("src/protyle/render/av/cell.ts", "utf8"), ScriptTarget.Latest);
const declaration = source.statements.find(statement => statement.getText(source).startsWith("export const updateCellsValue"));
const code = transpileModule(declaration.getText(source), {compilerOptions: {
    module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
}}).outputText;

const fixture = () => {
    const previous = {id: "value", type: "text", text: {content: "original"}};
    const selected = {rowID: "row", colID: "column", column: {type: "text"}, cell: {id: "value", value: previous}};
    const updates: string[] = [];
    let complete: () => void;
    let fail: (error: Error) => void;
    let requests = 0;
    const node = {isConnected: true, dataset: {avId: "database", nodeId: "carrier"},
        getAttribute: (name: string) => name === "data-av-type" ? "table" : "previous-time"};
    const exports = {} as typeof import("./cell");
    runInNewContext(code, {exports,
        getAVRelationHost: (): undefined => undefined,
        isAVReadonlyType,
        getAVBatchEditMode: () => "replace",
        cloneAVCellValueSnapshot: structuredClone,
        getCellValueText: (value: typeof previous) => value.text.content,
        transformCellValue: (_type: string, value: unknown) => structuredClone(value),
        rebindAVCellValue: (value: object, ids: object) => ({...value, ...ids}),
        objEquals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
        createAVCellUpdateOperation,
        dayjs: () => ({format: () => "current-time"}),
        updateAttrViewCellInOtherElements: (_protyle: unknown, _av: string, _row: string, _col: string, value: typeof previous) =>
            updates.push(value.text.content),
        updateAVSelectedCellValue: () => {},
        transaction: (_protyle: unknown, operations: IOperation[], _undo: IOperation[], options: {awaitResponse: boolean}) => {
            assert.equal(options.awaitResponse, true);
            assert.equal(operations[0].action, "updateAttrViewCell");
            requests++;
            return new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
        },
    });
    const save = () => exports.updateCellsValue({} as IProtyle, node as unknown as HTMLElement,
        {type: "text", text: {content: "draft"}}, undefined, undefined, undefined,
        false, false, false, [selected] as unknown as import("./selectionState").IAVSelectedCell[], true, true);
    return {save, node, previous, updates, requests: () => requests,
        complete: () => complete(), fail: () => fail(new Error("Save failed"))};
};

test("database text saves retain the original cache until the transaction succeeds", async () => {
    const f = fixture();
    const saving = f.save();
    assert.equal(f.requests(), 1);
    assert.deepEqual(f.updates, []);
    f.complete();
    await saving;
    assert.deepEqual(f.updates, ["draft"]);
});

test("failed database text saves do not cache an unsaved draft and permit explicit retry", async () => {
    const f = fixture();
    const saving = f.save();
    const rejected = assert.rejects(saving, /Save failed/);
    f.fail();
    await rejected;
    assert.deepEqual(f.updates, []);
    assert.equal(f.previous.text.content, "original");
    const retry = f.save();
    assert.equal(f.requests(), 2);
    f.complete();
    await retry;
    assert.deepEqual(f.updates, ["draft"]);
});

test("database text acknowledgements do not repopulate an invalidated owner", async () => {
    const f = fixture();
    const saving = f.save();
    f.node.isConnected = false;
    f.complete();
    await saving;
    assert.deepEqual(f.updates, []);
});

test("location editor saves await cell persistence and preserve the original target", async () => {
    const declaration = source.statements.find(statement => statement.getText(source).startsWith("export const popTextCell"));
    const exports = {} as typeof import("./cell");
    const previous = {id: "value", type: "location", location: {name: "original"}};
    const block = {isConnected: true, dataset: {avId: "database", nodeId: "carrier"},
        getAttribute: () => "table", querySelector: () => ({})};
    const cell = {dataset: {}, getBoundingClientRect: () => ({}), closest: (): null => null};
    const protyle = {block: {rootID: "document"}, options: {}};
    let editor: {onSave: (value: object) => Promise<void>; avBlockID: string};
    let complete: () => void;
    let fail: (error: Error) => void;
    let requests = 0;
    runInNewContext(transpileModule(declaration.getText(source), {compilerOptions: {
        module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
    }}).outputText, {exports,
        document: {querySelector: (): null => null}, getComputedStyle: () => ({}),
        window: {siyuan: {config: {}, menus: {menu: {remove() {}}}}},
        hasClosestBlock: () => block, hasClosestByClassName: () => ({}),
        getAVHostIdentity,
        isTableLikeView: () => true, cellScrollIntoView() {},
        getStoredCellValueByElement: () => previous,
        genCellValueByElement: () => previous, cloneAVCellValueSnapshot: structuredClone,
        getAVCellEditorOwner: () => ({contains: () => true}),
        getFieldIdByCellElement: () => "row", getColId: () => "column", getAVData: (): null => null,
        openAVLocationEditor: (options: typeof editor) => { editor = options; },
        updateCellsValue: (...args: unknown[]) => {
            assert.equal(args[0], protyle);
            assert.equal(args[1], block);
            const cells = args[9] as Array<{rowID: string; colID: string}>;
            assert.equal(cells[0].rowID, "row");
            assert.equal(cells[0].colID, "column");
            assert.equal(args[10], true);
            assert.equal(args[11], true);
            requests++;
            return new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
        },
    });
    exports.popTextCell(protyle as IProtyle, [cell] as unknown as HTMLElement[], "location");
    assert.equal(editor.avBlockID, "carrier");
    const saving = editor.onSave({name: "draft"});
    let resolved = false;
    void saving.then(() => { resolved = true; }, () => {});
    await Promise.resolve();
    assert.equal(resolved, false);
    const rejected = assert.rejects(saving, /Save failed/);
    fail(new Error("Save failed"));
    await rejected;
    const retry = editor.onSave({name: "draft"});
    complete();
    await retry;
    assert.equal(requests, 2);
    block.dataset.nodeId = "different-carrier";
    await editor.onSave({name: "redirected"});
    assert.equal(requests, 2);
    block.dataset.nodeId = "carrier";
    block.isConnected = false;
    await editor.onSave({name: "stale"});
    assert.equal(requests, 2);
});
