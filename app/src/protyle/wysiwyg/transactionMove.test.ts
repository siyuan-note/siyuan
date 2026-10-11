import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getVisibleMoveElements} from "./transactionMove";

class TestMoveElement {
    nextElementSibling?: TestMoveElement;

    constructor(readonly id?: string) {
    }

    getAttribute(name: string) {
        return name === "data-node-id" ? this.id ?? null : null;
    }
}

const asElement = (element: TestMoveElement) => element as unknown as Element;

const linkElements = (...elements: TestMoveElement[]) => {
    elements.forEach((element, index) => {
        element.nextElementSibling = elements[index + 1];
    });
};

describe("getVisibleMoveElements", () => {
    it("collects the visible members of a stored move group in order", () => {
        const heading = new TestMoveElement("heading");
        const first = new TestMoveElement("first");
        const second = new TestMoveElement("second");
        const target = new TestMoveElement("target");
        linkElements(heading, first, second, target);

        assert.deepEqual(
            getVisibleMoveElements(asElement(heading), ["first", "second"]),
            [heading, first, second],
        );
    });

    it("allows folded descendants to be absent from the DOM", () => {
        const heading = new TestMoveElement("heading");
        const first = new TestMoveElement("first");
        const third = new TestMoveElement("third");
        const target = new TestMoveElement("target");
        linkElements(heading, first, third, target);

        assert.deepEqual(
            getVisibleMoveElements(asElement(heading), ["first", "hidden", "third"]),
            [heading, first, third],
        );
    });

    it("does not absorb destination blocks when all original children are hidden", () => {
        const heading = new TestMoveElement("heading");
        const target = new TestMoveElement("target");
        linkElements(heading, target);

        assert.deepEqual(getVisibleMoveElements(asElement(heading), ["hidden"]), [heading]);
        assert.deepEqual(getVisibleMoveElements(asElement(heading), []), [heading]);
    });
});
