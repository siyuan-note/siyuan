import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {canExpandInlineRangeToParent, getInlineRangeElement} from "./inlineRangeBoundary";

const element = (tagName: string, parentElement: Element | null = null) => ({
    tagName,
    parentElement,
}) as unknown as Element;

const text = (parentElement: Element) => ({
    nodeType: 3,
    parentElement,
}) as unknown as Node;

describe("inline range boundary", () => {
    it("does not treat a span-based editable root as an inline element", () => {
        const calloutTitle = element("SPAN");

        assert.equal(getInlineRangeElement(text(calloutTitle), calloutTitle), undefined);
        assert.equal(canExpandInlineRangeToParent(text(calloutTitle), calloutTitle), false);
    });

    it("recognizes inline elements nested inside an editable root", () => {
        const calloutTitle = element("SPAN");
        const inlineElement = element("SPAN", calloutTitle);
        const textNode = text(inlineElement);

        assert.equal(getInlineRangeElement(textNode, calloutTitle), inlineElement);
        assert.equal(canExpandInlineRangeToParent(textNode, calloutTitle), true);
    });

    it("keeps existing block-level editable boundaries", () => {
        ["DIV", "TD", "TH", "TR"].forEach(tagName => {
            const editableElement = element(tagName);
            assert.equal(canExpandInlineRangeToParent(text(editableElement), editableElement), false);
        });
    });
});
