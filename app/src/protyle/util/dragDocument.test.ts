import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isSameDragEditor, uniqueDragIds} from "./dragDocument";

describe("isSameDragEditor", () => {
    it("does not treat a nested Protyle as the target editor", () => {
        const sourceElement = {} as Element;
        const ownerProtyle = {contains: () => true} as unknown as Element;
        const targetEditor = {contains: () => false} as unknown as Element;

        assert.equal(ownerProtyle.contains(sourceElement), true);
        assert.equal(isSameDragEditor(targetEditor, sourceElement), false);
    });

    it("recognizes a source block in the target editor", () => {
        const sourceElement = {} as Element;
        const targetEditor = {contains: (element: Element) => element === sourceElement} as unknown as Element;

        assert.equal(isSameDragEditor(targetEditor, sourceElement), true);
    });
});

describe("uniqueDragIds", () => {
    it("removes empty and duplicate block IDs while preserving their order", () => {
        assert.deepEqual(uniqueDragIds(["a", "", "b", "a", "b", "c"]), ["a", "b", "c"]);
    });
});
