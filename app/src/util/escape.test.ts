import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {escapeHtmlTextAndAttr, escapeSearchHighlight, stripSearchMark} from "./escape";

describe("escape HTML strings", () => {
    it("matches the bundled Lute engine for text and double-quoted attributes", () => {
        require("../../stage/protyle/js/lute/lute.min.js");
        for (const value of ["", "plain text", "&<>\"'", "&amp; &#39; &quot;", "</textarea><img src=\"x\">",
            "中文、日本語、😀\n\t'quoted'"]) {
            assert.equal(escapeHtmlTextAndAttr(value), Lute.EscapeHTMLStr(value));
        }
        assert.equal(escapeHtmlTextAndAttr("&<>\"'"), "&amp;&lt;&gt;&quot;'");
    });

    it("preserves Lute string conversion for non-string values", () => {
        require("../../stage/protyle/js/lute/lute.min.js");
        for (const value of [undefined, null, 0, 123, NaN, false, true, ["<&", 1],
            {toString: () => '<"&>'}]) {
            assert.equal(escapeHtmlTextAndAttr(value), Reflect.apply(Lute.EscapeHTMLStr, Lute, [value]));
        }
    });

    it("preserves lone surrogates while escaping HTML characters", () => {
        assert.equal(escapeHtmlTextAndAttr("\ud800&<\udc00>\"'"), "\ud800&amp;&lt;\udc00&gt;&quot;'");
        assert.equal(escapeHtmlTextAndAttr("\ud800"), "\ud800");
        assert.equal(escapeHtmlTextAndAttr("\udc00"), "\udc00");
    });
});

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
