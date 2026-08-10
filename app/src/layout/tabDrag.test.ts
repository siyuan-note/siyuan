import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {reorderTabItems} from "./tabDrag";

const createItems = () => [
    {id: "a"},
    {id: "b"},
    {id: "c"},
    {id: "d"},
];

describe("tab drag ordering", () => {
    it("moves a tab before the requested successor", () => {
        const items = createItems();

        assert.equal(reorderTabItems(items, items[3], "b"), true);
        assert.deepEqual(items.map((item) => item.id), ["a", "d", "b", "c"]);
    });

    it("moves a tab to the end when no successor exists", () => {
        const items = createItems();

        assert.equal(reorderTabItems(items, items[0]), true);
        assert.deepEqual(items.map((item) => item.id), ["b", "c", "d", "a"]);
    });

    it("does not change the list when the dragged tab is missing", () => {
        const items = createItems();

        assert.equal(reorderTabItems(items, {id: "missing"}, "b"), false);
        assert.deepEqual(items.map((item) => item.id), ["a", "b", "c", "d"]);
    });
});
