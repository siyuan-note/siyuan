import {strict as assert} from "node:assert";
import test from "node:test";
import type {Transaction} from "../../types/api";
import {getEditorTransaction} from "./transactionContract";
import {operationsMayChangeHeadingNumbers, operationsMayChangeOutline} from "./headingNumberCore";

test("block reference swaps retain affected roots and invalidate the outline", () => {
    const response: Transaction = JSON.parse(`{"doOperations":[{
        "action":"swapBlockRef","id":"ref","blockID":"def",
        "data":{"includeChildren":true,"originalToEmbed":true},"retData":["source","target"]
    }]}`);
    const operations = getEditorTransaction(response).doOperations;
    assert.equal(operations.length, 1);
    assert.deepEqual(operations[0].retData, ["source", "target"]);
    assert.equal(operationsMayChangeOutline(operations), true);
    assert.equal(operationsMayChangeHeadingNumbers(operations), true);
});

test("editor transaction selection preserves the original extension response", () => {
    const response: Transaction = JSON.parse(`{
        "timestamp": 123,
        "templateDocTreePlanID": "plan",
        "doOperations": [
            {"action": "update", "data": "content"},
            {"action": "plugin-custom", "data": {"extension": [1, null, true]}},
            {"action": "updateAttrs", "data": {"old": {}, "new": {"fold": "1"}}}
        ],
        "undoOperations": null
    }`);
    const selected = getEditorTransaction(response);
    assert.equal(selected.timestamp, 123);
    assert.equal(selected.templateDocTreePlanID, "plan");
    assert.deepEqual(selected.doOperations.map(operation => operation.action), ["update", "updateAttrs"]);
    assert.equal(selected.doOperations[0], response.doOperations[0]);
    assert.equal(response.doOperations.length, 3);
    assert.deepEqual(response.doOperations[1].data, {extension: [1, null, true]});
    assert.equal(selected.undoOperations, null);
});
