import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {deferFlashcardV2QueueCard, flashcardV2QueueBreakdown, refreshFlashcardV2Queue, selectFlashcardV2Queue} from "./flashcardV2Queue";

const card = (id: string, status = "queued", repeatDue = 0, generationStatus = "active", state = "new") => ({
    card: {id, generationStatus}, sessionCard: {status}, repeatDue, reviewState: {state},
});

describe("flashcardV2Queue", () => {
    it("defers cards in order without changing progress, indices or refreshed states", () => {
        const queue = [card("first", "shown"), card("second"), card("third")];
        const deferred: string[] = [];
        const original = JSON.stringify(queue);
        assert.equal(deferFlashcardV2QueueCard(queue, 0, 100, deferred), true);
        assert.equal(selectFlashcardV2Queue(queue, 100, deferred).index, 1);
        assert.equal(deferFlashcardV2QueueCard(queue, 1, 100, deferred), true);
        assert.equal(selectFlashcardV2Queue(queue, 100, deferred).index, 2);
        assert.equal(JSON.stringify(queue), original);
        assert.equal(flashcardV2QueueBreakdown(queue).remaining, 3);
        refreshFlashcardV2Queue(queue, [card("third", "reviewed"), card("second"), card("first", "shown")]);
        assert.equal(selectFlashcardV2Queue(queue, 100, deferred).index, 0);
        assert.deepEqual(queue.map((item) => item.card.id), ["first", "second", "third"]);
        assert.equal(deferFlashcardV2QueueCard(queue, 0, 100, deferred), true);
        assert.deepEqual(deferred, ["second", "first"]);
    });

    it("defers a due repeat behind ready cards and does not loop the last ready card", () => {
        const queue = [card("learning", "reviewed", 50), card("new"), card("waiting", "reviewed", 500)];
        const deferred: string[] = [];
        assert.equal(deferFlashcardV2QueueCard(queue, 0, 100, deferred), true);
        assert.equal(selectFlashcardV2Queue(queue, 100, deferred).index, 1);
        queue[1].sessionCard.status = "reviewed";
        assert.equal(selectFlashcardV2Queue(queue, 100, deferred).index, 0);
        assert.equal(deferFlashcardV2QueueCard(queue, 0, 100, deferred), false);
        assert.equal(deferFlashcardV2QueueCard(queue, 2, 100, deferred), false);
        queue[0].sessionCard.status = "skipped";
        assert.deepEqual(selectFlashcardV2Queue(queue, 100, deferred), {index: -1, nextDue: 500});
    });

    it("excludes edit-later cards even when a pending or repeat status is stale", () => {
        const queue = [{...card("pending"), card: {id: "pending", generationStatus: "active", editLater: {note: "", updatedAt: 1}}},
            card("ready")];
        assert.equal(selectFlashcardV2Queue(queue, 100, ["ready"]).index, 1);
        assert.equal(deferFlashcardV2QueueCard(queue, 1, 100, []), false);
    });

    it("prioritizes due learning cards without consuming them before their due time", () => {
        const queue = [card("learning", "reviewed", 5000), ...Array.from({length: 200}, (_, i) => card(`${i}`))];
        assert.deepEqual(selectFlashcardV2Queue(queue, 4999), {index: 1, nextDue: 5000});
        assert.deepEqual(selectFlashcardV2Queue(queue, 5000), {index: 0, nextDue: 0});
        assert.equal(queue[0].sessionCard.status, "reviewed");
        assert.equal(flashcardV2QueueBreakdown(queue).remaining, 201);
    });

    it("waits for the last learning card and chooses the earliest due repeat", () => {
        const queue = [card("later", "reviewed", 6000), card("earlier", "reviewed", 5000)];
        assert.deepEqual(selectFlashcardV2Queue(queue, 4000), {index: -1, nextDue: 5000});
        assert.deepEqual(selectFlashcardV2Queue(queue, 6000), {index: 1, nextDue: 0});
        refreshFlashcardV2Queue(queue, [card("later", "reviewed"), card("earlier", "reviewed")]);
        assert.deepEqual(selectFlashcardV2Queue(queue, 7000), {index: -1, nextDue: 0});
    });

    it("keeps membership and positions stable while dropping unavailable repeats", () => {
        const queue = [card("first", "reviewed", 5000), card("second"), card("missing")];
        refreshFlashcardV2Queue(queue, [card("outside"), card("second"), card("first", "skipped")]);
        assert.deepEqual(queue.map((item) => item.card.id), ["first", "second", "missing"]);
        assert.deepEqual(selectFlashcardV2Queue(queue, 6000), {index: 1, nextDue: 0});
        assert.equal(flashcardV2QueueBreakdown(queue).skipped, 2);
    });

    it("restores an undone card and excludes skipped, deleted and graduated cards", () => {
        const queue = [card("undone", "reviewed", 5000), card("skipped", "skipped", 1),
            card("deleted", "reviewed", 1, "deleted"), card("graduated", "reviewed")];
        refreshFlashcardV2Queue(queue, [card("undone"), ...queue.slice(1)]);
        assert.deepEqual(selectFlashcardV2Queue(queue, 6000), {index: 0, nextDue: 0});
        assert.equal(queue[0].repeatDue, 0);
    });
});

it("reports pending repeats by state and separates completed and skipped cards", () => {
    const queue = [
        card("queued"), card("learning", "reviewed", 5000, "active", "learning"),
        card("review", "shown", 0, "active", "review"), card("again", "reviewed", 10, "active", "relearning"),
        card("done", "reviewed"), card("skipped", "skipped"),
        card("disabled", "shown", 0, "disabledByTemplate"),
        {...card("edit"), card: {id: "edit", generationStatus: "active", editLater: {note: "", updatedAt: 1}}},
    ];
    assert.deepEqual(flashcardV2QueueBreakdown(queue),
        {total: 8, remaining: 4, completed: 1, skipped: 3, new: 1, learning: 1, review: 1, relearning: 1,
            newCards: {position: 1, total: 2}, oldCards: {position: 3, total: 3}});
});

it("counts the current card once and preserves new and old groups through repeats, skips and undo", () => {
    const initialNewCardIDs = new Set(["new", "skip"]);
    const queue = [card("new"), card("old", "queued", 0, "active", "review"), card("skip")];
    const progress = (index: number) => {
        const {newCards, oldCards} = flashcardV2QueueBreakdown(queue, initialNewCardIDs, index);
        return [newCards, oldCards];
    };
    assert.deepEqual(progress(0), [{position: 1, total: 2}, {position: 0, total: 1}]);
    refreshFlashcardV2Queue(queue, [card("new", "reviewed", 500, "active", "learning"), queue[1], card("skip", "skipped")]);
    assert.deepEqual(progress(1), [{position: 1, total: 1}, {position: 1, total: 1}]);
    assert.deepEqual(progress(0), [{position: 1, total: 1}, {position: 0, total: 1}]);
    queue[0] = card("new", "reviewed", 0, "active", "review");
    assert.deepEqual(progress(0), [{position: 1, total: 1}, {position: 0, total: 1}]);
    queue[0] = card("new");
    assert.deepEqual(progress(1), [{position: 0, total: 1}, {position: 1, total: 1}]);
});
