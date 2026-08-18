import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getCaretRect} from "./caretRect";

interface ITestRect {
    left: number;
    right: number;
    top: number;
    height: number;
}

const createRect = (left: number, right: number, top = 10, height = 20) => ({
    left,
    right,
    top,
    bottom: top + height,
    width: right - left,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
}) as DOMRect;

const emptyRect = createRect(0, 0, 0, 0);

const createNode = (rects: ITestRect[] = []) => ({
    nodeType: 3,
    textContent: "text",
    getRects: () => rects.map(rect => createRect(rect.left, rect.right, rect.top, rect.height)),
}) as unknown as Node & {getRects: () => DOMRect[]};

const createRange = (container: Node, offset: number, directRect = emptyRect) => {
    let selectedNode: Node & {getRects?: () => DOMRect[]};
    const clone = {
        collapse: (): void => undefined,
        getBoundingClientRect: () => emptyRect,
        getClientRects: () => selectedNode?.getRects?.() || [],
        selectNodeContents: (node: Node) => {
            selectedNode = node;
        },
        setEnd: (node: Node) => {
            selectedNode = node;
        },
        setStart: (node: Node) => {
            selectedNode = node;
        },
    } as unknown as Range;
    return {
        cloneRange: () => clone,
        getBoundingClientRect: () => directRect,
        startContainer: container,
        startOffset: offset,
    } as unknown as Range;
};

describe("getCaretRect", () => {
    it("uses a valid collapsed range rectangle", () => {
        const range = createRange(createNode(), 0, createRect(32, 32, 14, 18));

        assert.deepEqual(getCaretRect(range), {left: 32, top: 14, height: 18});
    });

    it("uses the end of the previous node for an element boundary", () => {
        const textNode = createNode([{left: 20, right: 54, top: 12, height: 18}]);
        const container = {nodeType: 1, childNodes: [textNode]} as unknown as Node;

        assert.deepEqual(getCaretRect(createRange(container, 1)), {left: 54, top: 12, height: 18});
    });

    it("uses the start of the next node for an element boundary", () => {
        const textNode = createNode([{left: 20, right: 54, top: 12, height: 18}]);
        const container = {nodeType: 1, childNodes: [textNode]} as unknown as Node;

        assert.deepEqual(getCaretRect(createRange(container, 0)), {left: 20, top: 12, height: 18});
    });

    it("uses the last text rectangle for a zero-height range at the text end", () => {
        const textNode = createNode([
            {left: 20, right: 80, top: 12, height: 18},
            {left: 20, right: 48, top: 32, height: 18},
        ]);

        assert.deepEqual(getCaretRect(createRange(textNode, 4)), {left: 48, top: 32, height: 18});
    });

    it("uses logical edges for right-to-left content", () => {
        const textNode = createNode([{left: 20, right: 54, top: 12, height: 18}]);
        const container = {nodeType: 1, childNodes: [textNode]} as unknown as Node;

        assert.deepEqual(getCaretRect(createRange(container, 1), true), {left: 20, top: 12, height: 18});
        assert.deepEqual(getCaretRect(createRange(container, 0), true), {left: 54, top: 12, height: 18});
    });

    it("returns no rectangle for an empty boundary", () => {
        const container = {nodeType: 1, childNodes: []} as unknown as Node;

        assert.equal(getCaretRect(createRange(container, 0)), undefined);
    });
});
