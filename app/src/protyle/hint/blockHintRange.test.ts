import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getBlockHintTriggerOffset} from "./blockHintRange";

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
