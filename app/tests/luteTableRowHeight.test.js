const assert = require("node:assert/strict");
const {test} = require("node:test");

require("../stage/protyle/js/lute/lute.min.js");

test("table row heights survive editor, internal Markdown and HTML conversion", () => {
    const lute = globalThis.Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetKramdownIAL(true);
    for (const cells of ["<td>A</td><td>B</td>", '<td colspan="2">A</td><td class="fn__none"></td>']) {
        let dom = '<div data-type="NodeTable"><div><table><thead><tr style="height: 60px;"><th>H1</th><th>H2</th></tr></thead>' +
            `<tbody><tr style="height: 100px;">${cells}</tr></tbody></table></div></div>`;
        for (let round = 0; round < 3; round++) {
            dom = lute.SpinBlockDOM(dom);
            assert.match(dom, /<tr style="height: 60px;">/);
            assert.match(dom, /<tr style="height: 100px;">/);
            assert.match(lute.BlockDOM2HTML(dom), /<tr style="height: 100px;">/);
            dom = lute.Md2BlockDOM(lute.BlockDOM2Md(dom));
        }
        assert.doesNotMatch(lute.BlockDOM2StdMd(dom), /row-style=/);
    }
});
