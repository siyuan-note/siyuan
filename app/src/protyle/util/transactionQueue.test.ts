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

test("大量积压的更新分批提交并保持任务顺序和完成边界", async () => {
    const protyle = {} as IProtyle;
    const blocker = deferred();
    const batches: number[][] = [];
    const events: Array<number | string> = [];
    const promises: Array<Promise<void>> = [];
    let active = false;
    const submit = async (items: number[]) => {
        assert.equal(active, false);
        active = true;
        await Promise.resolve();
        batches.push([...items]);
        events.push(...items);
        active = false;
    };
    void queueTransaction(protyle, () => blocker.promise);
    for (let i = 0; i < 70; i++) {
        promises.push(queueTransactionBatch(protyle, "transactions", i, submit));
    }
    void queueTransaction(protyle, async () => {
        events.push("structure");
    });
    void queueTransactionBatch(protyle, "transactions", 70, submit);

    assert.equal(promises[0], promises[31]);
    assert.notEqual(promises[31], promises[32]);
    assert.equal(promises[32], promises[63]);
    assert.notEqual(promises[63], promises[64]);
    blocker.resolve();
    await waitForPendingTransactions(protyle);
    await Promise.all(promises);

    assert.deepEqual(batches.map(items => items.length), [32, 32, 6, 1]);
    assert.deepEqual(events, [...Array.from({length: 70}, (_, i) => i), "structure", 70]);
});
