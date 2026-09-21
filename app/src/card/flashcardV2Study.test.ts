import {test} from "node:test";
import * as assert from "node:assert/strict";
import {FlashcardV2WeakCards, flashcardV2SubsetOptions, orderFlashcardV2StudyCards} from "./flashcardV2Study";
import {createFlashcardReviewTabData} from "./flashcardOpenMode";
import type {IFlashcardQueryAST} from "./flashcardV2Query";

const studyCards = [
    {card: {id: "a"}, reviewState: {due: 30, difficulty: 3, lapses: 2}},
    {card: {id: "b"}, reviewState: {due: 10, difficulty: 8, lapses: 0}},
    {card: {id: "c"}, reviewState: {due: 20, difficulty: 5, lapses: 4}},
    {card: {id: "new"}, reviewState: {due: 0, lapses: 0}},
];

test("subset ordering keeps the source and schedules intact and preserves ties", () => {
    const before = JSON.stringify(studyCards);
    assert.deepEqual(orderFlashcardV2StudyCards(studyCards, "selected"), ["a", "b", "c", "new"]);
    assert.deepEqual(orderFlashcardV2StudyCards(studyCards, "due"), ["new", "b", "c", "a"]);
    assert.deepEqual(orderFlashcardV2StudyCards(studyCards, "difficulty"), ["b", "c", "a", "new"]);
    assert.deepEqual(orderFlashcardV2StudyCards(studyCards, "lapses"), ["c", "a", "b", "new"]);
    const random = orderFlashcardV2StudyCards(studyCards, "random", () => 0);
    assert.notDeepEqual(random, ["a", "b", "c", "new"]);
    assert.deepEqual([...random].sort(), ["a", "b", "c", "new"]);
    assert.equal(JSON.stringify(studyCards), before);
});

test("filtered study preserves both the deck membership and the full query across windows", () => {
    const query: IFlashcardQueryAST = {version: 1, root: {operator: "predicate", field: "rootID", comparator: "equal", value: "doc"}};
    const options = flashcardV2SubsetOptions("deck", query, undefined, "normal");
    assert.deepEqual(options, {reviewMode: "normal", reviewSetIDs: ["deck"], query});
    assert.equal("cardIDs" in options, false);
    assert.equal("practiceLimit" in options, false);
    const data = JSON.parse(JSON.stringify(createFlashcardReviewTabData("", "Study", options)));
    assert.deepEqual(data.review, options);
});

test("selected practice includes the whole explicit selection without changing normal limits", () => {
    const ids = ["c", "b", "a"];
    const options = flashcardV2SubsetOptions("deck", undefined, ids, "reinforcement");
    assert.deepEqual(options, {
        reviewMode: "reinforcement", reviewSetIDs: ["deck"], cardIDs: ids, practiceLimit: 3,
    });
    ids.pop();
    assert.equal(options.cardIDs?.length, 3);
    assert.equal(flashcardV2SubsetOptions("", undefined, ids, "normal").practiceLimit, undefined);
    assert.equal(flashcardV2SubsetOptions("", undefined, undefined, "reinforcement").practiceLimit, undefined);
    assert.throws(() => flashcardV2SubsetOptions("", undefined, [], "normal"));
});

const queued = (id: string, status = "reviewed", generationStatus = "active") => ({
    card: {id, generationStatus}, sessionCard: {status},
});

test("weak practice uses the last accepted rating and excludes skipped or unavailable cards", () => {
    const tracker = new FlashcardV2WeakCards();
    const queue = [queued("a"), queued("b"), queued("c"), queued("unseen", "queued"),
        queued("deleted", "reviewed", "deleted"), queued("skipped", "skipped")];
    ["a", "b", "deleted", "skipped"].forEach((id) => tracker.record(id, "again"));
    tracker.record("c", "hard");
    tracker.record("a", "good");
    assert.deepEqual(tracker.cards(queue), ["b", "c"]);
    tracker.record("b", "easy");
    assert.deepEqual(tracker.cards(queue), ["c"]);
    assert.deepEqual(new FlashcardV2WeakCards().cards(queue), []);
});

test("undo restores weak membership for repeated learning cards and removes undone first ratings", () => {
    const tracker = new FlashcardV2WeakCards();
    const queue = [queued("a"), queued("b")];
    const first = tracker.record("a", "again");
    const previous = tracker.record("a", "good");
    assert.deepEqual(tracker.cards(queue), []);
    tracker.restore("a", previous);
    assert.deepEqual(tracker.cards(queue), ["a"]);
    tracker.restore("a", first);
    assert.deepEqual(tracker.cards(queue), []);
    tracker.record("b", "easy");
    const passed = tracker.record("b", "hard");
    tracker.restore("b", passed);
    assert.deepEqual(tracker.cards(queue), []);
});
