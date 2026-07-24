import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {updateDocumentBottomEof} from "./documentRange";

const createWysiwygElement = (lastElementEof?: string, initialBottomEof = false) => {
    let bottomEof = initialBottomEof;
    return {
        element: {
            lastElementChild: lastElementEof ? {
                getAttribute: (name: string) => name === "data-eof" ? lastElementEof : null,
            } : null,
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
        const wysiwyg = createWysiwygElement("2");

        updateDocumentBottomEof(wysiwyg.element);

        assert.equal(wysiwyg.hasBottomEof(), true);
    });

    it("clears the state when the loaded range no longer contains the document end", () => {
        const wysiwyg = createWysiwygElement(undefined, true);

        updateDocumentBottomEof(wysiwyg.element);

        assert.equal(wysiwyg.hasBottomEof(), false);
    });
});
