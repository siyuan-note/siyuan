const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

require("../stage/protyle/js/lute/lute.min.js");

describe("Markdown footnote labels", () => {
    for (const sup of [false, true]) {
        it(`preserves punctuation and surrounding emphasis with superscript ${sup}`, () => {
            const lute = globalThis.Lute.New();
            lute.SetFootnotes(true);
            lute.SetSup(sup);
            const reference = "<sup class=\"footnotes-ref\" id=\"footnotes-ref-1\"><a href=\"#footnotes-def-1\">1</a></sup>";
            for (const label of ["a_b", "a*b", "a&b", "a<b", "a=b", "a~b", "a^b", "a$b", "a#b", "a!b", "a(b)", "a`b", "a&amp;b"]) {
                const markdown = `*Before[^${label}] after*.\n\n[^${label}]: body\n`;
                assert.ok(lute.MarkdownStr("", markdown).startsWith(`<p><em>Before${reference} after</em>.</p>\n`), label);
            }
        });
    }
});
