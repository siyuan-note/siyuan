import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getPartialUpdateCleanupElements,
    shouldDeferCodeBlockCaretRestore,
    shouldReloadForHeadingBatch,
} from "./transactionUpdate";

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

describe("shouldDeferCodeBlockCaretRestore", () => {
    const replayCodeBlock = {
        isRangeBlock: true,
        isReplay: true,
        hasCaret: true,
        isCodeBlock: true,
        isRendered: false,
    };

    it("defers the caret until an active replayed code block is highlighted", () => {
        assert.equal(shouldDeferCodeBlockCaretRestore(replayCodeBlock), true);
    });

    it("keeps the synchronous restore path for an already highlighted undo snapshot", () => {
        assert.equal(shouldDeferCodeBlockCaretRestore({...replayCodeBlock, isRendered: true}), false);
    });

    it("does not let an inactive code block steal focus", () => {
        assert.equal(shouldDeferCodeBlockCaretRestore({...replayCodeBlock, isRangeBlock: false}), false);
    });

    it("does not defer caret restoration for ordinary blocks", () => {
        assert.equal(shouldDeferCodeBlockCaretRestore({...replayCodeBlock, isCodeBlock: false}), false);
    });
});

describe("shouldReloadForHeadingBatch", () => {
    it("does not reload when both the Lite root and the operation context omit a root ID", () => {
        assert.equal(shouldReloadForHeadingBatch(undefined, [{}]), false);
    });

    it("reloads when an operation targets the current heading batch root", () => {
        assert.equal(shouldReloadForHeadingBatch("root", [{
            context: {headingBatchRootID: "root"},
        }]), true);
    });

    it("does not reload for another heading batch root", () => {
        assert.equal(shouldReloadForHeadingBatch("root", [{
            context: {headingBatchRootID: "other"},
        }]), false);
    });
});
