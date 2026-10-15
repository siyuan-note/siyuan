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
    lute.SetExportNormalizeTaskListMarker(false);
    return lute;
};

describe("Markdown table structure", () => {
    it("preserves tasks, nested lists, styles and multiline code through copy and paste", () => {
        const lute = createLute();
        const source = '- [/] progress\n  - [ ] nested\n\n<span style="color:red">colored</span>\n\n```go\na | b\nc\n```';
        const encoded = Buffer.from(JSON.stringify({spec: 1, format: "kramdown", content: source})).toString("base64url");
        let dom = '<div data-type="NodeTable"><div contenteditable="true"><table><thead><tr><th>head</th></tr></thead>' +
            `<tbody><tr><td data-sy-table-cell-rich="${encoded}"></td></tr></tbody></table></div></div>`;
        for (let round = 0; round < 3; round++) {
            const markdown = lute.BlockDOM2StdMd(dom);
            assert.equal(markdown.trim().split("\n").length, 3);
            assert.doesNotMatch(markdown, /table-cell-rich/);
            dom = lute.Md2BlockDOM(markdown);
            const payload = dom.match(/data-sy-table-cell-rich="([^"]+)"/);
            assert.ok(payload, dom);
            const restored = JSON.parse(Buffer.from(payload[1], "base64url").toString("utf8")).content;
            assert.match(restored, /\[\/\] progress/);
            assert.match(restored, /\[ \] nested/);
            assert.match(restored, /a \| b\nc\n/);
            assert.match(dom, /color: red/);
            assert.match(dom, /type="checkbox"/);
        }
    });

    it("restores legacy task markers while preserving literal cells", () => {
        const lute = createLute();
        for (const convert of ["Md2BlockDOM", "Md2BlockDOMWithAutoLink"]) {
            const task = lute[convert]("| head |\n| --- |\n| - [ ] todo<br />- [x] done |");
            assert.match(task, /data-sy-table-cell-rich=/);
            assert.equal((task.match(/type="checkbox"/g) || []).length, 2);
            for (const literal of ["`- [ ] code`", "\\- [ ] escaped", "<ul><li>unclosed", "- ordinary"]) {
                assert.doesNotMatch(lute[convert](`| head |\n| --- |\n| ${literal} |`), /data-sy-table-cell-rich=/);
            }
        }
    });
});
