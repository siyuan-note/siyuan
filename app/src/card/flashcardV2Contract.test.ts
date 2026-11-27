import assert from "node:assert/strict";
import {test} from "node:test";
import type {FlashcardV2CardRenderModel, FlashcardV2EntityRevision} from "../types/api";
import {readFlashcardV2RenderModel} from "./flashcardV2Render";
import {
    isFlashcardV2Object,
    readFlashcardV2Payload,
    readFlashcardV2Revision,
    toFlashcardV2JSON,
} from "./flashcardV2Contract";

test("flashcard mutation JSON retains nested query values and omitted optional fields", () => {
    const payload: Record<string, unknown> = {
        id: "set",
        queryAST: {version: 1, root: {operator: "predicate", value: [false, 0, "", null]}},
        preset: undefined,
    };
    assert.deepEqual(toFlashcardV2JSON(payload), JSON.parse(JSON.stringify(payload)));
    assert.deepEqual(toFlashcardV2JSON([undefined, {value: null}]), [null, {value: null}]);
    assert.throws(() => toFlashcardV2JSON({value: BigInt(1)}));
    assert.throws(() => toFlashcardV2JSON({value: Infinity}));
});

test("flashcard entity payloads are checked before callers receive their narrowed fields", () => {
    const isTag = (value: unknown): value is {id: string, name: string} =>
        isFlashcardV2Object(value) && typeof value.id === "string" && typeof value.name === "string";
    const revision: FlashcardV2EntityRevision = {
        entityType: "tag", entityID: "tag", revisionID: "revision", parentRevisionIDs: [], updatedAt: 1,
        deleted: false, payload: {id: "tag", name: "name", extra: {kept: true}},
    };
    assert.deepEqual(readFlashcardV2Revision(revision, isTag), revision);
    for (const payload of [null, [], {}, {id: "tag", name: 1}]) {
        assert.throws(() => readFlashcardV2Payload(payload, isTag), /Invalid flashcard response payload/);
    }
    assert.throws(() => readFlashcardV2Revision({...revision, payload: {id: "tag"}}, isTag));
});

const renderModel = (): FlashcardV2CardRenderModel => ({
    card: {id: "card", sourceID: "source", templateID: "template", variantKey: "forward",
        generationStatus: "active", flag: 0, createdAt: 1, updatedAt: 1},
    reviewState: {cardID: "card", state: "new", due: 1, stability: 0, difficulty: 0, elapsedDays: 0,
        scheduledDays: 0, reps: 0, lapses: 0, suspended: false, stateRevisionID: "state"},
    source: {id: "source", schemaID: "schema", sourceType: "plugin:test:type", primaryRefID: "reference",
        generationConfig: {custom: [1, false, null]}, status: "active", pluginData: {textFallback: "fallback", custom: true}},
    references: [],
    template: {id: "template", schemaID: "schema", name: "template", generationRule: {mode: "static"},
        frontSpec: {type: "field", tts: {lang: "en", fieldIDs: ["question"]}}, backSpec: {type: "field"},
        answerMode: "reveal", enabled: true},
    schema: {id: "schema", name: "schema", fields: [], templateIDs: ["template"], createdAt: 1, updatedAt: 1},
});

test("typed render models preserve plugin JSON and validate built-in rendering fields", () => {
    const model = renderModel();
    const parsed = readFlashcardV2RenderModel(model);
    assert.deepEqual(parsed.source.generationConfig, model.source.generationConfig);
    assert.deepEqual(parsed.source.pluginData, model.source.pluginData);
    assert.deepEqual(parsed.template.frontSpec, model.template.frontSpec);
    assert.throws(() => readFlashcardV2RenderModel({...model,
        template: {...model.template, frontSpec: {tts: {rate: "fast"}}}}));
    assert.throws(() => readFlashcardV2RenderModel({...model,
        source: {...model.source, pluginData: {textFallback: 1}}}));
});
