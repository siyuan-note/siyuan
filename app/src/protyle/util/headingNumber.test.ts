import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    buildHeadingNumberStyles,
    headingNumberNeedsSpacing,
    invalidateHeadingNumberMeasurements,
    operationsMayChangeHeadingNumbers,
    operationsMayChangeOutline,
    renderHeadingNumberElements,
    resolveHeadingNumberEnabled,
    transactionsMayChangeRootHeadingNumberSetting
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
    constructor(public name = "", public events?: string[]) {}

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
        this.events?.push(`${this.name}:append`);
        this.appendCount++;
        this.appendedElement = element;
        element.parentElement = this;
        return element;
    }

    getBoundingClientRect() {
        this.parentElement?.events?.push(`${this.parentElement.name}:measure`);
        return {width: 12};
    }

    remove() {
        this.parentElement?.events?.push(`${this.parentElement.name}:remove`);
        if (this.parentElement?.appendedElement === this) {
            this.parentElement.appendedElement = null;
        }
        this.parentElement = null;
    }
}

describe("resolveHeadingNumberEnabled", () => {
    it("优先使用文档设置并在默认状态下继承全局设置", () => {
        assert.equal(resolveHeadingNumberEnabled("true", false), true);
        assert.equal(resolveHeadingNumberEnabled("false", true), false);
        assert.equal(resolveHeadingNumberEnabled("", true), true);
        assert.equal(resolveHeadingNumberEnabled(null, false), false);
    });
});

describe("headingNumberNeedsSpacing", () => {
    it("全角标点结尾不添加额外间距", () => {
        assert.equal(headingNumberNeedsSpacing("一、"), false);
        assert.equal(headingNumberNeedsSpacing("（一）"), false);
        assert.equal(headingNumberNeedsSpacing("1）"), false);
        assert.equal(headingNumberNeedsSpacing("1.2.3"), true);
        assert.equal(headingNumberNeedsSpacing("1."), true);
        assert.equal(headingNumberNeedsSpacing("①"), true);
    });
});

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

        invalidateHeadingNumberMeasurements();
        renderHeadingNumberElements(root as unknown as Element, {heading: "1"});

        assert.equal(heading.appendCount, 2);

        const emptyResult = renderHeadingNumberElements(root as unknown as Element, {});

        assert.equal(heading.getAttribute("data-heading-number"), null);
        assert.equal(editable.style.getPropertyValue("--b3-protyle-heading-number-width"), "");
        assert.deepEqual(emptyResult.styles, []);
    });

    it("使用内边距对齐标题正文和续行", () => {
        const css = buildHeadingNumberStyles("scope", [
            {id: "heading", number: "1.1", offset: "12px"},
            {id: "chinese-heading", number: "一、", offset: "24px"},
        ]);

        assert.match(css, /data-heading-number-scope="scope"/);
        assert.match(css, /data-node-id="heading"/);
        assert.match(css, /--b3-protyle-heading-number:"1\.1"/);
        assert.match(css, /data-node-id="heading"[^}]*calc\(12px \+ \.5em\)/);
        assert.match(css, /data-node-id="chinese-heading"[^}]*heading-number-offset:24px/);
        assert.doesNotMatch(css, /calc\([^)]*\+ 0px\)/);
        assert.match(css, /padding-inline-start:var\(--b3-protyle-heading-number-offset\)/);
        assert.match(css, />:first-child\[contenteditable]::before/);
        assert.doesNotMatch(css, />\[contenteditable]/);
        assert.doesNotMatch(css, /NodeHeading"]::after/);
        assert.doesNotMatch(css, /text-indent/);
        assert.equal(buildHeadingNumberStyles("scope", []), "");
    });

    it("批量插入、测量并移除编号测量节点", () => {
        const events: string[] = [];
        const root = new TestElement();
        const firstHeading = new TestElement("first", events);
        const secondHeading = new TestElement("second", events);
        [firstHeading, secondHeading].forEach((heading, index) => {
            heading.setAttribute("data-node-id", `heading-${index + 1}`);
            heading.setAttribute("data-type", "NodeHeading");
            heading.setAttribute("data-subtype", "h1");
            heading.parentElement = root;
            heading.editElement = new TestElement();
            heading.editElement.parentElement = heading;
        });
        root.queryElements = [firstHeading, secondHeading];

        renderHeadingNumberElements(root as unknown as Element, {
            "heading-1": "1",
            "heading-2": "2",
        });

        assert.deepEqual(events, [
            "first:append",
            "second:append",
            "first:measure",
            "second:measure",
            "first:remove",
            "second:remove",
        ]);
    });
});

