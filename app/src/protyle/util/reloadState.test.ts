import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {shouldReloadProtyle} from "./reloadState";

describe("shouldReloadProtyle", () => {
    it("skips an editor that has not loaded a document", () => {
        assert.equal(shouldReloadProtyle({block: {}, options: {}}), false);
    });

    it("reloads an editor that has loaded a document", () => {
        assert.equal(shouldReloadProtyle({
            block: {rootID: "20240101120000-abcdefg"},
            options: {},
        }), true);
    });

    it("reloads a backlink editor without a loaded document", () => {
        assert.equal(shouldReloadProtyle({
            block: {},
            options: {backlinkData: []},
        }), true);
    });
});
