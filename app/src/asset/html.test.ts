import * as assert from "node:assert/strict";
import test from "node:test";
import {getHTMLAssetIFrameSrc, isHTMLFilePath} from "./html";

test("recognizes supported HTML file paths", () => {
    assert.equal(isHTMLFilePath("component.html"), true);
    assert.equal(isHTMLFilePath("component.HTM?box=20260810000000-abcdefg"), true);
    assert.equal(isHTMLFilePath("component.xhtml"), false);
    assert.equal(isHTMLFilePath("component.js"), false);
});

test("adds the HTML IFrame query without losing existing parameters", () => {
    assert.equal(getHTMLAssetIFrameSrc("assets/component.html"), "assets/component.html?iframe=true");
    assert.equal(getHTMLAssetIFrameSrc("assets/component.html?box=20260810000000-abcdefg"),
        "assets/component.html?box=20260810000000-abcdefg&iframe=true");
    assert.equal(getHTMLAssetIFrameSrc("assets/component.html?iframe=false#preview"),
        "assets/component.html?iframe=true#preview");
});
