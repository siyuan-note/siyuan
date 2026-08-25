import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {createBase64ImageFile} from "./base64File";
import {
    applyHTMLEmbeddedAssetPaths,
    collectHTMLEmbeddedAssets,
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

    it("creates image files using the declared content type", () => {
        const file = createBase64ImageFile("data:image/jpeg;base64,YQ==", "image");

        assert.equal(file.name, "image.jpg");
        assert.equal(file.type, "image/jpeg");
        assert.equal(file.size, 1);
    });

    it("collects Base64 attributes and rewrites them after upload", () => {
        const attributes = new Map([["src", "data:image/png;base64,YQ=="]]);
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
