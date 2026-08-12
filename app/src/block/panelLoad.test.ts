import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getBlockPanelLoadPlan} from "./panelLoad";

describe("getBlockPanelLoadPlan", () => {
    it("loads document backlinks as regular document context", () => {
        assert.deepEqual(getBlockPanelLoadPlan("document", "document", true), {
            isDocument: true,
            useBacklinkContext: false,
        });
    });

    it("keeps backlink context for blocks inside documents", () => {
        assert.deepEqual(getBlockPanelLoadPlan("document", "block", true), {
            isDocument: false,
            useBacklinkContext: true,
        });
    });

    it("loads regular document popovers without backlink context", () => {
        assert.deepEqual(getBlockPanelLoadPlan("document", "document", false), {
            isDocument: true,
            useBacklinkContext: false,
        });
    });

    it("loads regular block popovers without backlink context", () => {
        assert.deepEqual(getBlockPanelLoadPlan("document", "block", false), {
            isDocument: false,
            useBacklinkContext: false,
        });
    });
});
