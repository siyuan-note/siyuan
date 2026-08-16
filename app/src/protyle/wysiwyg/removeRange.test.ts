import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getBlockRefCheckElementChain,
    getCrossBlockEndAction,
    getCrossBlockMergeRemoveElement,
    getCrossBlockSiblingListItemMergeContext,
    getDeletedBlockElements,
    isEntireBlockContentSelected
} from "./removeRange";

class TestElement {
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    private attributes = new Map<string, string>();
    classList = {
        contains: (name: string) => this.attributes.get("class")?.split(/\s+/).includes(name) || false,
    };

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

    addClass(name: string) {
        this.attributes.set("class", name);
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

    querySelectorAll(selector: string) {
        if (selector !== "[data-node-id]") {
            return [];
        }
        const result: TestElement[] = [];
        const collect = (element: TestElement) => {
            element.children.forEach(child => {
                if (child.hasAttribute("data-node-id")) {
                    result.push(child);
                }
                collect(child);
            });
        };
        collect(this);
        return result;
    }
}

const block = (name: string, type: string, ...children: TestElement[]) =>
    new TestElement(name, type).append(...children);
const attr = (name: string) => new TestElement(name);
const asHTMLElement = (element: TestElement) => element as unknown as HTMLElement;

describe("getCrossBlockEndAction", () => {
    it("合并相同类型的段落和标题边界", () => {
        assert.equal(getCrossBlockEndAction("NodeParagraph", "NodeParagraph", false, false), "merge");
        assert.equal(getCrossBlockEndAction("NodeHeading", "NodeHeading", true, false), "merge");
    });

    it("删除有效内容被完整选中的异类型终点块", () => {
        assert.equal(getCrossBlockEndAction("NodeParagraph", "NodeHeading", true, false), "delete");
        assert.equal(getCrossBlockEndAction("NodeHeading", "NodeParagraph", true, false), "delete");
        assert.equal(getCrossBlockEndAction("NodeCodeBlock", "NodeHeading", true, false), "delete");
    });

    it("保留部分选中的异类型终点块和折叠标题", () => {
        assert.equal(getCrossBlockEndAction("NodeParagraph", "NodeHeading", false, false), undefined);
        assert.equal(getCrossBlockEndAction("NodeParagraph", "NodeHeading", true, true), undefined);
        assert.equal(getCrossBlockEndAction("NodeParagraph", "NodeCodeBlock", true, false), undefined);
    });
});

describe("isEntireBlockContentSelected", () => {
    const range = (startComparison: number, endComparison: number) => ({
        compareBoundaryPoints(type: number) {
            return type === 0 ? startComparison : endComparison;
        },
    }) as unknown as Range;

    it("requires the selection boundaries to cover the complete editable content", () => {
        const contentRange = {} as Range;
        assert.equal(isEntireBlockContentSelected(range(0, 0), contentRange), true);
        assert.equal(isEntireBlockContentSelected(range(-1, 1), contentRange), true);
        assert.equal(isEntireBlockContentSelected(range(1, 0), contentRange), false);
        assert.equal(isEntireBlockContentSelected(range(0, -1), contentRange), false);
    });
});

describe("getBlockRefCheckElementChain", () => {
    it("includes the intermediate list item when a nested list paragraph is cleared", () => {
        const paragraph = block("paragraph", "NodeParagraph");
        const nestedItem = block("nestedItem", "NodeListItem", paragraph, attr("nestedItemAttr"));
        const nestedList = block("nestedList", "NodeList", nestedItem, attr("nestedListAttr"));
        const parentItem = block("parentItem", "NodeListItem",
            block("parentParagraph", "NodeParagraph"), nestedList, attr("parentItemAttr"));

        const result = getBlockRefCheckElementChain(asHTMLElement(paragraph), asHTMLElement(nestedList));

        assert.deepEqual(result, [
            asHTMLElement(paragraph),
            asHTMLElement(nestedItem),
            asHTMLElement(nestedList),
        ]);
        assert.equal(result.includes(asHTMLElement(parentItem)), false);
    });
});

describe("getDeletedBlockElements", () => {
    it("排除将被移动的子树并阻止从其祖先继续展开", () => {
        const deletedChild = block("deletedChild", "NodeParagraph");
        const retainedGrandchild = block("retainedGrandchild", "NodeParagraph");
        const retainedChild = block("retainedChild", "NodeListItem", retainedGrandchild);
        const root = block("root", "NodeList", deletedChild, retainedChild);

        const result = getDeletedBlockElements(
            [asHTMLElement(root)], [asHTMLElement(retainedChild)]);

        assert.deepEqual(result.elements, [asHTMLElement(root), asHTMLElement(deletedChild)]);
        assert.deepEqual(Array.from(result.expansionStopIDs), ["root"]);
    });

    it("排除查询嵌入块的渲染结果", () => {
        const renderedBlock = block("renderedBlock", "NodeParagraph");
        const renderedResult = new TestElement("renderedResult").addClass("protyle-wysiwyg__embed")
            .append(renderedBlock);
        const embed = block("embed", "NodeBlockQueryEmbed", renderedResult);

        const result = getDeletedBlockElements([asHTMLElement(embed)], []);

        assert.deepEqual(result.elements, [asHTMLElement(embed)]);
    });
});

describe("getCrossBlockMergeRemoveElement", () => {
    it("从列表跨选到顶层标题时只删除标题块", () => {
        const start = block("start", "NodeParagraph");
        const startItem = block("startItem", "NodeListItem", start, attr("startAttr"));
        const startList = block("startList", "NodeList", startItem, attr("startListAttr"));
        const end = block("end", "NodeHeading");
        const editor = new TestElement("editor").append(startList, end);

        const result = getCrossBlockMergeRemoveElement(
            asHTMLElement(editor), asHTMLElement(start), asHTMLElement(end));

        assert.equal(result, asHTMLElement(end));
    });

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

describe("getCrossBlockSiblingListItemMergeContext", () => {
    it("保留终点列表项中未选中的子列表", () => {
        const start = block("start", "NodeParagraph");
        const selectedChildList = block("selectedChildList", "NodeList");
        const startItem = block("startItem", "NodeListItem", start, selectedChildList, attr("startAttr"));
        const end = block("end", "NodeParagraph");
        const trailingChildList = block("trailingChildList", "NodeList");
        const endItem = block("endItem", "NodeListItem", end, trailingChildList, attr("endAttr"));
        const list = block("list", "NodeList", startItem, endItem, attr("listAttr"));
        const editor = new TestElement("editor").append(list);

        const context = getCrossBlockSiblingListItemMergeContext(
            asHTMLElement(editor), asHTMLElement(start), asHTMLElement(end));

        assert.equal(context?.startListItemElement, asHTMLElement(startItem));
        assert.equal(context?.endListItemElement, asHTMLElement(endItem));
        assert.deepEqual(context?.trailingEndBlockElements, [asHTMLElement(trailingChildList)]);
    });

    it("合并不同列表中的边界列表项", () => {
        const start = block("start", "NodeParagraph");
        const startItem = block("startItem", "NodeListItem", start, attr("startAttr"));
        const startList = block("startList", "NodeList", startItem, attr("startListAttr"));
        const end = block("end", "NodeParagraph");
        const trailingChildList = block("trailingChildList", "NodeList");
        const endItem = block("endItem", "NodeListItem", end, trailingChildList, attr("endAttr"));
        const endList = block("endList", "NodeList", endItem, attr("endListAttr"));
        const editor = new TestElement("editor").append(startList, endList);

        const context = getCrossBlockSiblingListItemMergeContext(
            asHTMLElement(editor), asHTMLElement(start), asHTMLElement(end));

        assert.equal(context?.startListElement, asHTMLElement(startList));
        assert.equal(context?.endListElement, asHTMLElement(endList));
        assert.equal(context?.removeEndElement, asHTMLElement(endList));
        assert.deepEqual(context?.trailingEndBlockElements, [asHTMLElement(trailingChildList)]);
    });
});
