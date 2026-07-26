import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getAVPasteMatrixWidth,
    getUniqueAVPasteColumnName,
    inferAVPasteColumnType,
} from "./paste";

describe("inferAVPasteColumnType", () => {
    it("infers strict numbers while preserving identifiers with leading zeros", () => {
        assert.equal(inferAVPasteColumnType(["1", "-2.5", "3e2"]), "number");
        assert.equal(inferAVPasteColumnType(["001", "002"]), "text");
        assert.equal(inferAVPasteColumnType(["1,000", "2,000"]), "text");
    });

    it("infers complete dates and rejects invalid or time-only values", () => {
        assert.equal(inferAVPasteColumnType(["2026-07-26", "2026-07-27 08:30"]), "date");
        assert.equal(inferAVPasteColumnType(["2024/02/29", "2025/02/28 23:59:59"]), "date");
        assert.equal(inferAVPasteColumnType(["2025-02-29"]), "text");
        assert.equal(inferAVPasteColumnType(["08:00", "09:30"]), "text");
    });

    it("uses text for empty and mixed columns", () => {
        assert.equal(inferAVPasteColumnType(["", "  "]), "text");
        assert.equal(inferAVPasteColumnType(["1", "value"]), "text");
    });
});

describe("AV paste matrix helpers", () => {
    it("uses the widest header or data row", () => {
        assert.equal(getAVPasteMatrixWidth([["1"], ["2", "3"]], ["a", "b", "c"]), 3);
        assert.equal(getAVPasteMatrixWidth([["1", "2", "3"]], ["a"]), 3);
    });

    it("generates localized unique field names", () => {
        const usedNames = new Set(["Text", "Text 2"]);
        assert.equal(getUniqueAVPasteColumnName("Text", usedNames), "Text 3");
        assert.equal(getUniqueAVPasteColumnName("Other", usedNames), "Other");
    });
});
