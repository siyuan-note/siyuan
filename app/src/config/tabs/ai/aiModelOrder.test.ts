import * as assert from "node:assert/strict";
import test from "node:test";
import {moveModelItem} from "./aiModelOrder";

test("model order moves items before and after another item", () => {
    assert.deepEqual(moveModelItem(["a", "b", "c", "d"], 3, 1, false), ["a", "d", "b", "c"]);
    assert.deepEqual(moveModelItem(["a", "b", "c", "d"], 0, 2, true), ["b", "c", "a", "d"]);
});

test("model order moves items to the beginning and end", () => {
    assert.deepEqual(moveModelItem(["a", "b", "c"], 2, 0, false), ["c", "a", "b"]);
    assert.deepEqual(moveModelItem(["a", "b", "c"], 0, 2, true), ["b", "c", "a"]);
});

test("model order ignores no-op and invalid moves", () => {
    assert.equal(moveModelItem(["a", "b", "c"], 0, 1, false), undefined);
    assert.equal(moveModelItem(["a", "b", "c"], 1, 0, true), undefined);
    assert.equal(moveModelItem(["a", "b", "c"], 1, 1, false), undefined);
    assert.equal(moveModelItem(["a", "b", "c"], -1, 1, false), undefined);
    assert.equal(moveModelItem(["a", "b", "c"], 0, 3, false), undefined);
});
