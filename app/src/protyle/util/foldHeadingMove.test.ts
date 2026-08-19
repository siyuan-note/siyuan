import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isFoldedHeading, shouldUnfoldMovedHeading} from "./foldHeadingMove";

class TestBlockElement {
    constructor(private attributes: Record<string, string>) {
    }

    getAttribute(name: string) {
        return this.attributes[name] ?? null;
    }
}

const asElement = (attributes: Record<string, string>) =>
    new TestBlockElement(attributes) as unknown as Element;

describe("folded heading moves", () => {
    const foldedHeading = asElement({"data-type": "NodeHeading", "data-subtype": "h2", fold: "1"});

    it("recognizes folded headings", () => {
        assert.equal(isFoldedHeading(foldedHeading), true);
        assert.equal(isFoldedHeading(asElement({"data-type": "NodeHeading", "data-subtype": "h2"})), false);
    });

    it("unfolds when the destination contributes a new heading child", () => {
        assert.equal(shouldUnfoldMovedHeading(foldedHeading, asElement({"data-type": "NodeParagraph"})), true);
        assert.equal(shouldUnfoldMovedHeading(
            foldedHeading,
            asElement({"data-type": "NodeHeading", "data-subtype": "h3"}),
        ), true);
    });

    it("preserves folding at a heading boundary or the end of a container", () => {
        assert.equal(shouldUnfoldMovedHeading(
            foldedHeading,
            asElement({"data-type": "NodeHeading", "data-subtype": "h2"}),
        ), false);
        assert.equal(shouldUnfoldMovedHeading(
            foldedHeading,
            asElement({"data-type": "NodeHeading", "data-subtype": "h1"}),
        ), false);
        assert.equal(shouldUnfoldMovedHeading(foldedHeading), false);
    });
});
