const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

require("../stage/protyle/js/lute/lute.min.js");

const createLute = () => {
    const lute = globalThis.Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetTextMark(true);
    lute.SetKramdownIAL(true);
    lute.SetEnsureListItemParagraph(true);
    lute.SetSuperBlock(true);
    lute.SetCallout(true);
    lute.SetDataTask(true);
    lute.SetUnorderedListMarker("-");
    lute.SetExportNormalizeTaskListMarker(false);
    return lute;
};

describe("list Markdown copying", () => {
    for (const [name, source, expected] of [
        ["tight nested list", "- parent\n\n  - child\n- sibling\n", "- parent\n  - child\n- sibling\n"],
        ["multiple paragraphs", "- first\n\n  second\n- sibling\n", "- first\n\n  second\n\n- sibling\n"],
        ["non-one ordered sublist", "- parent\n\n  2. child\n- sibling\n", "- parent\n\n  2. child\n\n- sibling\n"],
        ["thematic break", "- text\n\n  ---\n- sibling\n", "- text\n\n  ---\n\n- sibling\n"],
        ["empty nested item", "- text\n\n  -\n  - child\n- sibling\n", "- text\n\n  -\n  - child\n\n- sibling\n"],
        ["HTML block boundary", "- <div>\n  html\n  </div>\n\n  text\n- sibling\n", "- <div>\n  html\n  </div>\n\n  text\n\n- sibling\n"],
        ["flattened super block", "- before\n\n  {{{row\n  inside\n  }}}\n- sibling\n", "- before\n\n  inside\n\n- sibling\n"],
    ]) {
        it(name, () => {
            const lute = createLute();
            const copied = lute.BlockDOM2StdMd(lute.Md2BlockDOM(source));
            assert.equal(copied, expected);
            assert.equal(lute.BlockDOM2StdMd(lute.Md2BlockDOM(copied)), expected);
        });
    }

    it("keeps adjacent callouts separate", () => {
        const lute = createLute();
        const source = "- > [!NOTE]\n  > first\n\n  > [!TIP]\n  > second\n- sibling\n";
        const copied = lute.BlockDOM2StdMd(lute.Md2BlockDOM(source));
        const restored = lute.Md2BlockDOM(copied);
        assert.equal((restored.match(/data-type="NodeCallout"/g) || []).length, 2);
        assert.match(restored, /first/);
        assert.match(restored, /second/);
    });
});
