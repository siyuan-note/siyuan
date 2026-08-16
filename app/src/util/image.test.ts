import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getCompressURL,
    getDownloadURL,
    isBrowserRenderableImagePath,
    isHEIFPath,
    isInternalHEIFPath,
    removeCompressURL,
} from "./imageURL";

const TEST_ORIGIN = "https://siyuan.local";

describe("getCompressURL", () => {
    it("adds thumbnail styles to supported image assets regardless of extension case", () => {
        assert.equal(getCompressURL("assets/image.png"), "assets/image.png?style=thumb");
        assert.equal(getCompressURL("assets/image.JPG"), "assets/image.JPG?style=thumb");
        assert.equal(getCompressURL("assets/image.HeIc"), "assets/image.HeIc?style=thumb");
        assert.equal(getCompressURL("assets/image.HEIF"), "assets/image.HEIF?style=thumb");
    });

    it("preserves existing queries and fragments", () => {
        assert.equal(
            getCompressURL("assets/image.heic?box=20260816000000-test#preview"),
            "assets/image.heic?box=20260816000000-test&style=thumb#preview",
        );
        assert.equal(getCompressURL("assets/image.jpeg#preview"), "assets/image.jpeg?style=thumb#preview");
    });

    it("keeps one thumbnail style when called repeatedly", () => {
        assert.equal(
            getCompressURL("assets/image.heif?box=test&style=thumb#preview"),
            "assets/image.heif?box=test&style=thumb#preview",
        );
        assert.equal(
            getCompressURL("assets/image.heif?style=original&box=test"),
            "assets/image.heif?style=thumb&box=test",
        );
    });

    it("does not change unsupported or non-asset URLs", () => {
        assert.equal(getCompressURL("assets/image.gif?box=test#preview"), "assets/image.gif?box=test#preview");
        assert.equal(getCompressURL("https://example.com/assets/image.heic"), "https://example.com/assets/image.heic");
    });
});

describe("removeCompressURL", () => {
    it("removes thumbnail styles while preserving other queries and fragments", () => {
        assert.equal(
            removeCompressURL("assets/image.HEIC?box=20260816000000-test&style=thumb#preview"),
            "assets/image.HEIC?box=20260816000000-test#preview",
        );
        assert.equal(
            removeCompressURL("assets/image.jpg?style=thumb&box=20260816000000-test#preview"),
            "assets/image.jpg?box=20260816000000-test#preview",
        );
        assert.equal(removeCompressURL("assets/image.heif?style=thumb#preview"), "assets/image.heif#preview");
    });

    it("does not change URLs without a thumbnail style", () => {
        assert.equal(removeCompressURL("assets/image.heic?box=test#preview"), "assets/image.heic?box=test#preview");
        assert.equal(removeCompressURL("assets/image.gif?style=thumb"), "assets/image.gif?style=thumb");
    });
});

describe("HEIF paths", () => {
    it("recognizes every supported internal asset URL form", () => {
        assert.equal(isInternalHEIFPath("assets/image.heic", TEST_ORIGIN), true);
        assert.equal(isInternalHEIFPath("./assets/image.heic", TEST_ORIGIN), true);
        assert.equal(isInternalHEIFPath("/assets/image.heic", TEST_ORIGIN), true);
        assert.equal(isInternalHEIFPath("https://siyuan.local/assets/image.HEIF?box=test", TEST_ORIGIN), true);
    });

    it("rejects HEIF paths that cannot use the same-origin asset converter", () => {
        assert.equal(isHEIFPath("file:///tmp/image.HEIC#preview"), true);
        assert.equal(isHEIFPath("assets/image%2EHEIC"), true);
        assert.equal(isInternalHEIFPath("https://example.com/assets/image.heic", TEST_ORIGIN), false);
        assert.equal(isInternalHEIFPath("file:///tmp/image.HEIC#preview", TEST_ORIGIN), false);
        assert.equal(isInternalHEIFPath("C:\\notes\\image.heic", TEST_ORIGIN), false);
        assert.equal(isInternalHEIFPath("\\\\server\\share\\image.heic", TEST_ORIGIN), false);
        assert.equal(isInternalHEIFPath("/ASSETS/image.heic", TEST_ORIGIN), false);
        assert.equal(isHEIFPath("assets/image.jpeg"), false);
    });
});

describe("isBrowserRenderableImagePath", () => {
    it("renders regular images and same-origin HEIF assets", () => {
        assert.equal(isBrowserRenderableImagePath("https://example.com/image.jpg", TEST_ORIGIN), true);
        assert.equal(isBrowserRenderableImagePath("assets/image.heic", TEST_ORIGIN), true);
        assert.equal(isBrowserRenderableImagePath("./assets/image.heif", TEST_ORIGIN), true);
        assert.equal(isBrowserRenderableImagePath("/assets/image.heic", TEST_ORIGIN), true);
        assert.equal(
            isBrowserRenderableImagePath("https://siyuan.local/assets/image.heif?box=test", TEST_ORIGIN),
            true,
        );
    });

    it("does not render HEIF paths that bypass the asset converter", () => {
        assert.equal(isBrowserRenderableImagePath("https://example.com/assets/image.heic", TEST_ORIGIN), false);
        assert.equal(isBrowserRenderableImagePath("file:///tmp/image.heic", TEST_ORIGIN), false);
        assert.equal(isBrowserRenderableImagePath("C:\\notes\\image.heic", TEST_ORIGIN), false);
        assert.equal(isBrowserRenderableImagePath("\\\\server\\share\\image.heic", TEST_ORIGIN), false);
        assert.equal(isBrowserRenderableImagePath("assets/image.heic?download=true", TEST_ORIGIN), false);
        assert.equal(isBrowserRenderableImagePath("assets/image.heic?download=TRUE", TEST_ORIGIN), false);
        assert.equal(isBrowserRenderableImagePath("assets/image.heic?%64ownload=true", TEST_ORIGIN), false);
        assert.equal(isBrowserRenderableImagePath("assets/image.heic?download=false", TEST_ORIGIN), true);
    });
});

describe("getDownloadURL", () => {
    it("sets the download parameter while preserving asset context", () => {
        assert.equal(
            getDownloadURL("assets/image.heic?box=20260816000000-test#preview"),
            "assets/image.heic?box=20260816000000-test&download=true#preview",
        );
        assert.equal(getDownloadURL("assets/image.heif?download=false"), "assets/image.heif?download=true");
    });
});
