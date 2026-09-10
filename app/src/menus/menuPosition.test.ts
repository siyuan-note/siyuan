import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getAnchoredMenuPosition} from "./menuPosition";

describe("getAnchoredMenuPosition", () => {
    it("keeps a short menu below the button", () => {
        assert.deepEqual(getAnchoredMenuPosition(300, 24, 200, 800, 32), {top: 300, height: 200});
    });

    it("opens above when the complete menu fits there", () => {
        assert.deepEqual(getAnchoredMenuPosition(700, 24, 300, 800, 32), {top: 376, height: 300});
    });

    it("limits a long menu to the larger space below", () => {
        assert.deepEqual(getAnchoredMenuPosition(300, 24, 700, 800, 32), {top: 300, height: 500});
    });

    it("limits a long menu above without overlapping the button or top bar", () => {
        assert.deepEqual(getAnchoredMenuPosition(500, 24, 700, 800, 32), {top: 32, height: 444});
    });

    it("recalculates the available height after the window shrinks", () => {
        assert.deepEqual(getAnchoredMenuPosition(300, 24, 700, 400, 32), {top: 32, height: 244});
    });
});
