import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    buildFlashcardV2TagAssignmentGroups,
    canUseFlashcardV2ReviewActions,
    getFlashcardV2ConfirmedQueueStatuses,
    getFlashcardV2ReviewShortcutAction,
    getFlashcardV2TagSelection,
    shouldLoadFlashcardV2HeadingChildren,
} from "./flashcardV2State";

describe("flashcardV2State", () => {
    it("synchronizes only backend-confirmed terminal states after a failed rating", () => {
        const item = (id: string, status: string, generationStatus = "active") => ({
            card: {id, generationStatus}, sessionCard: {status},
        });
        const queue = [item("limited", "shown"), item("saved", "queued"), item("deleted", "queued"),
            item("available", "queued"), item("missing", "queued"), item("finished", "reviewed")];
        const refreshed = [item("limited", "skipped"), item("saved", "reviewed"), item("deleted", "queued", "deleted"),
            item("available", "queued"), item("finished", "queued"), item("outside", "skipped")];
        assert.deepEqual(getFlashcardV2ConfirmedQueueStatuses(queue, refreshed), {
            limited: "skipped", saved: "reviewed", deleted: "skipped",
        });
        assert.equal(queue[0].sessionCard.status, "shown");
    });

    it("keeps the current card after an unrelated save failure or an unsuccessful queue refresh", () => {
        const current = {card: {id: "current", generationStatus: "active"}, sessionCard: {status: "shown"}};
        assert.deepEqual(getFlashcardV2ConfirmedQueueStatuses([current], [current]), {});
        assert.deepEqual(getFlashcardV2ConfirmedQueueStatuses([current], []), {});
    });

    it("blocks review actions until the current card finishes rendering", () => {
        const ready = {
            renderPending: false,
            requestPending: false,
            sessionFinished: false,
            index: 0,
            queueLength: 1,
        };
        assert.equal(canUseFlashcardV2ReviewActions(ready), true);
        assert.equal(canUseFlashcardV2ReviewActions({...ready, renderPending: true}), false);
        assert.equal(canUseFlashcardV2ReviewActions({...ready, requestPending: true}), false);
        assert.equal(canUseFlashcardV2ReviewActions({...ready, sessionFinished: true}), false);
        assert.equal(canUseFlashcardV2ReviewActions({...ready, index: 1}), false);
    });

    it("loads expanded DOM only for folded headings", () => {
        assert.equal(shouldLoadFlashcardV2HeadingChildren("NodeHeading", "1"), true);
        assert.equal(shouldLoadFlashcardV2HeadingChildren("NodeHeading", null), false);
        assert.equal(shouldLoadFlashcardV2HeadingChildren("NodeParagraph", "1"), false);
    });

    it("keeps the legacy and current review shortcut aliases aligned", () => {
        assert.equal(getFlashcardV2ReviewShortcutAction("Enter"), "revealOrGood");
        assert.equal(getFlashcardV2ReviewShortcutAction("j"), "again");
        assert.equal(getFlashcardV2ReviewShortcutAction("S"), "hard");
        assert.equal(getFlashcardV2ReviewShortcutAction("3"), "good");
        assert.equal(getFlashcardV2ReviewShortcutAction(";"), "easy");
        assert.equal(getFlashcardV2ReviewShortcutAction("x"), "skip");
        assert.equal(getFlashcardV2ReviewShortcutAction("q"), "undo");
        assert.equal(getFlashcardV2ReviewShortcutAction("Escape"), undefined);
    });

    it("distinguishes tags shared by all cards from mixed tags", () => {
        assert.deepEqual(getFlashcardV2TagSelection(["card-a", "card-b"], {
            "card-a": ["common", "only-a"],
            "card-b": ["common", "only-b"],
        }), {
            selected: ["common"],
            mixed: ["only-a", "only-b"],
        });
    });

    it("applies only explicit batch tag changes and preserves card-specific tags", () => {
        const groups = buildFlashcardV2TagAssignmentGroups(["card-a", "card-b"], {
            "card-a": ["common", "only-a"],
            "card-b": ["common", "only-b"],
        }, {
            common: false,
            added: true,
        });
        assert.deepEqual(groups, [
            {targetIDs: ["card-a"], tagIDs: ["added", "only-a"]},
            {targetIDs: ["card-b"], tagIDs: ["added", "only-b"]},
        ]);
    });

    it("groups identical assignment payloads without losing target IDs", () => {
        assert.deepEqual(buildFlashcardV2TagAssignmentGroups(["card-a", "card-b"], {
            "card-a": ["one"],
            "card-b": ["two"],
        }, {
            one: false,
            two: false,
            shared: true,
        }), [{targetIDs: ["card-a", "card-b"], tagIDs: ["shared"]}]);
    });
});
