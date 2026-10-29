import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    escapeAriaLabel, escapeAttr, escapeHtml, escapeHtmlTextAndAttr, escapeMarkdownPlainText,
    escapeSearchHighlight, stripSearchMark,
} from "./escape";

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

    it("escapes text around the single-pass length boundary and long text", () => {
        const text = "&lt;<tag>\"'\\\ud800";
        for (const length of [511, 512, 513, 8192]) {
            const prefix = "x".repeat(length - text.length);
            assert.equal(escapeHtmlTextAndAttr(prefix + text), prefix + "&amp;lt;&lt;tag&gt;&quot;'\\\ud800");
        }
    });

    it("converts long non-string input only once", () => {
        let conversions = 0;
        const value = {
            toString: () => {
                conversions++;
                return "x".repeat(1024) + "<&>\"";
            },
        };
        assert.equal(escapeHtmlTextAndAttr(value), "x".repeat(1024) + "&lt;&amp;&gt;&quot;");
        assert.equal(conversions, 1);
    });
});

describe("escape HTML fragments and attributes", () => {
    it("escapes only ampersands and less-than signs for HTML fragments", () => {
        assert.equal(escapeHtml(""), "");
        assert.equal(escapeHtml("a&b<c>d\"e'f"), "a&amp;b&lt;c>d\"e'f");
    });

    it("escapes both quote kinds for attributes", () => {
        assert.equal(escapeAttr(""), "");
        assert.equal(escapeAttr("&<>\"'"), "&<>&quot;&apos;");
    });

    it("escapes short and long aria-label text with the inner attribute level", () => {
        assert.equal(escapeAriaLabel(""), "");
        assert.equal(escapeAriaLabel("&lt;a<b>'c\"d"), "&amp;lt;a&amp;lt;b>&apos;c&quot;d");
        const text = "&lt;<tag>\"'\\\ud800";
        for (const length of [511, 512, 513, 8192]) {
            const prefix = "x".repeat(length - text.length);
            assert.equal(escapeAriaLabel(prefix + text), prefix + "&amp;lt;&amp;lt;tag>&quot;&apos;\\\ud800");
        }
    });
});

describe("escape Markdown plain text", () => {
    it("prefixes every escapable marker with a backslash", () => {
        assert.equal(escapeMarkdownPlainText(""), "");
        assert.equal(escapeMarkdownPlainText("plain text"), "plain text");
        assert.equal(escapeMarkdownPlainText("\\*_[]!`<>&~{}()=#$^|."),
            "\\\\\\*\\_\\[\\]\\!\\`\\<\\>\\&\\~\\{\\}\\(\\)\\=\\#\\$\\^\\|\\.");
    });

    it("escapes text around the single-pass length boundary and dense long text", () => {
        const text = "\\*_[]!`<>&~{}()=#$^|.";
        const escaped = "\\\\\\*\\_\\[\\]\\!\\`\\<\\>\\&\\~\\{\\}\\(\\)\\=\\#\\$\\^\\|\\.";
        for (const length of [511, 512, 513, 8192]) {
            const prefix = "x".repeat(length - text.length);
            assert.equal(escapeMarkdownPlainText(prefix + text), prefix + escaped);
        }
        assert.equal(escapeMarkdownPlainText(text.repeat(400)), escaped.repeat(400));
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
