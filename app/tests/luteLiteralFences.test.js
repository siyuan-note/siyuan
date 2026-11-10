const assert = require("node:assert/strict");
const {test} = require("node:test");
require("../stage/protyle/js/lute/lute.min.js");

for (const marker of ["```", "~~~~"]) {
    test(`Markdown export preserves literal ${marker} and following blocks`, () => {
        const lute = globalThis.Lute.New();
        lute.SetProtyleWYSIWYG(true);
        lute.SetAutoSpace(false);
        lute.SetParagraphBeginningSpace(true);
        let dom = lute.Md2BlockDOM("placeholder\n\n```\noriginal();\n```\n\n# Following\n\n![gif](assets/animation.gif)\n\n![png](assets/picture.png)\n", false);
        dom = dom.replace("placeholder", `&lt;pre&gt;\n  ${marker}Java\nexample\n&lt;/pre&gt;`);
        for (let pass = 0; pass < 3; pass++) {
            const markdown = lute.BlockDOM2StdMd(dom);
            dom = lute.Md2BlockDOM(markdown, false);
            assert.equal((dom.match(/data-type="NodeCodeBlock"/g) || []).length, 1);
            assert.equal((dom.match(/data-type="NodeHeading"/g) || []).length, 1);
            assert.ok(dom.includes("original();"));
            assert.ok(dom.includes("assets/animation.gif"));
            assert.ok(dom.includes("assets/picture.png"));
            assert.ok(lute.BlockDOM2Content(dom).includes(`${marker}Java`));
        }
    });
}

test("typing code fences still converts editor input to a code block", () => {
    const lute = globalThis.Lute.New();
    lute.SetProtyleWYSIWYG(true);
    const dom = lute.SpinBlockDOM("```\nexample\n```");
    assert.ok(dom.includes("data-type=\"NodeCodeBlock\""));
    assert.ok(dom.includes("example"));
});
