import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getAVBindingOperations, preserveAVBindingRange} from "./binding";

for (const isDetached of [false, true]) {
    test(`binding operations preserve item identity and the ${isDetached ? "detached" : "bound"} original`, () => {
        const operations = getAVBindingOperations("database", "item", "new-block", "carrier", {
            type: "block", isDetached, block: {id: isDetached ? "" : "old-block", content: "Original"},
        }, {protyleID: "editor"});
        const {doOperations, undoOperations} = JSON.parse(JSON.stringify(operations));
        for (const operation of [...doOperations, ...undoOperations]) {
            assert.equal(operation.action, "replaceAttrViewBlock");
            assert.equal(operation.avID, "database");
            assert.equal(operation.previousID, "item");
            assert.equal(operation.blockID, "carrier");
            assert.deepEqual(operation.context, {protyleID: "editor"});
        }
        assert.equal(doOperations[0].nextID, "new-block");
        assert.equal(doOperations[0].isDetached, false);
        assert.equal(undoOperations[0].nextID, isDetached ? "" : "old-block");
        assert.equal(undoOperations[0].isDetached, isDetached);
    });
}

test("binding candidates follow a refreshed panel field but close when its binding changes", () => {
    let selected: unknown;
    let hidden = false;
    const oldCell = {
        nodeType: 1,
        dataset: {avId: "database", rowId: "item", colId: "primary"},
        querySelector: () => ({dataset: {id: "old-block"}}),
        closest: (): unknown => oldCell,
    };
    const range = {startContainer: oldCell, selectNodeContents: (cell: unknown) => { selected = cell; }};
    const protyle = {
        toolbar: {range},
        hint: {element: {classList: {contains: () => hidden, add: () => { hidden = true; }}}},
    } as unknown as IProtyle;
    const panel = {contains: (cell: unknown) => cell === oldCell} as HTMLElement;
    let boundID = "old-block";
    const newCell = {querySelector: () => ({dataset: {id: boundID}})};
    const nextPanel = {querySelector: (selector: string) => {
        assert.equal(selector, '[data-av-id="database"][data-row-id="item"][data-col-id="primary"]');
        return newCell;
    }} as unknown as HTMLElement;
    const restore = preserveAVBindingRange(protyle, panel);
    restore(nextPanel);
    assert.equal(selected, newCell);
    assert.equal(hidden, false);
    selected = undefined;
    boundID = "other-block";
    restore(nextPanel);
    assert.equal(selected, undefined);
    assert.equal(hidden, true);
});
