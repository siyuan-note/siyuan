import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getNewAVRow, retainNewAVRow} from "./newRowPage";
import {DOMFixture} from "./testDOM";

const makeView = (ids: string[], rowCount = 6, id = "view") => ({
    id, rows: ids.map(row => ({id: row})), rowCount, pageSize: ids.length, columns: [],
} as IAVTable);

const makeData = (view: IAVTable, target?: IAVRenderTarget, type: TAVView = "table") => ({
    viewID: "view", viewType: type, view, target,
} as IAV);

const target = (status: IAVRenderTarget["status"], groupID = "") => ({
    itemID: "new", status, groupID, index: 5, offset: 3, pageSize: 2,
} as IAVRenderTarget);

test("new row request matches only the committed detached row's ghost in its originating carrier and view", () => {
    const doc = new DOMFixture();
    const block = doc.createElement("div") as unknown as HTMLElement;
    block.dataset.nodeId = "carrier";
    block.dataset.avType = "table";
    block.innerHTML = '<div class="av__body" data-group-id="group"><div class="av__row" data-type="ghost" data-av-insert-item-id="new"></div></div>';
    const editor = {id: "editor"} as IProtyle;
    const operation: IOperation = {
        action: "insertAttrViewBlock", blockID: "carrier", viewID: "view", context: {protyleID: "editor"},
        srcs: [{id: "block", itemID: "new", isDetached: true, content: ""}], retData: {insertedItemIDs: ["new"], existingItemIDs: []},
    };
    assert.deepEqual(getNewAVRow(block, editor, operation, "view"), {itemID: "new", viewID: "view", groupID: "group"});
    assert.equal(getNewAVRow(block, editor, operation, "other-view"), undefined);
    assert.equal(getNewAVRow(block, {id: "other-editor"} as IProtyle, operation, "view"), undefined);
    assert.equal(getNewAVRow(block, editor, {...operation, blockID: "other-carrier"}, "view"), undefined);
    assert.equal(getNewAVRow(block, editor, {...operation, retData: {insertedItemIDs: [], existingItemIDs: []}}, "view"), undefined);
    assert.equal(getNewAVRow(block, editor, {...operation, parentID: "parent"}, "view"), undefined);
    assert.equal(getNewAVRow(block, editor, {...operation, srcs: [...operation.srcs, ...operation.srcs]}, "view"), undefined);
    block.innerHTML = "";
    assert.equal(getNewAVRow(block, editor, operation, "view"), undefined);
});

test("retains the saved new row in the current page without replacing the page or changing its size and totals", async () => {
    const view = makeView(["a", "b"]);
    const data = makeData(view);
    const actual = await retainNewAVRow(data, {itemID: "new", groupID: "", viewID: "view"}, {}, async (id, groupID) => {
        assert.equal(id, "new");
        assert.equal(groupID, "");
        return makeData(makeView(["d", "e", "new"]), target("visible"));
    });
    const renderedView = actual.view as IAVTable;
    assert.deepEqual(renderedView.rows.map(row => row.id), ["a", "b", "new"]);
    assert.equal(renderedView.pageSize, 2);
    assert.equal(renderedView.rowCount, 6);
    assert.equal(actual.target, undefined);
    assert.deepEqual(view.rows.map(row => row.id), ["a", "b"]);
});

test("retains a row inside the rendered window of just its visible group", async () => {
    const group = makeView(["a", "b", "c", "d"], 6, "group");
    const other = makeView(["z"], 1, "other");
    const view = {...makeView([]), groups: [group, other]} as IAVTable;
    const located = {...makeView([]), groups: [makeView(["new"], 6, "group")]} as IAVTable;
    const actual = await retainNewAVRow(makeData(view), {itemID: "new", groupID: "group", viewID: "view"}, {
        group: {renderedStart: 1, renderedEnd: 2, topSpacerHeight: 36},
    }, async () => makeData(located, target("visible", "group")));
    assert.deepEqual((actual.view.groups[0] as IAVTable).rows.map(row => row.id), ["a", "b", "new", "c", "d"]);
    assert.equal(actual.view.groups[1], other);
});

test("skips already loaded, fully loaded, and unrelated views; respects filtered and hidden targets", async () => {
    const row = {itemID: "new", groupID: "", viewID: "view"};
    for (const data of [
        makeData(makeView(["new"])), makeData(makeView(["a"], 1)),
        {...makeData(makeView(["a"])), viewID: "other"}, makeData(makeView(["a"]), undefined, "calendar"),
    ]) {
        assert.equal(await retainNewAVRow(data, row, {}, async () => assert.fail("Unneeded target lookup")), data);
    }
    const data = makeData(makeView(["a"]));
    for (const status of ["filtered", "groupHidden"] as const) {
        assert.equal(await retainNewAVRow(data, row, {}, async () => makeData(makeView(["new"]), target(status))), data);
    }
    assert.equal(await retainNewAVRow(data, row, {}, async () => undefined), data);
});
