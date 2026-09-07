import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let getAdjacentVisibleBlock: typeof import("./verticalTarget").getAdjacentVisibleBlock;
let getVisibleBoundaryBlock: typeof import("./verticalTarget").getVisibleBoundaryBlock;

before(async () => {
    Object.assign(globalThis, {
        SIYUAN_VERSION: "test",
        NODE_ENV: "test",
    });
    ({getAdjacentVisibleBlock, getVisibleBoundaryBlock} = await import("./verticalTarget"));
});

class TestElement {
    nodeType = 1;
    tagName = "DIV";
    nodeName = "DIV";
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    attributes = new Map<string, string>();
    classes = new Set<string>();
    visible = true;
    classList = {
        contains: (className: string) => this.classes.has(className),
    };

    get previousElementSibling() {
        const index = this.parentElement?.children.indexOf(this) ?? -1;
        return index > 0 ? this.parentElement.children[index - 1] : null;
    }

    get nextElementSibling() {
        const index = this.parentElement?.children.indexOf(this) ?? -1;
        return index >= 0 ? this.parentElement.children[index + 1] || null : null;
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

    getClientRects() {
        return this.visible ? [{top: 0, bottom: 20, left: 0, right: 100, height: 20, width: 100}] : [];
    }

    contains(element: TestElement): boolean {
        return element === this || this.children.some(child => child.contains(element));
    }

    closest(selector: string): TestElement | null {
        if (selector !== "[data-node-id]") {
            return null;
        }
        return this.hasAttribute("data-node-id") ? this : this.parentElement?.closest(selector) || null;
    }

    querySelectorAll(selector: string) {
        if (selector !== "[data-node-id]") {
            return [];
        }
        const matches: TestElement[] = [];
        const visit = (element: TestElement) => {
            element.children.forEach(child => {
                if (child.hasAttribute("data-node-id")) {
                    matches.push(child);
                }
                visit(child);
            });
        };
        visit(this);
        return matches;
    }
}

const asElement = (element: TestElement) => element as unknown as Element;

const block = (id: string, type = "NodeParagraph") => new TestElement()
    .setAttribute("data-node-id", id)
    .setAttribute("data-type", type);

describe("vertical navigation targets", () => {
    it("enters a folded list item as one navigation region", () => {
        const list = block("list", "NodeList").addClass("list");
        const item = block("item", "NodeListItem").addClass("li").setAttribute("fold", "1");
        const summary = block("summary");
        const hidden = block("hidden");
        hidden.visible = false;
        list.append(item.append(summary, hidden));

        assert.equal(getVisibleBoundaryBlock(asElement(list), "up"), asElement(item));
    });

    it("skips hidden folded descendants when leaving the visible summary", () => {
        const editor = new TestElement().addClass("protyle-wysiwyg");
        const list = block("list", "NodeList").addClass("list");
        const item = block("item", "NodeListItem").addClass("li").setAttribute("fold", "1");
        const summary = block("summary");
        const hidden = block("hidden");
        const after = block("after");
        hidden.visible = false;
        editor.append(list.append(item.append(summary, hidden)), after);

        assert.equal(getAdjacentVisibleBlock(asElement(summary), "down"), asElement(after));
    });

    it("does not navigate from a hidden source", () => {
        const editor = new TestElement().addClass("protyle-wysiwyg");
        const hidden = block("hidden");
        const after = block("after");
        hidden.visible = false;
        editor.append(hidden, after);

        assert.equal(getAdjacentVisibleBlock(asElement(hidden), "down"), false);
    });

    it("treats custom blocks as opaque regardless of their rendered descendants", () => {
        const custom = block("custom", "NodeCustomBlock").addClass("custom-block");
        const innerEditor = new TestElement().addClass("protyle-wysiwyg");
        const innerFolded = block("inner-folded", "NodeCallout").addClass("callout").setAttribute("fold", "1");
        const innerAtomic = block("inner-atomic", "NodeMathBlock");
        const superBlock = block("super", "NodeSuperBlock").addClass("sb");
        custom.append(innerEditor.append(innerFolded.append(innerAtomic)));
        superBlock.append(custom);

        assert.equal(getVisibleBoundaryBlock(asElement(custom), "down"), asElement(custom));
        assert.equal(getVisibleBoundaryBlock(asElement(custom), "up"), asElement(custom));
        assert.equal(getVisibleBoundaryBlock(asElement(superBlock), "up"), asElement(custom));
    });

    it("navigates to the last descendant within the current editable embed", () => {
        const embed = block("embed", "NodeBlockQueryEmbed");
        const result = new TestElement().addClass("protyle-wysiwyg__embed")
            .setAttribute("data-allow-child-operation", "true");
        const list = block("list", "NodeList").addClass("list");
        const firstItem = block("first-item", "NodeListItem").addClass("li");
        const lastItem = block("last-item", "NodeListItem").addClass("li");
        const first = block("first");
        const last = block("last");
        embed.append(result.append(list.append(firstItem.append(first), lastItem.append(last))));

        assert.equal(getVisibleBoundaryBlock(asElement(list), "down"), asElement(first));
        assert.equal(getVisibleBoundaryBlock(asElement(list), "up"), asElement(last));
    });

    it("keeps adjacent navigation within the current editable embed", () => {
        const embed = block("embed", "NodeBlockQueryEmbed");
        const result = new TestElement().addClass("protyle-wysiwyg__embed")
            .setAttribute("data-allow-child-operation", "true");
        const first = block("first");
        const last = block("last");
        embed.append(result.append(first, last));

        assert.equal(getAdjacentVisibleBlock(asElement(first), "down"), asElement(last));
        assert.equal(getAdjacentVisibleBlock(asElement(last), "down"), false);
    });

    it("stops at a nested embed instead of entering its rendered result", () => {
        const outerEmbed = block("outer-embed", "NodeBlockQueryEmbed");
        const outerResult = new TestElement().addClass("protyle-wysiwyg__embed")
            .setAttribute("data-allow-child-operation", "true");
        const list = block("list", "NodeList").addClass("list");
        const nestedEmbed = block("nested-embed", "NodeBlockQueryEmbed");
        const nestedResult = new TestElement().addClass("protyle-wysiwyg__embed")
            .setAttribute("data-allow-child-operation", "true");
        const nestedContent = block("nested-content");
        outerEmbed.append(outerResult.append(list.append(nestedEmbed.append(nestedResult.append(nestedContent)))));

        assert.equal(getVisibleBoundaryBlock(asElement(list), "up"), asElement(nestedEmbed));
    });
});
