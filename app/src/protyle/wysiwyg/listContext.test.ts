import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getFollowingOrderedListMarkerUpdates,
    getListContext,
    getListConversionType,
    getListShortcutAction,
    shouldIgnoreListShortcut,
    type TListSubtype
} from "./listContext";

class TestElement {
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    private attributes = new Map<string, string>();

    constructor(type?: string, id?: string, subtype?: TListSubtype) {
        if (type) {
            this.attributes.set("data-type", type);
        }
        if (id) {
            this.attributes.set("data-node-id", id);
        }
        if (subtype) {
            this.attributes.set("data-subtype", subtype);
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

const createList = (subtype: TListSubtype, ...children: TestElement[]) => {
    const paragraph = new TestElement("NodeParagraph", "paragraph");
    const listItem = new TestElement("NodeListItem", "list-item", subtype).append(paragraph, ...children,
        new TestElement());
    const list = new TestElement("NodeList", "list", subtype).append(listItem, new TestElement());
    const editor = new TestElement().append(list);
    return {paragraph, listItem, list, editor};
};

describe("getListContext", () => {
    it("returns the nearest list and its direct cursor child", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const blockquote = new TestElement("NodeBlockquote", "blockquote").append(paragraph, new TestElement());
        const listItem = new TestElement("NodeListItem", "list-item", "u").append(new TestElement(), blockquote,
            new TestElement());
        const list = new TestElement("NodeList", "list", "u").append(listItem, new TestElement());
        const editor = new TestElement().append(list);

        const context = getListContext(asHTMLElement(paragraph), asHTMLElement(editor));

        assert.equal(context?.listElement, asHTMLElement(list));
        assert.equal(context?.listItemElement, asHTMLElement(listItem));
        assert.equal(context?.childElement, asHTMLElement(blockquote));
        assert.deepEqual(context?.childElements, [asHTMLElement(blockquote)]);
        assert.equal(context?.subtype, "u");
    });

    it("uses the nearest list in a nested list", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const innerListItem = new TestElement("NodeListItem", "inner-item", "t").append(new TestElement(), paragraph,
            new TestElement());
        const innerList = new TestElement("NodeList", "inner-list", "t").append(innerListItem, new TestElement());
        const outerListItem = new TestElement("NodeListItem", "outer-item", "u").append(new TestElement(), innerList,
            new TestElement());
        const outerList = new TestElement("NodeList", "outer-list", "u").append(outerListItem, new TestElement());
        const editor = new TestElement().append(outerList);

        const context = getListContext(asHTMLElement(paragraph), asHTMLElement(editor));

        assert.equal(context?.listElement, asHTMLElement(innerList));
        assert.equal(context?.listItemElement, asHTMLElement(innerListItem));
        assert.equal(context?.childElement, asHTMLElement(paragraph));
        assert.equal(context?.subtype, "t");
    });

    it("supports a focused list item without its list wrapper", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const listItem = new TestElement("NodeListItem", "list-item", "o").append(new TestElement(), paragraph,
            new TestElement());
        const editor = new TestElement().append(listItem);

        const context = getListContext(asHTMLElement(paragraph), asHTMLElement(editor));

        assert.equal(context?.listElement, undefined);
        assert.equal(context?.listItemElement, asHTMLElement(listItem));
        assert.deepEqual(context?.listItemElements, [asHTMLElement(listItem)]);
        assert.equal(context?.subtype, "o");
    });

    it("does not cross the current editor boundary", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const editor = new TestElement().append(paragraph);
        new TestElement("NodeListItem", "list-item", "t").append(editor, new TestElement());

        assert.equal(getListContext(asHTMLElement(paragraph), asHTMLElement(editor)), undefined);
    });
});

