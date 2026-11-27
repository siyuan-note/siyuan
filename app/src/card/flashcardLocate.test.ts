import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    getFlashcardLocateBlockID,
    isCurrentFlashcardLocateTarget,
    setFlashcardLocateBlockID,
} from "./flashcardLocate";

const createElement = () => {
    const attributes = new Map<string, string>();
    return {
        getAttribute: (name: string) => attributes.get(name) || null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
    };
};

describe("flashcard document locate context", () => {
    it("updates and clears the current source block", () => {
        const element = createElement();

        setFlashcardLocateBlockID(element, "20260904120000-source1");
        assert.equal(getFlashcardLocateBlockID(element), "20260904120000-source1");

        setFlashcardLocateBlockID(element);
        assert.equal(getFlashcardLocateBlockID(element), "");
    });

    it("rejects a locate result after the current card or review element changes", () => {
        const requestedElement = createElement();
        const otherElement = createElement();
        setFlashcardLocateBlockID(requestedElement, "20260904120000-source1");

        assert.equal(isCurrentFlashcardLocateTarget(
            requestedElement, "20260904120000-source1", requestedElement), true);

        setFlashcardLocateBlockID(requestedElement, "20260904120001-source2");
        assert.equal(isCurrentFlashcardLocateTarget(
            requestedElement, "20260904120000-source1", requestedElement), false);
        assert.equal(isCurrentFlashcardLocateTarget(
            requestedElement, "20260904120001-source2", otherElement), false);
    });
});
