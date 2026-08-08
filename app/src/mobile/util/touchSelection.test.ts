import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {hasVisibleSelectionText} from "./touchSelection";

describe("mobile touch selection", () => {
    it("rejects selections containing only block placeholders", () => {
        assert.equal(hasVisibleSelectionText("\u200b"), false);
        assert.equal(hasVisibleSelectionText("\u200b\n\u200b\u200b"), false);
    });

    it("preserves selections containing visible text", () => {
        assert.equal(hasVisibleSelectionText("\u200b内容\u200b"), true);
    });
});
