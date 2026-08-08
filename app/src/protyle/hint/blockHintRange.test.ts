import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getBlockHintRangeAdjustment} from "./blockHintRange";

describe("getBlockHintRangeAdjustment", () => {
    it("preserves brackets outside the trigger range", () => {
        const text = "[[[]]";
        // getKey 会将三连开括号的起点定位到第一个字符
        const triggerOffset = 0;
        const caretOffset = 3;
        const adjustment = getBlockHintRangeAdjustment(text.substring(0, triggerOffset),
            text.substring(triggerOffset, caretOffset), text.substring(caretOffset), "[[", "]]");

        assert.equal(text.substring(0, triggerOffset + adjustment.preserveOpenLength) + "reference" +
            text.substring(caretOffset + adjustment.closeLength), "[[reference]]");
        assert.equal(text.substring(triggerOffset + adjustment.preserveOpenLength, caretOffset)
            .substring(adjustment.removeOpenLength), "");
    });

    it("removes an automatically completed closing marker", () => {
        assert.deepEqual(getBlockHintRangeAdjustment("text", "[[query", "]]tail", "[[", "]]"), {
            preserveOpenLength: 0,
            removeOpenLength: 2,
            closeLength: 2,
        });
        assert.deepEqual(getBlockHintRangeAdjustment("text", "（（query", "））tail", "（（", "））"), {
            preserveOpenLength: 0,
            removeOpenLength: 2,
            closeLength: 2,
        });
    });

    it("preserves repeated existing pairs around the inserted reference", () => {
        assert.deepEqual(getBlockHintRangeAdjustment("", "【【【query", "】】", "【【", "】】"), {
            preserveOpenLength: 2,
            removeOpenLength: 1,
            closeLength: 0,
        });
    });

    it("removes only the newly entered opening marker from static reference text", () => {
        const text = "[[[query]]";
        const caretOffset = 8;
        const adjustment = getBlockHintRangeAdjustment("", text.substring(0, caretOffset),
            text.substring(caretOffset), "[[", "]]");
        const selectedText = text.substring(adjustment.preserveOpenLength,
            caretOffset + adjustment.closeLength);

        assert.equal(selectedText.substring(adjustment.removeOpenLength,
            selectedText.length - adjustment.closeLength), "query");
    });

    it("does not remove unrelated closing markers", () => {
        assert.deepEqual(getBlockHintRangeAdjustment("text", "[[query", "tail]]", "[[", "]]"), {
            preserveOpenLength: 0,
            removeOpenLength: 2,
            closeLength: 0,
        });
        assert.deepEqual(getBlockHintRangeAdjustment("text))", "((query", "tail", "((", "))"), {
            preserveOpenLength: 0,
            removeOpenLength: 2,
            closeLength: 0,
        });
    });

    it("accounts for balanced pairs before the trigger", () => {
        assert.deepEqual(getBlockHintRangeAdjustment("[done]", "[[query", "]]", "[[", "]]"), {
            preserveOpenLength: 0,
            removeOpenLength: 2,
            closeLength: 2,
        });
        assert.deepEqual(getBlockHintRangeAdjustment("(done)", "((query", "))", "((", "))"), {
            preserveOpenLength: 0,
            removeOpenLength: 2,
            closeLength: 2,
        });
    });
});
