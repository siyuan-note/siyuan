import {it} from "node:test";
import * as assert from "node:assert/strict";
import type {Dialog} from "../dialog";
import {closeNotebookHistoryDialogs, forgetNotebookHistoryDialog, trackNotebookHistoryDialog} from "./notebookDialogs";

it("closes snapshot details before their history dialog when a notebook locks", () => {
    const closed: string[] = [];
    const makeDialog = (name: string) => ({destroy: () => { closed.push(name); }} as Dialog);
    const history = makeDialog("history");
    const detail = makeDialog("detail");
    const other = makeDialog("other");
    trackNotebookHistoryDialog(history, ["encrypted"]);
    trackNotebookHistoryDialog(detail, ["encrypted", "another"]);
    trackNotebookHistoryDialog(other, ["unrelated"]);
    closeNotebookHistoryDialogs("encrypted");
    assert.deepEqual(closed, ["detail", "history"]);
    closeNotebookHistoryDialogs("another");
    assert.equal(closed.length, 2);
    forgetNotebookHistoryDialog(other);
    closeNotebookHistoryDialogs("unrelated");
    assert.equal(closed.length, 2);
});
