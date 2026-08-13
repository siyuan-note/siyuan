import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getCrossBlockTextSelectionTarget,
    getGutterSelection,
    getGutterSelectionTarget,
    getSameContainerHeadingLevel,
    isCrossBlockTextRange,
    isGutterInsertStateMatched
} from "./multiSelect";

class TestElement {
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    attributes = new Map<string, string>();

    append(...elements: TestElement[]) {
        elements.forEach(element => {
            element.parentElement = this;
            this.children.push(element);
        });
        return this;
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
        return this;
    }

    getAttribute(name: string) {
        return this.attributes.get(name) || null;
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

const heading = (level: number) => asElement(new TestElement()
    .setAttribute("data-type", "NodeHeading")
    .setAttribute("data-subtype", `h${level}`));

describe("getSameContainerHeadingLevel", () => {
    it("returns the level for headings in the same block container", () => {
        const parent = new TestElement();
        const first = heading(2);
        const second = heading(2);
        parent.append(first as unknown as TestElement, second as unknown as TestElement);

        assert.equal(getSameContainerHeadingLevel([first, second]), 2);
    });

    it("accepts non-contiguous headings in the same block container", () => {
        const parent = new TestElement();
        const first = heading(3);
        const paragraph = new TestElement().setAttribute("data-type", "NodeParagraph");
        const second = heading(3);
        parent.append(first as unknown as TestElement, paragraph, second as unknown as TestElement);

        assert.equal(getSameContainerHeadingLevel([first, second]), 3);
    });

    it("rejects mixed levels, block types, and containers", () => {
        const parent = new TestElement();
        const first = heading(1);
        const second = heading(2);
        const paragraph = asElement(new TestElement().setAttribute("data-type", "NodeParagraph"));
        parent.append(first as unknown as TestElement, second as unknown as TestElement,
            paragraph as unknown as TestElement);

        assert.equal(getSameContainerHeadingLevel([first, second]), undefined);
        assert.equal(getSameContainerHeadingLevel([first, paragraph]), undefined);

        const otherParent = new TestElement();
        const otherHeading = heading(1);
        otherParent.append(otherHeading as unknown as TestElement);
        assert.equal(getSameContainerHeadingLevel([first, otherHeading]), undefined);
    });

    it("requires an actual multiple selection", () => {
        assert.equal(getSameContainerHeadingLevel([heading(1)]), undefined);
    });
});

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

describe("getCrossBlockTextSelectionTarget", () => {
    it("uses a matching cross-block text selection when there is no multiple block selection", () => {
        const selected = new TestElement();
        const content = new TestElement();
        selected.append(content);

        assert.equal(getCrossBlockTextSelectionTarget([], [asElement(selected)], asElement(content)),
            asElement(selected));
        assert.equal(getCrossBlockTextSelectionTarget([asElement(new TestElement())], [asElement(selected)],
            asElement(content)), asElement(selected));
    });

    it("keeps an existing multiple block selection ahead of a text selection", () => {
        const first = asElement(new TestElement());
        const second = asElement(new TestElement());
        const rangeElement = asElement(new TestElement());

        assert.equal(getCrossBlockTextSelectionTarget([first, second], [rangeElement], rangeElement), undefined);
    });

    it("ignores a gutter outside the cross-block text selection", () => {
        const rangeElement = asElement(new TestElement());
        const unrelated = asElement(new TestElement());

        assert.equal(getCrossBlockTextSelectionTarget([], [rangeElement], unrelated), undefined);
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
