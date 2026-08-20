import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isCodeBlockFenceBeforeCaret} from "./codeBlockEnter";

describe("isCodeBlockFenceBeforeCaret", () => {
    it("requires the complete opening fence before the caret", () => {
        assert.equal(isCodeBlockFenceBeforeCaret("```11111", 0, true), false);
        assert.equal(isCodeBlockFenceBeforeCaret("```11111", 1, true), false);
        assert.equal(isCodeBlockFenceBeforeCaret("```11111", 2, true), false);
        assert.equal(isCodeBlockFenceBeforeCaret("```11111", 3, true), true);
    });

    it("includes additional marker characters in the opening fence", () => {
        assert.equal(isCodeBlockFenceBeforeCaret("````code", 3, true), false);
        assert.equal(isCodeBlockFenceBeforeCaret("````code", 4, true), true);
    });

    it("supports leading whitespace and fences after a newline", () => {
        assert.equal(isCodeBlockFenceBeforeCaret("  ~~~shell", 4, true), false);
        assert.equal(isCodeBlockFenceBeforeCaret("  ~~~shell", 5, true), true);
        assert.equal(isCodeBlockFenceBeforeCaret("text\n```js", 7, true), false);
        assert.equal(isCodeBlockFenceBeforeCaret("text\n```js", 8, true), true);
    });

    it("respects the middle dot setting", () => {
        assert.equal(isCodeBlockFenceBeforeCaret("···code", 3, true), true);
        assert.equal(isCodeBlockFenceBeforeCaret("···code", 3, false), false);
    });

    it("ignores text without a code block fence", () => {
        assert.equal(isCodeBlockFenceBeforeCaret("paragraph", 9, true), false);
    });
});
