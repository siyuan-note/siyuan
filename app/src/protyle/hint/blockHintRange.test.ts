import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    endsWithMultiCharHintPrefix,
    getBlockHintTriggerOffset,
    getBlockRefStaticText,
    shouldCaptureHintUndoFocus,
    shouldIgnoreHintTrigger,
} from "./blockHintRange";

describe("getBlockHintTriggerOffset", () => {
    it("uses the latest overlapping trigger inside existing closing markers", () => {
        assert.equal(getBlockHintTriggerOffset("[[[", "]]", "[[", "]]"), 1);
        assert.equal(getBlockHintTriggerOffset("【【【query", "】】", "【【", "】】"), 1);
    });

    it("replaces exactly the latest trigger in the reported scenario", () => {
        const text = "[[[]]";
        const caretOffset = 3;
        const triggerOffset = getBlockHintTriggerOffset(text.substring(0, caretOffset),
            text.substring(caretOffset), "[[", "]]");
        assert.equal(text.substring(0, triggerOffset) + "reference" +
            text.substring(caretOffset), "[reference]]");
    });

    it("keeps the first trigger when the query starts with an opening marker", () => {
        const text = "[[[电影自习室] 全集";
        const triggerOffset = getBlockHintTriggerOffset(text, "", "[[", "]]");

        assert.equal(triggerOffset, 0);
        assert.equal(text.substring(triggerOffset + 2), "[电影自习室] 全集");
        assert.equal(getBlockHintTriggerOffset("[[[", "]", "[[", "]]"), 0);
        assert.equal(getBlockHintTriggerOffset("【【【", "】", "【【", "】】"), 0);
    });

    it("extracts the query after the latest overlapping trigger", () => {
        const text = "[[[query";
        const triggerOffset = getBlockHintTriggerOffset(text, "]]", "[[", "]]");

        assert.equal(text.substring(triggerOffset + 2), "query");
    });

    it("preserves text after the caret when replacing a block hint", () => {
        const text = "[[query]]tail";
        const caretOffset = 7;
        const triggerOffset = getBlockHintTriggerOffset(text.substring(0, caretOffset),
            text.substring(caretOffset), "[[", "]]");

        assert.equal(text.substring(0, triggerOffset) + "reference" + text.substring(caretOffset),
            "reference]]tail");
    });

    it("includes manually entered closing markers in the query", () => {
        const text = "[[foo]]";
        const triggerOffset = getBlockHintTriggerOffset(text, "", "[[", "]]");

        assert.equal(text.substring(triggerOffset + 2), "foo]]");
    });
});

describe("getBlockRefStaticText", () => {
    it("preserves the complete toolbar selection", () => {
        assert.equal(getBlockRefStaticText("旧的开始", "((", false), "旧的开始");
        assert.equal(getBlockRefStaticText("((literal", "((", false), "((literal");
    });

    it("removes the trigger from an inline block hint", () => {
        assert.equal(getBlockRefStaticText("[[旧的开始", "[[", true), "旧的开始");
        assert.equal(getBlockRefStaticText("((query", "((", true), "query");
    });
});

describe("shouldIgnoreHintTrigger", () => {
    const blockHintKeys = ["((", "[[", "（（", "【【"];

    it("keeps block reference queries intact when slash hints appear inside them", () => {
        assert.equal(shouldIgnoreHintTrigger("[[", "、", blockHintKeys), true);
        assert.equal(shouldIgnoreHintTrigger("((", "/", blockHintKeys), true);
        assert.equal(shouldIgnoreHintTrigger("[[", "#", blockHintKeys), true);
        assert.equal(shouldIgnoreHintTrigger("[[", ":", blockHintKeys), true);
    });

    it("does not block unrelated hint contexts", () => {
        assert.equal(shouldIgnoreHintTrigger("", "、", blockHintKeys), false);
        assert.equal(shouldIgnoreHintTrigger("#", "、", blockHintKeys), true);
        assert.equal(shouldIgnoreHintTrigger("、", "[[", blockHintKeys), false);
    });
});

describe("shouldCaptureHintUndoFocus", () => {
    const blockHintKeys = ["((", "[[", "（（", "【【"];

    it("captures block hint focus in all editors", () => {
        assert.equal(shouldCaptureHintUndoFocus("[[", blockHintKeys, false), true);
    });

    it("captures slash hint focus in lite editors", () => {
        assert.equal(shouldCaptureHintUndoFocus("/", blockHintKeys, true), true);
        assert.equal(shouldCaptureHintUndoFocus("、", blockHintKeys, true), true);
    });

    it("does not change regular editor slash hint focus handling", () => {
        assert.equal(shouldCaptureHintUndoFocus("/", blockHintKeys, false), false);
        assert.equal(shouldCaptureHintUndoFocus("#", blockHintKeys, true), false);
    });
});

describe("endsWithMultiCharHintPrefix", () => {
    const hintKeys = ["((", "【【", "[[", "{{", "#", "/", "、", ":"];

    it("ends the current hint when another multi-character hint starts", () => {
        assert.equal(endsWithMultiCharHintPrefix("2【", hintKeys), true);
        assert.equal(endsWithMultiCharHintPrefix("query[", hintKeys), true);
    });

    it("keeps the current hint active for ordinary query text", () => {
        assert.equal(endsWithMultiCharHintPrefix("2级", hintKeys), false);
        assert.equal(endsWithMultiCharHintPrefix("2", hintKeys), false);
    });
});
