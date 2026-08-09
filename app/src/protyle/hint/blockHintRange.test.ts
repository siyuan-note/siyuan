import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getBlockHintCloseLength, getBlockHintTriggerOffset} from "./blockHintRange";

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
        const closeLength = getBlockHintCloseLength(text.substring(0, triggerOffset),
            text.substring(caretOffset), "[[", "]]");

        assert.equal(text.substring(0, triggerOffset) + "reference" +
            text.substring(caretOffset + closeLength), "[reference]]");
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
});

describe("getBlockHintCloseLength", () => {
    it("preserves closing markers paired before the actual trigger", () => {
        assert.equal(getBlockHintCloseLength("[", "]]", "[[", "]]"), 0);
        assert.equal(getBlockHintCloseLength("【", "】】", "【【", "】】"), 0);
    });

    it("removes an automatically completed closing marker", () => {
        assert.equal(getBlockHintCloseLength("text", "]]tail", "[[", "]]"), 2);
        assert.equal(getBlockHintCloseLength("text", "））tail", "（（", "））"), 2);
    });

    it("does not remove unrelated closing markers", () => {
        assert.equal(getBlockHintCloseLength("text", "tail]]", "[[", "]]"), 0);
        assert.equal(getBlockHintCloseLength("text))", "tail", "((", "))"), 0);
    });

    it("accounts for balanced pairs before the trigger", () => {
        assert.equal(getBlockHintCloseLength("[done]", "]]", "[[", "]]"), 2);
        assert.equal(getBlockHintCloseLength("(done)", "))", "((", "))"), 2);
    });
});
