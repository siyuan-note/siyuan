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
