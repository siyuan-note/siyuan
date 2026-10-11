const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

require("../stage/protyle/js/lute/lute.min.js");

const createLute = () => {
    const lute = globalThis.Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetHTMLTag2TextMark(true);
    lute.SetTextMark(true);
    lute.SetKramdownIAL(true);
    lute.SetAutoSpace(false);
    return lute;
};

describe("Markdown table HTML styles", () => {
    it("restores plain and native spans without changing table content", () => {
        const lute = createLute();
        const markdown = [
            "| 任务 | 内容 | 备注 |",
            "| --- | --- | --- |",
            "| - [ ] 测试文本 | <span style=\"color: var(--b3-font-color6);\">测试文本 ⭐⭐⭐ / 测试文本</span>⭐⭐⭐ | <span data-type=\"text\" style=\"color: var(--b3-font-color10);\">原生文本</span><br />测试文本<span style=\"color: var(--b3-font-color6);\">测试文本 </span>⭐ |",
        ].join("\n");
        for (const convert of ["Md2BlockDOM", "Md2BlockDOMWithAutoLink"]) {
            let dom = lute[convert](markdown);
            for (let round = 0; round < 2; round++) {
                assert.equal((dom.match(/data-type="NodeTable"/g) || []).length, 1);
                assert.equal((dom.match(/<td\b/g) || []).length, 3);
                assert.ok(dom.includes('type="checkbox"'));
                assert.ok(dom.includes('data-sy-table-cell-rich="'));
                assert.ok(dom.includes("style=\"color: var(--b3-font-color6);\">测试文本 ⭐⭐⭐ / 测试文本</span>⭐⭐⭐"));
                assert.ok(dom.includes("style=\"color: var(--b3-font-color10);\">原生文本</span><br />"));
                assert.ok(dom.includes("style=\"color: var(--b3-font-color6);\">测试文本 </span>⭐"));
                assert.ok(!dom.includes("&lt;span"));
                dom = lute.SpinBlockDOM(dom);
            }
        }
    });

    it("preserves nested colors and Markdown formatting", () => {
        const dom = createLute().Md2BlockDOM("| Header |\n| --- |\n| <SPAN class='custom' STYLE='color:var(--b3-font-color6);background:var(--b3-font-background3)'>outer <span style='color:red'>inner</span> **bold** [link](https://example.com)</SPAN> |");
        assert.ok(dom.includes("color: red;background-color: var(--b3-font-background3);\">inner</span>"));
        assert.ok(dom.includes("data-type=\"strong\""));
        assert.ok(dom.includes("data-href=\"https://example.com\""));
        assert.ok(!/\bclass="custom"|&lt;span|&lt;SPAN/.test(dom));
    });

    it("keeps literal code, escaped tags and unclosed spans unstyled", () => {
        const lute = createLute();
        for (const content of [
            "`<span style=\"color:var(--b3-font-color6)\">code</span>`",
            "&lt;span style=\"color:var(--b3-font-color6)\"&gt;literal&lt;/span&gt;",
            "<span style=\"color:var(--b3-font-color6)\">unclosed",
        ]) {
            const dom = lute.Md2BlockDOM(`| Header |\n| --- |\n| ${content} |`);
            assert.ok(!/<span\b[^>]*\bstyle=/.test(dom), dom);
            assert.ok(dom.includes("&lt;span"), dom);
        }
    });
});
