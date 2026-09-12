import * as assert from "node:assert/strict";
import {test} from "node:test";
import {flashcardTabQuery, normalizeFlashcardTabData} from "./flashcardTab";

test("document scope and an additional query remain intersected", () => {
    const query = {version: 1, root: {operator: "predicate" as const, field: "presetID", comparator: "equal", value: "preset"}};
    assert.deepEqual(flashcardTabQuery({type: "doc", id: "doc", query}), {
        version: 1, root: {operator: "and", children: [
            {operator: "predicate", field: "rootID", comparator: "equal", value: "doc"}, query.root,
        ]},
    });
    assert.equal(flashcardTabQuery({type: "all", query}), query);
});

test("empty explicit selections never become a global review", () => {
    for (const cardIDs of [[], [" "], null, [1], "card"] as unknown as string[][]) {
        assert.throws(() => flashcardTabQuery({type: "all", cardIDs}));
    }
    assert.throws(() => flashcardTabQuery({type: "all", reviewSetIDs: []}));
    assert.throws(() => flashcardTabQuery({type: "doc"}));
    assert.throws(() => flashcardTabQuery({type: "notebook", id: " "}));
    assert.equal(flashcardTabQuery({type: "all", reviewSetIDs: ["a", "b"]}), undefined);
});

test("legacy layouts become normal sessions with the same scope and no stale queue", () => {
    for (const cardType of ["all", "doc", "notebook"] as const) {
        const old = {cardType, id: cardType === "all" ? "" : "scope", title: "saved title",
            cardsData: {cards: ["obsolete-card"]}, index: 7};
        const data = normalizeFlashcardTabData(JSON.parse(JSON.stringify(old)));
        assert.equal(data.cardType, cardType);
        assert.equal(data.title, old.title);
        assert.equal(data.review.reviewMode, "normal");
        assert.deepEqual(data.review.query, flashcardTabQuery({type: cardType, id: old.id}));
        assert.equal("cardsData" in data, false);
        assert.equal("index" in data, false);
        assert.equal(JSON.stringify(normalizeFlashcardTabData(JSON.parse(JSON.stringify(data)))), JSON.stringify(data));
    }
});

test("restoring a new layout preserves mixed sets, query, and reinforcement mode", () => {
    const review = {reviewMode: "reinforcement" as const, reviewSetIDs: ["a", "b"],
        cardIDs: ["third", "first", "second"],
        query: {version: 1, root: {operator: "matchAll" as const}}};
    const data = normalizeFlashcardTabData({cardType: "all", id: "", review});
    assert.deepEqual(data.review, review);
    assert.throws(() => normalizeFlashcardTabData({cardType: "doc", id: ""}));
});

test("legacy deck scopes require mapping and never expand to all cards", () => {
    const old = {cardType: "all" as const, id: "legacy-deck"};
    assert.throws(() => normalizeFlashcardTabData(old));
    assert.deepEqual(normalizeFlashcardTabData(old, "migrated-set").review,
        {reviewMode: "normal", reviewSetIDs: ["migrated-set"], query: undefined});
});