describe("operationsMayChangeHeadingNumbers", () => {
    it("文档标题编号设置变化时使编号失效", () => {
        const changed = operationsMayChangeHeadingNumbers([{
            action: "updateAttrs",
            data: {
                old: {"custom-sy-heading-number": "false"},
                new: {"custom-sy-heading-number": "true"},
            },
        }]);

        assert.equal(changed, true);
    });

    it("其他文档属性变化时不使编号失效", () => {
        const changed = operationsMayChangeHeadingNumbers([{
            action: "updateAttrs",
            data: {
                old: {title: "Old"},
                new: {title: "New"},
            },
        }]);

        assert.equal(changed, false);
    });

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

    it("未加载容器移除标题时使编号失效", () => {
        const changed = operationsMayChangeHeadingNumbers([{
            action: "update",
            id: "unloaded-list",
            data: '<div data-node-id="unloaded-list" data-type="NodeList"></div>',
        }]);

        assert.equal(changed, true);
    });
});

describe("operationsMayChangeOutline", () => {
    it("缺少操作列表时不刷新大纲", () => {
        assert.equal(operationsMayChangeOutline(null), false);
        assert.equal(operationsMayChangeOutline(undefined), false);
    });

    it("文档标题编号设置变化时刷新大纲", () => {
        const changed = operationsMayChangeOutline([{
            action: "updateAttrs",
            data: {
                old: {"custom-sy-heading-number": "true"},
                new: {},
            },
        }]);

        assert.equal(changed, true);
    });

    it("API 更新容器并移除标题时刷新大纲", () => {
        const changed = operationsMayChangeOutline([{
            action: "update",
            id: "list-item",
            data: '<div data-node-id="list-item" data-type="NodeListItem"></div>',
        }]);

        assert.equal(changed, true);
    });

    it("已有标题转换为普通块时刷新大纲", () => {
        const changed = operationsMayChangeOutline([{
            action: "update",
            id: "heading",
            data: '<div data-node-id="heading" data-type="NodeParagraph"></div>',
        }], new Set(["heading"]));

        assert.equal(changed, true);
    });

    it("普通块内容更新时不刷新大纲", () => {
        const changed = operationsMayChangeOutline([{
            action: "update",
            id: "paragraph",
            data: '<div data-node-id="paragraph" data-type="NodeParagraph"></div>',
        }]);

        assert.equal(changed, false);
    });
});

describe("transactionsMayChangeRootHeadingNumberSetting", () => {
    it("当前根文档标题编号设置变化时刷新大纲", () => {
        const changed = transactionsMayChangeRootHeadingNumberSetting([{
            doOperations: [{
                action: "updateAttrs",
                id: "root",
                data: {
                    old: {"custom-sy-heading-number": "true"},
                    new: {"custom-sy-heading-number": "false"},
                },
            }],
        }], "root");

        assert.equal(changed, true);
    });

    it("忽略其他文档及无关属性事务", () => {
        const otherDocument = transactionsMayChangeRootHeadingNumberSetting([{
            doOperations: [{
                action: "updateAttrs",
                id: "other-root",
                data: {
                    old: {"custom-sy-heading-number": "true"},
                    new: {"custom-sy-heading-number": "false"},
                },
            }],
        }], "root");
        const unrelatedAttribute = transactionsMayChangeRootHeadingNumberSetting([{
            undoOperations: [{
                action: "updateAttrs",
                id: "root",
                data: {
                    old: {"custom-test": "old"},
                    new: {"custom-test": "new"},
                },
            }],
        }], "root");

        assert.equal(otherDocument, false);
        assert.equal(unrelatedAttribute, false);
    });
});
