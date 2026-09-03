import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getSelectionElementAvailableHeight, getSelectionElementY} from "./selectionElementPosition";

const options = {
    elementHeight: 120,
    rangeTop: 300,
    rangeBottom: 320,
    topBoundary: 20,
    bottomBoundary: 700,
    gap: 4,
    isBottom: false,
};

describe("selection element position", () => {
    it("places a child panel outside a toolbar above the selection", () => {
        assert.equal(getSelectionElementY({...options, toolbarTop: 260, toolbarBottom: 290}), 136);
    });

    it("places a child panel outside a toolbar below the selection", () => {
        assert.equal(getSelectionElementY({...options, toolbarTop: 330, toolbarBottom: 360}), 364);
    });

    it("falls back to the opposite side when the toolbar side has insufficient space", () => {
        assert.equal(getSelectionElementY({
            ...options,
            rangeTop: 130,
            rangeBottom: 150,
            toolbarTop: 90,
            toolbarBottom: 120,
        }), 154);
    });

    it("reserves the toolbar space when limiting a child panel", () => {
        assert.equal(getSelectionElementAvailableHeight({...options, toolbarTop: 260, toolbarBottom: 290}), 376);
    });
});
