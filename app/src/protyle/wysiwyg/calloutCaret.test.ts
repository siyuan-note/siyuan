import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let getCalloutTitleNavigationTarget: typeof import("./calloutCaret").getCalloutTitleNavigationTarget;

before(async () => {
    Object.assign(globalThis, {
        SIYUAN_VERSION: "test",
        NODE_ENV: "test",
    });
    ({getCalloutTitleNavigationTarget} = await import("./calloutCaret"));
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

    querySelector(selector: string) {
        if (selector !== ":scope > .callout-info > .callout-title") {
            return null;
        }
        const infoElement = this.children.find(element => element.classes.has("callout-info"));
        return infoElement?.children.find(element => element.classes.has("callout-title")) || null;
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

const createCallout = () => {
    const editor = new TestElement().addClass("protyle-wysiwyg");
    const callout = block("callout", "NodeCallout").addClass("callout");
    const info = new TestElement().addClass("callout-info");
    const title = new TestElement().addClass("callout-title");
    const content = new TestElement().addClass("callout-content");
    const first = block("first");
    const second = block("second");
    editor.append(callout.append(info.append(title), content.append(first, second)));
    return {editor, callout, title, first, second};
};

describe("getCalloutTitleNavigationTarget", () => {
    it("moves upward from the first callout content block to the title", () => {
        const {title, first} = createCallout();

        assert.equal(getCalloutTitleNavigationTarget(asElement(first), false, "ArrowUp"), asElement(title));
    });

    it("keeps upward navigation between callout content blocks unchanged", () => {
        const {second} = createCallout();

        assert.equal(getCalloutTitleNavigationTarget(asElement(second), false, "ArrowUp"), undefined);
    });

    it("moves upward from the first leaf in a callout container to the title", () => {
        const {title, first, callout} = createCallout();
        const content = callout.children[1];
        const list = block("list", "NodeList").addClass("list");
        const item = block("item", "NodeListItem").addClass("li");
        content.children = [];
        content.append(list.append(item.append(first)));

        assert.equal(getCalloutTitleNavigationTarget(asElement(first), false, "ArrowUp"), asElement(title));
    });

    it("moves downward into the title of an adjacent callout", () => {
        const {callout, title} = createCallout();
        const previous = block("previous");

        assert.equal(getCalloutTitleNavigationTarget(asElement(previous), asElement(callout), "ArrowDown"),
            asElement(title));
    });

    it("finds a callout at the beginning of an adjacent container", () => {
        const {callout, title} = createCallout();
        const list = block("list", "NodeList").addClass("list");
        const item = block("item", "NodeListItem").addClass("li");
        list.append(item.append(callout));

        assert.equal(getCalloutTitleNavigationTarget(asElement(block("previous")), asElement(list), "ArrowDown"),
            asElement(title));
    });

    it("finds a callout nested through multiple adjacent containers", () => {
        const {callout, title} = createCallout();
        const list = block("list", "NodeList").addClass("list");
        const item = block("item", "NodeListItem").addClass("li");
        const quote = block("quote", "NodeBlockquote").addClass("bq");
        list.append(item.append(quote.append(callout)));

        assert.equal(getCalloutTitleNavigationTarget(asElement(block("previous")), asElement(list), "ArrowDown"),
            asElement(title));
    });
});
