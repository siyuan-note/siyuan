import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    BLOCK_SELECTION_MODE_CLASS,
    BLOCK_SELECTION_CLASS,
    captureBlockSelectionModeState,
    getBlockSelectionToggle,
    getDeleteSelectionCandidate,
    isContinuousBlockSelection,
    restoreBlockSelectionModeState
} from "./blockSelection";

class TestElement {
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    private attributes = new Map<string, string>();
    private classes = new Set<string>();
    classList = {
        add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
        contains: (name: string) => this.classes.has(name),
        remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
    };

    constructor(public name: string, public block = true) {
    }

    append(...elements: TestElement[]) {
        elements.forEach(element => {
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

    getAttribute(name: string) {
        if (name === "data-node-id") {
            return this.block ? this.name : null;
        }
        return this.attributes.get(name) || null;
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }

    removeAttribute(name: string) {
        this.attributes.delete(name);
    }

    querySelectorAll(selector: string) {
        const elements: TestElement[] = [];
        const visit = (element: TestElement) => {
            element.children.forEach(child => {
                if ((selector === "[data-node-id]" && child.block) ||
                    (selector.startsWith(".") && child.classList.contains(selector.slice(1)))) {
                    elements.push(child);
                }
                visit(child);
            });
        };
        visit(this);
        return elements;
    }
}

const asElement = (element: TestElement) => element as unknown as Element;

const getNextBlock = (element: Element) => {
    const testElement = element as unknown as TestElement;
    const siblings = testElement.parentElement?.children || [];
    for (let index = siblings.indexOf(testElement) + 1; index < siblings.length; index++) {
        if (siblings[index].block) {
            return asElement(siblings[index]);
        }
    }
    return undefined;
};

const getPreviousBlock = (element: Element) => {
    const testElement = element as unknown as TestElement;
    const siblings = testElement.parentElement?.children || [];
    for (let index = siblings.indexOf(testElement) - 1; index >= 0; index--) {
        if (siblings[index].block) {
            return asElement(siblings[index]);
        }
    }
    return undefined;
};

describe("getBlockSelectionToggle", () => {
    it("adds and removes the target without changing unrelated marks", () => {
        const root = new TestElement("root", false);
        const first = new TestElement("first");
        const second = new TestElement("second");
        root.append(first, second);

        assert.deepEqual(getBlockSelectionToggle([asElement(first)], asElement(second)),
            [asElement(first), asElement(second)]);
        assert.deepEqual(getBlockSelectionToggle([asElement(first), asElement(second)], asElement(second)),
            [asElement(first)]);
    });

    it("keeps parent and child marks mutually exclusive", () => {
        const root = new TestElement("root", false);
        const parent = new TestElement("parent");
        const child = new TestElement("child");
        const sibling = new TestElement("sibling");
        root.append(parent.append(child), sibling);

        assert.deepEqual(getBlockSelectionToggle([asElement(parent), asElement(sibling)], asElement(child)),
            [asElement(sibling), asElement(child)]);
        assert.deepEqual(getBlockSelectionToggle([asElement(child), asElement(sibling)], asElement(parent)),
            [asElement(sibling), asElement(parent)]);
    });
});

describe("block selection mode state", () => {
    it("restores the active block and marked endpoints after replacing a subtree", () => {
        const editor = new TestElement("editor", false);
        const oldRoot = new TestElement("root");
        const oldChild = new TestElement("child");
        editor.append(oldRoot.append(oldChild));
        oldChild.classList.add(BLOCK_SELECTION_MODE_CLASS, BLOCK_SELECTION_CLASS);
        oldChild.setAttribute("select-start", "true");
        oldChild.setAttribute("select-end", "true");
        const state = captureBlockSelectionModeState(asElement(oldRoot));

        const newRoot = new TestElement("root");
        const newChild = new TestElement("child");
        newRoot.append(newChild);
        editor.children = [newRoot];
        newRoot.parentElement = editor;
        const restoredSelectionModeElement = restoreBlockSelectionModeState(asElement(editor), asElement(newRoot), state);

        assert.equal(restoredSelectionModeElement, asElement(newChild));
        assert.equal(newChild.classList.contains(BLOCK_SELECTION_MODE_CLASS), true);
        assert.equal(newChild.classList.contains(BLOCK_SELECTION_CLASS), true);
        assert.equal(newChild.getAttribute("select-start"), "true");
        assert.equal(newChild.getAttribute("select-end"), "true");
    });
});

describe("isContinuousBlockSelection", () => {
    it("accepts one block and adjacent blocks while skipping non-block siblings", () => {
        const root = new TestElement("root", false);
        const first = new TestElement("first");
        const attribute = new TestElement("attribute", false);
        const second = new TestElement("second");
        root.append(first, attribute, second);

        assert.equal(isContinuousBlockSelection([asElement(first)], getNextBlock), true);
        assert.equal(isContinuousBlockSelection([asElement(first), asElement(second)], getNextBlock), true);
    });

    it("rejects empty, non-contiguous, and cross-parent selections", () => {
        const firstRoot = new TestElement("firstRoot", false);
        const secondRoot = new TestElement("secondRoot", false);
        const first = new TestElement("first");
        const second = new TestElement("second");
        const third = new TestElement("third");
        const other = new TestElement("other");
        firstRoot.append(first, second, third);
        secondRoot.append(other);

        assert.equal(isContinuousBlockSelection([], getNextBlock), false);
        assert.equal(isContinuousBlockSelection([asElement(first), asElement(third)], getNextBlock), false);
        assert.equal(isContinuousBlockSelection([asElement(first), asElement(other)], getNextBlock), false);
    });
});

describe("getDeleteSelectionCandidate", () => {
    const createBlocks = () => {
        const root = new TestElement("root", false);
        const blocks = ["A", "B", "C", "D", "E"].map(name => new TestElement(name));
        root.append(...blocks);
        return blocks;
    };

    it("uses the next block for Delete and the previous block for Backspace", () => {
        const blocks = createBlocks();

        assert.deepEqual(getDeleteSelectionCandidate(blocks.slice(1, 3).map(asElement), "Delete",
            getPreviousBlock, getNextBlock), {element: asElement(blocks[3]), side: "after"});
        assert.deepEqual(getDeleteSelectionCandidate(blocks.slice(1, 3).map(asElement), "Backspace",
            getPreviousBlock, getNextBlock), {element: asElement(blocks[0]), side: "before"});
    });

    it("uses the outside edges for non-contiguous marks", () => {
        const blocks = createBlocks();
        const targets = [asElement(blocks[1]), asElement(blocks[3])];

        assert.deepEqual(getDeleteSelectionCandidate(targets, "Delete", getPreviousBlock, getNextBlock),
            {element: asElement(blocks[4]), side: "after"});
        assert.deepEqual(getDeleteSelectionCandidate(targets, "Backspace", getPreviousBlock, getNextBlock),
            {element: asElement(blocks[0]), side: "before"});
    });

    it("falls back to the opposite side and returns no candidate when every block is deleted", () => {
        const blocks = createBlocks();

        assert.deepEqual(getDeleteSelectionCandidate(blocks.slice(3).map(asElement), "Delete",
            getPreviousBlock, getNextBlock), {element: asElement(blocks[2]), side: "before"});
        assert.deepEqual(getDeleteSelectionCandidate(blocks.slice(0, 2).map(asElement), "Backspace",
            getPreviousBlock, getNextBlock), {element: asElement(blocks[2]), side: "after"});
        assert.equal(getDeleteSelectionCandidate(blocks.map(asElement), "Delete",
            getPreviousBlock, getNextBlock), undefined);
    });

    it("skips candidates that are also being deleted", () => {
        const blocks = createBlocks();
        const targets = [asElement(blocks[1]), asElement(blocks[3])];
        const getNextWithDeletedCandidate = (element: Element) => {
            if (element === asElement(blocks[3])) {
                return asElement(blocks[1]);
            }
            if (element === asElement(blocks[1])) {
                return asElement(blocks[4]);
            }
            return getNextBlock(element);
        };

        assert.deepEqual(getDeleteSelectionCandidate(targets, "Delete", getPreviousBlock,
            getNextWithDeletedCandidate), {element: asElement(blocks[4]), side: "after"});
    });
});
