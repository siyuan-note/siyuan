import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {appendFlashcardV2ClozeTargets, resolveFlashcardV2InlineOcclusions} from "./flashcardV2Occlusion";

describe("flashcardV2Occlusion", () => {
    it("adds new marks in separate groups while preserving edited existing assignments and order", () => {
        const original = {id: "original", blockID: "block", displayOrder: 1, label: "original"};
        const added = {id: "added", blockID: "block", displayOrder: 0, label: "added"};
        const current = {
            targets: [original], groupOrder: ["second-group", "first-group"],
            assignments: {original: ["second-group", "first-group"]},
        };
        const result = appendFlashcardV2ClozeTargets(current, [added, original, added], () => "new-group");
        assert.deepEqual(result.targets, [original, added]);
        assert.deepEqual(result.groupOrder, ["second-group", "first-group", "new-group"]);
        assert.deepEqual(result.assignments, {
            original: ["second-group", "first-group"], added: ["new-group"],
        });
        assert.deepEqual(current.targets, [original]);
        assert.deepEqual(current.groupOrder, ["second-group", "first-group"]);
        const repeated = appendFlashcardV2ClozeTargets(result, [added], () =>
            assert.fail("including a mark twice must keep its group identity"));
        assert.deepEqual(repeated, result);
    });

    it("can include replacement marks after every original mark has been removed", () => {
        const added = {id: "replacement", blockID: "block", displayOrder: 0, label: "replacement"};
        const result = appendFlashcardV2ClozeTargets({
            targets: [], groupOrder: ["original-group"], assignments: {},
        }, [added], () => "replacement-group");
        assert.deepEqual(result.targets, [added]);
        assert.deepEqual(result.groupOrder, ["original-group", "replacement-group"]);
        assert.deepEqual(result.assignments, {replacement: ["replacement-group"]});
    });

    it("keeps a shared identity across styled parts of the same occlusion", () => {
        const result = resolveFlashcardV2InlineOcclusions([
            {blockID: "block-a", id: "shared", label: "The "},
            {blockID: "block-a", id: "shared", label: "bold"},
            {blockID: "block-a", id: "shared", label: " and italic answer"},
        ], () => assert.fail("existing identities must be preserved"));
        assert.deepEqual(result.ids, ["shared", "shared", "shared"]);
        assert.deepEqual(result.targets, [{
            id: "shared", blockID: "block-a", displayOrder: 0, label: "The bold and italic answer",
        }]);
    });

    it("assigns one replacement identity to all copied parts in another block", () => {
        let created = 0;
        const result = resolveFlashcardV2InlineOcclusions([
            {blockID: "block-a", id: "shared", label: "original"},
            {blockID: "block-b", id: "shared", label: "copied "},
            {blockID: "block-b", id: "shared", label: "answer"},
            {blockID: "block-b", label: "another"},
        ], () => `new-${++created}`);
        assert.deepEqual(result.ids, ["shared", "new-1", "new-1", "new-2"]);
        assert.deepEqual(result.targets.map((target) => target.label), ["original", "copied answer", "another"]);
        assert.deepEqual(result.targets.map((target) => target.displayOrder), [0, 1, 2]);
    });
});
