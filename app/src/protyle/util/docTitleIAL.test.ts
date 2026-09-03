import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {syncDocTitleIAL} from "./docTitleIAL";

const TITLE_EMPTY_KEY = "custom-sy-title-empty";

describe("syncDocTitleIAL", () => {
    it("removes the empty-title marker when a document receives a title", () => {
        const ial = {
            title: "Untitled",
            icon: "1f4c4",
            [TITLE_EMPTY_KEY]: "true",
        };

        assert.equal(syncDocTitleIAL(ial, "Named document", false, TITLE_EMPTY_KEY), ial);
        assert.deepEqual(ial, {
            title: "Named document",
            icon: "1f4c4",
        });
    });

    it("sets the empty-title marker when a document title is cleared", () => {
        const ial: Record<string, string> = {
            title: "Named document",
        };

        syncDocTitleIAL(ial, "Untitled", true, TITLE_EMPTY_KEY);

        assert.deepEqual(ial, {
            title: "Untitled",
            [TITLE_EMPTY_KEY]: "true",
        });
    });
});
