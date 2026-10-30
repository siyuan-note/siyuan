import {test} from "node:test";
import * as assert from "node:assert/strict";
import {MemoryOperationState, memoryModelOptions} from "./state";

test("memory organization reuses operation identity after failure and renews it after completion", () => {
    const state = new MemoryOperationState();
    let count = 0;
    const id = () => String(++count);
    assert.equal(state.operationFor("draft", id), "1");
    assert.equal(state.operationFor("draft", id), "1");
    assert.equal(state.operationFor("changed", id), "2");
    state.committed();
    assert.equal(state.operationFor("changed", id), "3");
});

test("memory model picker never silently selects another model or loses unavailable selection", () => {
    const providers = [{enabled: true, displayName: "P", models: [
        {id: "a", enabled: true, name: "A"}, {id: "b", enabled: false, name: "B"},
    ]}, {enabled: false, models: [{id: "c", enabled: true, name: "C"}]}];
    assert.deepEqual(memoryModelOptions(providers, ""), [{id: "a", label: "P / A", unavailable: false}]);
    assert.deepEqual(memoryModelOptions(providers, "b")[0], {id: "b", label: "b", unavailable: true});
    assert.deepEqual(memoryModelOptions(providers, "missing")[0], {id: "missing", label: "missing", unavailable: true});
});
