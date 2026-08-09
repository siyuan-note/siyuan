import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    extractCrossBlockPasteContext,
    isNestedListCrossBlockSelection,
    NESTED_LIST_PASTE_MARKER,
    shouldPreservePastedBlockStructure,
} from "./pasteSource";

const element = (type: string, selected = false) => ({
    classList: {
        contains(className: string) {
            return selected && className === "protyle-wysiwyg--select";
        }
    },
    getAttribute(attribute: string) {
        return attribute === "data-type" ? type : null;
    }
}) as unknown as Element;

describe("shouldPreservePastedBlockStructure", () => {
    it("preserves a selection containing complete blocks", () => {
        assert.equal(shouldPreservePastedBlockStructure([
            element("NodeParagraph"),
            element("NodeParagraph", true)
        ]), true);
    });

    it("preserves a cross-block text selection that starts with a heading", () => {
        assert.equal(shouldPreservePastedBlockStructure([
            element("NodeHeading"),
            element("NodeHeading")
        ]), true);
    });

    it("merges a cross-block paragraph selection into the target block", () => {
        assert.equal(shouldPreservePastedBlockStructure([
            element("NodeParagraph"),
            element("NodeParagraph")
        ]), false);
    });
});

describe("isNestedListCrossBlockSelection", () => {
    const item = () => {
        const children = new Set<Element>();
        return {
            element: {
                contains(child: Element) {
                    return children.has(child);
                },
            } as unknown as Element,
            children,
        };
    };

    it("detects a selection from a parent list item into its descendant", () => {
        const parent = item();
        const child = item();
        parent.children.add(child.element);
        assert.equal(isNestedListCrossBlockSelection(parent.element, child.element), true);
    });

    it("ignores selections within one list item or between sibling items", () => {
        const first = item();
        const second = item();
        assert.equal(isNestedListCrossBlockSelection(first.element, first.element), false);
        assert.equal(isNestedListCrossBlockSelection(first.element, second.element), false);
    });
});

describe("extractCrossBlockPasteContext", () => {
    it("extracts and removes the nested-list marker", () => {
        const html = `<!--data-siyuan='encoded'-->${NESTED_LIST_PASTE_MARKER}<p>content</p>`;
        assert.deepEqual(extractCrossBlockPasteContext(html), {
            nestedList: true,
            html: "<!--data-siyuan='encoded'--><p>content</p>",
        });
    });

    it("leaves unmarked HTML unchanged", () => {
        assert.deepEqual(extractCrossBlockPasteContext("<p>content</p>"), {
            nestedList: false,
            html: "<p>content</p>",
        });
    });
});
