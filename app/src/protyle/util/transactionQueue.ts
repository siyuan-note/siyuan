const transactionQueues = new WeakMap<IProtyle, Promise<void>>();

export const queueTransaction = (protyle: IProtyle, task: () => Promise<void>) => {
    const previousTransaction = transactionQueues.get(protyle) || Promise.resolve();
    const currentTransaction = previousTransaction.catch(() => undefined).then(task);
    transactionQueues.set(protyle, currentTransaction);
    return currentTransaction;
};

export const waitForPendingTransactions = (protyle: IProtyle) => {
    return (transactionQueues.get(protyle) || Promise.resolve()).catch(() => undefined);
};
