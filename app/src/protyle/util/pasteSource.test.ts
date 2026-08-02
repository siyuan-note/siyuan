import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {hasBlockSelectionPasteMarker} from "./pasteSource";

const element = (selected = false) => ({
    classList: {
        contains(className: string) {
            return selected && className === "protyle-wysiwyg--select";
        }
    }
}) as unknown as Element;

describe("hasBlockSelectionPasteMarker", () => {
    it("detects a marker on any pasted root block", () => {
        assert.equal(hasBlockSelectionPasteMarker([element(), element(true)]), true);
    });

    it("does not classify a cross-block text range as a block selection", () => {
        assert.equal(hasBlockSelectionPasteMarker([element(), element()]), false);
    });
});
