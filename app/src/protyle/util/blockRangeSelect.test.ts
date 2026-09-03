import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getBlockRangeSelectElements} from "./blockRangeSelect";

class TestClassList {
    private classes: Set<string>;

    constructor(classes: string[]) {
        this.classes = new Set(classes);
    }

    contains(className: string) {
        return this.classes.has(className);
    }
}

class TestElement {
    nodeType = 1;
    tagName = "DIV";
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    classList: TestClassList;

    constructor(private name: string, private top: number, classes: string[] = [], private type?: string) {
        this.classList = new TestClassList(classes);
    }

    append(...elements: TestElement[]) {
        elements.forEach(element => {
            element.parentElement = this;
            this.children.push(element);
        });
        return this;
    }

    get nextElementSibling() {
        if (!this.parentElement) {
            return null;
        }
        return this.parentElement.children[this.parentElement.children.indexOf(this) + 1] || null;
    }

    getAttribute(attribute: string) {
        if (attribute === "data-node-id" && this.type) {
            return this.name;
        }
        if (attribute === "data-type") {
            return this.type || null;
        }
        return null;
    }

    hasAttribute(attribute: string) {
        return attribute === "data-node-id" && !!this.type;
    }

    contains(element: TestElement): boolean {
        return this === element || this.children.some(child => child.contains(element));
    }

    getBoundingClientRect() {
        return {
            bottom: this.top + 10,
            left: 0,
            top: this.top,
        } as DOMRect;
    }
}

const asElement = (element: TestElement) => element as unknown as HTMLElement;

const block = (name: string, top: number, type = "NodeParagraph", classes: string[] = []) =>
    new TestElement(name, top, classes, type);

const getBlock = (element: Node) => {
    let currentElement = element as unknown as TestElement;
    while (currentElement && !currentElement.classList.contains("protyle-wysiwyg")) {
        if (currentElement.getAttribute("data-type")?.startsWith("Node") &&
            currentElement.hasAttribute("data-node-id")) {
            return asElement(currentElement);
        }
        currentElement = currentElement.parentElement;
    }
    return false;
};

describe("getBlockRangeSelectElements", () => {
    it("selects a callout and its following siblings when the range starts in callout content", () => {
        const editor = new TestElement("editor", 0, ["protyle-wysiwyg"]);
        const callout = block("callout", 0, "NodeCallout", ["callout"]);
        const content = new TestElement("content", 0, ["callout-content"]);
        const calloutParagraph = block("callout-paragraph", 10);
        const list = block("list", 20, "NodeList", ["list"]);
        const paragraph = block("paragraph", 30);
        editor.append(callout.append(content.append(calloutParagraph)), list, paragraph);

        const expected = [asElement(callout), asElement(list), asElement(paragraph)];
        assert.deepEqual(getBlockRangeSelectElements(asElement(calloutParagraph), asElement(paragraph), getBlock)
            .selectElements, expected);
        const upwardSelection = getBlockRangeSelectElements(asElement(paragraph), asElement(calloutParagraph),
            getBlock);
        assert.deepEqual(upwardSelection.selectElements, expected);
        assert.equal(upwardSelection.toDown, false);
    });

    it("keeps child blocks selected when the range stays inside a callout", () => {
        const editor = new TestElement("editor", 0, ["protyle-wysiwyg"]);
        const callout = block("callout", 0, "NodeCallout", ["callout"]);
        const content = new TestElement("content", 0, ["callout-content"]);
        const first = block("first", 10);
        const second = block("second", 20);
        const sibling = block("sibling", 30);
        editor.append(callout.append(content.append(first, second)), sibling);

        assert.deepEqual(getBlockRangeSelectElements(asElement(first), asElement(second), getBlock).selectElements,
            [asElement(first), asElement(second)]);
    });

    it("keeps child blocks selected in the left vertical super block", () => {
        const editor = new TestElement("editor", 0, ["protyle-wysiwyg"]);
        const outer = block("outer", 0, "NodeSuperBlock", ["sb"]);
        const left = block("left", 0, "NodeSuperBlock", ["sb"]);
        const first = block("first", 10);
        const second = block("second", 20);
        const leftAttr = new TestElement("left-attr", 20, ["protyle-attr"]);
        const resize = new TestElement("resize", 0, ["sb__resize"]);
        const right = block("right", 0, "NodeSuperBlock", ["sb"]);
        const third = block("third", 10);
        const fourth = block("fourth", 20);
        const rightAttr = new TestElement("right-attr", 20, ["protyle-attr"]);
        const outerAttr = new TestElement("outer-attr", 20, ["protyle-attr"]);
        editor.append(outer.append(left.append(first, second, leftAttr), resize,
            right.append(third, fourth, rightAttr), outerAttr));

        const expected = [asElement(first), asElement(second)];
        assert.deepEqual(getBlockRangeSelectElements(asElement(first), asElement(second), getBlock).selectElements,
            expected);
        const upwardSelection = getBlockRangeSelectElements(asElement(second), asElement(first), getBlock);
        assert.deepEqual(upwardSelection.selectElements, expected);
        assert.equal(upwardSelection.toDown, false);
    });

    it("stops at a list containing the range end in the left vertical super block", () => {
        const editor = new TestElement("editor", 0, ["protyle-wysiwyg"]);
        const outer = block("outer", 0, "NodeSuperBlock", ["sb"]);
        const left = block("left", 0, "NodeSuperBlock", ["sb"]);
        const first = block("first", 10);
        const list = block("list", 20, "NodeList", ["list"]);
        const listItem = block("list-item", 20, "NodeListItem", ["li"]);
        const listParagraph = block("list-paragraph", 20);
        const listItemAttr = new TestElement("list-item-attr", 20, ["protyle-attr"]);
        const listAttr = new TestElement("list-attr", 20, ["protyle-attr"]);
        const leftAttr = new TestElement("left-attr", 20, ["protyle-attr"]);
        const resize = new TestElement("resize", 0, ["sb__resize"]);
        const right = block("right", 0, "NodeSuperBlock", ["sb"]);
        const third = block("third", 10);
        const fourth = block("fourth", 20);
        const rightAttr = new TestElement("right-attr", 20, ["protyle-attr"]);
        const outerAttr = new TestElement("outer-attr", 20, ["protyle-attr"]);
        list.append(listItem.append(listParagraph, listItemAttr), listAttr);
        editor.append(outer.append(left.append(first, list, leftAttr), resize,
            right.append(third, fourth, rightAttr), outerAttr));

        const expected = [asElement(first), asElement(list)];
        assert.deepEqual(getBlockRangeSelectElements(asElement(first), asElement(listParagraph), getBlock)
            .selectElements, expected);
        const upwardSelection = getBlockRangeSelectElements(asElement(listParagraph), asElement(first), getBlock);
        assert.deepEqual(upwardSelection.selectElements, expected);
        assert.equal(upwardSelection.toDown, false);
    });
});
