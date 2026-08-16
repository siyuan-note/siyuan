import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {mergeGroupResponseView} from "./groupResponse";

const currentView = {
    id: "view-1",
    type: "table",
    name: "Table",
    columns: [{id: "column-1"}],
    rows: [{id: "row-1"}],
    group: {field: "column-1", method: 0},
    groups: [{id: "old-group", rows: [{id: "old-row"}]}],
} as unknown as IAVTable;

describe("mergeGroupResponseView", () => {
    it("keeps heavy table data when the response has a complete view shape", () => {
        const responseView = {
            ...currentView,
            name: "Updated",
            rows: [],
            groups: [{id: "new-group", rows: []}],
        } as unknown as IAVTable;
        const result = mergeGroupResponseView(currentView, {view: responseView}) as IAVTable;

        assert.equal(result.name, "Updated");
        assert.equal(result.columns, currentView.columns);
        assert.equal(result.rows, currentView.rows);
        assert.deepEqual(result.groups, responseView.groups);
    });

    it("preserves top-level table data for a slim response view", () => {
        const groups = [{id: "new-group", name: "New"}] as IAVView[];
        const result = mergeGroupResponseView(currentView, {
            view: {
                group: {field: "column-2", method: 0},
                groups,
            },
        }) as IAVTable;

        assert.equal(result.columns, currentView.columns);
        assert.equal(result.rows, currentView.rows);
        assert.equal(result.group.field, "column-2");
        assert.equal(result.groups, groups);
        assert.equal((result.groups[0] as IAVTable).rows, undefined);
    });

    it("accepts independent group metadata", () => {
        const groups = [{id: "group-2", name: "Second"}] as IAVView[];
        const result = mergeGroupResponseView(currentView, {
            group: {field: "column-1", method: 0, order: 1},
            groups,
        }) as IAVTable;

        assert.equal(result.rows, currentView.rows);
        assert.equal(result.group.order, 1);
        assert.equal(result.groups, groups);
    });
});
