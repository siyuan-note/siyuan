import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getPartialUpdateCleanupElements} from "./transactionUpdate";

describe("getPartialUpdateCleanupElements", () => {
    const breadcrumb = {id: "breadcrumb"};
    const updateRoot = {id: "update-root"};
    const sibling = {id: "sibling"};
    const rootElements = [breadcrumb, updateRoot, sibling];

    it("preserves backlink breadcrumbs and sibling contexts", () => {
        assert.deepEqual(getPartialUpdateCleanupElements(rootElements, updateRoot, true), []);
    });

    it("keeps only the actual partial-update root in a zoomed editor", () => {
        assert.deepEqual(getPartialUpdateCleanupElements(rootElements, updateRoot, false), [breadcrumb, sibling]);
    });

    it("does not clean up roots when the update root cannot be resolved", () => {
        assert.deepEqual(getPartialUpdateCleanupElements(rootElements, undefined, false), []);
    });
});