describe("getListShortcutAction", () => {
    it("cancels or converts a single empty list", () => {
        const {paragraph, editor} = createList("u");
        const context = getListContext(asHTMLElement(paragraph), asHTMLElement(editor))!;

        assert.equal(getListShortcutAction(context, "u", true, false), "cancelList");
        assert.equal(getListShortcutAction(context, "o", true, false), "convertList");
    });

    it("does not cancel a focused single empty list item", () => {
        const {paragraph, editor} = createList("u");
        const context = getListContext(asHTMLElement(paragraph), asHTMLElement(editor))!;

        assert.equal(getListShortcutAction(context, "u", true, true), "insertListItem");
        assert.equal(getListShortcutAction(context, "o", true, true), "insertChildList");
    });

    it("inserts a list item only for a matching single-child list item", () => {
        const sibling = new TestElement("NodeListItem", "sibling", "t");
        const {paragraph, list, editor} = createList("t");
        sibling.parentElement = list;
        list.children.splice(1, 0, sibling);
        const context = getListContext(asHTMLElement(paragraph), asHTMLElement(editor))!;

        assert.equal(getListShortcutAction(context, "t", false, false), "insertListItem");
        assert.equal(getListShortcutAction(context, "u", false, false), "insertChildList");
    });

    it("converts an empty child in a list item with multiple children", () => {
        const secondChild = new TestElement("NodeParagraph", "second");
        const {paragraph, editor} = createList("o", secondChild);
        const context = getListContext(asHTMLElement(paragraph), asHTMLElement(editor))!;

        assert.equal(getListShortcutAction(context, "o", true, false), "convertChildToList");
        assert.equal(getListShortcutAction(context, "u", true, false), "convertChildToList");
    });

    it("inserts a child list after a non-empty child in a list item with multiple children", () => {
        const secondChild = new TestElement("NodeParagraph", "second");
        const {paragraph, editor} = createList("o", secondChild);
        const context = getListContext(asHTMLElement(paragraph), asHTMLElement(editor))!;

        assert.equal(getListShortcutAction(context, "o", false, false), "insertChildList");
    });

    it("treats a folded heading as having hidden children", () => {
        const heading = new TestElement("NodeHeading", "heading");
        heading.setAttribute("fold", "1");
        const listItem = new TestElement("NodeListItem", "list-item", "u").append(heading, new TestElement());
        const list = new TestElement("NodeList", "list", "u").append(listItem, new TestElement());
        const editor = new TestElement().append(list);
        const context = getListContext(asHTMLElement(heading), asHTMLElement(editor))!;

        assert.equal(getListShortcutAction(context, "u", false, false), "insertChildList");
    });
});

describe("getFollowingOrderedListMarkerUpdates", () => {
    it("increments following markers after inserting a list item", () => {
        assert.deepEqual(getFollowingOrderedListMarkerUpdates("1.", ["2.", "3."]), ["3.", "4."]);
        assert.deepEqual(getFollowingOrderedListMarkerUpdates("2.", ["4.", "5."]), [undefined, undefined]);
    });

    it("ignores an invalid current marker", () => {
        assert.deepEqual(getFollowingOrderedListMarkerUpdates("*", ["2."]), [undefined]);
    });
});

describe("shouldIgnoreListShortcut", () => {
    it("ignores only a selected list item", () => {
        assert.equal(shouldIgnoreListShortcut(true, "NodeListItem"), true);
        assert.equal(shouldIgnoreListShortcut(true, "NodeList"), false);
        assert.equal(shouldIgnoreListShortcut(false, "NodeListItem"), false);
    });
});

describe("getListConversionType", () => {
    it("maps every list subtype conversion", () => {
        assert.equal(getListConversionType("u", "o"), "UL2OL");
        assert.equal(getListConversionType("u", "t"), "UL2TL");
        assert.equal(getListConversionType("o", "u"), "OL2UL");
        assert.equal(getListConversionType("o", "t"), "OL2TL");
        assert.equal(getListConversionType("t", "u"), "TL2UL");
        assert.equal(getListConversionType("t", "o"), "TL2OL");
        assert.equal(getListConversionType("t", "t"), undefined);
    });
});
