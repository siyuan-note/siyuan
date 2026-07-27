import assert from "node:assert/strict";
import test from "node:test";
import {shouldSubmitDateEdit} from "../src/protyle/render/av/dateSubmit";

test("submits the prefilled date for a regular cell", () => {
    assert.equal(shouldSubmitDateEdit(false, false), true);
});

test("requires a change when batch editing dates", () => {
    assert.equal(shouldSubmitDateEdit(false, true), false);
    assert.equal(shouldSubmitDateEdit(true, true), true);
});
