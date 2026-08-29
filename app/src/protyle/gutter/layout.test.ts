import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getBacklinkGutterContentTop,
    getContainerGutterSpace,
    getFixedGutterPosition,
    getGutterMarginHeight,
    getListGutterAnchorLeft
} from "./layout";

describe("getGutterMarginHeight", () => {
    it("uses the natural height after heading gutter buttons wrap", () => {
        const editorFontSize = 16;
        const wrappedHeight = 56;
        const naturalHeight = 34;

        [1.38, 1.25, 1.13].forEach(scale => {
            const headingHeight = editorFontSize * 1.625 * scale + 8;
            const marginHeight = getGutterMarginHeight(
                headingHeight, wrappedHeight, naturalHeight, editorFontSize);

            assert.ok(marginHeight + 6 >= 0);
            assert.ok(marginHeight + 6 <= headingHeight);
        });
    });

    it("falls back to the current height before the natural height is measured", () => {
        assert.equal(getGutterMarginHeight(44, 34, 0, 16), 5);
    });
});

describe("getBacklinkGutterContentTop", () => {
    it("keeps the gutter below the sticky document title", () => {
        assert.equal(getBacklinkGutterContentTop(20, 30, 62), 62);
    });

    it("keeps the existing content boundary when it is lower", () => {
        assert.equal(getBacklinkGutterContentTop(80, 30, 62), 80);
    });
});

describe("getFixedGutterPosition", () => {
    it("keeps viewport coordinates without a transformed container", () => {
        assert.equal(getFixedGutterPosition(240), 240);
    });

    it("converts viewport coordinates to transformed container coordinates", () => {
        assert.equal(getFixedGutterPosition(860, 640), 220);
    });
});

describe("getContainerGutterSpace", () => {
    it("compensates for container padding when a child rectangle positions the gutter", () => {
        assert.equal(getContainerGutterSpace("NodeBlockquote", false), 10);
        assert.equal(getContainerGutterSpace("NodeCallout", false), 10);
    });

    it("does not offset a gutter already positioned from the container rectangle", () => {
        assert.equal(getContainerGutterSpace("NodeBlockquote", true), 0);
        assert.equal(getContainerGutterSpace("NodeCallout", true), 0);
        assert.equal(getContainerGutterSpace("NodeParagraph", false), 0);
    });
});

describe("getListGutterAnchorLeft", () => {
    it("uses the content edge for RTL list actions", () => {
        assert.equal(getListGutterAnchorLeft(680, 120, true), 120);
    });

    it("keeps the list action edge for LTR lists", () => {
        assert.equal(getListGutterAnchorLeft(120, 154, false), 120);
    });
});
