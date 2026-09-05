import * as assert from "node:assert/strict";
import {test} from "node:test";
import {tabsListTitle} from "./tabsList";

test("tab summaries count twelve runes and append an extra ellipsis only when truncated", () => {
    assert.equal(tabsListTitle(""), "");
    assert.equal(tabsListTitle("abcdefghijkl"), "abcdefghijkl");
    assert.equal(tabsListTitle("abcdefghijklm"), "abcdefghijkl...");
    assert.equal(tabsListTitle("这是一个超过十二个字符的长段落"), "这是一个超过十二个字符的...");
    assert.equal(tabsListTitle("😀".repeat(13)), "😀".repeat(12) + "...");
});
