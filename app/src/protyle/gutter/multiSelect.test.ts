import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getMultiSelectGutterTarget, isGutterInsertStateMatched} from "./multiSelect";

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
}

const asElement = (element: TestElement) => element as unknown as Element;

describe("getMultiSelectGutterTarget", () => {
    it("keeps the regular gutter behavior for a single selected block", () => {
        const selected = new TestElement();

        assert.equal(getMultiSelectGutterTarget([asElement(selected)], asElement(selected)), undefined);
    });

    it("uses the selected block when it is hit directly", () => {
        const first = new TestElement();
        const second = new TestElement();

        assert.equal(getMultiSelectGutterTarget([asElement(first), asElement(second)], asElement(second)),
            asElement(second));
    });

    it("uses the selected ancestor for any descendant", () => {
        const selected = new TestElement();
        const firstChild = new TestElement();
        const secondChild = new TestElement();
        const content = new TestElement();
        selected.append(firstChild, secondChild.append(content));
        const otherSelected = new TestElement();

        assert.equal(getMultiSelectGutterTarget([asElement(selected), asElement(otherSelected)], asElement(content)),
            asElement(selected));
    });

    it("uses the nearest selected ancestor when selections overlap", () => {
        const outerSelected = new TestElement();
        const innerSelected = new TestElement();
        const content = new TestElement();
        outerSelected.append(innerSelected.append(content));
        const otherSelected = new TestElement();

        assert.equal(getMultiSelectGutterTarget([
            asElement(outerSelected),
            asElement(innerSelected),
            asElement(otherSelected)
        ], asElement(content)), asElement(innerSelected));
    });

    it("does not render a gutter for a block outside the selection", () => {
        const first = new TestElement();
        const second = new TestElement();
        const unrelated = new TestElement();

        assert.equal(getMultiSelectGutterTarget([asElement(first), asElement(second)], asElement(unrelated)),
            undefined);
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
