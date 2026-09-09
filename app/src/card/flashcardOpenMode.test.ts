import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createFlashcardReviewTabData, resolveFlashcardOpenMode} from "./flashcardOpenMode";
import {normalizeFlashcardTabData} from "./flashcardTab";
import {flashcardV2LocationQuery} from "./flashcardV2Query";

test("missing and unsupported opening preferences preserve the dialog default", () => {
    for (const mode of [undefined, -1, 4, NaN, 1.5]) {
        assert.equal(resolveFlashcardOpenMode(mode, false, false), 0);
    }
    for (const mode of [0, 1, 2, 3]) {
        assert.equal(resolveFlashcardOpenMode(mode, false, false), mode);
        assert.equal(resolveFlashcardOpenMode(mode, true, false), 0);
        assert.equal(resolveFlashcardOpenMode(mode, true, true), 0);
        assert.equal(resolveFlashcardOpenMode(mode, false, true), mode === 3 ? 1 : mode);
    }
});

test("opening and restoring a tab preserves global, document, and notebook review scopes", () => {
    for (const query of [undefined, flashcardV2LocationQuery("rootID", "doc"),
        flashcardV2LocationQuery("notebookID", "notebook")]) {
        const options = {reviewMode: "normal" as const, query};
        const data = createFlashcardReviewTabData("", "Review title", options);
        const restored = normalizeFlashcardTabData(JSON.parse(JSON.stringify(data)));
        assert.equal(restored.title, "Review title");
        assert.deepEqual(restored.review.query, query);
        assert.equal(restored.review.reviewMode, "normal");
    }
});

test("review set and reinforcement filters survive transfer to another window", () => {
    const options = {
        reviewMode: "reinforcement" as const,
        includeSuspended: true,
        includeBuried: true,
        includePaused: true,
        query: flashcardV2LocationQuery("rootID", "doc"),
    };
    const data = createFlashcardReviewTabData("selected-set", "Set", options);
    const restored = normalizeFlashcardTabData(JSON.parse(JSON.stringify(data)));
    assert.equal(restored.reviewSetID, "selected-set");
    assert.deepEqual(restored.review, options);
    assert.equal("reviewSetIDs" in options, false);
    const mixed = {...options, reviewSetIDs: ["a", "b"]};
    assert.deepEqual(createFlashcardReviewTabData("", "Mixed", mixed).review, mixed);
});
