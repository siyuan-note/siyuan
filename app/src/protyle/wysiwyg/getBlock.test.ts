import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let getEmbedChildOperationContext: typeof import("./getBlock").getEmbedChildOperationContext;
let getEmbedGutterOperationContext: typeof import("./getBlock").getEmbedGutterOperationContext;
let getContenteditableElement: typeof import("./getBlock").getContenteditableElement;
let isNotEditBlock: typeof import("./getBlock").isNotEditBlock;

before(async () => {
    Object.assign(globalThis, {
        SIYUAN_VERSION: "test",
        NODE_ENV: "test",
    });
    ({getContenteditableElement, getEmbedChildOperationContext, getEmbedGutterOperationContext, isNotEditBlock} =
        await import("./getBlock"));
});

class TestElement {
    nodeType = 1;
    tagName = "DIV";
    nodeName = "DIV";
    parentElement: TestElement | null = null;
    children: TestElement[] = [];
    attributes = new Map<string, string>();
    classes = new Set<string>();
    classList = {
        contains: (className: string) => this.classes.has(className),
    };

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

    get firstElementChild() {
        return this.children[0] || null;
    }

    querySelector(selector: string) {
        if (selector === ":scope > .tab-item-content > [data-node-id]") {
            return this.children.find(child => child.classes.has("tab-item-content"))?.children
                .find(child => child.hasAttribute("data-node-id")) || null;
        }
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector: string) {
        const nodeID = /^\[data-node-id="(.+)"\]$/.exec(selector)?.[1];
        const matches: TestElement[] = [];
        const visit = (element: TestElement) => {
            element.children.forEach(child => {
                if ((selector === "[data-node-id]" && child.hasAttribute("data-node-id")) ||
                    (nodeID && child.getAttribute("data-node-id") === nodeID)) {
                    matches.push(child);
                }
                visit(child);
            });
        };
        visit(this);
        return matches;
    }
}

const asNode = (element: TestElement) => element as unknown as Node;

const createEmbed = (allowChildOperation: boolean) => {
    const editor = new TestElement().addClass("protyle-wysiwyg");
    const embedBlock = new TestElement()
        .setAttribute("data-node-id", "20260817120000-embed")
        .setAttribute("data-type", "NodeBlockQueryEmbed");
    const result = new TestElement()
        .addClass("protyle-wysiwyg__embed")
        .setAttribute("data-id", "20260817120001-target");
    if (allowChildOperation) {
        result.setAttribute("data-allow-child-operation", "true");
    }
    const target = new TestElement()
        .setAttribute("data-node-id", "20260817120001-target")
        .setAttribute("data-type", "NodeBlockquote");
    const child = new TestElement()
        .setAttribute("data-node-id", "20260817120002-child")
        .setAttribute("data-type", "NodeParagraph");
    editor.append(embedBlock.append(result.append(target.append(child))));
    return {target, child};
};

describe("getEmbedGutterOperationContext", () => {
    it("shows a gutter for a queried target block without enabling child operations", () => {
        const {target} = createEmbed(false);
        const context = getEmbedGutterOperationContext(asNode(target));

        assert.equal(context?.targetElement, target as unknown as Element);
        assert.equal(context?.allowChildOperation, false);
        assert.equal(getEmbedChildOperationContext(asNode(target)), undefined);
    });

    it("does not expose nested block gutters when child operations are unavailable", () => {
        const {child} = createEmbed(false);

        assert.equal(getEmbedGutterOperationContext(asNode(child)), undefined);
    });

    it("keeps nested block gutters available for supported container queries", () => {
        const {child} = createEmbed(true);
        const context = getEmbedGutterOperationContext(asNode(child));

        assert.equal(context?.allowChildOperation, true);
        assert.equal(getEmbedChildOperationContext(asNode(child))?.targetElement, context?.targetElement);
    });
});

describe("isNotEditBlock", () => {
    it("treats custom blocks as non-editable removal boundaries", () => {
        const customBlock = new TestElement().setAttribute("data-type", "NodeCustomBlock");
        const paragraph = new TestElement().setAttribute("data-type", "NodeParagraph");

        assert.equal(isNotEditBlock(customBlock as unknown as Element), true);
        assert.equal(isNotEditBlock(paragraph as unknown as Element), false);
    });
});

describe("getContenteditableElement", () => {
    it("uses the active item when a tab block is the first document block", () => {
        const editor = new TestElement().addClass("protyle-wysiwyg");
        const tabs = new TestElement().addClass("tabs")
            .setAttribute("data-node-id", "tabs")
            .setAttribute("data-type", "NodeTabs")
            .setAttribute("tabs-active-id", "second");
        const createItem = (id: string, hidden: boolean) => {
            const item = new TestElement().addClass("tab-item")
                .setAttribute("data-node-id", id)
                .setAttribute("data-type", "NodeTabItem")
                .setAttribute("data-tabs-hidden", String(hidden));
            const content = new TestElement().addClass("tab-item-content");
            const paragraph = new TestElement()
                .setAttribute("data-node-id", `${id}-paragraph`)
                .setAttribute("data-type", "NodeParagraph");
            const editable = new TestElement();
            item.append(content.append(paragraph.append(editable)));
            return {item, editable};
        };
        const first = createItem("first", true);
        const second = createItem("second", false);
        editor.append(tabs.append(first.item, second.item));

        assert.equal(getContenteditableElement(editor as unknown as Element), second.editable as unknown as Element);
    });
});
