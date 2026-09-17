import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getAVBindingOperations} from "./binding";

for (const isDetached of [false, true]) {
    test(`binding operations preserve item identity and the ${isDetached ? "detached" : "bound"} original`, () => {
        const operations = getAVBindingOperations("database", "item", "new-block", "carrier", {
            type: "block", isDetached, block: {id: isDetached ? "" : "old-block", content: "Original"},
        }, {protyleID: "editor"});
        const {doOperations, undoOperations} = JSON.parse(JSON.stringify(operations));
        for (const operation of [...doOperations, ...undoOperations]) {
            assert.equal(operation.action, "replaceAttrViewBlock");
            assert.equal(operation.avID, "database");
            assert.equal(operation.previousID, "item");
            assert.equal(operation.blockID, "carrier");
            assert.deepEqual(operation.context, {protyleID: "editor"});
        }
        assert.equal(doOperations[0].nextID, "new-block");
        assert.equal(doOperations[0].isDetached, false);
        assert.equal(undoOperations[0].nextID, isDetached ? "" : "old-block");
        assert.equal(undoOperations[0].isDetached, isDetached);
    });
}
