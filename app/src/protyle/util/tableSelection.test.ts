import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {getTableCellsInRectangle} from "./tableSelection";

interface ITestCellInfo {
    id: string;
    row: number;
    col: number;
    rowspan: number;
    colspan: number;
}

const createCell = (id: string, row: number, col: number, rowspan = 1, colspan = 1): ITestCellInfo => ({
    id,
    row,
    col,
    rowspan,
    colspan,
});

describe("getTableCellsInRectangle", () => {
    it("keeps horizontal and vertical ranges within their logical rows and columns", () => {
        const cells = [
            createCell("a", 0, 0), createCell("b", 0, 1), createCell("c", 0, 2),
            createCell("d", 1, 0), createCell("e", 1, 1), createCell("f", 1, 2),
            createCell("g", 2, 0), createCell("h", 2, 1), createCell("i", 2, 2),
        ];

        assert.deepEqual(getTableCellsInRectangle(cells, cells[0], cells[2]).map(item => item.id), ["a", "b", "c"]);
        assert.deepEqual(getTableCellsInRectangle(cells, cells[2], cells[0]).map(item => item.id), ["a", "b", "c"]);
        assert.deepEqual(getTableCellsInRectangle(cells, cells[0], cells[3]).map(item => item.id), ["a", "d"]);
        assert.deepEqual(getTableCellsInRectangle(cells, cells[3], cells[0]).map(item => item.id), ["a", "d"]);
    });

    it("expands repeatedly across intersecting merged cells", () => {
        const cells = [
            createCell("a", 0, 0, 2),
            createCell("b", 0, 1),
            createCell("c", 0, 2),
            createCell("d", 1, 1, 1, 2),
            createCell("e", 2, 0),
            createCell("f", 2, 1),
            createCell("g", 2, 2),
        ];

        assert.deepEqual(getTableCellsInRectangle(cells, cells[0], cells[1]).map(item => item.id),
            ["a", "b", "c", "d"]);
    });

    it("returns no cells without both endpoints", () => {
        const cells = [createCell("a", 0, 0)];

        assert.deepEqual(getTableCellsInRectangle(cells, cells[0]), []);
    });
});
