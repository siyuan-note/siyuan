import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {resolveDockPanelVisibility} from "./panelVisibility";

describe("dock panel visibility", () => {
    it("toggles a non-empty panel when visibility is omitted", () => {
        assert.deepEqual(resolveDockPanelVisibility(true, true), {
            changed: true,
            storedVisible: false,
            visible: false,
        });
        assert.deepEqual(resolveDockPanelVisibility(false, true), {
            changed: true,
            storedVisible: true,
            visible: true,
        });
    });

    it("sets a non-empty panel idempotently", () => {
        assert.deepEqual(resolveDockPanelVisibility(true, true, true), {
            changed: false,
            storedVisible: true,
            visible: true,
        });
        assert.deepEqual(resolveDockPanelVisibility(false, true, false), {
            changed: false,
            storedVisible: false,
            visible: false,
        });
    });

    it("keeps an empty panel closed without retaining a collapsed state", () => {
        assert.deepEqual(resolveDockPanelVisibility(false, false, true), {
            changed: true,
            storedVisible: true,
            visible: false,
        });
        assert.deepEqual(resolveDockPanelVisibility(true, false, false), {
            changed: false,
            storedVisible: true,
            visible: false,
        });
    });
});
