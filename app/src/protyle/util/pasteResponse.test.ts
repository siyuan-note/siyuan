import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {normalizePasteResponse} from "./pasteResponse";

describe("normalizePasteResponse", () => {
    it("clears omitted text formats and preserves existing files", () => {
        const files = [{} as File];
        assert.deepEqual(normalizePasteResponse({textPlain: "updated"}, files), {
            textHTML: "",
            textPlain: "updated",
            siyuanHTML: "",
            files,
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

    it("clears existing files when a plugin returns an empty file list", () => {
        const files = [{} as File];
        assert.deepEqual(normalizePasteResponse({textPlain: "updated", files: []}, files), {
            textHTML: "",
            textPlain: "updated",
            siyuanHTML: "",
            files: [],
        });
    });
});
