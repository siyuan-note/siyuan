import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getBlockquoteContext, isBlockquoteMarker, shouldCancelBlockquote} from "./blockquote";

class TestElement {
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    private attributes = new Map<string, string>();

    constructor(type?: string, id?: string) {
        if (type) {
            this.attributes.set("data-type", type);
        }
        if (id) {
            this.attributes.set("data-node-id", id);
        }
    }

    append(...elements: TestElement[]) {
        elements.forEach((element) => {
            element.parentElement = this;
            this.children.push(element);
        });
        return this;
    }

    getAttribute(name: string) {
        return this.attributes.get(name) || null;
    }

    hasAttribute(name: string) {
        return this.attributes.has(name);
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }
}

const asHTMLElement = (element: TestElement) => element as unknown as HTMLElement;

describe("getBlockquoteContext", () => {
    it("returns the direct blockquote child containing a nested cursor block", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const listItem = new TestElement("NodeListItem", "list-item").append(paragraph);
        const list = new TestElement("NodeList", "list").append(listItem);
        const sibling = new TestElement("NodeParagraph", "sibling");
        const attr = new TestElement();
        const blockquote = new TestElement("NodeBlockquote", "blockquote").append(list, sibling, attr);
        const editor = new TestElement().append(blockquote);

        const context = getBlockquoteContext(asHTMLElement(paragraph), asHTMLElement(editor));

        assert.equal(context?.blockquoteElement, asHTMLElement(blockquote));
        assert.equal(context?.childElement, asHTMLElement(list));
        assert.deepEqual(context?.childElements, [asHTMLElement(list), asHTMLElement(sibling)]);
    });

    it("uses the nearest blockquote", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const inner = new TestElement("NodeBlockquote", "inner").append(paragraph, new TestElement());
        const outer = new TestElement("NodeBlockquote", "outer").append(inner, new TestElement());
        const editor = new TestElement().append(outer);

        const context = getBlockquoteContext(asHTMLElement(paragraph), asHTMLElement(editor));

        assert.equal(context?.blockquoteElement, asHTMLElement(inner));
        assert.equal(context?.childElement, asHTMLElement(paragraph));
        assert.deepEqual(context?.childElements, [asHTMLElement(paragraph)]);
        assert.notEqual(context?.blockquoteElement, asHTMLElement(outer));
    });

    it("returns undefined outside a blockquote", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const editor = new TestElement().append(paragraph);

        assert.equal(getBlockquoteContext(asHTMLElement(paragraph), asHTMLElement(editor)), undefined);
    });

    it("does not cross the current editor boundary", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const editor = new TestElement().append(paragraph);
        new TestElement("NodeBlockquote", "outer").append(editor, new TestElement());

        assert.equal(getBlockquoteContext(asHTMLElement(paragraph), asHTMLElement(editor)), undefined);
    });

    it("does not cancel a blockquote whose only visible child is a folded heading", () => {
        const heading = new TestElement("NodeHeading", "heading");
        heading.setAttribute("fold", "1");
        const blockquote = new TestElement("NodeBlockquote", "blockquote").append(heading, new TestElement());
        const editor = new TestElement().append(blockquote);
        const context = getBlockquoteContext(asHTMLElement(heading), asHTMLElement(editor));

        assert.equal(shouldCancelBlockquote(context!), false);
    });

    it("cancels a blockquote with one unfolded child", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const blockquote = new TestElement("NodeBlockquote", "blockquote").append(paragraph, new TestElement());
        const editor = new TestElement().append(blockquote);
        const context = getBlockquoteContext(asHTMLElement(paragraph), asHTMLElement(editor));

        assert.equal(shouldCancelBlockquote(context!), true);
    });

    it("does not cancel a blockquote when the current paragraph has a sibling block", () => {
        const sibling = new TestElement("NodeParagraph", "sibling");
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const blockquote = new TestElement("NodeBlockquote", "blockquote").append(sibling, paragraph, new TestElement());
        const editor = new TestElement().append(blockquote);
        const context = getBlockquoteContext(asHTMLElement(paragraph), asHTMLElement(editor));

        assert.equal(shouldCancelBlockquote(context!), false);
    });
});

describe("isBlockquoteMarker", () => {
    it("accepts ASCII and Chinese blockquote markers", () => {
        assert.equal(isBlockquoteMarker(">"), true);
        assert.equal(isBlockquoteMarker("》"), true);
        assert.equal(isBlockquoteMarker("> "), true);
        assert.equal(isBlockquoteMarker("》 "), true);
        assert.equal(isBlockquoteMarker("   >"), true);
    });

    it("rejects over-indented markers and ordinary text", () => {
        assert.equal(isBlockquoteMarker("    > "), false);
        assert.equal(isBlockquoteMarker("text > "), false);
        assert.equal(isBlockquoteMarker(">  "), false);
    });
});
