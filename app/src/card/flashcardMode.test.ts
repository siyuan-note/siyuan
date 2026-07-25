import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    beginFlashcardLoad,
    createFlashcardRevealState,
    hideFlashcardAnswer,
    prepareCalloutFlashcard,
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

describe("flashcardMode", () => {
    it("prepares a top-level callout with an answer", () => {
        const calloutElement = {
            querySelector(selector: string) {
                assert.equal(selector, ":scope > .callout-content > [data-node-id]");
                return {};
            },
        } as unknown as Element;
        const wysiwygElement = {
            querySelector(selector: string) {
                assert.equal(selector, ":scope > .callout[custom-riff-decks]");
                return calloutElement;
            },
        } as unknown as Element;

        assert.equal(prepareCalloutFlashcard(wysiwygElement, true), true);
    });

    it("ignores callouts when the mode is disabled or no direct answer exists", () => {
        let queried = false;
        const disabledElement = {
            querySelector(): null {
                queried = true;
                return null;
            },
        } as unknown as Element;
        assert.equal(prepareCalloutFlashcard(disabledElement, false), false);
        assert.equal(queried, false);

        const calloutElement = {
            querySelector(): null {
                return null;
            },
            removeAttribute() {
                assert.fail("A callout without an answer must keep its fold attribute");
            },
        } as unknown as Element;
        const wysiwygElement = {
            querySelector() {
                return calloutElement;
            },
        } as unknown as Element;
        assert.equal(prepareCalloutFlashcard(wysiwygElement, true), false);
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
