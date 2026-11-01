const assert = require("node:assert/strict");
const {test} = require("node:test");

require("../stage/protyle/js/lute/lute.min.js");

for (const [mode, toDOM, toMarkdown] of [
    ["IR", "Md2VditorIRDOM", "VditorIRDOM2Md"],
    ["WYSIWYG", "Md2VditorDOM", "VditorDOM2Md"],
]) {
    test(`bundled Lute retains used and unused reference titles in ${mode}`, () => {
        const lute = globalThis.Lute.New();
        lute.SetSanitize(true);
        lute.SetVditorIR(mode === "IR");
        lute.SetVditorWYSIWYG(mode === "WYSIWYG");
        for (const source of [
            '[Text][ref]\n\n[ref]: https://example.com "Title"\n',
            '[ref]: https://example.com "Unused title"\n',
            '![Image][ref]\n\n[ref]: https://example.com/image.png "Image title"\n',
        ]) {
            let markdown = source;
            const reference = source.slice(source.lastIndexOf("[ref]:"));
            for (let round = 0; round < 3; round++) {
                markdown = lute[toMarkdown](lute[toDOM](markdown));
                assert.ok(markdown.includes(reference), `${mode} round ${round}: ${markdown}`);
                assert.equal((markdown.match(/title/gi) || []).length, 1);
            }
        }
    });
}

test("bundled Lute keeps source-view definition titles as escaped text", () => {
    const lute = globalThis.Lute.New();
    lute.SetVditorSV(true);
    const dom = lute.Md2VditorSVDOM('[ref]: /target "<img src=x onerror=alert(1)> & title"\n');
    assert.ok(dom.includes("&lt;img src=x onerror=alert(1)&gt; &amp; title"));
    assert.equal(dom.includes("<img"), false);
    const image = lute.Md2VditorSVDOM('![Image][ref]\n\n[ref]: /image.png "Title"\n');
    assert.equal((image.match(/Title/g) || []).length, 1);
});
