export const getTransactionOperations = (transactions: {doOperations?: IOperation[]}[]) =>
    transactions.flatMap(transaction => transaction.doOperations || []);
