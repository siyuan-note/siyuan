import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getCrossBlockMergeRemoveElement, isEntireBlockContentSelected} from "./removeRange";

class TestElement {
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    private attributes = new Map<string, string>();

    constructor(public name: string, type?: string) {
        if (type) {
            this.attributes.set("data-node-id", name);
            this.attributes.set("data-type", type);
        }
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
        const index = this.parentElement.children.indexOf(this);
        return this.parentElement.children[index + 1] || null;
    }

    getAttribute(name: string) {
        return this.attributes.get(name) || null;
    }

    hasAttribute(name: string) {
        return this.attributes.has(name);
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

const block = (name: string, type: string, ...children: TestElement[]) =>
    new TestElement(name, type).append(...children);
const attr = (name: string) => new TestElement(name);
const asHTMLElement = (element: TestElement) => element as unknown as HTMLElement;

describe("isEntireBlockContentSelected", () => {
    it("requires the selection to cover the complete editable content", () => {
        assert.equal(isEntireBlockContentSelected(0, 3, 3), true);
        assert.equal(isEntireBlockContentSelected(0, 4, 3), true);
        assert.equal(isEntireBlockContentSelected(1, 3, 3), false);
        assert.equal(isEntireBlockContentSelected(0, 2, 3), false);
    });
});

describe("getCrossBlockMergeRemoveElement", () => {
    it("删除多层列表中起点下方的完整分支", () => {
        const start = block("start", "NodeParagraph");
        const second = block("second", "NodeParagraph");
        const third = block("third", "NodeParagraph");
        const end = block("end", "NodeParagraph");
        const fourthItem = block("fourthItem", "NodeListItem", end, attr("fourthAttr"));
        const fourthList = block("fourthList", "NodeList", fourthItem, attr("fourthListAttr"));
        const thirdItem = block("thirdItem", "NodeListItem", third, fourthList, attr("thirdAttr"));
        const thirdList = block("thirdList", "NodeList", thirdItem, attr("thirdListAttr"));
        const secondItem = block("secondItem", "NodeListItem", second, thirdList, attr("secondAttr"));
        const secondList = block("secondList", "NodeList", secondItem, attr("secondListAttr"));
        const firstItem = block("firstItem", "NodeListItem", start, secondList, attr("firstAttr"));
        const firstList = block("firstList", "NodeList", firstItem, attr("firstListAttr"));
        const editor = new TestElement("editor").append(firstList);

        const result = getCrossBlockMergeRemoveElement(
            asHTMLElement(editor), asHTMLElement(start), asHTMLElement(end));

        assert.equal(result, asHTMLElement(secondList));
    });

    it("保留终点列表项之后的兄弟项", () => {
        const start = block("start", "NodeParagraph");
        const end = block("end", "NodeParagraph");
        const endItem = block("endItem", "NodeListItem", end, attr("endAttr"));
        const siblingItem = block("siblingItem", "NodeListItem",
            block("sibling", "NodeParagraph"), attr("siblingAttr"));
        const list = block("list", "NodeList", endItem, siblingItem, attr("listAttr"));
        const editor = new TestElement("editor").append(start, list);

        const result = getCrossBlockMergeRemoveElement(
            asHTMLElement(editor), asHTMLElement(start), asHTMLElement(end));

        assert.equal(result, asHTMLElement(endItem));
    });

    it("终点后存在未选中的子列表时不删除终点块", () => {
        const start = block("start", "NodeParagraph");
        const end = block("end", "NodeParagraph");
        const childList = block("childList", "NodeList",
            block("childItem", "NodeListItem", block("child", "NodeParagraph"), attr("childAttr")),
            attr("childListAttr"));
        const endItem = block("endItem", "NodeListItem", end, childList, attr("endAttr"));
        const list = block("list", "NodeList", endItem, attr("listAttr"));
        const editor = new TestElement("editor").append(start, list);

        const result = getCrossBlockMergeRemoveElement(
            asHTMLElement(editor), asHTMLElement(start), asHTMLElement(end));

        assert.equal(result, undefined);
    });

    it("同一列表项内保留起点块并删除终点块", () => {
        const start = block("start", "NodeParagraph");
        const end = block("end", "NodeParagraph");
        const childList = block("childList", "NodeList",
            block("childItem", "NodeListItem", block("child", "NodeParagraph"), attr("childAttr")),
            attr("childListAttr"));
        const item = block("item", "NodeListItem", start, end, childList, attr("itemAttr"));
        const list = block("list", "NodeList", item, attr("listAttr"));
        const editor = new TestElement("editor").append(list);

        const result = getCrossBlockMergeRemoveElement(
            asHTMLElement(editor), asHTMLElement(start), asHTMLElement(end));

        assert.equal(result, asHTMLElement(end));
    });

    it("终点之前的子列表不阻止合并", () => {
        const start = block("start", "NodeParagraph");
        const end = block("end", "NodeParagraph");
        const childList = block("childList", "NodeList",
            block("childItem", "NodeListItem", block("child", "NodeParagraph"), attr("childAttr")),
            attr("childListAttr"));
        const item = block("item", "NodeListItem", start, childList, end, attr("itemAttr"));
        const list = block("list", "NodeList", item, attr("listAttr"));
        const editor = new TestElement("editor").append(list);

        const result = getCrossBlockMergeRemoveElement(
            asHTMLElement(editor), asHTMLElement(start), asHTMLElement(end));

        assert.equal(result, asHTMLElement(end));
    });
});
