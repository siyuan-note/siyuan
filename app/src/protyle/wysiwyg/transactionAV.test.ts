import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../testSupport/loadModule";
import {queueTransaction, queueTransactionBatch, waitForPendingTransactions} from "../util/transactionQueue";
import {getEditorTransaction} from "../util/transactionContract";
import type {Transaction} from "../../types/api";

const fixture = () => {
    const rendered: Element[] = [];
    const refreshed: IOperation[] = [];
    const carriers = [
        {isConnected: true, closest: (): Element => null, getAttribute: (name: string) => name === "data-av-type" ? "table" : "NodeAttributeView"},
        {isConnected: true, closest: (): Element => null, getAttribute: (name: string) => name === "data-av-type" ? "table" : "NodeAttributeView"},
    ];
    let finish: (success: boolean) => void;
    let finishSave: (response: unknown) => void;
    const undo: IOperation[][] = [];
    const requests: {transactions: {collectionRemovalSourceVersions?: Record<string, string>}[]}[] = [];
    const dependencies = {
        shouldReloadForEmbedConversion: () => false,
        shouldReloadForHeadingBatch: () => false,
        invalidateTrackedRangesByOperations() {},
        isUndoViewportPreserved: () => false,
        prepareAVHostTransaction: (_protyle: unknown, operations?: IOperation[]) => operations,
        getTagRemovalChanges: (): [] => [],
        hasReferenceRemoval: () => false,
        getEditorTransaction,
        Constants: {},
        queueTransaction,
        queueTransactionBatch,
        prepareViewFoldTransaction: (_protyle: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) =>
            ({doOperations, undoOperations}),
        cleanBlockSelectionModeHTML: (html: string) => html,
        cleanTableCellRichHTML: (html: string) => html,
        cleanTableVirtualizationHTML: (html: string) => html,
        cleanListMindmapHTML: (html: string) => html,
        restoreInlineElementBoundaryHTML: (html: string) => html,
        normalizeHTMLAssetIFrameBlockDOM: (html: string) => html,
        cleanHeadingNumberOperations: (): void => undefined,
        needSubscribe: () => true,
        isInEmbedBlock: (): void => undefined,
        syncTrackedRanges: (): void => undefined,
        avRender: (element: Element) => rendered.push(element),
        refreshAV: (_protyle: IProtyle, operation: IOperation) => refreshed.push(operation),
        invalidateViewFoldRequests: (): void => undefined,
        getBlockSelectionStatusIDs: (): string[] => [],
        countBlockWord: (): void => undefined,
        handleViewFoldSourceOperation: () => false,
        queueHeadingNumberRefresh: (): void => undefined,
        queueDatabaseRowRefreshForOperations: (): void => undefined,
        refreshHeadingFoldIndicators: (): void => undefined,
        applyViewFoldStates: (): void => undefined,
        fetchPost: (_url: string, data: {transactions: unknown[]}, callback: (response: unknown) => void) =>
            new Promise<void>(resolve => {
                finish = success => {
                    if (success) {
                        callback({data: data.transactions});
                    }
                    resolve();
                };
            }),
        fetchSyncPost: (_url: string, request: typeof requests[number]) => {
            requests.push(request);
            return new Promise(resolve => { finishSave = resolve; });
        },
    };
    const exports = loadModule<any>("src/protyle/wysiwyg/transaction.ts", {
        require: () => dependencies,
        window: {siyuan: {config: {sync: {provider: 0}, fileTree: {}}, languages: {transactionSaveUnconfirmed: "Unconfirmed save"}}},
        getSelection: () => ({rangeCount: 0}),
    }, ScriptTarget.ES2021);
    const element = {
        childElementCount: 1,
        querySelectorAll: (selector: string) => selector === '[data-node-id="carrier"]' ?
            carriers.filter(item => item.isConnected) : [],
        querySelector: () => carriers[0],
    };
    const protyle = {block: {rootID: "root"}, wysiwyg: {element}, options: {}, undo: {add: (operations: IOperation[]) => undo.push(operations)}} as unknown as IProtyle;
    const insert = () => exports.transaction(protyle, [{
        action: "insert", id: "carrier", previousID: "paragraph", data: '<div data-type="NodeAttributeView"></div>',
    }]);
    const save = (collectionRemovalSourceVersions?: Record<string, string>) => exports.transaction(protyle, [{action: "updateAttrViewCell", id: "value", avID: "av",
        keyID: "key", rowID: "row", data: {type: "text", text: {content: "saved"}}}], [],
    {awaitResponse: true, skipSync: true, collectionRemovalSourceVersions}) as Promise<void>;
    return {protyle, carriers, rendered, refreshed, api: exports, insert, save, undo, requests, finishSave: (response: unknown) => finishSave(response),
        finish: (success: boolean) => finish(success)};
};

