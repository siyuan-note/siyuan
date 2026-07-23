import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    buildHeadingNumberStyles,
    operationsMayChangeHeadingNumbers,
    renderHeadingNumberElements
} from "./headingNumberCore";

class TestElement {
    private attributes = new Map<string, string>();
    private classes = new Set<string>();
    parentElement: TestElement | null = null;
    editElement: TestElement | null = null;
    appendedElement: TestElement | null = null;
    appendCount = 0;
    queryElements: TestElement[] = [];
    textContent = "";
    styleProperties = new Map<string, string>();
    style = {
        getPropertyValue: (name: string) => this.styleProperties.get(name) || "",
        removeProperty: (name: string) => this.styleProperties.delete(name),
        setProperty: (name: string, value: string) => this.styleProperties.set(name, value),
    };
    ownerDocument = {
        createElement: () => new TestElement(),
    };
    classList = {
        add: (name: string) => this.classes.add(name),
        contains: (name: string) => this.classes.has(name),
        remove: (name: string) => this.classes.delete(name),
    };

    get firstElementChild() {
        return this.editElement;
    }

    getAttribute(name: string) {
        return this.attributes.get(name) || null;
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }

    removeAttribute(name: string) {
        this.attributes.delete(name);
    }

    querySelector() {
        return this.editElement;
    }

    querySelectorAll() {
        return this.queryElements;
    }

    closest(): null {
        return null;
    }

    appendChild(element: TestElement) {
        this.appendCount++;
        this.appendedElement = element;
        element.parentElement = this;
        return element;
    }

    getBoundingClientRect() {
        return {width: 12};
    }

    remove() {
        if (this.parentElement?.appendedElement === this) {
            this.parentElement.appendedElement = null;
        }
        this.parentElement = null;
    }
}

describe("renderHeadingNumbers", () => {
    it("生成不依赖标题 DOM 状态的编号样式", () => {
        const root = new TestElement();
        const container = new TestElement();
        const heading = new TestElement();
        const editable = new TestElement();
        container.setAttribute("data-node-id", "container");
        heading.setAttribute("data-node-id", "heading");
        heading.setAttribute("data-type", "NodeHeading");
        heading.setAttribute("data-subtype", "h1");
        heading.setAttribute("data-heading-number", "legacy");
        heading.parentElement = container;
        container.parentElement = root;
        heading.editElement = editable;
        editable.parentElement = heading;
        editable.style.setProperty("--b3-protyle-heading-number-width", "10px");
        root.queryElements = [heading];

        const result = renderHeadingNumberElements(root as unknown as Element, {heading: "1"});

        assert.equal(heading.getAttribute("data-heading-number"), null);
        assert.equal(editable.getAttribute("data-heading-number"), null);
        assert.equal(editable.style.getPropertyValue("--b3-protyle-heading-number-width"), "");
        assert.equal(heading.appendedElement, null);
        assert.equal(heading.firstElementChild, editable);
        assert.equal(result.containers.has("container"), true);
        assert.deepEqual(result.styles, [{id: "heading", number: "1", offset: "12px"}]);

        renderHeadingNumberElements(root as unknown as Element, {heading: "1"});

        assert.equal(heading.appendCount, 1);

        const emptyResult = renderHeadingNumberElements(root as unknown as Element, {});

        assert.equal(heading.getAttribute("data-heading-number"), null);
        assert.equal(editable.style.getPropertyValue("--b3-protyle-heading-number-width"), "");
        assert.deepEqual(emptyResult.styles, []);
    });

    it("使用内边距对齐标题正文和续行", () => {
        const css = buildHeadingNumberStyles("scope", [{id: "heading", number: "1.1", offset: "12px"}]);

        assert.match(css, /data-heading-number-scope="scope"/);
        assert.match(css, /data-node-id="heading"/);
        assert.match(css, /--b3-protyle-heading-number:"1\.1"/);
        assert.match(css, /padding-inline-start:var\(--b3-protyle-heading-number-offset\)/);
        assert.match(css, />:first-child\[contenteditable]::before/);
        assert.doesNotMatch(css, />\[contenteditable]/);
        assert.doesNotMatch(css, /NodeHeading"]::after/);
        assert.doesNotMatch(css, /text-indent/);
        assert.equal(buildHeadingNumberStyles("scope", []), "");
    });
});

describe("operationsMayChangeHeadingNumbers", () => {
    it("更新并移除容器中的标题时使编号失效", () => {
        const changed = operationsMayChangeHeadingNumbers(
            [{action: "update", id: "container", data: "<div></div>"}],
            {},
            {},
            new Set(["container"]),
        );

        assert.equal(changed, true);
    });

    it("普通块内容更新不使编号失效", () => {
        const changed = operationsMayChangeHeadingNumbers([
            {action: "update", id: "paragraph", data: "<div></div>"},
        ]);

        assert.equal(changed, false);
    });
});
