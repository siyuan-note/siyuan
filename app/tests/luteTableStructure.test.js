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
    it("preserves multi-row headers and merged cells through internal round trips and HTML interchange", () => {
        const lute = createLute();
        for (const [head, rowCount] of [
            ["<tr><th>A</th><th>B</th><th>C</th></tr><tr><th>D</th><th>E</th><th>F</th></tr>", 2],
            ['<tr style="height: 60px;"><th rowspan="3">group</th><th colspan="2">metrics</th></tr>' +
                '<tr><th rowspan="2" style="text-align: right;">child</th><th>one</th></tr><tr><th>two</th></tr>', 3],
        ]) {
            let dom = lute.HTML2BlockDOM(`<table><thead>${head}</thead><tbody>` +
                "<tr><td>a</td><td>b</td><td>c</td></tr></tbody></table>");
            for (let round = 0; round < 3; round++) {
                dom = lute.SpinBlockDOM(dom);
                const header = dom.match(/<thead>(.*?)<\/thead>/s)[1];
                assert.equal((header.match(/<tr[\s>]/g) || []).length, rowCount);
                assert.match(dom, /<tbody><tr><td>a<\/td><td>b<\/td><td>c<\/td><\/tr><\/tbody>/);
                if (rowCount === 3) {
                    assert.match(header, /rowspan="3"/);
                    assert.match(header, /rowspan="2"/);
                    assert.match(header, /colspan="2"/);
                    assert.match(header, /height: 60px/);
                    assert.match(header, /text-align: right/);
                }
                dom = lute.Md2BlockDOM(lute.BlockDOM2Md(dom));
            }
            if (rowCount === 3) {
                const markdown = lute.BlockDOM2StdMd(dom);
                assert.match(markdown, /<thead>/);
                assert.match(markdown, /rowspan="3"/);
                const restored = lute.HTML2BlockDOM(markdown);
                assert.equal((restored.match(/<thead>(.*?)<\/thead>/s)[1].match(/<tr[\s>]/g) || []).length, 3);
            }
        }
    });

    it("normalizes omitted merged-cell slots without adding visible cells", () => {
        const lute = createLute();
        const head = "<thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>";
        for (const [body, expected] of [
            [
                "<tr><td>a</td><td rowspan=\"2\">merged</td><td>b</td></tr><tr><td>c</td><td>d</td></tr>",
                "<tr><td>a</td><td rowspan=\"2\">merged</td><td>b</td></tr><tr><td>c</td><td class=\"fn__none\"></td><td>d</td></tr>",
            ],
            [
                "<tr><td colspan=\"2\" rowspan=\"2\">merged</td><td>b</td></tr><tr><td>c</td></tr>",
                "<tr><td colspan=\"2\" rowspan=\"2\">merged</td><td class=\"fn__none\"></td><td>b</td></tr><tr><td class=\"fn__none\"></td><td class=\"fn__none\"></td><td>c</td></tr>",
            ],
        ]) {
            for (const source of [body, expected]) {
                let dom = `<div data-type="NodeTable"><div><table>${head}<tbody>${source}</tbody></table></div></div>`;
                for (let round = 0; round < 3; round++) {
                    dom = lute.SpinBlockDOM(dom);
                    assert.ok(dom.includes(`<tbody>${expected}</tbody>`), dom);
                    assert.equal((dom.match(/<col \/>/g) || []).length, 3);
                }
            }
        }
    });

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
