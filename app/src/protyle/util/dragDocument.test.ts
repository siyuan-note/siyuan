import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    isAttributeViewTitleTarget,
    isDragTargetInSource,
    isSameDragEditor,
    isSameSiblingMove,
    replaceDragUndoOperation,
    uniqueDragIds
} from "./dragDocument";

const createClassElement = (classNames: string[], parentElement: Element = null) => ({
    nodeType: 1,
    classList: {
        contains: (className: string) => classNames.includes(className),
    },
    parentElement,
    querySelector: (): Element | null => null,
}) as unknown as Element;

const createTextNode = (parentElement: Element) => ({
    nodeType: 3,
    parentElement,
}) as unknown as Node;

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

describe("isAttributeViewTitleTarget", () => {
    it("recognizes the database title and its descendants", () => {
        const title = createClassElement(["av__title"]);
        const titleChild = createClassElement([], title);
        const titleText = createTextNode(title);

        assert.equal(isAttributeViewTitleTarget(title), true);
        assert.equal(isAttributeViewTitleTarget(titleChild), true);
        assert.equal(isAttributeViewTitleTarget(titleText), true);
    });

    it("allows other database areas", () => {
        const database = createClassElement(["av"]);
        const row = createClassElement(["av__row"], database);

        assert.equal(isAttributeViewTitleTarget(row), false);
    });

    it("recognizes coordinates over the database title when the browser targets its container", () => {
        const title = createClassElement(["av__title"]);
        const database = createClassElement(["av"]);
        const container = createClassElement([], database);
        (database as HTMLElement).querySelector = () => title;
        (title as HTMLElement).getBoundingClientRect = () => ({
            bottom: 40,
            height: 20,
            left: 10,
            right: 110,
            top: 20,
            width: 100,
        }) as DOMRect;

        assert.equal(isAttributeViewTitleTarget(container, {x: 50, y: 30}), true);
        assert.equal(isAttributeViewTitleTarget(container, {x: 4, y: 30}), true);
        assert.equal(isAttributeViewTitleTarget(container, {x: 50, y: 60}), false);
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
