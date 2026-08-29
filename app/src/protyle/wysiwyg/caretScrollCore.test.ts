import {strict as assert} from "node:assert";
import {describe, it} from "node:test";
import {getCaretScrollDelta} from "./caretScrollCore";

const geometry = {
    caretTop: 100,
    caretHeight: 20,
    viewportTop: 0,
    viewportHeight: 200,
    lineHeight: 20,
    surroundingLines: 2,
};

describe("getCaretScrollDelta", () => {
    it("does not scroll while the caret remains inside the margin", () => {
        assert.equal(getCaretScrollDelta(geometry, "up"), 0);
        assert.equal(getCaretScrollDelta(geometry, "down"), 0);
    });

    it("scrolls upward by the amount crossing the top margin", () => {
        assert.equal(getCaretScrollDelta({...geometry, caretTop: 30}, "up"), -10);
    });

    it("scrolls downward by the amount crossing the bottom margin", () => {
        assert.equal(getCaretScrollDelta({...geometry, caretTop: 150}, "down"), 10);
    });

    it("does not scroll when the setting is disabled", () => {
        assert.equal(getCaretScrollDelta({...geometry, caretTop: 0, surroundingLines: 0}, "up"), 0);
        assert.equal(getCaretScrollDelta({...geometry, caretTop: 180, surroundingLines: 0}, "down"), 0);
    });

    it("limits the margin to half of a small viewport", () => {
        const smallViewport = {...geometry, caretTop: 0, viewportHeight: 60, surroundingLines: 20};
        assert.equal(getCaretScrollDelta(smallViewport, "up"), -20);
        assert.equal(getCaretScrollDelta({...smallViewport, caretTop: 40}, "down"), 20);
    });

    it("accounts for a viewport that does not start at zero", () => {
        const offsetViewport = {...geometry, caretTop: 120, viewportTop: 100};
        assert.equal(getCaretScrollDelta(offsetViewport, "up"), -20);
        assert.equal(getCaretScrollDelta({...offsetViewport, caretTop: 250}, "down"), 10);
    });
});
