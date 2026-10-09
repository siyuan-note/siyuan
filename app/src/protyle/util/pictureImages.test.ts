import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getPictureImageSource, normalizePictureImages} from "./pictureImages";

describe("picture image sources", () => {
    it("selects width and density candidates without splitting commas inside URLs", () => {
        assert.equal(getPictureImageSource("https://example.com/image,w_320.png 320w, https://example.com/image,w_1280.png 1280w"),
            "https://example.com/image,w_1280.png");
        assert.equal(getPictureImageSource("https://example.com/large.png 2x, https://example.com/small.png 1x"),
            "https://example.com/large.png");
        assert.equal(getPictureImageSource("https://example.com/image.png,"), "https://example.com/image.png");
    });

    it("resolves relative web sources and rejects invalid candidates and unsafe schemes", () => {
        assert.equal(getPictureImageSource("/images/a.png 320w, ../b.png 640w", "https://example.com/docs/page"),
            "https://example.com/b.png");
        assert.equal(getPictureImageSource("//example.com/a.png 1x", "https://other.example/page"),
            "https://example.com/a.png");
        assert.equal(getPictureImageSource("/images/a.png 320w"), "");
        for (const value of ["", "https://example.com/a.png 0w", "https://example.com/a.png 0x",
            "https://example.com/a.png 1x 2x", "javascript:alert(1) 2x", "file:///tmp/a.png 640w",
            "data:image/png;base64,YQ== 1x", "https://example.com/a.png " + "9".repeat(400) + "w"]) {
            assert.equal(getPictureImageSource(value), "", value);
        }
    });

    it("does not turn an empty currentSrc into the source page URL", () => {
        const values: Record<string, string> = {src: "data:image/png;base64,YQ=="};
        const image = {
            currentSrc: "",
            closest: () => ({children: [] as Element[]}),
            getAttribute: (attribute: string) => values[attribute] || null,
            setAttribute: (attribute: string, value: string) => values[attribute] = value,
        } as unknown as HTMLImageElement;
        const root = {querySelectorAll: () => [image]} as unknown as ParentNode;
        normalizePictureImages(root, "https://example.com/article");
        assert.equal(values.src, "data:image/png;base64,YQ==");
    });
});
