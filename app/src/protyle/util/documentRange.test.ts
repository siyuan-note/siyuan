import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    hasUnloadedDocumentBlocks,
    isDocumentBoundaryLoaded,
    markDocumentBoundaryLoaded,
    updateDocumentBottomEof
} from "./documentRange";

const createWysiwygElement = (options: {
    firstElementEof?: string,
    firstElementIndex?: string,
    lastElementEof?: string,
    initialBottomEof?: boolean,
} = {}) => {
    let bottomEof = options.initialBottomEof || false;
    const createElement = (eof?: string, index?: string) => {
        let currentEof = eof;
        return {
            getAttribute: (name: string) => {
                if (name === "data-eof") {
                    return currentEof || null;
                }
                return name === "data-node-index" ? index || null : null;
            },
            setAttribute: (name: string, value: string) => {
                if (name === "data-eof") {
                    currentEof = value;
                }
            },
        };
    };
    return {
        element: {
            firstElementChild: options.firstElementEof || options.firstElementIndex ?
                createElement(options.firstElementEof, options.firstElementIndex) : null,
            lastElementChild: options.lastElementEof ? createElement(options.lastElementEof) : null,
            hasAttribute: (name: string) => name === "data-bottom-eof" && bottomEof,
            toggleAttribute: (name: string, force: boolean) => {
                if (name === "data-bottom-eof") {
                    bottomEof = force;
                }
            },
        } as unknown as HTMLElement,
        hasBottomEof: () => bottomEof,
    };
};

describe("updateDocumentBottomEof", () => {
    it("marks the loaded range when its last block is the document end", () => {
        const wysiwyg = createWysiwygElement({lastElementEof: "2"});

        updateDocumentBottomEof(wysiwyg.element);

        assert.equal(wysiwyg.hasBottomEof(), true);
    });

    it("clears the state when the loaded range no longer contains the document end", () => {
        const wysiwyg = createWysiwygElement({initialBottomEof: true});

        updateDocumentBottomEof(wysiwyg.element);

        assert.equal(wysiwyg.hasBottomEof(), false);
    });

    it("preserves the document end when probing the beginning of a single-block range", () => {
        const wysiwyg = createWysiwygElement({lastElementEof: "1", initialBottomEof: true});

        updateDocumentBottomEof(wysiwyg.element, true);

        assert.equal(wysiwyg.hasBottomEof(), true);
    });
});

describe("hasUnloadedDocumentBlocks", () => {
    it("ignores document boundaries when dynamic loading is disabled", () => {
        const wysiwyg = createWysiwygElement();

        assert.equal(hasUnloadedDocumentBlocks(wysiwyg.element, false), false);
    });

    it("recognizes the initial block index as the document start", () => {
        const wysiwyg = createWysiwygElement({firstElementIndex: "0", initialBottomEof: true});

        assert.equal(hasUnloadedDocumentBlocks(wysiwyg.element, true), false);
    });

    it("recognizes the explicit document boundaries", () => {
        const wysiwyg = createWysiwygElement({firstElementEof: "1", initialBottomEof: true});

        assert.equal(hasUnloadedDocumentBlocks(wysiwyg.element, true), false);
    });

    it("detects unloaded blocks before the loaded range", () => {
        const wysiwyg = createWysiwygElement({firstElementIndex: "10", initialBottomEof: true});

        assert.equal(hasUnloadedDocumentBlocks(wysiwyg.element, true), true);
    });

    it("detects unloaded blocks after the loaded range", () => {
        const wysiwyg = createWysiwygElement({firstElementEof: "1"});

        assert.equal(hasUnloadedDocumentBlocks(wysiwyg.element, true), true);
    });
});

describe("isDocumentBoundaryLoaded", () => {
    it("checks the beginning independently from the document end", () => {
        const wysiwyg = createWysiwygElement({firstElementIndex: "0"});

        assert.equal(isDocumentBoundaryLoaded(wysiwyg.element, "before"), true);
        assert.equal(isDocumentBoundaryLoaded(wysiwyg.element, "after"), false);
    });

    it("checks the document end independently from the beginning", () => {
        const wysiwyg = createWysiwygElement({initialBottomEof: true});

        assert.equal(isDocumentBoundaryLoaded(wysiwyg.element, "before"), false);
        assert.equal(isDocumentBoundaryLoaded(wysiwyg.element, "after"), true);
    });
});

describe("markDocumentBoundaryLoaded", () => {
    it("marks the beginning without changing the document end", () => {
        const wysiwyg = createWysiwygElement({firstElementIndex: "10"});

        markDocumentBoundaryLoaded(wysiwyg.element, "before");

        assert.equal(isDocumentBoundaryLoaded(wysiwyg.element, "before"), true);
        assert.equal(isDocumentBoundaryLoaded(wysiwyg.element, "after"), false);
    });

    it("marks the last block and updates the document end", () => {
        const wysiwyg = createWysiwygElement({lastElementEof: "0"});

        markDocumentBoundaryLoaded(wysiwyg.element, "after");

        assert.equal(isDocumentBoundaryLoaded(wysiwyg.element, "after"), true);
    });
});
