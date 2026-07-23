import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {hideFlashcardAnswer, prepareCalloutFlashcard, showFlashcardAnswer} from "./flashcardMode";

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
        let removedAttribute = "";
        const calloutElement = {
            querySelector(selector: string) {
                assert.equal(selector, ":scope > .callout-content > [data-node-id]");
                return {};
            },
            removeAttribute(attribute: string) {
                removedAttribute = attribute;
            },
        } as unknown as Element;
        const wysiwygElement = {
            querySelector(selector: string) {
                assert.equal(selector, ":scope > .callout[custom-riff-decks]");
                return calloutElement;
            },
        } as unknown as Element;

        assert.equal(prepareCalloutFlashcard(wysiwygElement, true), true);
        assert.equal(removedAttribute, "fold");
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
});
