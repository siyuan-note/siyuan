import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {normalizePasteResponse} from "./pasteResponse";

describe("normalizePasteResponse", () => {
    it("clears clipboard formats omitted from a plugin response", () => {
        assert.deepEqual(normalizePasteResponse({textPlain: "updated"}), {
            textHTML: "",
            textPlain: "updated",
            siyuanHTML: "",
            files: [],
        });
    });

    it("preserves all clipboard formats returned by a plugin", () => {
        const files = [] as File[];
        assert.deepEqual(normalizePasteResponse({
            textHTML: "<strong>updated</strong>",
            textPlain: "updated",
            siyuanHTML: "<div data-type=\"NodeParagraph\">updated</div>",
            files,
        }), {
            textHTML: "<strong>updated</strong>",
            textPlain: "updated",
            siyuanHTML: "<div data-type=\"NodeParagraph\">updated</div>",
            files,
        });
    });
});
