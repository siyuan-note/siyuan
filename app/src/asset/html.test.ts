import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getHTMLAssetIFrameSrc,
    isHTMLFilePath,
    isLocalHTMLAssetPath,
    normalizeHTMLAssetIFrameSources
} from "./html";

test("recognizes supported HTML file paths", () => {
    assert.equal(isHTMLFilePath("component.html"), true);
    assert.equal(isHTMLFilePath("component.HTM?box=20260810000000-abcdefg"), true);
    assert.equal(isHTMLFilePath("component.xhtml"), false);
    assert.equal(isHTMLFilePath("component.js"), false);
});

test("recognizes only local HTML asset paths", () => {
    assert.equal(isLocalHTMLAssetPath("assets/component.html"), true);
    assert.equal(isLocalHTMLAssetPath("./assets/component.htm?box=20260810000000-abcdefg"), true);
    assert.equal(isLocalHTMLAssetPath("/assets/component.HTML#preview"), true);
    assert.equal(isLocalHTMLAssetPath("component.html"), false);
    assert.equal(isLocalHTMLAssetPath("https://example.com/assets/component.html"), false);
    assert.equal(isLocalHTMLAssetPath("assets/component.xhtml"), false);
});

test("adds the HTML IFrame query without losing existing parameters", () => {
    assert.equal(getHTMLAssetIFrameSrc("assets/component.html"), "assets/component.html?iframe=true");
    assert.equal(getHTMLAssetIFrameSrc("assets/component.html?box=20260810000000-abcdefg"),
        "assets/component.html?box=20260810000000-abcdefg&iframe=true");
    assert.equal(getHTMLAssetIFrameSrc("assets/component.html?iframe=false#preview"),
        "assets/component.html?iframe=true#preview");
});

test("keeps non-local IFrame sources unchanged", () => {
    assert.equal(getHTMLAssetIFrameSrc("https://example.com/component.html"),
        "https://example.com/component.html");
    assert.equal(getHTMLAssetIFrameSrc("component.html"), "component.html");
    assert.equal(getHTMLAssetIFrameSrc("assets/component.xhtml"), "assets/component.xhtml");
});

test("normalizes legacy local HTML IFrame sources", () => {
    const sources = [
        "assets/legacy.html",
        "assets/current.html?iframe=true",
        "https://example.com/component.html",
        "assets/component.svg",
        null
    ];
    const iframes = sources.map((source) => {
        let value = source;
        return {
            get source() {
                return value;
            },
            getAttribute: () => value,
            setAttribute: (_name: string, newValue: string) => {
                value = newValue;
            }
        };
    });
    const root = {
        querySelectorAll: (selector: string) => {
            assert.equal(selector, '[data-type="NodeIFrame"] iframe');
            return iframes;
        }
    } as unknown as ParentNode;

    assert.equal(normalizeHTMLAssetIFrameSources(root), true);
    assert.deepEqual(iframes.map(item => item.source), [
        "assets/legacy.html?iframe=true",
        "assets/current.html?iframe=true",
        "https://example.com/component.html",
        "assets/component.svg",
        null
    ]);
});

test("preserves remote IFrame attributes for serialization", () => {
    const attributes = new Map([
        ["src", "data:text/html,<script>alert(1)</script>"],
        ["srcdoc", "<script>alert(1)</script>"],
        ["sandbox", "allow-scripts allow-same-origin"],
        ["onload", "alert(1)"],
        ["allow", "camera"],
        ["allowfullscreen", "true"],
    ]);
    const iframe = {
        tagName: "IFRAME",
        get attributes() {
            return Array.from(attributes.entries()).map(([name, value]) => ({name, value}));
        },
        getAttribute: (name: string) => attributes.get(name) || null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
    };
    const root = {
        querySelectorAll: (selector: string) => selector === "*" ? [iframe] : [],
    } as unknown as ParentNode;

    const originalAttributes = new Map(attributes);

    assert.equal(normalizeHTMLAssetIFrameSources(root, true), false);
    assert.deepEqual(attributes, originalAttributes);
});

test("sanitizes active remote document content while preserving editor structure", () => {
    const createElement = (tagName: string, entries: [string, string][]) => {
        const attributes = new Map(entries);
        return {
            tagName,
            attributesMap: attributes,
            removed: false,
            get attributes() {
                return Array.from(attributes.entries()).map(([name, value]) => ({name, value}));
            },
            removeAttribute: (name: string) => attributes.delete(name),
            remove() {
                this.removed = true;
            },
        };
    };
    const customElement = createElement("PROTYLE-HTML", [
        ["data-content", "&lt;strong&gt;content&lt;/strong&gt;"],
        ["data-node-id", "20260903150000-abcdefg"],
        ["onclick", "require('child_process').exec('calc')"],
    ]);
    const dangerousLink = createElement("A", [["href", " java\nscript:alert(1)"]]);
    const safeLink = createElement("A", [["href", "https://example.com"]]);
    const embeddedImage = createElement("IMG", [["src", "data:image/png;base64,AAAA"]]);
    const script = createElement("SCRIPT", []);
    const root = {
        querySelectorAll: (selector: string) => {
            if (selector === "iframe") {
                return [];
            }
            if (selector.startsWith("script,")) {
                return [script];
            }
            if (selector === "*") {
                return [customElement, dangerousLink, safeLink, embeddedImage];
            }
            return [];
        },
    } as unknown as ParentNode;

    assert.equal(normalizeHTMLAssetIFrameSources(root, true), true);
    assert.equal(script.removed, true);
    assert.equal(customElement.attributesMap.get("data-content"), "&lt;strong&gt;content&lt;/strong&gt;");
    assert.equal(customElement.attributesMap.get("data-node-id"), "20260903150000-abcdefg");
    assert.equal(customElement.attributesMap.has("onclick"), false);
    assert.equal(dangerousLink.attributesMap.has("href"), false);
    assert.equal(safeLink.attributesMap.get("href"), "https://example.com");
    assert.equal(embeddedImage.attributesMap.get("src"), "data:image/png;base64,AAAA");
});
