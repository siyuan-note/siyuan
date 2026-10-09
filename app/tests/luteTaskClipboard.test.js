const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

require("../stage/protyle/js/lute/lute.min.js");

describe("task status Markdown copying and export", () => {
    it("preserves task markers in copied Markdown and normalizes them for standard export", () => {
        const lute = globalThis.Lute.New();
        lute.SetProtyleWYSIWYG(true);
        lute.SetDataTask(true);
        lute.SetArbitraryTaskListItemMarker(true);
        lute.SetUnorderedListMarker("-");
        const markdown = "- [ ] todo\n- [/] progress\n\n  - [-] canceled\n- [X] done\n- [!] custom\n";
        const blockDOM = lute.Md2BlockDOM(markdown);
        lute.SetExportNormalizeTaskListMarker(false);
        assert.equal(lute.BlockDOM2StdMd(blockDOM), markdown);
        const roundTrip = lute.Md2BlockDOM(lute.BlockDOM2StdMd(blockDOM));
        assert.ok(roundTrip.includes('data-task="/"'));
        assert.ok(roundTrip.includes('data-task="-"'));
        assert.ok(roundTrip.includes('data-task="!"'));
        lute.SetExportNormalizeTaskListMarker(true);
        assert.equal(lute.BlockDOM2StdMd(blockDOM), markdown.replace(/\[[/!\-]\]/g, "[X]"));
    });
});
