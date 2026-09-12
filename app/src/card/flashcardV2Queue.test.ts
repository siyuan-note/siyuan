import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {flashcardV2QueueProgress, refreshFlashcardV2Queue, selectFlashcardV2Queue} from "./flashcardV2Queue";

const card = (id: string, status = "queued", repeatDue = 0, generationStatus = "active") => ({
    card: {id, generationStatus}, sessionCard: {status}, repeatDue,
});

describe("flashcardV2Queue", () => {
    it("prioritizes due learning cards without consuming them before their due time", () => {
        const queue = [card("learning", "reviewed", 5000), ...Array.from({length: 200}, (_, i) => card(`${i}`))];
        assert.deepEqual(selectFlashcardV2Queue(queue, 4999), {index: 1, nextDue: 5000});
        assert.deepEqual(selectFlashcardV2Queue(queue, 5000), {index: 0, nextDue: 0});
        assert.equal(queue[0].sessionCard.status, "reviewed");
        assert.equal(flashcardV2QueueProgress(queue), "1 / 201");
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
        assert.equal(flashcardV2QueueProgress(queue), "2 / 3");
    });

    it("restores an undone card and excludes skipped, deleted and graduated cards", () => {
        const queue = [card("undone", "reviewed", 5000), card("skipped", "skipped", 1),
            card("deleted", "reviewed", 1, "deleted"), card("graduated", "reviewed")];
        refreshFlashcardV2Queue(queue, [card("undone"), ...queue.slice(1)]);
        assert.deepEqual(selectFlashcardV2Queue(queue, 6000), {index: 0, nextDue: 0});
        assert.equal(queue[0].repeatDue, 0);
    });
});
