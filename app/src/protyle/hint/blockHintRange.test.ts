import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getBlockHintCloseLength} from "./blockHintRange";

describe("getBlockHintCloseLength", () => {
    it("preserves brackets outside the trigger range", () => {
        const text = "[[[]]";
        const triggerOffset = 1;
        const caretOffset = 3;
        const closeLength = getBlockHintCloseLength(text.substring(0, triggerOffset),
            text.substring(caretOffset), "[[", "]]");

        assert.equal(text.substring(0, triggerOffset) + "reference" +
            text.substring(caretOffset + closeLength), "[reference]]");
    });

    it("removes an automatically completed closing marker", () => {
        assert.equal(getBlockHintCloseLength("text", "]]tail", "[[", "]]"), 2);
        assert.equal(getBlockHintCloseLength("text", "））tail", "（（", "））"), 2);
    });

    it("does not remove closing markers after an unmatched opening marker", () => {
        assert.equal(getBlockHintCloseLength("[", "]]", "[[", "]]"), 0);
        assert.equal(getBlockHintCloseLength("[[", "]]]", "[[", "]]"), 0);
        assert.equal(getBlockHintCloseLength("【", "】】", "【【", "】】"), 0);
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
