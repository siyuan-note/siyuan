import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getFullWidthStrikethroughMarkerOffsets} from "./strikethrough";

describe("getFullWidthStrikethroughMarkerOffsets", () => {
    it("finds a full-width strikethrough ending at the caret", () => {
        assert.deepEqual(getFullWidthStrikethroughMarkerOffsets("～～文字～～"), {
            openStart: 0,
            closeStart: 4,
            markerLength: 2,
        });
        assert.deepEqual(getFullWidthStrikethroughMarkerOffsets("前缀 ～～文字～～"), {
            openStart: 3,
            closeStart: 7,
            markerLength: 2,
        });
    });

    it("rejects incomplete markers and text after the closing marker", () => {
        assert.equal(getFullWidthStrikethroughMarkerOffsets("～～文字～"), undefined);
        assert.equal(getFullWidthStrikethroughMarkerOffsets("～～文字～～后缀"), undefined);
        assert.equal(getFullWidthStrikethroughMarkerOffsets("~~文字~~"), undefined);
        assert.equal(getFullWidthStrikethroughMarkerOffsets("〜〜文字〜〜"), undefined);
    });

    it("rejects empty, whitespace-bound, and decorative marker runs", () => {
        assert.equal(getFullWidthStrikethroughMarkerOffsets("～～～～"), undefined);
        assert.equal(getFullWidthStrikethroughMarkerOffsets("～～ 文字～～"), undefined);
        assert.equal(getFullWidthStrikethroughMarkerOffsets("～～文字 ～～"), undefined);
        assert.equal(getFullWidthStrikethroughMarkerOffsets("～～～文字～～"), undefined);
        assert.equal(getFullWidthStrikethroughMarkerOffsets("～～文字～～～"), undefined);
    });
});
