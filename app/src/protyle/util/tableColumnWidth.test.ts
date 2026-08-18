import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getDistributedTableColumnWidth,
    isDefaultTableColumnWidth,
    TABLE_DEFAULT_COLUMN_WIDTH,
} from "./tableColumnWidth";

describe("getDistributedTableColumnWidth", () => {
    it("preserves the selected columns' total width", () => {
        assert.equal(getDistributedTableColumnWidth([120, 240, 360]), 240);
    });

    it("uses the table default as the minimum width", () => {
        assert.equal(getDistributedTableColumnWidth([]), TABLE_DEFAULT_COLUMN_WIDTH);
        assert.equal(getDistributedTableColumnWidth([20, 40]), TABLE_DEFAULT_COLUMN_WIDTH);
    });
});

describe("isDefaultTableColumnWidth", () => {
    it("requires an empty width and the default minimum width", () => {
        assert.equal(isDefaultTableColumnWidth("", "60px"), true);
        assert.equal(isDefaultTableColumnWidth("120px", "60px"), false);
        assert.equal(isDefaultTableColumnWidth("", ""), false);
    });
});
