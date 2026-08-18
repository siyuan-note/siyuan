import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {buildExpandedTableGrid, getPlatformListMarker, getWechatCodeLines} from "./platformCopy";

interface ITestCell {
    colSpan: number;
    id: string;
    rowSpan: number;
}

const createCell = (id: string, rowSpan = 1, colSpan = 1): ITestCell => ({
    colSpan,
    id,
    rowSpan,
});

describe("getPlatformListMarker", () => {
    it("uses stable markers for nested ordered and unordered lists", () => {
        assert.equal(getPlatformListMarker(true, 3, 0), "3. ");
        assert.equal(getPlatformListMarker(true, 3, 1), "3) ");
        assert.equal(getPlatformListMarker(true, 27, 2), "AA. ");
        assert.equal(getPlatformListMarker(true, 4, 3), "d. ");
        assert.equal(getPlatformListMarker(true, 9, 4), "ix. ");
        assert.equal(getPlatformListMarker(false, 1, 0), "• ");
        assert.equal(getPlatformListMarker(false, 1, 4), "• ");
    });

    it("uses the task state instead of the list marker", () => {
        assert.equal(getPlatformListMarker(false, 1, 0, "checked"), "✅ ");
        assert.equal(getPlatformListMarker(true, 1, 0, "unchecked"), "▢ ");
    });
});

describe("getWechatCodeLines", () => {
    it("preserves indentation, repeated spaces, tabs and trailing lines", () => {
        const nbsp = "\u00A0";
        assert.deepEqual(getWechatCodeLines("  a b  \n\tc\n"), [
            `${nbsp}${nbsp}a b${nbsp}${nbsp}`,
            `${nbsp}${nbsp}${nbsp}${nbsp}c`,
            "",
        ]);
    });

    it("keeps single spaces inside a line breakable", () => {
        assert.deepEqual(getWechatCodeLines("const value = 1;"), ["const value = 1;"]);
    });
});

describe("buildExpandedTableGrid", () => {
    it("fills every position covered by merged cells", () => {
        const merged = createCell("merged", 2, 2);
        const top = createCell("top");
        const bottom = createCell("bottom");
        const grid = buildExpandedTableGrid([
            [merged, top],
            [bottom],
        ]);

        assert.deepEqual(grid.map(row => row.map(cell => cell?.id)), [
            ["merged", "merged", "top"],
            ["merged", "merged", "bottom"],
        ]);
    });

    it("supports row spans that continue through all remaining rows", () => {
        const merged = createCell("merged", 0);
        const first = createCell("first");
        const second = createCell("second");
        const third = createCell("third");
        const grid = buildExpandedTableGrid([
            [merged, first],
            [second],
            [third],
        ]);

        assert.deepEqual(grid.map(row => row.map(cell => cell?.id)), [
            ["merged", "first"],
            ["merged", "second"],
            ["merged", "third"],
        ]);
    });
});
