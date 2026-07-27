import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    CARD_LAYOUT_COMPACT,
    CARD_LAYOUT_LIST,
    getCardFieldsClass
} from "./cardLayout";

describe("getCardFieldsClass", () => {
    it("marks only compact card field containers", () => {
        assert.equal(getCardFieldsClass(CARD_LAYOUT_LIST), "av__gallery-fields");
        assert.equal(getCardFieldsClass(CARD_LAYOUT_COMPACT),
            "av__gallery-fields av__gallery-fields--compact");
    });

    it("preserves hidden field container state", () => {
        assert.equal(getCardFieldsClass(CARD_LAYOUT_COMPACT, false),
            "av__gallery-fields av__gallery-fields--compact fn__none");
    });
});
