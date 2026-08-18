import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getCardAspectRatioLabel,
    getCardAspectRatioValue,
    getCardStyle,
    getCardWidth
} from "./style";

const getView = (values: Partial<IAVGallery> = {}) => ({
    cardSize: 1,
    cardWidth: 0,
    cardAspectRatio: 0,
    cardAspectRatioValue: 0,
    ...values
}) as IAVGallery;

describe("attribute view card style", () => {
    it("uses custom widths and falls back to legacy size presets", () => {
        assert.equal(getCardWidth(getView({cardWidth: 410})), 410);
        assert.equal(getCardWidth(getView({cardSize: 0})), 180);
        assert.equal(getCardWidth(getView({cardSize: 2, cardWidth: 700})), 320);
    });

    it("uses custom aspect ratios and falls back to legacy presets", () => {
        assert.equal(getCardAspectRatioValue(getView({cardAspectRatioValue: 0.25})), 0.25);
        assert.equal(getCardAspectRatioValue(getView({cardAspectRatioValue: 1.25})), 1.25);
        assert.equal(getCardAspectRatioValue(getView({cardAspectRatioValue: 2.5})), 2.5);
        assert.equal(getCardAspectRatioValue(getView({cardAspectRatio: 3})), 3 / 4);
        assert.equal(getCardAspectRatioValue(getView({cardAspectRatio: 5, cardAspectRatioValue: 2.55})), 2 / 3);
    });

    it("formats decimal labels and sanitized inline styles", () => {
        assert.equal(getCardAspectRatioLabel(0.25), "0.25");
        assert.equal(getCardAspectRatioLabel(4 / 3), "1.33");
        assert.equal(getCardAspectRatioLabel(1.25), "1.25");
        assert.equal(getCardAspectRatioLabel(2.5), "2.50");
        assert.equal(
            getCardStyle(getView({cardWidth: 410, cardAspectRatioValue: 1.25})),
            "--b3-av-card-width: 410px; --b3-av-card-aspect-ratio: 1.25;"
        );
    });
});
