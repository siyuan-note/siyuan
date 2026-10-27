import {strict as assert} from "node:assert";
import {test} from "node:test";
import {createRequire} from "node:module";
import {markdownMathPaste} from "./markdownMathPaste";

createRequire(import.meta.url)("../../../stage/protyle/js/lute/lute.min.js");

test("pasted Markdown recognizes alternate delimiters without changing subsequent editing", () => {
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    const source = "| Formula | Value |\n| --- | --- |\n| \\(\\hat VY\\) | 0.60 |\n\n\\[\nx+y\n\\]";
    for (const autoLink of [false, true]) {
        const dom = markdownMathPaste(lute, source, true, autoLink);
        assert.match(dom, /data-type="inline-math"/);
        assert.match(dom, /data-type="NodeMathBlock"/);
        assert.match(dom, /0\.60/);
        assert.doesNotMatch(lute.Md2BlockDOM("\\(x\\)"), /data-type="inline-math"/);
        assert.doesNotMatch(markdownMathPaste(lute, source, false, autoLink), /data-type="(?:inline-math|NodeMathBlock)"/);
    }
});

test("paste compatibility preserves code and restores the engine after a conversion error", () => {
    const lute = Lute.New();
    assert.doesNotMatch(markdownMathPaste(lute, "`\\(x\\)`\n\n```tex\n\\[x\\]\n```", true), /data-type="(?:inline-math|NodeMathBlock)"/);
    const original = lute.Md2BlockDOM;
    lute.Md2BlockDOM = () => {
        throw new Error("conversion failed");
    };
    assert.throws(() => markdownMathPaste(lute, "\\(x\\)", true), /conversion failed/);
    lute.Md2BlockDOM = original;
    assert.doesNotMatch(lute.Md2BlockDOM("\\(x\\)"), /data-type="inline-math"/);
});
