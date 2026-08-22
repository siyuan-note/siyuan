import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getAppendListContext,
    getFirstListItemElement,
    getFollowingOrderedListMarkerUpdates,
    getLastListItemElement,
    getListContext,
    getListConversionType,
    getOrderedListMarkerUpdates,
    getOrderedListMaxStart,
    getPreviousListItemID,
    getListShortcutAction,
    isEmptyListItemBlock,
    isListItemActionElement,
    parseOrderedListStart,
    shouldCreateListItemChildOnEnter,
    shouldIgnoreListShortcut,
    shouldOpenListItemAttr,
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

const createActionElement = (parentType: string) => ({
    parentElement: {
        getAttribute: (name: string) => name === "data-type" ? parentType : null,
    },
}) as unknown as Element;

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

describe("getAppendListContext", () => {
    it("uses the nearest list in a nested list", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const innerListItem = new TestElement("NodeListItem", "inner-item", "u").append(paragraph);
        const innerList = new TestElement("NodeList", "inner-list", "u").append(innerListItem);
        const outerListItem = new TestElement("NodeListItem", "outer-item", "u").append(innerList);
        const outerList = new TestElement("NodeList", "outer-list", "u").append(outerListItem);
        const editor = new TestElement().append(outerList);

        const context = getAppendListContext(asHTMLElement(paragraph), asHTMLElement(editor));

        assert.equal(context?.listElement, asHTMLElement(innerList));
        assert.equal(context?.listItemElement, asHTMLElement(innerListItem));
    });

    it("uses a selected list as the current list", () => {
        const {list, editor} = createList("o");

        const context = getAppendListContext(asHTMLElement(list), asHTMLElement(editor));

        assert.equal(context?.listElement, asHTMLElement(list));
        assert.equal(context?.listItemElement, undefined);
    });

    it("supports a focused list item without its list wrapper", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const listItem = new TestElement("NodeListItem", "list-item", "t").append(paragraph);
        const editor = new TestElement().append(listItem);

        const context = getAppendListContext(asHTMLElement(paragraph), asHTMLElement(editor));

        assert.equal(context?.listElement, undefined);
        assert.equal(context?.listItemElement, asHTMLElement(listItem));
    });

    it("does not cross the current editor boundary", () => {
        const paragraph = new TestElement("NodeParagraph", "paragraph");
        const editor = new TestElement().append(paragraph);
        new TestElement("NodeListItem", "list-item", "u").append(editor);

        assert.equal(getAppendListContext(asHTMLElement(paragraph), asHTMLElement(editor)), undefined);
    });
});

describe("getLastListItemElement", () => {
    it("ignores non-list-item children at the end", () => {
        const first = new TestElement("NodeListItem", "first", "u");
        const last = new TestElement("NodeListItem", "last", "u");
        const list = new TestElement("NodeList", "list", "u").append(first, last, new TestElement());

        assert.equal(getLastListItemElement(asHTMLElement(list)), asHTMLElement(last));
    });
});

describe("getFirstListItemElement", () => {
    it("ignores non-list-item children at the beginning", () => {
        const first = new TestElement("NodeListItem", "first", "u");
        const last = new TestElement("NodeListItem", "last", "u");
        const list = new TestElement("NodeList", "list", "u").append(new TestElement(), first, last);

        assert.equal(getFirstListItemElement(asHTMLElement(list)), asHTMLElement(first));
    });
});

