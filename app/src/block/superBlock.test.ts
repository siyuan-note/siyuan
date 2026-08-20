import * as assert from "node:assert/strict";
import test from "node:test";
import {getHorizontalSuperBlockChild} from "./superBlock";

class TestElement {
    parentElement?: TestElement;
    private attributes: Record<string, string>;

    constructor(attributes: Record<string, string> = {}) {
        this.attributes = attributes;
    }

    append(child: TestElement) {
        child.parentElement = this;
        return child;
    }

    getAttribute(name: string) {
        return this.attributes[name] ?? null;
    }

    hasAttribute(name: string) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name);
    }
}

let nextID = 0;

const block = (type = "NodeParagraph") => new TestElement({
    "data-node-id": (++nextID).toString(),
    "data-type": type,
});

const superBlock = (layout: "col" | "row") => new TestElement({
    "data-node-id": (++nextID).toString(),
    "data-type": "NodeSuperBlock",
    "data-sb-layout": layout,
});

test("returns a direct child of a horizontal super block", () => {
    const horizontal = superBlock("col");
    const column = horizontal.append(block());

    assert.equal(getHorizontalSuperBlockChild(column as unknown as Element), column);
});

test("returns the nearest direct child when the current block is nested", () => {
    const horizontal = superBlock("col");
    const column = horizontal.append(superBlock("row"));
    const nested = column.append(block());

    assert.equal(getHorizontalSuperBlockChild(nested as unknown as Element), column);
});

test("uses the nearest horizontal super block", () => {
    const outerHorizontal = superBlock("col");
    const outerColumn = outerHorizontal.append(superBlock("row"));
    const innerHorizontal = outerColumn.append(superBlock("col"));
    const innerColumn = innerHorizontal.append(block());
    const nested = innerColumn.append(block());

    assert.equal(getHorizontalSuperBlockChild(nested as unknown as Element), innerColumn);
});

test("returns undefined outside a horizontal super block", () => {
    const vertical = superBlock("row");
    const nested = vertical.append(block());

    assert.equal(getHorizontalSuperBlockChild(nested as unknown as Element), undefined);
});

test("does not search outside the editor boundary", () => {
    const horizontal = superBlock("col");
    const column = horizontal.append(block());
    const editor = column.append(new TestElement());
    const nested = editor.append(block());

    assert.equal(getHorizontalSuperBlockChild(
        nested as unknown as Element,
        editor as unknown as Element,
    ), undefined);
});
