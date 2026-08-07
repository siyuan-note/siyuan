import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getAVRowDropTarget,
    getSameSuperBlockEdgeTarget,
    getTopListDragTarget,
    isAttributeViewTitleTarget,
    isDragTargetInSource,
    isSameDragEditor,
    isSameSiblingMove,
    replaceDragUndoOperation,
    shouldKeepListBlockDragTarget,
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

const createSuperBlock = (layout = "col") => {
    const children: Element[] = [];
    const blocks: Element[] = [];
    const superBlock = {
        children,
        getAttribute: (name: string) => name === "data-type" ? "NodeSuperBlock" :
            (name === "data-sb-layout" ? layout : null),
    } as unknown as Element;
    ["first", "middle", "last"].forEach((id, index) => {
        const block = {
            getAttribute: (name: string) => name === "data-node-id" ? id : null,
            hasAttribute: (name: string) => name === "data-node-id",
            parentElement: superBlock,
        } as unknown as Element;
        blocks.push(block);
        children.push(block);
        if (index < 2) {
            children.push({hasAttribute: () => false, parentElement: superBlock} as unknown as Element);
        }
    });
    children.push({hasAttribute: () => false, parentElement: superBlock} as unknown as Element);
    return {blocks, superBlock};
};

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

describe("getAVRowDropTarget", () => {
    it("uses the preceding row for the table utility row", () => {
        const row = createClassElement(["av__row"]);
        const utilityRow = createClassElement(["av__row--util"]);
        Object.defineProperty(utilityRow, "previousElementSibling", {value: row});

        assert.equal(getAVRowDropTarget(utilityRow as HTMLElement), row);
    });

    it("keeps regular rows unchanged", () => {
        const row = createClassElement(["av__row"]);

        assert.equal(getAVRowDropTarget(row as HTMLElement), row);
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

describe("getSameSuperBlockEdgeTarget", () => {
    it("uses the first column when a middle column is moved to the start", () => {
        const {blocks, superBlock} = createSuperBlock();

        assert.equal(getSameSuperBlockEdgeTarget([blocks[1]], superBlock, false), blocks[0]);
    });

    it("uses the last column when a middle column is moved to the end", () => {
        const {blocks, superBlock} = createSuperBlock();

        assert.equal(getSameSuperBlockEdgeTarget([blocks[1]], superBlock, true), blocks[2]);
    });

    it("keeps an external block drop as an outer super block operation", () => {
        const {superBlock} = createSuperBlock();
        const external = createBlockElement("external");

        assert.equal(getSameSuperBlockEdgeTarget([external], superBlock, false), undefined);
    });

    it("does not reorder columns in a row super block", () => {
        const {blocks, superBlock} = createSuperBlock("row");

        assert.equal(getSameSuperBlockEdgeTarget([blocks[1]], superBlock, false), undefined);
    });
});

describe("getTopListDragTarget", () => {
    it("uses the complete list when a list item is hit at the outer edge", () => {
        const list = createClassElement(["list"]);
        const listItem = createClassElement(["li"], list);

        assert.equal(getTopListDragTarget(listItem), list);
    });

    it("uses the outer list when a nested list item is hit", () => {
        const outerList = createClassElement(["list"]);
        const parentItem = createClassElement(["li"], outerList);
        const nestedList = createClassElement(["list"], parentItem);
        const nestedItem = createClassElement(["li"], nestedList);

        assert.equal(getTopListDragTarget(nestedItem), outerList);
    });
});

describe("shouldKeepListBlockDragTarget", () => {
    it("keeps both complete lists when forming a horizontal super block", () => {
        assert.equal(shouldKeepListBlockDragTarget("nodelist", true, false), true);
    });

    it("allows a list block to expand into list items for a regular list drop", () => {
        assert.equal(shouldKeepListBlockDragTarget("nodelist", false, false), false);
    });

    it("keeps a list block when reordering columns", () => {
        assert.equal(shouldKeepListBlockDragTarget("nodelist", false, true), true);
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
