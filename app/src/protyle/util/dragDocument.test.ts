import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    isDragTargetInSource,
    isSameDragEditor,
    isSameSiblingMove,
    replaceDragUndoOperation,
    uniqueDragIds
} from "./dragDocument";

const createBlockElement = (id: string, parentElement: Element = null) => ({
    getAttribute: (name: string) => name === "data-node-id" ? id : null,
    parentElement
}) as unknown as Element;

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

describe("isDragTargetInSource", () => {
    it("recognizes a target rendered under the same block ID in another editor", () => {
        const source = createBlockElement("source");
        const renderedSource = createBlockElement("source");
        const child = createBlockElement("child", renderedSource);
        const target = createBlockElement("target", child);

        assert.equal(isDragTargetInSource([source], target), true);
    });

    it("allows a target outside all source blocks", () => {
        const source = createBlockElement("source");
        const target = createBlockElement("target", createBlockElement("parent"));

        assert.equal(isDragTargetInSource([source], target), false);
    });

    it("checks every source in a multi-block drag", () => {
        const firstSource = createBlockElement("first");
        const secondSource = createBlockElement("second");
        const target = createBlockElement("target", createBlockElement("second"));

        assert.equal(isDragTargetInSource([firstSource, secondSource], target), true);
    });
});

describe("isSameSiblingMove", () => {
    it("treats dropping a selection onto one of its items as a no-op", () => {
        assert.equal(isSameSiblingMove(["a", "b", "c"], ["a", "b", "c"], "c", true), true);
    });

    it("recognizes an unchanged sibling order", () => {
        assert.equal(isSameSiblingMove(["a", "b", "c", "d"], ["b", "c"], "a", true), true);
    });

    it("allows a sibling move that changes the order", () => {
        assert.equal(isSameSiblingMove(["a", "b", "c", "d"], ["b", "c"], "d", true), false);
    });
});

describe("replaceDragUndoOperation", () => {
    it("restores a valid container before moving the remaining items back", () => {
        const operations = ["move-c", "move-b", "move-a"];
        replaceDragUndoOperation(operations, "move-a", [
            "delete-placeholder",
            "move-a",
            "insert-list-with-placeholder"
        ]);

        assert.deepEqual(operations.reverse(), [
            "insert-list-with-placeholder",
            "move-a",
            "delete-placeholder",
            "move-b",
            "move-c"
        ]);
    });
});
