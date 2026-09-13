import * as assert from "node:assert/strict";
import test from "node:test";
import {getPinnedDropPosition} from "./pinnedDocsDrop";

test("root insertion creates pins while child insertion changes source order", () => {
    assert.equal(getPinnedDropPosition(true, .1), "pin-before");
    assert.equal(getPinnedDropPosition(true, .9), "pin-after");
    assert.equal(getPinnedDropPosition(false, .1), "before");
    assert.equal(getPinnedDropPosition(false, .9), "after");
    for (const root of [false, true]) {
        assert.equal(getPinnedDropPosition(root, .5), "inside");
        assert.equal(getPinnedDropPosition(root, .25), "inside");
        assert.equal(getPinnedDropPosition(root, .75), "inside");
    }
});
