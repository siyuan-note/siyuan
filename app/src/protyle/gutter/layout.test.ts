import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getBacklinkGutterContentTop,
    getContainerGutterSpace,
    getFixedGutterPosition,
    getGutterMarginHeight,
    getGutterPaneRect,
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

describe("getGutterPaneRect", () => {
    it("uses the fullscreen boundary and restores split-pane clipping on exit", () => {
        const viewport = {left: 0, right: 1200, top: 30, bottom: 800} as DOMRect;
        const split = {left: 260, right: 800, top: 60, bottom: 700} as DOMRect;
        let fullscreen = false;
        const element = {closest: (selector: string) => selector === ".fullscreen" ?
            fullscreen ? {getBoundingClientRect: () => viewport} : null :
            {getBoundingClientRect: () => split}} as unknown as HTMLElement;
        assert.equal(getGutterPaneRect(element, viewport), split);
        fullscreen = true;
        const boundary = getGutterPaneRect(element, viewport);
        assert.equal(boundary, viewport);
        assert.ok(boundary.left <= 100 && boundary.right >= 100, "left-side fullscreen gutters stay visible");
        fullscreen = false;
        assert.equal(getGutterPaneRect(element, viewport), split);
    });

    it("uses the content viewport without a desktop pane", () => {
        const viewport = {left: 0, right: 360} as DOMRect;
        assert.equal(getGutterPaneRect({closest: (): Element => null} as unknown as HTMLElement, viewport), viewport);
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
