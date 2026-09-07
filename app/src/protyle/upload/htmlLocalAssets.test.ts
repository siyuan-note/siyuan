import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    applyHTMLLocalAssetPaths,
    collectHTMLLocalAssets,
    getHTMLAssetSourceURL,
    type IHTMLLocalAsset,
    isHTMLLocalAssetPath,
    removeHTMLLocalAssetPaths,
    resolveHTMLAssetURL,
    resolveHTMLAssetURLs,
} from "./htmlLocalAssets";

describe("HTML local assets", () => {
    const createElement = (tagName: string, attributes: Record<string, string>) => ({
        tagName,
        getAttribute: (name: string) => attributes[name] ?? null,
        setAttribute: (name: string, value: string) => attributes[name] = value,
    }) as unknown as Element;

    it("ignores webpage components and collects only supported resource attributes", () => {
        const elements = [
            createElement("INCLUDE-FRAGMENT", {src: "/in-product-messaging/code-scanning-ai-findings-preview-banner?page_path=test"}),
            createElement("SCRIPT", {src: "/scripts/site.js"}),
            createElement("LINK", {href: "/styles/site.css"}),
            createElement("IMG", {src: "/tmp/image.png", href: "/not-an-image"}),
            createElement("A", {href: "C:\\files\\attachment.pdf", src: "/not-an-attachment"}),
            createElement("VIDEO", {src: "file:///tmp/movie.mp4"}),
            createElement("AUDIO", {src: "/tmp/sound.mp3"}),
            createElement("SOURCE", {src: "/tmp/media.webm"}),
        ];
        const root = {querySelectorAll: () => elements} as unknown as ParentNode;
        assert.deepEqual(collectHTMLLocalAssets(root).map(item => item.path), [
            "/tmp/image.png", "C:\\files\\attachment.pdf", "file:///tmp/movie.mp4", "/tmp/sound.mp3", "/tmp/media.webm",
        ]);
    });

    it("resolves web resource paths before local asset collection", () => {
        const image = createElement("IMG", {src: "/images/a.png"});
        const link = createElement("A", {href: "../attachment.pdf"});
        const local = createElement("IMG", {src: "file:///tmp/a.png"});
        const root = {querySelectorAll: () => [image, link, local]} as unknown as ParentNode;
        resolveHTMLAssetURLs(root, "https://example.com/docs/page");
        assert.equal(image.getAttribute("src"), "https://example.com/images/a.png");
        assert.equal(link.getAttribute("href"), "https://example.com/attachment.pdf");
        assert.deepEqual(collectHTMLLocalAssets(root).map(item => item.path), ["file:///tmp/a.png"]);
    });

    it("uses only explicit web provenance and preserves local and internal paths", () => {
        assert.equal(getHTMLAssetSourceURL("Version:0.9\r\nSourceURL:https://example.com/docs/page\r\n<html>"), "https://example.com/docs/page");
        assert.equal(getHTMLAssetSourceURL("", "https://example.com/base/"), "https://example.com/base/");
        assert.equal(getHTMLAssetSourceURL("SourceURL:https://example.com/docs/page", "../base/"), "https://example.com/base/");
        assert.equal(getHTMLAssetSourceURL(""), undefined);
        assert.equal(getHTMLAssetSourceURL("SourceURL:file:///tmp/document.html"), undefined);
        assert.equal(resolveHTMLAssetURL("/tmp/a.png"), "/tmp/a.png");
        for (const value of ["file:///tmp/a.png", "C:\\Images\\a.png", "\\\\server\\a.png", "assets/a.png", "#section", "data:image/png;base64,test"]) {
            assert.equal(resolveHTMLAssetURL(value, "https://example.com/"), value);
        }
        assert.equal(resolveHTMLAssetURL("//cdn.example.com/a.png", "https://example.com/"), "https://cdn.example.com/a.png");
    });
    it("recognizes absolute paths without treating web and asset URLs as local", () => {
        assert.equal(isHTMLLocalAssetPath("file:///tmp/a.png"), true);
        assert.equal(isHTMLLocalAssetPath("C:\\Images\\a.png"), true);
        assert.equal(isHTMLLocalAssetPath("/tmp/a.png"), true);
        assert.equal(isHTMLLocalAssetPath("https://example.com/a.png"), false);
        assert.equal(isHTMLLocalAssetPath("//example.com/a.png"), false);
        assert.equal(isHTMLLocalAssetPath("assets/a.png"), false);
    });

    it("rewrites only successful paths by their input indexes", () => {
        const values = ["file:///tmp/a.png", "/tmp/b.pdf"];
        const assets = values.map((path, index) => ({
            element: {
                setAttribute(_attribute: string, value: string) {
                    values[index] = value;
                },
            } as Element,
            attribute: index === 0 ? "src" : "href",
            path,
        })) as IHTMLLocalAsset[];

        applyHTMLLocalAssetPaths(assets, [undefined, "assets/b.pdf"]);

        assert.deepEqual(values, ["file:///tmp/a.png", "assets/b.pdf"]);
    });

    it("removes local paths before remote HTML conversion", () => {
        const attributes = new Map([
            ["src", "file:///Users/test/private.png"],
            ["data-type", "NodeImage"],
        ]);
        const assets = [{
            element: {
                removeAttribute(attribute: string) {
                    attributes.delete(attribute);
                },
            } as Element,
            attribute: "src",
            path: attributes.get("src"),
        }] as IHTMLLocalAsset[];

        removeHTMLLocalAssetPaths(assets);

        assert.equal(attributes.has("src"), false);
        assert.equal(attributes.get("data-type"), "NodeImage");
    });
});
