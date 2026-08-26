import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getAVColumnFitWidth,
    getAVRelationColumnWidth,
    getAVColumnResizeWidth,
    getAVDistributedColumnWidth,
    getAVTableFitWidths,
} from "./columnWidth";

const measureText = (value: string) => value.length * 10;

describe("getAVColumnFitWidth", () => {
    it("calculates compact widths from measured content", () => {
        assert.equal(getAVColumnFitWidth("优先级", "select", ["P1", "P2", "P3"], measureText), "72px");
        assert.equal(getAVColumnFitWidth(
            "URL", "url", ["https://github.com/siyuan-note/siyuan/issues/10767"], measureText), "480px");
        assert.equal(getAVColumnFitWidth("日期", "date", ["2026-07-30"], measureText), "120px");
        assert.equal(getAVColumnFitWidth(
            "标题", "text", ["A very long title that should not make the field excessively wide"], measureText), "480px");
    });

    it("uses select padding for multi-select columns", () => {
        assert.equal(getAVColumnFitWidth("P", "mSelect", ["Long"], measureText), "72px");
    });
});

describe("getAVRelationColumnWidth", () => {
    it("keeps relation previews compact", () => {
        assert.equal(getAVRelationColumnWidth("64px", "block", true), "120px");
        assert.equal(getAVRelationColumnWidth("480px", "block", true), "160px");
        assert.equal(getAVRelationColumnWidth("480px", "text", false), "160px");
        assert.equal(getAVRelationColumnWidth("480px", "relation", false), "200px");
        assert.equal(getAVRelationColumnWidth("120px", "date", false), "120px");
    });
});

describe("getAVTableFitWidths", () => {
    it("uses visible groups, field IDs and total line counts", () => {
        const columns = [
            {id: "title", name: "Title", type: "text", hidden: false},
            {id: "priority", name: "P", type: "mSelect", hidden: false},
            {id: "number", name: "No", type: "lineNumber", hidden: false},
            {id: "hidden", name: "Hidden", type: "text", hidden: true},
        ] as IAVColumn[];
        const visibleGroup = {
            columns,
            rows: [{
                id: "row-1",
                cells: [
                    {value: {keyID: "priority", type: "mSelect", text: {content: "Long"}}},
                    {value: {keyID: "title", type: "text", text: {content: "Content"}}},
                ],
            }],
            groups: [],
            groupHidden: 0,
            rowCount: 12345,
        } as IAVTable;
        const hiddenGroup = {
            columns,
            rows: [{
                id: "row-2",
                cells: [{value: {keyID: "title", type: "text", text: {content: "Ignored long content"}}}],
            }],
            groups: [],
            groupHidden: 2,
            rowCount: 1,
        } as IAVTable;
        const view = {
            columns,
            rows: [],
            groups: [visibleGroup, hiddenGroup],
            rowCount: 12346,
        } as unknown as IAVTable;
        const widths = getAVTableFitWidths(
            view,
            value => value.text?.content || "",
            measureText,
        );

        assert.deepEqual(widths, {
            title: "92px",
            priority: "72px",
            number: "70px",
        });

        assert.deepEqual(getAVTableFitWidths(
            view,
            value => value.text?.content || "",
            measureText,
            ["priority"],
        ), {
            priority: "72px",
        });
    });
});

describe("getAVColumnResizeWidth", () => {
    it("snaps to the previous visible column within the threshold", () => {
        assert.deepEqual(getAVColumnResizeWidth(195, 200), {width: 195, snapped: false});
        assert.deepEqual(getAVColumnResizeWidth(196, 200), {width: 200, snapped: true});
        assert.deepEqual(getAVColumnResizeWidth(204, 200), {width: 200, snapped: true});
        assert.deepEqual(getAVColumnResizeWidth(205, 200), {width: 205, snapped: false});
    });

    it("keeps manual resizing above the minimum width", () => {
        assert.deepEqual(getAVColumnResizeWidth(10), {width: 25, snapped: false});
    });
});

describe("getAVDistributedColumnWidth", () => {
    it("preserves the total width while distributing columns evenly", () => {
        assert.equal(getAVDistributedColumnWidth([120, 240, 360]), 240);
        assert.equal(getAVDistributedColumnWidth([]), 25);
    });
});
