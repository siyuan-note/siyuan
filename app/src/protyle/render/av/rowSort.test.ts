import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/rowSort.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    let commit: () => void;
    const pending = new Promise<void>(resolve => commit = resolve);
    const requests: {data: any, callback: (response: any) => void}[] = [];
    const transactions: any[][] = [];
    const confirmations: Array<() => void> = [];
    const block = {
        isConnected: true,
        viewID: "view",
        sorted: true,
        dataset: {avId: "database", nodeId: "block"},
        querySelector: () => ({classList: {contains: () => block.sorted}}),
    };
    const protyle = {disabled: false};
    const exports: any = {};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {languages: {removeSorts: "Remove sort rules", avDragRemoveSorts: "Confirm"}}},
        require: () => ({
            waitForPendingTransactions: () => pending,
            getAVViewID: () => block.viewID,
            fetchPost: (_url: string, data: any, callback: (response: any) => void) => requests.push({data, callback}),
            transaction: (...args: any[]) => transactions.push(args),
            confirmDialog: (_title: string, _text: string, confirm: () => void) => confirmations.push(confirm),
        }),
    });
    const legacyDo = [{id: "legacy-do"}];
    const legacyUndo = [{id: "legacy-undo"}];
    const sort = (selected = ["b@group", "a@group"]) => exports.sortAVRows(
        protyle, block, selected, "group", "", "c", legacyDo, legacyUndo);
    return {block, protyle, requests, transactions, confirmations, legacyDo, legacyUndo, sort, commit: () => commit()};
};

test("sorted dragging waits for edits and submits the complete selection and exact anchor", async () => {
    const f = fixture();
    const sorting = f.sort();
    assert.equal(f.requests.length, 0);
    f.commit();
    await sorting;
    assert.equal(f.requests[0].data.viewID, "view");
    assert.equal(f.requests[0].data.groupID, "group");
    assert.equal(f.requests[0].data.nextID, "c");
    assert.equal(f.requests[0].data.itemIDs.join(","), "b,a");
    const preview = {conflict: false, doOperations: [{id: "new"}], undoOperations: [{id: "old"}]};
    f.requests[0].callback({data: preview});
    assert.equal(f.confirmations.length, 0);
    assert.equal(f.transactions.length, 1);
    assert.equal(f.transactions[0][1], preview.doOperations);
    assert.equal(f.transactions[0][2], preview.undoOperations);
});

test("conflicting dragging does not write until confirmed", async () => {
    const f = fixture();
    f.commit();
    await f.sort();
    const preview = {conflict: true, doOperations: [{id: "new"}], undoOperations: [{id: "old"}]};
    f.requests[0].callback({data: preview});
    assert.equal(f.confirmations.length, 1);
    assert.equal(f.transactions.length, 0);
    f.confirmations[0]();
    assert.equal(f.transactions.length, 1);
    assert.equal(f.transactions[0][1], preview.doOperations);
    assert.equal(f.transactions[0][2], preview.undoOperations);
});

test("late previews and confirmations cannot affect a newer drag or a different view", async () => {
    const f = fixture();
    f.commit();
    await f.sort();
    await f.sort();
    const response = {data: {conflict: true, doOperations: [{}], undoOperations: [{}]}};
    f.requests[0].callback(response);
    assert.equal(f.confirmations.length, 0);
    f.requests[1].callback(response);
    f.block.viewID = "other-view";
    f.confirmations[0]();
    assert.equal(f.transactions.length, 0);
});

test("unsorted and cross-group dragging retain their existing transactions", async () => {
    for (const crossGroup of [false, true]) {
        const f = fixture();
        f.block.sorted = crossGroup;
        await f.sort(crossGroup ? ["a@other-group"] : undefined);
        assert.equal(f.requests.length, 0);
        assert.equal(f.transactions.length, 1);
        assert.equal(f.transactions[0][1], f.legacyDo);
        assert.equal(f.transactions[0][2], f.legacyUndo);
    }
});
