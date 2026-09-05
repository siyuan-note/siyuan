import * as assert from "node:assert/strict";
import test from "node:test";
import {adjacentTabID, resolveTabID, tabKeyboardTarget} from "./tabsState";

test("tab selection falls back safely and deletion prefers the next item", () => {
    assert.equal(resolveTabID(["a", "b"], "b"), "b");
    assert.equal(resolveTabID(["a", "b"], "missing"), "a");
    assert.equal(resolveTabID([], "a"), "");
    assert.equal(adjacentTabID(["a", "b", "c"], "b"), "c");
    assert.equal(adjacentTabID(["a", "b", "c"], "c"), "b");
    assert.equal(adjacentTabID(["a"], "a"), "");
});

test("tab navigation wraps and responds only to its layout direction", () => {
    assert.equal(tabKeyboardTarget(["a", "b"], "a", "ArrowLeft", false), "b");
    assert.equal(tabKeyboardTarget(["a", "b"], "b", "ArrowRight", false), "a");
    assert.equal(tabKeyboardTarget(["a", "b"], "a", "ArrowUp", false), "");
    assert.equal(tabKeyboardTarget(["a", "b"], "a", "ArrowDown", true), "b");
    assert.equal(tabKeyboardTarget(["a", "b"], "b", "Home", true), "a");
    assert.equal(tabKeyboardTarget(["a", "b"], "a", "End", false), "b");
    assert.equal(tabKeyboardTarget([], "", "Home", true), "");
});
