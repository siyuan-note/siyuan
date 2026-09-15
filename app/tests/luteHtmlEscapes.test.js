const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

require("../stage/protyle/js/lute/lute.min.js");

describe("HTML text escaping", () => {
    it("keeps generated escapes out of flattened formatting", () => {
        const lute = globalThis.Lute.New();
        lute.SetProtyleWYSIWYG(true);
        lute.SetHTMLTag2TextMark(true);
        lute.SetTextMark(true);
        const [markdown, error] = lute.HTML2Markdown("<p><span style=\"color:red\">color</span><strong>1 = 2 \\=</strong></p>");
        assert.equal(error, null);
        const text = [...markdown.matchAll(/<span data-type="strong">([^<]*)<\/span>/g)]
            .map(match => match[1]).join("");
        assert.equal(text, "1 = 2 \\=");
    });

    it("preserves raw spans, code, and ordinary Markdown escaping", () => {
        const lute = globalThis.Lute.New();
        lute.SetProtyleWYSIWYG(true);
        for (const [html, expected] of [
            ["<p>a = b \\=</p>", "a \\= b \\\\\\=\n"],
            ["<span>$x=2$</span>", "$x=2$\n"],
            ["<span class=\"\">$x=2$</span>", "\\$x\\=2\\$\n"],
            ["<code>a = b \\=</code>", "`a = b \\=`\n"],
        ]) {
            const [actual, error] = lute.HTML2Markdown(html);
            assert.equal(error, null);
            assert.equal(actual, expected);
        }
    });
});
