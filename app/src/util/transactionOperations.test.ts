import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getTransactionOperations} from "./transactionOperations";

test("按事务顺序合并全部操作", () => {
    const first = {action: "update", id: "first"} as IOperation;
    const second = {action: "update", id: "second"} as IOperation;

    assert.deepEqual(getTransactionOperations([
        {doOperations: [first]},
        {},
        {doOperations: [second]},
    ]), [first, second]);
});
