import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {genNotebookOptionsHTML, getLastDailyNoteNotebookId} from "./dailyNote";

describe("daily note notebook selection", () => {
    const notebooks = [
        {id: "open", closed: false},
        {id: "closed", closed: true},
    ];

    it("reuses the last open notebook", () => {
        assert.equal(getLastDailyNoteNotebookId(notebooks, "open"), "open");
    });

    it("falls back when the notebook is missing or closed", () => {
        assert.equal(getLastDailyNoteNotebookId(notebooks, "closed"), undefined);
        assert.equal(getLastDailyNoteNotebookId(notebooks, "missing"), undefined);
        assert.equal(getLastDailyNoteNotebookId(notebooks, undefined), undefined);
    });
});

describe("daily note notebook options", () => {
    it("escapes notebook names so they cannot inject markup", () => {
        const html = genNotebookOptionsHTML([{
            id: "20260101120000-abcdefg",
            name: "</option></select><img src=x onerror=alert(document.domain)>",
            closed: false,
        }]);
        assert.ok(!html.includes("<img"), `raw img tag reached dialog HTML: ${html}`);
        // escapeHtml 只处理 & 和 <，转义 < 已足以让标签无法成立
        assert.ok(html.includes("&lt;/option>&lt;/select>&lt;img src=x onerror=alert(document.domain)>"),
            `actual: ${JSON.stringify(html)}`);
    });

    it("escapes ampersands so stored entities stay text", () => {
        const html = genNotebookOptionsHTML([{
            id: "20260101120000-abcdefg",
            name: "&lt;img src=x onerror=alert(document.domain)&gt;",
            closed: false,
        }]);
        assert.ok(!html.includes("<img"), `entity decoded into a live tag: ${html}`);
        assert.ok(html.includes("&amp;lt;img"), `actual: ${JSON.stringify(html)}`);
    });

    it("skips closed notebooks and keeps plain names unchanged", () => {
        const html = genNotebookOptionsHTML([
            {id: "20260101120000-abcdefg", name: "Notes & Ideas", closed: false},
            {id: "20260101120001-hijklmn", name: "Closed", closed: true},
        ]);
        assert.equal(html, "<option value=\"20260101120000-abcdefg\">Notes &amp; Ideas</option>");
    });
});
