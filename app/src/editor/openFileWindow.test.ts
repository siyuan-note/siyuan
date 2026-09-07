import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {shouldCheckOtherWindows} from "./openFileWindow";

describe("cross-window file opening", () => {
    it("checks other windows for regular file opening", () => {
        assert.equal(shouldCheckOtherWindows({}), true);
    });

    it("keeps the existing split-position behavior", () => {
        assert.equal(shouldCheckOtherWindows({position: "right"}), false);
        assert.equal(shouldCheckOtherWindows({position: "bottom"}), false);
        assert.equal(shouldCheckOtherWindows({position: "right", assetPath: "assets/test.pdf"}), true);
    });

    it("stays in the target window when explicitly requested", () => {
        assert.equal(shouldCheckOtherWindows({forceCurrentWindow: true}), false);
        assert.equal(shouldCheckOtherWindows({
            position: "right",
            assetPath: "assets/test.pdf",
            forceCurrentWindow: true,
        }), false);
    });
});
