import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {createBase64ImageFile} from "./base64File";
import {
    applyHTMLEmbeddedAssetPaths,
    collectHTMLEmbeddedAssets,
    hasHTMLEmbeddedAssets,
    type IHTMLEmbeddedAsset,
    isHTMLBase64Image,
} from "./htmlEmbeddedAssets";

describe("HTML embedded assets", () => {
    it("recognizes Base64 images without accepting unrelated data URLs", () => {
        assert.equal(isHTMLBase64Image("data:image/png;base64,YQ=="), true);
        assert.equal(isHTMLBase64Image("data:image/svg+xml;charset=utf-8;base64,YQ=="), true);
        assert.equal(isHTMLBase64Image("data:text/plain;base64,YQ=="), false);
        assert.equal(isHTMLBase64Image("https://example.com/image.png"), false);
    });

    it("creates image files using the detected content type", () => {
        const file = createBase64ImageFile("data:image/png;base64,/9j/2Q==", "image");

        assert.equal(file.name, "image.jpg");
        assert.equal(file.type, "image/jpeg");
        assert.equal(file.size, 4);
    });

    it("supports raster signatures and encoded Base64 line breaks", () => {
        const gif = createBase64ImageFile("data:image/png;base64,R0lGODlh", "gif");
        const bmp = createBase64ImageFile("data:image/png;base64,Qk0=", "bmp");
        const png = createBase64ImageFile("data:image/png;base64,iVBORw0K%0AGgo=", "png");

        assert.equal(gif.name, "gif.gif");
        assert.equal(gif.type, "image/gif");
        assert.equal(bmp.name, "bmp.bmp");
        assert.equal(bmp.type, "image/bmp");
        assert.equal(png.name, "png.png");
        assert.equal(png.type, "image/png");
        assert.equal(createBase64ImageFile("data:image/png;base64,UklGRgAAAABXRUJQ", "webp")?.type, "image/webp");
        assert.equal(createBase64ImageFile("data:image/png;base64,PHN2Zz48L3N2Zz4=", "svg")?.type, "image/svg+xml");
    });

    it("rejects unsupported and oversized Base64 images before decoding", () => {
        assert.equal(createBase64ImageFile("data:image/png;base64,YQ==", "invalid"), undefined);
        const originalAtob = globalThis.atob;
        let decoded = false;
        globalThis.atob = (value: string) => {
            decoded = true;
            return originalAtob(value);
        };
        try {
            assert.equal(createBase64ImageFile("data:image/png;base64,iVBORw0KGgo=", "large", 7), undefined);
        } finally {
            globalThis.atob = originalAtob;
        }
        assert.equal(decoded, false);
        assert.equal(createBase64ImageFile("data:image/png;base64,iVBORw0KGgo=", "image", 8)?.size, 8);
    });

    it("collects Base64 attributes and rewrites them after upload", () => {
        const attributes = new Map([["src", "data:image/png;base64,iVBORw0KGgo="]]);
        const element = {
            getAttribute(name: string) {
                return attributes.get(name) || null;
            },
            setAttribute(name: string, value: string) {
                attributes.set(name, value);
            },
        } as Element;
        const root = {
            querySelectorAll(selector: string) {
                return selector === "pre" ? [] : [element];
            },
        } as unknown as ParentNode;

        const assets = collectHTMLEmbeddedAssets(root);
        applyHTMLEmbeddedAssetPaths(assets, ["assets/image.png"]);

        assert.equal(assets.length, 1);
        assert.equal(attributes.get("src"), "assets/image.png");
    });

    it("detects embedded assets without decoding them", () => {
        const root = {
            querySelectorAll(selector: string) {
                if (selector === "pre") {
                    return [];
                }
                return [{
                    getAttribute(attribute: string) {
                        return attribute === "src" ? "data:image/png;base64,not-decoded" : null;
                    },
                }];
            },
        } as unknown as ParentNode;

        assert.equal(hasHTMLEmbeddedAssets(root), true);
    });

    it("collects inline SVG blocks and replaces them with uploaded images", () => {
        const attributes = new Map<string, string>();
        const image = {
            setAttribute(name: string, value: string) {
                attributes.set(name, value);
            },
        } as Element;
        let replacement: Element | undefined;
        const block = {
            hasAttributes() {
                return true;
            },
            querySelector() {
                return {outerHTML: "<svg><rect width=\"1\" height=\"1\"></rect></svg>"};
            },
            ownerDocument: {
                createElement() {
                    return image;
                },
            },
            replaceWith(element: Element) {
                replacement = element;
            },
        } as unknown as Element;
        const root = {
            querySelectorAll(selector: string) {
                return selector === "pre" ? [block] : [];
            },
        } as unknown as ParentNode;

        const assets = collectHTMLEmbeddedAssets(root);
        applyHTMLEmbeddedAssetPaths(assets, ["assets/image.svg"]);

        assert.equal(assets[0].file.type, "image/svg+xml");
        assert.equal(replacement, image);
        assert.equal(attributes.get("src"), "assets/image.svg");
        assert.equal(attributes.get("alt"), "image");
    });

    it("applies only successful upload paths", () => {
        const applied: string[] = [];
        const assets = [0, 1].map(index => ({
            file: new File(["content"], `${index}.png`, {type: "image/png"}),
            apply(path: string) {
                applied.push(`${index}:${path}`);
            },
        })) as IHTMLEmbeddedAsset[];

        applyHTMLEmbeddedAssetPaths(assets, [undefined, "assets/image.png"]);

        assert.deepEqual(applied, ["1:assets/image.png"]);
    });
});
