import * as assert from "node:assert/strict";
import test from "node:test";
import {getDocTreeEntryScope} from "./docTreeScope";

const menuFrom = {
    notebook: "tree-notebook",
    notebooks: "tree-notebooks",
    doc: "tree-doc",
    docs: "tree-docs",
    items: "tree-items",
};

test("document tree multiple selections use their respective entry scopes", () => {
    assert.equal(getDocTreeEntryScope(menuFrom.docs, menuFrom), "docTree.multi");
    assert.equal(getDocTreeEntryScope(menuFrom.items, menuFrom), "docTree.multi");
    assert.equal(getDocTreeEntryScope(menuFrom.notebooks, menuFrom), "docTree.notebooks");
});
