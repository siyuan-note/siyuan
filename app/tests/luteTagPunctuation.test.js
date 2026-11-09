const assert = require("node:assert/strict");
const {test} = require("node:test");

require("../stage/protyle/js/lute/lute.min.js");

test("bundled Lute preserves quoted bare hashes and adjacent inline code across repeated exports", () => {
    const lute = globalThis.Lute.New();
    lute.SetTextMark(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetKramdownIAL(true);
    lute.SetTag(true);
    for (const [open, close] of [["«", "»"], ["„", "“"], ['"', '"'], ["‘", "’"], ["‹", "›"]]) {
        const source = `маркер ${open}#${close} и код \`bare_hash\` между ${open}#${close} и ${open}#${close} же.`;
        let markdown = source;
        for (let round = 0; round < 3; round++) {
            const dom = lute.Md2BlockDOM(markdown, false);
            assert.equal(dom.includes('data-type="tag'), false, dom);
            assert.ok(dom.includes('data-type="code"'), dom);
            markdown = lute.BlockDOM2StdMd(dom).trim();
            assert.equal(markdown, source);
        }
        assert.ok(lute.Md2BlockDOM(`${open}#foo#${close}`, false).includes('data-type="tag"'));
    }
});
