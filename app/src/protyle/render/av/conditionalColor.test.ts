import {test} from "node:test";
import * as assert from "node:assert/strict";
import {getConditionalBackground, getConditionalCellStyle, getConditionalItemStyle} from "./conditionalColor";

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
