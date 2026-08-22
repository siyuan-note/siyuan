import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getMultilineInputText} from "./multilineInput";

describe("multiline input", () => {
    it("accepts text, replacement, and composition input", () => {
        ["insertText", "insertReplacementText", "insertCompositionText"].forEach(inputType => {
            assert.equal(getMultilineInputText(inputType, "aaa\nbbb"), "aaa\nbbb");
        });
    });

    it("normalizes line separators", () => {
        assert.equal(getMultilineInputText("insertText", "a\r\nb\rc\u2028d\u2029e"), "a\nb\nc\nd\ne");
    });

    it("ignores ordinary and line break input", () => {
        assert.equal(getMultilineInputText("insertText", "aaa"), undefined);
        assert.equal(getMultilineInputText("insertLineBreak", "aaa\nbbb"), undefined);
        assert.equal(getMultilineInputText("insertText", null), undefined);
    });
});
