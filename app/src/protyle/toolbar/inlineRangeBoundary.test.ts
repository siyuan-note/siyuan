import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    canExpandInlineRangeToParent,
    getInlineRangeElement,
    normalizeCalloutTitleRange
} from "./inlineRangeBoundary";

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

    it("normalizes a browser select-all range to the callout title", () => {
        const infoElement = element("DIV");
        const titleElement = element("SPAN", infoElement);
        const titleText = text(titleElement);
        Object.defineProperty(titleElement, "childNodes", {value: [titleText]});
        infoElement.contains = (node: Node) => node === titleElement || node === titleText;
        titleElement.contains = (node: Node) => node === titleText;
        const blockElement = {
            getAttribute: (name: string) => name === "data-type" ? "NodeCallout" : null,
            querySelector: () => titleElement,
        } as unknown as Element;
        const fallbackEditableElement = element("DIV");
        const range = {
            startContainer: infoElement,
            endContainer: infoElement,
            intersectsNode: (node: Node) => node === titleElement,
            setStart(node: Node, offset: number) {
                this.startContainer = node;
                assert.equal(offset, 0);
            },
            setEnd(node: Node, offset: number) {
                this.endContainer = node;
                assert.equal(offset, 1);
            },
        } as unknown as Range;

        assert.equal(normalizeCalloutTitleRange(range, blockElement, fallbackEditableElement), titleElement);
        assert.equal(range.startContainer, titleElement);
        assert.equal(range.endContainer, titleElement);
    });
});