test("primary and related icon notifications survive contract filtering and refresh the selected view", () => {
    const f = fixture();
    for (const action of ["setAttrViewShowIcon", "setAttrViewShowRelationIcon"]) {
        for (const data of [false, true]) {
            const response = JSON.parse(JSON.stringify({doOperations: [{action, data, avID: "av", viewID: "view"}]})) as Transaction;
            const operations = getEditorTransaction(response).doOperations;
            assert.equal(operations.length, 1);
            f.api.onTransaction(f.protyle, operations, false);
            assert.equal(f.refreshed.at(-1), operations[0]);
            assert.equal(f.refreshed.at(-1).data, data);
        }
    }
});

test("awaited database saves wait for acknowledgement and record undo only after success", async () => {
    const f = fixture();
    let completed = false;
    const saving = f.save().then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    assert.equal(f.undo.length, 0);
    f.finishSave({code: 0, data: [{doOperations: []}]});
    await saving;
    assert.equal(completed, true);
    assert.equal(f.undo.length, 1);
});

test("source-removal document versions reach the transaction request independently of cleanup operations", async () => {
    const f = fixture();
    const versions = {root: "authenticated-source-version"};
    const pending = f.save(versions);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.requests[0].transactions[0].collectionRemovalSourceVersions, versions);
    f.finishSave({code: 0, data: [{doOperations: []}]});
    await pending;
});

test("awaited database saves reject failed and malformed acknowledgements and permit retry", async () => {
    for (const response of [{code: -1, msg: "Save failed"}, {code: 0, data: {closeTimeout: 1}}, {code: 0, data: [] as unknown[]}]) {
        const f = fixture();
        const saving = f.save();
        const rejected = assert.rejects(saving);
        await new Promise(resolve => setImmediate(resolve));
        f.finishSave(response);
        await rejected;
        assert.equal(f.undo.length, 0);
        const retry = f.save();
        await new Promise(resolve => setImmediate(resolve));
        f.finishSave({code: 0, data: [{doOperations: []}]});
        await retry;
        assert.equal(f.undo.length, 1);
    }
});

test("本地模板数据库及其副本在插入事务成功后才渲染", async () => {
    const f = fixture();
    f.insert();
    assert.equal(f.rendered.length, 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.rendered.length, 0);
    f.finish(true);
    await waitForPendingTransactions(f.protyle);
    assert.deepEqual(f.rendered, f.carriers);
});

test("插入事务失败时不渲染尚未保存的数据库", async () => {
    const f = fixture();
    f.insert();
    await new Promise(resolve => setImmediate(resolve));
    f.finish(false);
    await waitForPendingTransactions(f.protyle);
    assert.equal(f.rendered.length, 0);
});

test("等待插入事务期间移除的数据库副本不再渲染", async () => {
    const f = fixture();
    f.insert();
    await new Promise(resolve => setImmediate(resolve));
    f.carriers[0].isConnected = false;
    f.finish(true);
    await waitForPendingTransactions(f.protyle);
    assert.deepEqual(f.rendered, [f.carriers[1]]);
});
