import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    clampBlockDragSelectY,
    getBlockDragSelectBlock,
    getBlockDragSelectContentBounds,
    getBlockDragSelectProbeX,
    isBlockDragSelectBottomReached,
    isBlockDragSelectTopReached,
    resolveBlockDragSelectStart
} from "./blockDragSelect";

describe("getBlockDragSelectContentBounds", () => {
    it("preserves zero padding for compact editors", () => {
        assert.deepEqual(getBlockDragSelectContentBounds(10, 210, "0px", "0px"), {
            left: 11,
            right: 208,
        });
    });

    it("uses the default editor padding when the computed value is unavailable", () => {
        assert.deepEqual(getBlockDragSelectContentBounds(10, 210, "", ""), {
            left: 35,
            right: 192,
        });
    });
});

class TestElement {
    parentElement: TestElement | null = null;
    children: TestElement[] = [];

    constructor(public name: string, public block = false, public containerSurface = false) {
    }

    append(...elements: TestElement[]) {
        elements.forEach((element) => {
            element.parentElement = this;
            this.children.push(element);
        });
        return this;
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

const getBlock = (element: Element) => {
    let currentElement = element as unknown as TestElement | null;
    while (currentElement && !currentElement.block) {
        currentElement = currentElement.parentElement;
    }
    return currentElement ? asElement(currentElement) : false;
};

const resolve = (points: Map<number, TestElement>, top = 0, bottom = 12, fallbackBlock?: TestElement) =>
    resolveBlockDragSelectStart({
    x: 100,
    top,
    bottom,
    elementFromPoint: (_x, y) => {
        const point = points.get(y);
        return point ? asElement(point) : null;
    },
    getBlock,
    isContainerSurface: (element) => (element as unknown as TestElement).containerSurface,
    fallbackBlock: fallbackBlock && asElement(fallbackBlock),
});

describe("getBlockDragSelectProbeX", () => {
    const selectRect = {left: 20, right: 180, top: 0, bottom: 20};

    it("uses the edge approaching content when dragging from the left", () => {
        assert.equal(getBlockDragSelectProbeX(10, selectRect, 50, 150), 150);
    });

    it("uses the edge approaching content when dragging from the right", () => {
        assert.equal(getBlockDragSelectProbeX(190, selectRect, 50, 150), 50);
    });

    it("keeps the existing left-edge probe for vertical padding", () => {
        assert.equal(getBlockDragSelectProbeX(100, selectRect, 50, 150), 50);
    });
});

describe("getBlockDragSelectBlock", () => {
    const isContainerBlock = (element: Element) => (element as unknown as TestElement).containerSurface;
    const isListItem = (element: Element) => (element as unknown as TestElement).name === "listItem";

    it("selects a list item instead of its primary content block", () => {
        const editor = new TestElement("editor");
        const list = new TestElement("list", true, true);
        const listItem = new TestElement("listItem", true, true);
        const action = new TestElement("action");
        const paragraph = new TestElement("paragraph", true);
        const content = new TestElement("content");
        editor.append(list.append(listItem.append(action, paragraph.append(content))));

        assert.equal(getBlockDragSelectBlock(asElement(content), asElement(editor), getBlock,
            isContainerBlock, isListItem), asElement(listItem));
    });

    it("selects an additional list item child block independently", () => {
        const editor = new TestElement("editor");
        const list = new TestElement("list", true, true);
        const listItem = new TestElement("listItem", true, true);
        const action = new TestElement("action");
        const paragraph = new TestElement("paragraph", true);
        const childParagraph = new TestElement("childParagraph", true);
        const childContent = new TestElement("childContent");
        editor.append(list.append(listItem.append(action, paragraph, childParagraph.append(childContent))));

        assert.equal(getBlockDragSelectBlock(asElement(childContent), asElement(editor), getBlock,
            isContainerBlock, isListItem), asElement(childParagraph));
    });

    it("selects the inner list item for its primary content block", () => {
        const editor = new TestElement("editor");
        const outerList = new TestElement("list", true, true);
        const outerListItem = new TestElement("listItem", true, true);
        const outerParagraph = new TestElement("outerParagraph", true);
        const innerList = new TestElement("list", true, true);
        const innerListItem = new TestElement("listItem", true, true);
        const innerAction = new TestElement("innerAction");
        const innerParagraph = new TestElement("innerParagraph", true);
        const content = new TestElement("content");
        innerListItem.append(innerAction, innerParagraph.append(content));
        outerListItem.append(outerParagraph, innerList.append(innerListItem));
        editor.append(outerList.append(outerListItem));

        assert.equal(getBlockDragSelectBlock(asElement(content), asElement(editor), getBlock,
            isContainerBlock, isListItem), asElement(innerListItem));
    });

    it("does not cross another container to select an outer list item", () => {
        const editor = new TestElement("editor");
        const listItem = new TestElement("listItem", true, true);
        const blockquote = new TestElement("blockquote", true, true);
        const paragraph = new TestElement("paragraph", true);
        const content = new TestElement("content");
        editor.append(listItem.append(blockquote.append(paragraph.append(content))));

        assert.equal(getBlockDragSelectBlock(asElement(content), asElement(editor), getBlock,
            isContainerBlock, isListItem), asElement(paragraph));
    });
});

describe("isBlockDragSelectBottomReached", () => {
    it("reaches a container when the selection enters its bottom padding", () => {
        assert.equal(isBlockDragSelectBottomReached(105, 110, 100), true);
    });

    it("reaches a container at the document end without a following sibling", () => {
        assert.equal(isBlockDragSelectBottomReached(140, 110, 110), true);
    });

    it("keeps child selection before the bottom padding", () => {
        assert.equal(isBlockDragSelectBottomReached(100, 110, 100), false);
    });
});

describe("isBlockDragSelectTopReached", () => {
    it("reaches a container when the selection enters its top padding", () => {
        assert.equal(isBlockDragSelectTopReached(95, 90, 100), true);
    });

    it("reaches a container at the document start without a preceding sibling", () => {
        assert.equal(isBlockDragSelectTopReached(60, 90, 90), true);
    });

    it("keeps child selection after the top padding", () => {
        assert.equal(isBlockDragSelectTopReached(100, 90, 100), false);
    });
});

describe("clampBlockDragSelectY", () => {
    it("stops upward selection at the editor top", () => {
        assert.equal(clampBlockDragSelectY(120, 50, 700, 200, 650), 200);
    });

    it("stops downward selection at the editor bottom", () => {
        assert.equal(clampBlockDragSelectY(680, 50, 700, 200, 650), 650);
    });

    it("keeps selection inside the editor unchanged", () => {
        assert.equal(clampBlockDragSelectY(400, 50, 700, 200, 650), 400);
    });
});

describe("resolveBlockDragSelectStart", () => {
    it("keeps the fallback block after the selection start scrolls outside the viewport", () => {
        const fallback = new TestElement("fallback", true);

        assert.equal(resolve(new Map(), 0, 12, fallback), asElement(fallback));
    });

    it("keeps the parent block while the selection only covers its side", () => {
        const parent = new TestElement("parent", true, true);

        assert.equal(resolve(new Map([[0, parent], [4, parent], [8, parent], [12, parent]])), asElement(parent));
    });

    it("uses the direct child below a list gap", () => {
        const list = new TestElement("list", true, true);
        const listItem = new TestElement("listItem", true, true);
        const paragraph = new TestElement("paragraph", true);
        const content = new TestElement("content");
        list.append(listItem.append(paragraph.append(content)));

        assert.equal(resolve(new Map([[0, list], [4, list], [8, content]])), asElement(listItem));
    });

    it("switches from a list item surface to an additional child block", () => {
        const editor = new TestElement("editor");
        const list = new TestElement("list", true, true);
        const listItem = new TestElement("listItem", true, true);
        const paragraph = new TestElement("paragraph", true);
        const childParagraph = new TestElement("childParagraph", true);
        const childContent = new TestElement("childContent");
        editor.append(list.append(listItem.append(paragraph, childParagraph.append(childContent))));
        const isContainerBlock = (element: Element) => (element as unknown as TestElement).containerSurface;
        const isListItem = (element: Element) => (element as unknown as TestElement).name === "listItem";
        const getDragSelectBlock = (element: Element) => getBlockDragSelectBlock(element, asElement(editor),
            getBlock, isContainerBlock, isListItem);

        assert.equal(resolveBlockDragSelectStart({
            x: 100,
            top: 0,
            bottom: 8,
            elementFromPoint: (_x, y) => y < 8 ? asElement(listItem) : asElement(childContent),
            getBlock: getDragSelectBlock,
            isContainerSurface: (element) => (element as unknown as TestElement).containerSurface,
        }), asElement(childParagraph));
    });

    ["blockquote", "callout", "superBlock"].forEach((name) => {
        it(`uses the child below a ${name} gap`, () => {
            const container = new TestElement(name, true, true);
            const wrapper = name === "callout" ? new TestElement("contentWrapper", false, true) : container;
            const child = new TestElement("child", true);
            const content = new TestElement("content");
            if (wrapper === container) {
                container.append(child.append(content));
            } else {
                container.append(wrapper.append(child.append(content)));
            }

            assert.equal(resolve(new Map([[0, wrapper], [4, wrapper], [8, content]])), asElement(child));
        });
    });

    it("keeps the parent when its bottom padding is followed by a sibling", () => {
        const editor = new TestElement("editor");
        const parent = new TestElement("parent", true, true);
        const sibling = new TestElement("sibling", true);
        editor.append(parent, sibling);

        assert.equal(resolve(new Map([[0, parent], [4, parent], [8, sibling]])), asElement(parent));
    });

    it("finds the first block below editor padding", () => {
        const editor = new TestElement("editor", false, true);
        const child = new TestElement("child", true);
        editor.append(child);

        assert.equal(resolve(new Map([[0, editor], [4, editor], [8, child]])), asElement(child));
    });

    it("finds the first block below a non-block editor header", () => {
        const editor = new TestElement("editor");
        const header = new TestElement("header");
        const child = new TestElement("child", true);
        editor.append(header, child);

        assert.equal(resolve(new Map([[0, header]]), 0, 12, child), asElement(child));
    });
});
