import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getGutterSelection,
    getGutterSelectionTarget,
    isCrossBlockTextRange,
    isGutterInsertStateMatched
} from "./multiSelect";

class TestElement {
    parentElement: TestElement | null = null;
    children: TestElement[] = [];

    append(...elements: TestElement[]) {
        elements.forEach(element => {
            element.parentElement = this;
            this.children.push(element);
        });
        return this;
    }

    contains(element: TestElement) {
        let currentElement: TestElement | null = element;
        while (currentElement) {
            if (currentElement === this) {
                return true;
            }
            currentElement = currentElement.parentElement;
        }
        return false;
    }
}

const asElement = (element: TestElement) => element as unknown as Element;

describe("getGutterSelection", () => {
    it("keeps the regular gutter behavior for a single selected block", () => {
        const selected = asElement(new TestElement());

        assert.deepEqual(getGutterSelection([selected], []), {
            isMultiSelect: false,
            selectElements: [selected]
        });
    });

    it("uses an existing multiple block selection", () => {
        const first = asElement(new TestElement());
        const second = asElement(new TestElement());

        assert.deepEqual(getGutterSelection([first, second], []), {
            isMultiSelect: true,
            selectElements: [first, second]
        });
    });

    it("uses a cross-block text selection without changing block selection classes", () => {
        const rangeElement = asElement(new TestElement());

        assert.deepEqual(getGutterSelection([], [rangeElement]), {
            isMultiSelect: true,
            selectElements: [rangeElement]
        });
    });

    it("keeps an existing multiple block selection ahead of a text range", () => {
        const first = asElement(new TestElement());
        const second = asElement(new TestElement());
        const rangeElement = asElement(new TestElement());

        assert.deepEqual(getGutterSelection([first, second], [rangeElement]), {
            isMultiSelect: true,
            selectElements: [first, second]
        });
    });
});

describe("getGutterSelectionTarget", () => {

    it("uses the selected block when it is hit directly", () => {
        const first = new TestElement();
        const second = new TestElement();

        assert.equal(getGutterSelectionTarget([asElement(first), asElement(second)], asElement(second)),
            asElement(second));
    });

    it("uses the selected ancestor for any descendant", () => {
        const selected = new TestElement();
        const firstChild = new TestElement();
        const secondChild = new TestElement();
        const content = new TestElement();
        selected.append(firstChild, secondChild.append(content));
        const otherSelected = new TestElement();

        assert.equal(getGutterSelectionTarget([asElement(selected), asElement(otherSelected)], asElement(content)),
            asElement(selected));
    });

    it("uses the nearest selected ancestor when selections overlap", () => {
        const outerSelected = new TestElement();
        const innerSelected = new TestElement();
        const content = new TestElement();
        outerSelected.append(innerSelected.append(content));
        const otherSelected = new TestElement();

        assert.equal(getGutterSelectionTarget([
            asElement(outerSelected),
            asElement(innerSelected),
            asElement(otherSelected)
        ], asElement(content)), asElement(innerSelected));
    });

    it("does not render a gutter for a block outside the selection", () => {
        const first = new TestElement();
        const second = new TestElement();
        const unrelated = new TestElement();

        assert.equal(getGutterSelectionTarget([asElement(first), asElement(second)], asElement(unrelated)),
            undefined);
    });
});

describe("isCrossBlockTextRange", () => {
    const getBlock = (node: Node) => node as unknown as Element;

    it("detects a range spanning two blocks inside the editor", () => {
        const boundary = new TestElement();
        const start = new TestElement();
        const end = new TestElement();
        boundary.append(start, end);
        const range = {
            collapsed: false,
            startContainer: asElement(start),
            endContainer: asElement(end)
        } as unknown as Range;

        assert.equal(isCrossBlockTextRange(range, asElement(boundary), getBlock), true);
    });

    it("ignores a collapsed or same-block range", () => {
        const boundary = new TestElement();
        const block = new TestElement();
        boundary.append(block);
        const range = {
            collapsed: false,
            startContainer: asElement(block),
            endContainer: asElement(block)
        } as unknown as Range;

        assert.equal(isCrossBlockTextRange(range, asElement(boundary), getBlock), false);
        (range as unknown as { collapsed: boolean }).collapsed = true;
        assert.equal(isCrossBlockTextRange(range, asElement(boundary), getBlock), false);
    });

    it("ignores a range outside the editor", () => {
        const boundary = new TestElement();
        const start = new TestElement();
        const end = new TestElement();
        boundary.append(start);
        const range = {
            collapsed: false,
            startContainer: asElement(start),
            endContainer: asElement(end)
        } as unknown as Range;

        assert.equal(isCrossBlockTextRange(range, asElement(boundary), getBlock), false);
    });
});

describe("isGutterInsertStateMatched", () => {
    it("matches all four insertion elements in regular mode", () => {
        assert.equal(isGutterInsertStateMatched(4, true), true);
        assert.equal(isGutterInsertStateMatched(0, true), false);
    });

    it("matches no insertion elements in multiple selection mode", () => {
        assert.equal(isGutterInsertStateMatched(0, false), true);
        assert.equal(isGutterInsertStateMatched(4, false), false);
    });
});
