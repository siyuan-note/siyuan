import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let isEmptyParagraph: typeof import("./emptyTextBlock").isEmptyParagraph;
let isEmptyTextBlock: typeof import("./emptyTextBlock").isEmptyTextBlock;

before(async () => {
    Object.assign(globalThis, {
        SIYUAN_VERSION: "test",
        NODE_ENV: "test",
    });
    ({isEmptyParagraph, isEmptyTextBlock} = await import("./emptyTextBlock"));
});

class TestEditableElement {
    constructor(public textContent: string, public childTags: string[] = []) {
    }

    get childElementCount() {
        return this.childTags.length;
    }

    cloneNode() {
        return new TestEditableElement(this.textContent, [...this.childTags]);
    }

    querySelectorAll(selector: string) {
        if (selector !== "br, wbr") {
            return [];
        }
        return this.childTags.filter(tag => tag === "br" || tag === "wbr").map(tag => ({
            remove: () => {
                const index = this.childTags.indexOf(tag);
                if (index > -1) {
                    this.childTags.splice(index, 1);
                }
            },
        }));
    }
}

class TestBlockElement {
    classList = {
        contains: () => false,
    };

    constructor(public type: string, public firstElementChild: TestEditableElement) {
    }

    getAttribute(name: string) {
        if (name === "data-type") {
            return this.type;
        }
        return name === "data-node-id" ? "20260904180000-test" : null;
    }
}

const block = (type: string, text = "", childTags: string[] = []) =>
    new TestBlockElement(type, new TestEditableElement(text, childTags)) as unknown as Element;

describe("empty text blocks", () => {
    it("recognizes empty paragraphs without changing paragraph semantics", () => {
        assert.equal(isEmptyParagraph(block("NodeParagraph", "", ["wbr"])), true);
        assert.equal(isEmptyTextBlock(block("NodeParagraph", "", ["wbr"])), true);
        assert.equal(isEmptyParagraph(block("NodeHeading", "", ["wbr"])), false);
    });

    it("recognizes empty headings as caret navigation targets", () => {
        assert.equal(isEmptyTextBlock(block("NodeHeading", "", ["wbr"])), true);
        assert.equal(isEmptyTextBlock(block("NodeHeading", "\u200b")), true);
    });

    it("does not treat content or other block types as empty text blocks", () => {
        assert.equal(isEmptyTextBlock(block("NodeHeading", "heading")), false);
        assert.equal(isEmptyTextBlock(block("NodeHeading", "", ["span"])), false);
        assert.equal(isEmptyTextBlock(block("NodeCodeBlock")), false);
    });
});
