import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let getEmbedChildOperationContext: typeof import("./getBlock").getEmbedChildOperationContext;
let getEmbedGutterOperationContext: typeof import("./getBlock").getEmbedGutterOperationContext;

before(async () => {
    Object.assign(globalThis, {
        SIYUAN_VERSION: "test",
        NODE_ENV: "test",
    });
    ({getEmbedChildOperationContext, getEmbedGutterOperationContext} = await import("./getBlock"));
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

    querySelectorAll(selector: string) {
        const nodeID = /^\[data-node-id="(.+)"\]$/.exec(selector)?.[1];
        const matches: TestElement[] = [];
        const visit = (element: TestElement) => {
            element.children.forEach(child => {
                if (nodeID && child.getAttribute("data-node-id") === nodeID) {
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
