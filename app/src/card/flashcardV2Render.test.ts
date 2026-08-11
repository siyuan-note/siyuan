import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    buildFlashcardV2OcclusionPlan,
    checkFlashcardV2Answer,
    flashcardV2OcclusionIDForReference,
    flashcardV2TemplateURI,
    isSafeFlashcardV2CSSValue,
    renderFlashcardV2AnkiTemplate,
    renderFlashcardV2Choice,
    renderFlashcardV2MultiLine,
    type IFlashcardV2RenderModel
} from "./flashcardV2Render";

const model = (sourceType: string, generationConfig: unknown, variantData: Record<string, unknown>) => ({
    card: {id: "card", variantKey: "variant", variantData},
    source: {sourceType, generationConfig},
    references: [],
    template: {},
}) as IFlashcardV2RenderModel;

describe("flashcardV2Render", () => {
    it("normalizes typed answers with configurable whitespace, punctuation, case, and diacritics", () => {
        const result = checkFlashcardV2Answer("  CAFE,   au lait! ", ["Café au lait"], {
            ignorePunctuation: true,
            ignoreDiacritics: true,
        });

        assert.equal(result.correct, true);
        assert.equal(result.exact, false);
        assert.equal(result.distance, 0);
        assert.equal(result.suggestedRating, "good");
    });

    it("selects the closest accepted answer and supports bounded fuzzy matching", () => {
        const result = checkFlashcardV2Answer("mitocondria", ["chloroplast", "mitochondria"], {
            caseSensitive: true,
            fuzzyMaxDistance: 1,
        });

        assert.equal(result.correct, true);
        assert.equal(result.acceptedAnswer, "mitochondria");
        assert.equal(result.distance, 1);
        assert.deepEqual(result.diff.filter((part) => part.type === "missing"), [{type: "missing", value: "h"}]);
    });

    it("rejects answers outside the configured fuzzy ratio", () => {
        const result = checkFlashcardV2Answer("planet", ["planets"], {fuzzyMaxRatio: 0.1});

        assert.equal(result.correct, false);
        assert.equal(result.distance, 1);
        assert.equal(result.suggestedRating, "again");
    });

    it("maps stable block-reference roles to occlusion identities", () => {
        assert.equal(flashcardV2OcclusionIDForReference({
            entityType: "block", entityID: "block", role: "occlusion:stable-id", sort: 0,
        }), "stable-id");
        assert.equal(flashcardV2OcclusionIDForReference({
            entityType: "block", entityID: "block", role: "content", sort: 0,
        }), undefined);
    });

    it("hides all occlusions that belong to any selected cloze group", () => {
        const plan = buildFlashcardV2OcclusionPlan(model("cloze", {
            occlusions: [
                {id: "o1", groupIDs: ["g1"], displayOrder: 1},
                {id: "o2", groupIDs: ["g1", "g2"], displayOrder: 0},
                {id: "o3", groupIDs: ["g3"], displayOrder: 2},
            ],
        }, {mode: "hideGroups", groupIDs: ["g1", "g2"]}));

        assert.deepEqual(plan, {steps: [["o2", "o1"]], persistent: []});
    });

    it("supports reverse cloze variants", () => {
        const plan = buildFlashcardV2OcclusionPlan(model("cloze", {
            occlusions: [
                {id: "o1", groupIDs: ["g1"], displayOrder: 0},
                {id: "o2", groupIDs: ["g2"], displayOrder: 1},
            ],
        }, {mode: "showGroups", groupIDs: ["g1"]}));

        assert.deepEqual(plan, {steps: [["o2"]], persistent: []});
    });

    it("reveals ordered single-card steps in display order", () => {
        const plan = buildFlashcardV2OcclusionPlan(model("ordered", {
            steps: [
                {id: "s2", displayOrder: 1, occlusionIDs: ["o2"]},
                {id: "s1", displayOrder: 0, occlusionIDs: ["o1", "o1b"]},
            ],
        }, {mode: "single", stepIDs: ["s1", "s2"]}));

        assert.deepEqual(plan, {steps: [["o1", "o1b"], ["o2"]], persistent: []});
    });

    it("keeps future progressive steps hidden after revealing the current answer", () => {
        const plan = buildFlashcardV2OcclusionPlan(model("ordered", {
            steps: [
                {id: "s1", displayOrder: 0, occlusionIDs: ["o1"]},
                {id: "s2", displayOrder: 1, occlusionIDs: ["o2"]},
                {id: "s3", displayOrder: 2, occlusionIDs: ["o3"]},
            ],
        }, {mode: "progressive", stepID: "s2", contextStepIDs: ["s1"]}));

        assert.deepEqual(plan, {steps: [["o2"]], persistent: ["o3"]});
    });

    it("renders fixed choices in the order frozen by the session", () => {
        const choiceModel = {
            card: {id: "card", variantKey: "choice"},
            source: {
                sourceType: "choice",
                generationConfig: {
                    mode: "multiple",
                    options: [{id: "a", displayOrder: 0}, {id: "b", displayOrder: 1}],
                    correctOptionIDs: ["a"],
                    randomize: true,
                },
            },
            references: [
                {entityType: "block", entityID: "question", role: "question", sort: 0},
                {entityType: "block", entityID: "option-a", role: "option:a", sort: 1},
                {entityType: "block", entityID: "option-b", role: "option:b", sort: 2},
                {entityType: "block", entityID: "option-c", role: "option:c", sort: 3},
            ],
            template: {},
        } as IFlashcardV2RenderModel;
        const html = renderFlashcardV2Choice(choiceModel, {
            question: "<div>Question</div>",
            "option-a": "<div>A</div>",
            "option-b": "<div>B</div>",
            "option-c": "<div>C</div>",
        }, ["c", "b", "a"]);

        assert.ok(html.indexOf('value="c"') < html.indexOf('value="b"'));
        assert.ok(html.indexOf('value="b"') < html.indexOf('value="a"'));
        assert.match(html, /type="checkbox"/);
    });

    it("renders multi-line answers in stable display order", () => {
        const multiLineModel = {
            card: {id: "card", variantKey: "multi-line"},
            source: {
                sourceType: "multi-line",
                generationConfig: {
                    revealMode: "steps",
                    answers: [{id: "b", displayOrder: 1}, {id: "a", displayOrder: 0}],
                },
            },
            references: [
                {entityType: "block", entityID: "question", role: "question", sort: 0},
                {entityType: "block", entityID: "option-a", role: "answer:a", sort: 1},
                {entityType: "block", entityID: "option-b", role: "answer:b", sort: 2},
            ],
            template: {},
        } as IFlashcardV2RenderModel;
        const html = renderFlashcardV2MultiLine(multiLineModel, {
            question: "<div>Question</div>",
            "option-a": "<div>A</div>",
            "option-b": "<div>B</div>",
        });

        assert.ok(html.indexOf('data-multi-line-answer="a"') < html.indexOf('data-multi-line-answer="b"'));
        assert.match(html, /card__v2-multi-line-answer--hidden/);
    });

    it("renders sanitized Anki fields, conditions, FrontSide, and typed answers declaratively", () => {
        const previousWindow = globalThis.window;
        globalThis.window = {DOMPurify: {sanitize: (value: string) => value}} as Window & typeof globalThis;
        try {
            const ankiModel = {
                card: {id: "card", variantKey: "anki-card:1", variantData: {ord: 0}},
                source: {sourceType: "anki"},
                references: [
                    {fieldID: "front", entityType: "block", entityID: "front-block", role: "field", sort: 1},
                    {fieldID: "back", entityType: "block", entityID: "back-block", role: "field", sort: 2},
                ],
                template: {
                    frontSpec: {type: "anki", markup: "{{#Front}}{{Front}}{{/Front}}{{type:Back}}"},
                    backSpec: {type: "anki", markup: "{{FrontSide}}<hr>{{Back}}"},
                },
                schema: {fields: [{id: "front", name: "Front"}, {id: "back", name: "Back"}]},
            } as IFlashcardV2RenderModel;
            const doms = {"front-block": "<div>Question</div>", "back-block": "<div>Answer</div>"};
            const front = renderFlashcardV2AnkiTemplate(ankiModel, "front", doms);
            const back = renderFlashcardV2AnkiTemplate(ankiModel, "back", doms, front);
            assert.match(front, /Question/);
            assert.match(front, /data-anki-type-answer="back"/);
            assert.match(back, /Question/);
            assert.match(back, /Answer/);
        } finally {
            globalThis.window = previousWindow;
        }
    });

    it("allows only local template media in CSS declarations", () => {
        assert.equal(isSafeFlashcardV2CSSValue('url("assets/anki-image.png?box=notebook") center / cover'), true);
        assert.equal(isSafeFlashcardV2CSSValue("url(data:image/png;base64,iVBORw0KGgo=)"), true);
        assert.equal(isSafeFlashcardV2CSSValue('url("https://example.com/tracker.png")'), false);
        assert.equal(isSafeFlashcardV2CSSValue('url("h\\74tps://example.com/tracker.png")'), false);
        assert.equal(isSafeFlashcardV2CSSValue("var(--untrusted-position)"), false);
        assert.equal(flashcardV2TemplateURI.test("assets/anki-audio.mp3?box=notebook"), true);
        assert.equal(flashcardV2TemplateURI.test("https://example.com/tracker.png"), false);
    });
});
