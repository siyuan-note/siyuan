import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {queueTransaction, queueTransactionBatch, waitForPendingTransactions} from "../util/transactionQueue";

const compiled = transpileModule(readFileSync("src/protyle/wysiwyg/transaction.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    const rendered: Element[] = [];
    const carriers = [
        {isConnected: true, closest: (): Element => null, getAttribute: () => "NodeAttributeView"},
        {isConnected: true, closest: (): Element => null, getAttribute: () => "NodeAttributeView"},
    ];
    let finish: (success: boolean) => void;
    const exports: any = {};
    const dependencies = {
        Constants: {},
        queueTransaction,
        queueTransactionBatch,
        prepareViewFoldTransaction: (_protyle: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) =>
            ({doOperations, undoOperations}),
        cleanBlockSelectionModeHTML: (html: string) => html,
        cleanTableCellRichHTML: (html: string) => html,
        normalizeHTMLAssetIFrameBlockDOM: (html: string) => html,
        cleanHeadingNumberOperations: (): void => undefined,
        needSubscribe: () => true,
        isInEmbedBlock: (): void => undefined,
        syncTrackedRanges: (): void => undefined,
        avRender: (element: Element) => rendered.push(element),
        invalidateViewFoldRequests: (): void => undefined,
        getBlockSelectionStatusIDs: (): string[] => [],
        countBlockWord: (): void => undefined,
        handleViewFoldSourceOperation: () => false,
        queueHeadingNumberRefresh: (): void => undefined,
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
    };
    runInNewContext(compiled, {
        exports,
        require: () => dependencies,
        window: {siyuan: {config: {sync: {provider: 0}}}},
        getSelection: () => ({rangeCount: 0}),
    });
    const element = {
        childElementCount: 1,
        querySelectorAll: (selector: string) => selector === '[data-node-id="carrier"]' ?
            carriers.filter(item => item.isConnected) : [],
        querySelector: () => carriers[0],
    };
    const protyle = {wysiwyg: {element}, options: {}} as unknown as IProtyle;
    const insert = () => exports.transaction(protyle, [{
        action: "insert", id: "carrier", previousID: "paragraph", data: '<div data-type="NodeAttributeView"></div>',
    }]);
    return {protyle, carriers, rendered, insert, finish: (success: boolean) => finish(success)};
};

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
