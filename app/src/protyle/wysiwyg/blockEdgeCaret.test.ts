import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getBlockEdgeCaretPoint, getBlockEdgeCaretRange, isCaretRangeInsideElement} from "./blockEdgeCaret";

const editableRect = {
    left: 40,
    right: 240,
    top: 100,
    bottom: 200,
};

describe("getBlockEdgeCaretPoint", () => {
    it("probes the matching visual line from the left padding", () => {
        assert.deepEqual(getBlockEdgeCaretPoint(20, 150, 30, 250, editableRect), {
            x: 44,
            y: 150,
        });
    });

    it("probes the matching visual line from the right padding", () => {
        assert.deepEqual(getBlockEdgeCaretPoint(270, 150, 30, 250, editableRect), {
            x: 236,
            y: 150,
        });
    });

    it("leaves native caret placement unchanged inside the content area", () => {
        assert.equal(getBlockEdgeCaretPoint(100, 150, 30, 250, editableRect), undefined);
    });

    it("does not map vertical padding or block gaps to a text line", () => {
        assert.equal(getBlockEdgeCaretPoint(20, 90, 30, 250, editableRect), undefined);
        assert.equal(getBlockEdgeCaretPoint(270, 210, 30, 250, editableRect), undefined);
    });

    it("keeps probes inside narrow editable elements", () => {
        assert.deepEqual(getBlockEdgeCaretPoint(20, 101, 30, 250, {
            left: 40,
            right: 44,
            top: 100,
            bottom: 102,
        }), {
            x: 42,
            y: 101,
        });
    });
});

class TestElement {
    public children: TestElement[] = [];

    append(...children: TestElement[]) {
        this.children.push(...children);
        return this;
    }

    contains(node: TestElement): boolean {
        return this.children.some(child => child === node || child.contains(node));
    }
}

const createRange = (startContainer: TestElement, endContainer = startContainer, collapsed = true,
                     rect = {top: 100, bottom: 120}) => ({
    collapsed,
    startContainer: startContainer as unknown as Node,
    endContainer: endContainer as unknown as Node,
    getClientRects: () => [rect],
}) as unknown as Range;

describe("isCaretRangeInsideElement", () => {
    it("accepts a collapsed caret inside the target editable element", () => {
        const text = new TestElement();
        const editable = new TestElement().append(text);

        assert.equal(isCaretRangeInsideElement(createRange(text), editable as unknown as Element), true);
    });

    it("rejects a caret returned for an adjacent block", () => {
        const editable = new TestElement();
        const adjacent = new TestElement();

        assert.equal(isCaretRangeInsideElement(createRange(adjacent), editable as unknown as Element), false);
    });

    it("rejects non-collapsed ranges", () => {
        const text = new TestElement();
        const editable = new TestElement().append(text);

        assert.equal(isCaretRangeInsideElement(createRange(text, text, false), editable as unknown as Element), false);
    });
});

describe("getBlockEdgeCaretRange", () => {
    it("moves a direct range to the clicked edge of its visual line", () => {
        const text = new TestElement();
        const editable = new TestElement().append(text);
        const range = createRange(text);

        assert.deepEqual(getBlockEdgeCaretRange(270, 110, 30, 250, editableRect,
            editable as unknown as Element, () => range), {
            range,
            lineBoundaryDirection: "right",
        });
    });

    it("moves toward the right edge from the closest range on a softly wrapped line", () => {
        const text = new TestElement();
        const editable = new TestElement().append(text);
        const targetLineRange = createRange(text);
        const nextLineRange = createRange(text, text, true, {top: 130, bottom: 150});

        const caret = getBlockEdgeCaretRange(270, 110, 30, 250, editableRect,
            editable as unknown as Element, (x) => x > 200 ? nextLineRange : targetLineRange);

        assert.equal(caret.range, targetLineRange);
        assert.equal(caret.lineBoundaryDirection, "right");
    });

    it("moves toward the left edge when its direct range belongs to the previous visual line", () => {
        const text = new TestElement();
        const editable = new TestElement().append(text);
        const targetLineRange = createRange(text, text, true, {top: 130, bottom: 150});
        const previousLineRange = createRange(text);

        const caret = getBlockEdgeCaretRange(20, 140, 30, 250, editableRect,
            editable as unknown as Element, (x) => x < 80 ? previousLineRange : targetLineRange);

        assert.equal(caret.range, targetLineRange);
        assert.equal(caret.lineBoundaryDirection, "left");
    });

    it("falls back when no range on the clicked visual line can be found", () => {
        const text = new TestElement();
        const editable = new TestElement().append(text);
        const nextLineRange = createRange(text, text, true, {top: 130, bottom: 150});

        assert.equal(getBlockEdgeCaretRange(270, 110, 30, 250, editableRect,
            editable as unknown as Element, () => nextLineRange), undefined);
    });
});
