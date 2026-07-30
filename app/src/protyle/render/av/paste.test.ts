import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getAVPasteMatrixWidth,
    getAVPasteColumnWidth,
    getUniqueAVPasteColumnName,
    inferAVPasteColumnType,
    isAVPasteHeaderCandidate,
    shouldShowAVPasteSkeleton,
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

    it("infers complete HTTP URLs conservatively", () => {
        assert.equal(inferAVPasteColumnType([
            "https://github.com/siyuan-note/siyuan/issues/10767",
            "http://localhost:6806/path?key=value#heading",
        ]), "url");
        assert.equal(inferAVPasteColumnType(["www.example.com", "https://example.com"]), "text");
        assert.equal(inferAVPasteColumnType(["/relative/path", "https://example.com"]), "text");
        assert.equal(inferAVPasteColumnType(["mailto:user@example.com"]), "text");
    });

    it("infers repeated low-cardinality values as single select", () => {
        assert.equal(inferAVPasteColumnType(["P1", "P2", "P1", "P3", "P2", "P1"]), "select");
        assert.equal(inferAVPasteColumnType(["高", "中", "低", "高", "中", "高"]), "select");
        assert.equal(inferAVPasteColumnType(["P1", "P2", "P1"]), "text");
        assert.equal(inferAVPasteColumnType(["#1", "#2", "#3", "#4", "#5", "#6"]), "text");
        assert.equal(inferAVPasteColumnType([
            "This is a repeated paragraph that is too long to use as a single-select option value",
            "This is a repeated paragraph that is too long to use as a single-select option value",
            "Another repeated paragraph that is also too long to use as a single-select option",
            "Another repeated paragraph that is also too long to use as a single-select option",
        ]), "text");
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

    it("recognizes spreadsheet tables without semantic header cells", () => {
        assert.equal(isAVPasteHeaderCandidate([["Name", "Age"], ["Alice", "20"]], false), true);
        assert.equal(isAVPasteHeaderCandidate([["Name"]], true), true);
        assert.equal(isAVPasteHeaderCandidate([["Alice", "20"]], false), false);
        assert.equal(isAVPasteHeaderCandidate([["Alice"], ["Bob"]], false), false);
    });

    it("shows a skeleton only for large paste matrices", () => {
        assert.equal(shouldShowAVPasteSkeleton(Array.from({length: 10}, () => Array(10))), true);
        assert.equal(shouldShowAVPasteSkeleton(Array.from({length: 9}, () => Array(10))), false);
        assert.equal(shouldShowAVPasteSkeleton([Array(100)]), true);
    });

    it("calculates compact widths from measured content", () => {
        const measureText = (value: string) => value.length * 10;
        assert.equal(getAVPasteColumnWidth("优先级", "select", ["P1", "P2", "P3"], measureText), "72px");
        assert.equal(getAVPasteColumnWidth(
            "URL", "url", ["https://github.com/siyuan-note/siyuan/issues/10767"], measureText), "480px");
        assert.equal(getAVPasteColumnWidth("日期", "date", ["2026-07-30"], measureText), "120px");
        assert.equal(getAVPasteColumnWidth(
            "标题", "text", ["A very long title that should not make the field excessively wide"], measureText), "480px");
    });
});
