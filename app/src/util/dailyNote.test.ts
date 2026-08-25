import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getLastDailyNoteNotebookId} from "./dailyNote";

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
