import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let getMobileBlockSelectionElement: typeof import("./blockSelection").getMobileBlockSelectionElement;

before(async () => {
    Object.assign(globalThis, {
        SIYUAN_VERSION: "test",
        NODE_ENV: "test",
    });
    ({getMobileBlockSelectionElement} = await import("./blockSelection"));
});

class TestElement {
    nodeType = 1;
    tagName = "DIV";
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    attributes = new Map<string, string>();
    classes = new Set<string>();
    classList = {
        contains: (className: string) => this.classes.has(className),
    };

    get childElementCount() {
        return this.children.length;
    }

    append(...elements: TestElement[]) {
        elements.forEach(element => {
            element.parentElement = this;
            this.children.push(element);
        });
        return this;
    }

    addClass(className: string) {
        this.classes.add(className);
        return this;
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
        return this;
    }

    getAttribute(name: string) {
        return this.attributes.get(name) || null;
    }

    hasAttribute(name: string) {
        return this.attributes.has(name);
    }
}

const block = (type: string) => new TestElement().setAttribute("data-type", type).setAttribute("data-node-id", type);
const asHTMLElement = (element: TestElement) => element as unknown as HTMLElement;

describe("mobile block selection", () => {
    it("selects a simple list item instead of its paragraph", () => {
        const editor = new TestElement().addClass("protyle-wysiwyg");
        const list = block("NodeList");
        const paragraph = block("NodeParagraph");
        const listItem = block("NodeListItem").append(new TestElement(), paragraph, new TestElement());
        const siblingItem = block("NodeListItem").append(new TestElement(), block("NodeParagraph"), new TestElement());
        editor.append(list.append(listItem, siblingItem, new TestElement()));

        assert.equal(getMobileBlockSelectionElement(asHTMLElement(paragraph)), asHTMLElement(listItem));
    });

    it("keeps independently movable content blocks inside complex list items", () => {
        const editor = new TestElement().addClass("protyle-wysiwyg");
        const paragraph = block("NodeParagraph");
        const listItem = block("NodeListItem").append(
            new TestElement(), paragraph, block("NodeParagraph"), new TestElement());
        editor.append(block("NodeList").append(listItem, block("NodeListItem"), new TestElement()));

        assert.equal(getMobileBlockSelectionElement(asHTMLElement(paragraph)), asHTMLElement(paragraph));
    });

    it("selects the query embed instead of a rendered child block", () => {
        const editor = new TestElement().addClass("protyle-wysiwyg");
        const child = block("NodeParagraph");
        const embed = block("NodeBlockQueryEmbed").append(child);
        editor.append(embed);

        assert.equal(getMobileBlockSelectionElement(asHTMLElement(child)), asHTMLElement(embed));
    });
});
