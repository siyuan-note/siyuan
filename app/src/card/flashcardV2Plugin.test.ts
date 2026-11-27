import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    flashcardV2PluginSourceType,
    getFlashcardV2PluginType,
    listFlashcardV2PluginTypes,
    registerFlashcardV2PluginType,
    snapshotFlashcardV2AnswerResult,
    unregisterFlashcardV2PluginTypes
} from "./flashcardV2Plugin";

describe("flashcardV2Plugin", () => {
    it("registers namespaced flashcard types and removes them on unload", () => {
        const registration = {typeName: "diagram", displayName: "Diagram"};
        const dispose = registerFlashcardV2PluginType("example", registration);
        const sourceType = flashcardV2PluginSourceType("example", "diagram");
        try {
            assert.equal(getFlashcardV2PluginType(sourceType), registration);
            assert.equal(listFlashcardV2PluginTypes().some((item) => item.sourceType === sourceType), true);
            assert.throws(() => registerFlashcardV2PluginType("example", registration), /already registered/);
        } finally {
            dispose();
        }
        assert.equal(getFlashcardV2PluginType(sourceType), undefined);

        registerFlashcardV2PluginType("example", {typeName: "one"});
        registerFlashcardV2PluginType("example", {typeName: "two"});
        unregisterFlashcardV2PluginTypes("example");
        assert.equal(listFlashcardV2PluginTypes().some((item) => item.namespace === "example"), false);
    });

    it("rejects ambiguous namespace and type names", () => {
        assert.throws(() => registerFlashcardV2PluginType("bad:name", {typeName: "valid"}), /namespace/);
        assert.throws(() => registerFlashcardV2PluginType("valid", {typeName: "bad:name"}), /namespace/);
    });

    it("takes an immutable JSON snapshot of plugin answer results", () => {
        const original = {answers: ["one"], ignored: () => "value"};
        const snapshot = snapshotFlashcardV2AnswerResult(original) as { answers: string[] };
        original.answers.push("two");
        assert.deepEqual(snapshot, {answers: ["one"]});

        const cyclic: { self?: unknown } = {};
        cyclic.self = cyclic;
        assert.equal(snapshotFlashcardV2AnswerResult(cyclic), undefined);
    });
});
