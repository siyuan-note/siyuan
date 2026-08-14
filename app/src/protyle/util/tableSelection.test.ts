import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    getProjectedTableHeadRowCount,
    getTableHeadRowCount,
    getTableCellsInRectangle,
    getTableDragEdge,
    projectTableCells,
    transposeTableCells,
} from "./tableSelection";

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

describe("getTableDragEdge", () => {
    it("allows dropping at both clamped table edges", () => {
        assert.equal(getTableDragEdge(50, 50, 250), "start");
        assert.equal(getTableDragEdge(250, 50, 250), "end");
    });

    it("keeps positions inside the table on cell-based targeting", () => {
        assert.equal(getTableDragEdge(51, 50, 250), undefined);
        assert.equal(getTableDragEdge(249, 50, 250), undefined);
        assert.equal(getTableDragEdge(100, 150, 50), undefined);
    });
});

describe("projectTableCells", () => {
    const issueCells = [
        createCell("a", 0, 0, 1, 2), createCell("b", 0, 2),
        createCell("c", 1, 0), createCell("d", 1, 1), createCell("e", 1, 2, 2),
        createCell("f", 2, 0), createCell("g", 2, 1),
    ];
    const simplify = (cells: ReturnType<typeof projectTableCells<ITestCellInfo>>["cells"]) => cells.map(item => ({
        id: item.source.id,
        row: item.row,
        col: item.col,
        rowspan: item.rowspan,
        colspan: item.colspan,
    }));

    it("shrinks horizontal merged cells after deleting a covered column", () => {
        const projection = projectTableCells(issueCells, [0, 1, 2], [1, 2]);

        assert.deepEqual(simplify(projection.cells), [
            {id: "a", row: 0, col: 0, rowspan: 1, colspan: 1},
            {id: "b", row: 0, col: 1, rowspan: 1, colspan: 1},
            {id: "d", row: 1, col: 0, rowspan: 1, colspan: 1},
            {id: "e", row: 1, col: 1, rowspan: 2, colspan: 1},
            {id: "g", row: 2, col: 0, rowspan: 1, colspan: 1},
        ]);
    });

    it("moves a vertical merged cell to the first surviving row", () => {
        const projection = projectTableCells(issueCells, [0, 2], [0, 1, 2]);

        assert.deepEqual(simplify(projection.cells), [
            {id: "a", row: 0, col: 0, rowspan: 1, colspan: 2},
            {id: "b", row: 0, col: 2, rowspan: 1, colspan: 1},
            {id: "f", row: 1, col: 0, rowspan: 1, colspan: 1},
            {id: "g", row: 1, col: 1, rowspan: 1, colspan: 1},
            {id: "e", row: 1, col: 2, rowspan: 1, colspan: 1},
        ]);
    });

    it("removes a merged cell only after its whole region is deleted", () => {
        const projection = projectTableCells(issueCells, [0], [0, 1, 2]);

        assert.deepEqual(simplify(projection.cells), [
            {id: "a", row: 0, col: 0, rowspan: 1, colspan: 2},
            {id: "b", row: 0, col: 2, rowspan: 1, colspan: 1},
        ]);
    });

    it("compresses non-contiguous retained rows and columns", () => {
        const cells = [
            createCell("a", 0, 0, 3, 3),
            createCell("b", 0, 3),
            createCell("c", 1, 3),
            createCell("d", 2, 3),
        ];
        const projection = projectTableCells(cells, [0, 2], [0, 2, 3]);

        assert.deepEqual(simplify(projection.cells), [
            {id: "a", row: 0, col: 0, rowspan: 2, colspan: 2},
            {id: "b", row: 0, col: 2, rowspan: 1, colspan: 1},
            {id: "d", row: 1, col: 2, rowspan: 1, colspan: 1},
        ]);
    });

    it("keeps the header large enough for merged cells", () => {
        const cells = [
            createCell("a", 0, 0, 3),
            createCell("b", 0, 1),
            createCell("c", 1, 1),
            createCell("d", 2, 1),
        ];
        const projection = projectTableCells(cells, [1, 2], [0, 1]);

        assert.equal(getProjectedTableHeadRowCount(projection.cells, projection.rows,
            ["thead", "tbody", "tbody"]), 2);
    });
});

describe("transposeTableCells", () => {
    const simplify = (cells: ReturnType<typeof transposeTableCells<ITestCellInfo>>["cells"]) => cells.map(item => ({
        id: item.source.id,
        row: item.row,
        col: item.col,
        rowspan: item.rowspan,
        colspan: item.colspan,
    }));

    it("swaps rows and columns", () => {
        const cells = [
            createCell("a", 0, 0), createCell("b", 0, 1), createCell("c", 0, 2),
            createCell("d", 1, 0), createCell("e", 1, 1), createCell("f", 1, 2),
        ];

        const transposed = transposeTableCells(cells, 2, 3);

        assert.equal(transposed.rowCount, 3);
        assert.equal(transposed.columnCount, 2);
        assert.deepEqual(simplify(transposed.cells), [
            {id: "a", row: 0, col: 0, rowspan: 1, colspan: 1},
            {id: "d", row: 0, col: 1, rowspan: 1, colspan: 1},
            {id: "b", row: 1, col: 0, rowspan: 1, colspan: 1},
            {id: "e", row: 1, col: 1, rowspan: 1, colspan: 1},
            {id: "c", row: 2, col: 0, rowspan: 1, colspan: 1},
            {id: "f", row: 2, col: 1, rowspan: 1, colspan: 1},
        ]);
    });

    it("swaps merged cell spans", () => {
        const cells = [
            createCell("a", 0, 0, 1, 2), createCell("b", 0, 2),
            createCell("c", 1, 0), createCell("d", 1, 1), createCell("e", 1, 2, 2),
            createCell("f", 2, 0), createCell("g", 2, 1),
        ];

        const transposed = transposeTableCells(cells, 3, 3);

        assert.deepEqual(simplify(transposed.cells), [
            {id: "a", row: 0, col: 0, rowspan: 2, colspan: 1},
            {id: "c", row: 0, col: 1, rowspan: 1, colspan: 1},
            {id: "f", row: 0, col: 2, rowspan: 1, colspan: 1},
            {id: "d", row: 1, col: 1, rowspan: 1, colspan: 1},
            {id: "g", row: 1, col: 2, rowspan: 1, colspan: 1},
            {id: "b", row: 2, col: 0, rowspan: 1, colspan: 1},
            {id: "e", row: 2, col: 1, rowspan: 1, colspan: 2},
        ]);
    });

    it("restores coordinates and spans after transposing twice", () => {
        const cells = [
            createCell("a", 0, 0, 1, 2), createCell("b", 0, 2),
            createCell("c", 1, 0), createCell("d", 1, 1), createCell("e", 1, 2, 2),
            createCell("f", 2, 0), createCell("g", 2, 1),
        ];
        const first = transposeTableCells(cells, 3, 3);
        const intermediate = first.cells.map(item => ({
            ...item.source,
            row: item.row,
            col: item.col,
            rowspan: item.rowspan,
            colspan: item.colspan,
        }));

        const second = transposeTableCells(intermediate, first.rowCount, first.columnCount);

        assert.deepEqual(simplify(second.cells), cells.map(item => ({
            id: item.id,
            row: item.row,
            col: item.col,
            rowspan: item.rowspan,
            colspan: item.colspan,
        })));
    });

    it("expands the table head to contain transposed merged cells", () => {
        const cells = [
            createCell("a", 0, 0, 2),
            createCell("b", 1, 1, 3),
        ];

        assert.equal(getTableHeadRowCount(cells, 4), 4);
    });
});