describe("getPreviousListItemID", () => {
    it("returns the original predecessor of a focused list item", () => {
        const first = new TestElement("NodeListItem", "first", "o");
        const middle = new TestElement("NodeListItem", "middle", "o");
        const last = new TestElement("NodeListItem", "last", "o");
        const list = new TestElement("NodeList", "list", "o").append(first, middle, last, new TestElement());

        assert.equal(getPreviousListItemID(asHTMLElement(list), "middle"), "first");
        assert.equal(getPreviousListItemID(asHTMLElement(list), "first"), undefined);
        assert.equal(getPreviousListItemID(asHTMLElement(list), "missing"), undefined);
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

describe("isEmptyListItemBlock", () => {
    it("treats empty text and a single soft line as empty", () => {
        assert.equal(isEmptyListItemBlock("", false), true);
        assert.equal(isEmptyListItemBlock("\n", false), true);
    });

    it("treats text and images as content", () => {
        assert.equal(isEmptyListItemBlock("content", false), false);
        assert.equal(isEmptyListItemBlock("", true), false);
    });
});

describe("shouldCreateListItemChildOnEnter", () => {
    it("uses normal block creation for a non-empty trailing child", () => {
        assert.equal(shouldCreateListItemChildOnEnter(false, true, false), true);
    });

    it("keeps list handling for primary, non-trailing, and empty blocks", () => {
        assert.equal(shouldCreateListItemChildOnEnter(true, true, false), false);
        assert.equal(shouldCreateListItemChildOnEnter(false, false, false), false);
        assert.equal(shouldCreateListItemChildOnEnter(false, true, true), false);
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

describe("getOrderedListMarkerUpdates", () => {
    it("preserves ordered lists starting from zero", () => {
        assert.deepEqual(getOrderedListMarkerUpdates(["0.", "1."]), [undefined, undefined]);
        assert.deepEqual(getOrderedListMarkerUpdates(["5.", "9."]), [undefined, "6."]);
    });

    it("supports an explicit zero start index", () => {
        assert.deepEqual(getOrderedListMarkerUpdates(["1.", "2."], 0), ["0.", "1."]);
        assert.deepEqual(getOrderedListMarkerUpdates(["1.", "2.", "0."], 0), ["0.", "1.", "2."]);
        assert.deepEqual(getOrderedListMarkerUpdates(["2.", "0.", "1."], 0), ["0.", "1.", "2."]);
    });

    it("preserves an explicit custom start when the original first item is removed", () => {
        assert.deepEqual(getOrderedListMarkerUpdates(["1.", "12.", "13."], 10), ["10.", "11.", "12."]);
        assert.deepEqual(getOrderedListMarkerUpdates(["4.", "5.", "2."], 4), [undefined, undefined, "6."]);
    });

    it("replaces invalid markers instead of producing NaN", () => {
        assert.deepEqual(getOrderedListMarkerUpdates(["NaN.", "NaN."]), ["1.", "2."]);
        assert.deepEqual(getOrderedListMarkerUpdates(["2.", "3."], Number.NaN), ["1.", "2."]);
    });

    it("renumbers the complete parent list after focused list edits", () => {
        assert.deepEqual(getOrderedListMarkerUpdates(["10.", "11.", "12.", "12.", "13.", "14.", "15."]),
            [undefined, undefined, undefined, "13.", "14.", "15.", "16."]);
        assert.deepEqual(getOrderedListMarkerUpdates(["10.", "11.", "13.", "14.", "15.", "16."]),
            [undefined, undefined, "12.", "13.", "14.", "15."]);
        assert.deepEqual(getOrderedListMarkerUpdates(["10.", "11.", "1.", "12.", "13.", "14.", "15."]),
            [undefined, undefined, "12.", "13.", "14.", "15.", "16."]);
        assert.deepEqual(getOrderedListMarkerUpdates(["10.", "11.", "14.", "15.", "16.", "17.", "18."]),
            [undefined, undefined, "12.", "13.", "14.", "15.", "16."]);
    });
});

describe("parseOrderedListStart", () => {
    it("accepts non-negative integers within the list range", () => {
        assert.equal(parseOrderedListStart("0", 3), 0);
        assert.equal(parseOrderedListStart("0005", 3), 5);
        assert.equal(parseOrderedListStart("999999997", 3), 999999997);
        assert.equal(getOrderedListMaxStart(3), 999999997);
    });

    it("rejects malformed and overflowing values", () => {
        assert.equal(parseOrderedListStart("-1", 3), undefined);
        assert.equal(parseOrderedListStart("1.5", 3), undefined);
        assert.equal(parseOrderedListStart("1x", 3), undefined);
        assert.equal(parseOrderedListStart("999999998", 3), undefined);
        assert.equal(parseOrderedListStart("1000000000", 1), undefined);
        assert.equal(parseOrderedListStart("1", 0), undefined);
    });
});

describe("shouldIgnoreListShortcut", () => {
    it("ignores only a selected list item", () => {
        assert.equal(shouldIgnoreListShortcut(true, "NodeListItem"), true);
        assert.equal(shouldIgnoreListShortcut(true, "NodeList"), false);
        assert.equal(shouldIgnoreListShortcut(false, "NodeListItem"), false);
    });
});

describe("shouldOpenListItemAttr", () => {
    it("prioritizes Shift-click on an editable list item marker", () => {
        assert.equal(shouldOpenListItemAttr(true, false, createActionElement("NodeListItem")), true);
    });

    it("keeps range selection for other targets and read-only editors", () => {
        assert.equal(shouldOpenListItemAttr(true, false, createActionElement("NodeCodeBlock")), false);
        assert.equal(shouldOpenListItemAttr(true, true, createActionElement("NodeListItem")), false);
        assert.equal(shouldOpenListItemAttr(false, false, createActionElement("NodeListItem")), false);
        assert.equal(shouldOpenListItemAttr(true, false, false), false);
    });
});

describe("isListItemActionElement", () => {
    it("recognizes only actions directly owned by a list item", () => {
        assert.equal(isListItemActionElement(createActionElement("NodeListItem")), true);
        assert.equal(isListItemActionElement(createActionElement("NodeCodeBlock")), false);
        assert.equal(isListItemActionElement(false), false);
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
