import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    addBase64ImageBatchSize,
    BASE64_IMAGE_BATCH_MAX_BYTES,
    BASE64_IMAGE_ITEM_MAX_BYTES,
    Base64ImageSizeLimitError,
    assertBase64ImageItemSize,
    createBase64ImageFile,
    isBase64ImageSizeLimitError,
} from "./base64File";
import {
    applyHTMLEmbeddedAssetPaths,
    collectHTMLEmbeddedAssets,
    hasHTMLEmbeddedAssets,
    type IHTMLEmbeddedAsset,
    isHTMLBase64Image,
    validateHTMLEmbeddedAssetSizes,
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

    it("recognizes SVG documents with comments and a doctype", () => {
        const comment = "x".repeat(5000);
        const svg = `<!--${comment}--><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>`;
        const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

        assert.equal(createBase64ImageFile(source, "svg")?.type, "image/svg+xml");
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
            assert.throws(() => createBase64ImageFile("data:image/png;base64,iVBORw0KGgo=", "large", 7),
                (error: unknown) => isBase64ImageSizeLimitError(error) && error.scope === "item" &&
                    error.actualBytes === 8 && error.maxBytes === 7);
        } finally {
            globalThis.atob = originalAtob;
        }
        assert.equal(decoded, false);
        assert.equal(createBase64ImageFile("data:image/png;base64,iVBORw0KGgo=", "image", 8)?.size, 8);
    });

    it("rejects a Base64 batch that exceeds the hard limit", () => {
        assert.throws(() => assertBase64ImageItemSize(BASE64_IMAGE_ITEM_MAX_BYTES + 1, Number.MAX_SAFE_INTEGER),
            (error: unknown) => error instanceof Base64ImageSizeLimitError && error.scope === "item" &&
                error.maxBytes === BASE64_IMAGE_ITEM_MAX_BYTES);
        assert.equal(addBase64ImageBatchSize(BASE64_IMAGE_BATCH_MAX_BYTES - 1, 1), BASE64_IMAGE_BATCH_MAX_BYTES);
        assert.throws(() => addBase64ImageBatchSize(BASE64_IMAGE_BATCH_MAX_BYTES, 1),
            (error: unknown) => error instanceof Base64ImageSizeLimitError && error.scope === "batch" &&
                error.actualBytes === BASE64_IMAGE_BATCH_MAX_BYTES + 1 &&
                error.maxBytes === BASE64_IMAGE_BATCH_MAX_BYTES);
    });

    it("validates HTML Base64 sizes without decoding", () => {
        const root = {
            querySelectorAll(selector: string) {
                if (selector === "pre") {
                    return [];
                }
                return [{
                    getAttribute(attribute: string) {
                        return attribute === "src" ? "data:image/png;base64,iVBORw0KGgo=" : null;
                    },
                }];
            },
        } as unknown as ParentNode;
        const originalAtob = globalThis.atob;
        let decoded = false;
        globalThis.atob = () => {
            decoded = true;
            return "";
        };
        try {
            assert.throws(() => validateHTMLEmbeddedAssetSizes(root, 7), isBase64ImageSizeLimitError);
        } finally {
            globalThis.atob = originalAtob;
        }
        assert.equal(decoded, false);
    });

    it("validates the complete HTML Base64 batch before creating files", () => {
        const sources = [
            "data:image/png;base64,iVBORw0KGgo=",
            "data:image/png;base64,iVBORw0KGgoAA",
        ];
        const root = {
            querySelectorAll(selector: string) {
                if (selector === "pre") {
                    return [];
                }
                return sources.map(source => ({
                    getAttribute(attribute: string) {
                        return attribute === "src" ? source : null;
                    },
                }));
            },
        } as unknown as ParentNode;
        const originalAtob = globalThis.atob;
        let decoded = false;
        globalThis.atob = () => {
            decoded = true;
            return "";
        };
        try {
            assert.throws(() => collectHTMLEmbeddedAssets(root, 8), isBase64ImageSizeLimitError);
        } finally {
            globalThis.atob = originalAtob;
        }
        assert.equal(decoded, false);
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

    it("counts inline SVG bytes against the item limit", () => {
        const svgHTML = "<svg><text>inline image</text></svg>";
        const block = {
            hasAttributes() {
                return true;
            },
            querySelector() {
                return {outerHTML: svgHTML};
            },
        } as unknown as Element;
        const root = {
            querySelectorAll(selector: string) {
                return selector === "pre" ? [block] : [];
            },
        } as unknown as ParentNode;
        const size = new Blob([svgHTML]).size;

        assert.throws(() => validateHTMLEmbeddedAssetSizes(root, size - 1),
            (error: unknown) => isBase64ImageSizeLimitError(error) && error.scope === "item" &&
                error.actualBytes === size && error.maxBytes === size - 1);
        assert.doesNotThrow(() => validateHTMLEmbeddedAssetSizes(root, size));
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
