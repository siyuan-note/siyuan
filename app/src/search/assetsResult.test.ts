import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {genAssetSearchResultItemHTML} from "./assetsResult";

const baseItem = {
    content: "safe escaped content",
    ext: "txt",
    id: "20260822000001-abcdefg",
    path: "assets/2026/report.txt",
    name: "report.txt",
    hSize: "1 B",
};

describe("asset search result item html", () => {
    it("escapes quotes and angle brackets in the asset name", () => {
        const html = genAssetSearchResultItemHTML({
            ...baseItem,
            name: "report\"><img src=x onerror=\"alert(1)\">.txt",
        }, 0);
        assert.ok(!html.includes("<img src=x onerror=\"alert(1)\">"));
        assert.ok(html.includes("\">&lt;img src=x"));
    });

    it("escapes event handler attributes in the asset name", () => {
        const html = genAssetSearchResultItemHTML({
            ...baseItem,
            name: "<svg onload=\"alert(1)\">.txt",
        }, 0);
        assert.ok(!html.includes("<svg"));
        assert.ok(html.includes("&lt;svg onload="));
    });

    it("escapes svg markup in the asset name", () => {
        const html = genAssetSearchResultItemHTML({
            ...baseItem,
            name: "x\"><svg><script>alert(1)</script></svg>.txt",
        }, 0);
        assert.ok(!html.includes("<svg>"));
        assert.ok(!html.includes("<script>"));
    });

    it("escapes the asset extension", () => {
        const html = genAssetSearchResultItemHTML({
            ...baseItem,
            ext: "<img src=x onerror=\"alert(1)\">",
        }, 0);
        assert.ok(!html.includes("<img"));
        assert.ok(html.includes("&lt;img src=x"));
    });

    it("keeps the aria-label path escaped", () => {
        const html = genAssetSearchResultItemHTML({
            ...baseItem,
            path: "assets/2026/\"><img src=x onerror=\"alert(1)\">.txt",
        }, 0);
        assert.ok(!html.includes("aria-label=\"assets/2026/\"><img"));
    });

    it("preserves backend-escaped content with highlight marks", () => {
        const html = genAssetSearchResultItemHTML({
            ...baseItem,
            content: "&lt;img src=x&gt;<mark>x</mark>",
        }, 0);
        assert.ok(html.includes("&lt;img src=x&gt;<mark>x</mark>"));
    });

    it("marks the first row as focused", () => {
        const html = genAssetSearchResultItemHTML(baseItem, 0);
        assert.ok(html.includes("b3-list-item b3-list-item--focus"));
    });
});
