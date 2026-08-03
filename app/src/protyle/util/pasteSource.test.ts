import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {shouldPreservePastedBlockStructure} from "./pasteSource";

const element = (type: string, selected = false) => ({
    classList: {
        contains(className: string) {
            return selected && className === "protyle-wysiwyg--select";
        }
    },
    getAttribute(attribute: string) {
        return attribute === "data-type" ? type : null;
    }
}) as unknown as Element;

describe("shouldPreservePastedBlockStructure", () => {
    it("preserves a selection containing complete blocks", () => {
        assert.equal(shouldPreservePastedBlockStructure([
            element("NodeParagraph"),
            element("NodeParagraph", true)
        ]), true);
    });

    it("preserves a cross-block text selection that starts with a heading", () => {
        assert.equal(shouldPreservePastedBlockStructure([
            element("NodeHeading"),
            element("NodeHeading")
        ]), true);
    });

    it("merges a cross-block paragraph selection into the target block", () => {
        assert.equal(shouldPreservePastedBlockStructure([
            element("NodeParagraph"),
            element("NodeParagraph")
        ]), false);
    });
});
