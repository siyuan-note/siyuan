interface ITransactionBatch<T> {
    items: T[];
    promise?: Promise<void>;
    task: (items: T[]) => Promise<void>;
}

interface ITransactionQueue {
    pendingBatches: Map<string, ITransactionBatch<unknown>>;
    tail: Promise<void>;
}

const transactionQueues = new WeakMap<IProtyle, ITransactionQueue>();

const getTransactionQueue = (protyle: IProtyle) => {
    let queue = transactionQueues.get(protyle);
    if (!queue) {
        queue = {
            pendingBatches: new Map(),
            tail: Promise.resolve(),
        };
        transactionQueues.set(protyle, queue);
    }
    return queue;
};

const appendTransaction = (queue: ITransactionQueue, task: () => Promise<void>) => {
    const currentTransaction = queue.tail.catch(() => undefined).then(task);
    queue.tail = currentTransaction;
    return currentTransaction;
};

const sealPendingBatches = (queue: ITransactionQueue) => {
    queue.pendingBatches.clear();
};

export const queueTransaction = (protyle: IProtyle, task: () => Promise<void>) => {
    const queue = getTransactionQueue(protyle);
    sealPendingBatches(queue);
    return appendTransaction(queue, task);
};

export const queueTransactionBatch = <T>(protyle: IProtyle, key: string, item: T,
                                          task: (items: T[]) => Promise<void>) => {
    const queue = getTransactionQueue(protyle);
    const pendingBatch = queue.pendingBatches.get(key) as ITransactionBatch<T> | undefined;
    if (pendingBatch) {
        pendingBatch.items.push(item);
        return pendingBatch.promise;
    }

    sealPendingBatches(queue);
    const batch: ITransactionBatch<T> = {
        items: [item],
        task,
    };
    queue.pendingBatches.set(key, batch as ITransactionBatch<unknown>);
    batch.promise = appendTransaction(queue, async () => {
        if (queue.pendingBatches.get(key) === batch) {
            queue.pendingBatches.delete(key);
        }
        await batch.task(batch.items);
    });
    return batch.promise;
};

export const waitForPendingTransactions = (protyle: IProtyle) => {
    const queue = transactionQueues.get(protyle);
    if (!queue) {
        return Promise.resolve();
    }
    sealPendingBatches(queue);
    return queue.tail.catch(() => undefined);
};
