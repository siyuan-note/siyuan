import {test} from "node:test";
import * as assert from "node:assert/strict";
import {getConditionalBackground, getConditionalCellStyle, getConditionalItemStyle, moveConditionalColorRule} from "./conditionalColor";

test("conditional backgrounds preserve explicit defaults and independent property colors", () => {
    assert.equal(getConditionalBackground(null), "");
    assert.equal(getConditionalBackground({content: "", color: ""}), "var(--b3-theme-background)");
    const row: IAVRow = {id: "row", cells: [], conditionalColors: {background: {content: "", color: "3"},
        properties: {tags: {content: "", color: ""}}}};
    assert.match(getConditionalItemStyle(row), /^--b3-av-item-background:/);
    assert.equal(getConditionalCellStyle(row, "tags"), "--b3-av-cell-background:var(--b3-theme-background);");
    assert.equal(getConditionalCellStyle(row, "other"), "");
    assert.equal(getConditionalItemStyle({} as IAVRow), "");
});

test("conditional rule drops preserve values and handle both directions and unchanged positions", () => {
    const rules: IAVConditionalColorRule[] = ["a", "b", "c"].map(id => ({id, target: "item", color: null,
        matchOption: false, filter: {column: "text", operator: "Is not empty"}}));
    const ids = (items: IAVConditionalColorRule[]) => items.map(item => item.id);
    assert.deepEqual(ids(moveConditionalColorRule(rules, "a", "c", false)), ["b", "c", "a"]);
    assert.deepEqual(ids(moveConditionalColorRule(rules, "c", "a", true)), ["c", "a", "b"]);
    assert.deepEqual(ids(moveConditionalColorRule(rules, "a", "c", true)), ["b", "a", "c"]);
    assert.deepEqual(ids(moveConditionalColorRule(rules, "c", "a", false)), ["a", "c", "b"]);
    assert.equal(moveConditionalColorRule(rules, "a", "b", true), rules);
    assert.equal(moveConditionalColorRule(rules, "b", "a", false), rules);
    assert.equal(moveConditionalColorRule(rules, "a", "a", false), rules);
    assert.equal(moveConditionalColorRule(rules, "missing", "a", false), rules);
    assert.deepEqual(ids(rules), ["a", "b", "c"]);
});
