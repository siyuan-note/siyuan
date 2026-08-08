import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    collapseAVCellSelectionToAnchor,
    findAVItemPointIndex,
    getAVCellSelection,
    getAVItemSelection,
    reconcileAVSelectedItemIDs,
    setAVCellSelection,
    setAVItemAnchorState,
    setAVItemSelectionState,
} from "./selectionState";

describe("database range selection helpers", () => {
    it("locates duplicate items by both group and item ID", () => {
        const items = [
            {groupID: "group-a", itemID: "item-1"},
            {groupID: "group-b", itemID: "item-1"},
            {groupID: "group-b", itemID: "item-2"},
        ];

        assert.equal(findAVItemPointIndex(items, "item-1", "group-b"), 1);
        assert.equal(findAVItemPointIndex(items, "item-1", "group-a"), 0);
        assert.equal(findAVItemPointIndex(items, "item-1", "group-c"), -1);
    });

    it("drops selected items that are absent from the current view", () => {
        const selectedIDs = reconcileAVSelectedItemIDs(
            ["item-1", "item-3"], ["item-1", "item-2", "item-3"]);

        assert.deepEqual(Array.from(selectedIDs), ["item-1", "item-3"]);
    });

    it("collapses a cell range to its anchor after columns are sorted", () => {
        const blockElement = {} as HTMLElement;
        const anchor = {groupID: "group-a", rowID: "row-1", colID: "col-1"};
        const anchorCell = {
            ...anchor,
            rowIndex: 0,
            colIndex: 0,
            cell: {} as IAVCell,
            column: {} as IAVColumn,
        };
        const focusCell = {
            groupID: "group-a",
            rowID: "row-2",
            colID: "col-2",
            rowIndex: 1,
            colIndex: 1,
            cell: {} as IAVCell,
            column: {} as IAVColumn,
        };
        setAVCellSelection(blockElement, {
            anchor,
            focus: {
                groupID: focusCell.groupID,
                rowID: focusCell.rowID,
                colID: focusCell.colID,
            },
            cells: [anchorCell, focusCell],
        });

        collapseAVCellSelectionToAnchor(blockElement);

        assert.deepEqual(getAVCellSelection(blockElement), {
            anchor,
            focus: anchor,
            cells: [anchorCell],
        });
    });

    it("clears the cell selection when an item selection starts", () => {
        const blockElement = {} as HTMLElement;
        const point = {groupID: "group-a", rowID: "row-1", colID: "col-1"};
        setAVCellSelection(blockElement, {
            anchor: point,
            focus: point,
            cells: [],
        });

        setAVItemAnchorState(blockElement, "row-2", "group-a");

        assert.equal(getAVCellSelection(blockElement), undefined);
        assert.deepEqual(getAVItemSelection(blockElement), {
            anchorID: "row-2",
            anchorGroupID: "group-a",
            focusID: "row-2",
            focusGroupID: "group-a",
        });
    });

    it("clears the item selection when a cell selection starts", () => {
        const blockElement = {} as HTMLElement;
        setAVItemSelectionState(blockElement, {
            anchorID: "row-1",
            anchorGroupID: "group-a",
            focusID: "row-2",
            focusGroupID: "group-a",
        });
        const point = {groupID: "group-a", rowID: "row-1", colID: "col-1"};

        setAVCellSelection(blockElement, {
            anchor: point,
            focus: point,
            cells: [],
        });

        assert.equal(getAVItemSelection(blockElement), undefined);
        assert.deepEqual(getAVCellSelection(blockElement), {
            anchor: point,
            focus: point,
            cells: [],
        });
    });
});
