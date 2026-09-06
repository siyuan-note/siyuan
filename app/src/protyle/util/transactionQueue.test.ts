import * as assert from "node:assert/strict";
import {test} from "node:test";
import {queueTransaction, queueTransactionBatch, waitForPendingTransactions} from "./transactionQueue";

const deferred = () => {
    let resolve: () => void;
    const promise = new Promise<void>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return {promise, resolve: () => resolve()};
};

test("批量执行等待期间入队的同类事务", async () => {
    const protyle = {} as IProtyle;
    const blocker = deferred();
    const batches: string[][] = [];
    void queueTransaction(protyle, () => blocker.promise);

    void queueTransactionBatch(protyle, "transactions", "first", async items => {
        batches.push(items);
    });
    void queueTransactionBatch(protyle, "transactions", "second", async items => {
        batches.push(items);
    });
    blocker.resolve();
    await waitForPendingTransactions(protyle);

    assert.deepEqual(batches, [["first", "second"]]);
});

test("执行中的事务不会吸收后续批次", async () => {
    const protyle = {} as IProtyle;
    const firstBatchStarted = deferred();
    const firstBatch = deferred();
    const batches: string[][] = [];
    void queueTransactionBatch(protyle, "transactions", "first", async items => {
        batches.push(items);
        firstBatchStarted.resolve();
        await firstBatch.promise;
    });
    await firstBatchStarted.promise;

    void queueTransactionBatch(protyle, "transactions", "second", async items => {
        batches.push(items);
    });
    void queueTransactionBatch(protyle, "transactions", "third", async items => {
        batches.push(items);
    });
    firstBatch.resolve();
    await waitForPendingTransactions(protyle);

    assert.deepEqual(batches, [["first"], ["second", "third"]]);
});

test("普通任务保持与批量事务的入队顺序", async () => {
    const protyle = {} as IProtyle;
    const blocker = deferred();
    const events: string[] = [];
    void queueTransaction(protyle, () => blocker.promise);
    void queueTransactionBatch(protyle, "transactions", "first", async items => {
        events.push(...items);
    });
    void queueTransaction(protyle, async () => {
        events.push("task");
    });
    void queueTransactionBatch(protyle, "transactions", "second", async items => {
        events.push(...items);
    });

    blocker.resolve();
    await waitForPendingTransactions(protyle);

    assert.deepEqual(events, ["first", "task", "second"]);
});

test("等待屏障不会吸收屏障后的事务", async () => {
    const protyle = {} as IProtyle;
    const blocker = deferred();
    const batches: string[][] = [];
    void queueTransaction(protyle, () => blocker.promise);
    void queueTransactionBatch(protyle, "transactions", "before", async items => {
        batches.push(items);
    });
    const barrier = waitForPendingTransactions(protyle);
    void queueTransactionBatch(protyle, "transactions", "after", async items => {
        batches.push(items);
    });

    blocker.resolve();
    await barrier;
    await waitForPendingTransactions(protyle);

    assert.deepEqual(batches, [["before"], ["after"]]);
});

test("失败的任务不阻塞后续批次", async () => {
    const protyle = {} as IProtyle;
    const batches: string[][] = [];
    void queueTransaction(protyle, async () => {
        throw new Error("failed");
    });
    void queueTransactionBatch(protyle, "transactions", "next", async items => {
        batches.push(items);
    });

    await waitForPendingTransactions(protyle);

    assert.deepEqual(batches, [["next"]]);
});
