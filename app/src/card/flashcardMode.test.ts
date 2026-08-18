import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    beginFlashcardLoad,
    createFlashcardRevealState,
    type FlashcardCreationConfig,
    hasFlashcardAnswer,
    hideFlashcardAnswer,
    revealFlashcardAfterUnfold,
    showFlashcardAnswer
} from "./flashcardMode";

const createClassElement = () => {
    const classes = new Set<string>();
    const element = {
        classList: {
            add: (...classNames: string[]) => classNames.forEach((className) => classes.add(className)),
            remove: (...classNames: string[]) => classNames.forEach((className) => classes.delete(className)),
        },
    } as unknown as Element;
    return {classes, element};
};

const createFlashcardConfig = (overrides: Partial<FlashcardCreationConfig> = {}): FlashcardCreationConfig => ({
    blockquote: false,
    callout: false,
    heading: false,
    list: false,
    mark: false,
    superBlock: false,
    ...overrides,
});

describe("flashcardMode", () => {
    it("ignores ordinary lists in document flashcards", () => {
        const element = {
            querySelector(selector: string) {
                return selector === ".list, .li" ? {} : null;
            },
        } as unknown as Element;

        assert.equal(hasFlashcardAnswer(element, createFlashcardConfig({list: true})), false);
    });

    it("detects list flashcard answers instead of leaf list cards", () => {
        const answerSelector = ".list[custom-riff-decks] .li > .list, .li[custom-riff-decks] > .list";
        const answerElement = {
            querySelector(selector: string) {
                return selector === answerSelector ? {} : null;
            },
        } as unknown as Element;
        const leafElement = {
            querySelector(selector: string) {
                return selector === ".list[custom-riff-decks], .li[custom-riff-decks]" ? {} : null;
            },
        } as unknown as Element;

        assert.equal(hasFlashcardAnswer(answerElement, createFlashcardConfig({list: true})), true);
        assert.equal(hasFlashcardAnswer(leafElement, createFlashcardConfig({list: true})), false);
    });

    it("detects structural flashcard answers", () => {
        const selectors: Array<[keyof FlashcardCreationConfig, string]> = [
            ["superBlock", ":scope > .sb[custom-riff-decks] > div:nth-of-type(n+2):not(.protyle-attr)"],
            ["blockquote", ":scope > .bq[custom-riff-decks] > [data-node-id] ~ [data-node-id]"],
            ["callout", ":scope > .callout[custom-riff-decks] > .callout-content > [data-node-id]"],
            ["heading", ":scope > div[data-type=\"NodeHeading\"][custom-riff-decks] ~ div"],
        ];

        selectors.forEach(([key, answerSelector]) => {
            const element = {
                querySelector(selector: string) {
                    return selector === answerSelector ? {} : null;
                },
            } as unknown as Element;
            assert.equal(hasFlashcardAnswer(element, createFlashcardConfig({[key]: true})), true);
        });
    });

    it("ignores ordinary structural blocks", () => {
        const ordinarySelectors = new Set([
            ":scope > .sb",
            ":scope > [data-type=\"NodeHeading\"]",
        ]);
        const element = {
            querySelector(selector: string) {
                return ordinarySelectors.has(selector) ? {} : null;
            },
        } as unknown as Element;

        assert.equal(hasFlashcardAnswer(element, createFlashcardConfig({
            heading: true,
            superBlock: true,
        })), false);
    });

    it("detects marks and skips disabled modes", () => {
        let queryCount = 0;
        const element = {
            querySelector(selector: string) {
                queryCount++;
                return selector === "span[data-type~=\"mark\"]" ? {} : null;
            },
        } as unknown as Element;

        assert.equal(hasFlashcardAnswer(element, createFlashcardConfig()), false);
        assert.equal(queryCount, 0);
        assert.equal(hasFlashcardAnswer(element, createFlashcardConfig({mark: true})), true);
    });

    it("hides and reveals the callout answer", () => {
        const {classes, element} = createClassElement();
        hideFlashcardAnswer(element, {
            blockquote: false,
            callout: true,
            heading: false,
            list: false,
            mark: false,
            superBlock: false,
        });
        assert.deepEqual([...classes], ["card__block--hidecallout"]);

        showFlashcardAnswer(element);
        assert.equal(classes.size, 0);
    });

    it("reveals an unfolded card immediately", () => {
        const state = createFlashcardRevealState();
        const generation = beginFlashcardLoad(state);
        let revealed = 0;

        assert.equal(revealFlashcardAfterUnfold({
            state,
            generation,
            reveal: () => revealed++,
        }), true);
        assert.equal(revealed, 1);
    });

    it("waits for a folded card to finish unfolding", () => {
        const state = createFlashcardRevealState();
        const generation = beginFlashcardLoad(state);
        let done: () => void;
        let revealed = 0;

        assert.equal(revealFlashcardAfterUnfold({
            state,
            generation,
            unfold: (callback) => {
                done = callback;
            },
            reveal: () => revealed++,
        }), true);
        assert.equal(revealed, 0);

        done();
        assert.equal(revealed, 1);
    });

    it("ignores repeated reveals while unfolding", () => {
        const state = createFlashcardRevealState();
        const generation = beginFlashcardLoad(state);
        let done: () => void;
        let revealed = 0;

        revealFlashcardAfterUnfold({
            state,
            generation,
            unfold: (callback) => {
                done = callback;
            },
            reveal: () => revealed++,
        });
        assert.equal(revealFlashcardAfterUnfold({
            state,
            generation,
            reveal: () => revealed++,
        }), false);

        done();
        done();
        assert.equal(revealed, 1);
    });

    it("ignores an unfold callback after loading another card", () => {
        const state = createFlashcardRevealState();
        const generation = beginFlashcardLoad(state);
        let done: () => void;
        let revealed = 0;

        revealFlashcardAfterUnfold({
            state,
            generation,
            unfold: (callback) => {
                done = callback;
            },
            reveal: () => revealed++,
        });
        beginFlashcardLoad(state);
        done();

        assert.equal(revealed, 0);
    });
});
