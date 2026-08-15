import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {escapeSearchHighlight, stripSearchMark} from "./escape";

describe("strip search mark", () => {
    it("removes search highlights without decoding escaped block names", () => {
        assert.equal(stripSearchMark("<mark>xw</mark>"), "xw");
        assert.equal(stripSearchMark("&lt;mark&gt;<mark>xw</mark>&lt;/mark&gt;"), "&lt;mark&gt;xw&lt;/mark&gt;");
    });
});

describe("escape search highlight", () => {
    it("preserves search highlight tags", () => {
        assert.equal(escapeSearchHighlight("&lt;mark&gt;<mark>xw</mark>&lt;/mark&gt;"), "&lt;mark&gt;<mark>xw</mark>&lt;/mark&gt;");
    });

    it("escapes raw HTML tags except mark", () => {
        assert.equal(escapeSearchHighlight('<img src="x" onerror="alert(1)">'), '&lt;img src="x" onerror="alert(1)">');
        assert.equal(escapeSearchHighlight("<script>alert(1)</script>"), "&lt;script>alert(1)&lt;/script>");
        assert.equal(escapeSearchHighlight('<mark onclick="alert(1)">x</mark>'), '&lt;mark onclick="alert(1)">x</mark>');
    });
});
