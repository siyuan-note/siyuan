import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {operationsMayChangeHeadingNumbers, renderHeadingNumberElements} from "./headingNumberCore";

class TestElement {
    private attributes = new Map<string, string>();
    parentElement: TestElement | null = null;
    editElement: TestElement | null = null;
    queryElements: TestElement[] = [];

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
}

describe("renderHeadingNumbers", () => {
    it("将编号属性设置在读取该属性的可编辑节点上", () => {
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
        root.queryElements = [heading];

        const result = renderHeadingNumberElements(root as unknown as Element, {heading: "1"});

        assert.equal(heading.getAttribute("data-heading-number"), null);
        assert.equal(editable.getAttribute("data-heading-number"), "1");
        assert.equal(result.containers.has("container"), true);
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
