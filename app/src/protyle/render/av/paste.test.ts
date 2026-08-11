import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    compactAVCellOperations,
    getAVPasteCellValue,
    getAVPasteValueForType,
    getAVPasteMatrixWidth,
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
    it("preserves link names and URLs as assets when links fill the table cell", () => {
        assert.deepEqual(getAVPasteCellValue("Issue 18354", [{
            content: "Issue 18354",
            href: "https://github.com/siyuan-note/siyuan/issues/18354",
        }]), {
            type: "mAsset",
            mAsset: [{
                type: "file",
                content: "https://github.com/siyuan-note/siyuan/issues/18354",
                name: "Issue 18354",
            }],
        });
        assert.deepEqual(getAVPasteCellValue("#18354、 #11928", [{
            content: "#18354",
            href: "https://github.com/siyuan-note/siyuan/issues/18354",
        }, {
            content: "#11928",
            href: "https://github.com/siyuan-note/siyuan/issues/11928",
        }], "、 "), {
            type: "mAsset",
            mAsset: [{
                type: "file",
                content: "https://github.com/siyuan-note/siyuan/issues/18354",
                name: "#18354",
            }, {
                type: "file",
                content: "https://github.com/siyuan-note/siyuan/issues/11928",
                name: "#11928",
            }],
        });
        assert.deepEqual(getAVPasteCellValue("#15049 click-editorcontent 返回错误 ID", [{
            content: "#15049 ",
            href: "https://github.com/siyuan-note/siyuan/issues/15049",
        }, {
            content: "\u200Bclick-editorcontent",
            href: "https://github.com/siyuan-note/siyuan/issues/15049",
        }, {
            content: " 返回错误 ID",
            href: "https://github.com/siyuan-note/siyuan/issues/15049",
        }], "\u200B"), {
            type: "mAsset",
            mAsset: [{
                type: "file",
                content: "https://github.com/siyuan-note/siyuan/issues/15049",
                name: "#15049 click-editorcontent 返回错误 ID",
            }],
        });
        assert.equal(getAVPasteCellValue("See Issue 18354", [{
            content: "Issue 18354",
            href: "https://github.com/siyuan-note/siyuan/issues/18354",
        }], "See "), "See Issue 18354");
        assert.equal(getAVPasteCellValue("Email", [{
            content: "Email",
            href: "mailto:test@example.com",
        }]), "Email");
    });

    it("infers asset columns from rich link values", () => {
        const value: IAVCellValue = {
            type: "mAsset",
            mAsset: [{type: "file", content: "https://example.com", name: "Example"}],
        };
        assert.equal(inferAVPasteColumnType(["", "https://example.org", value]), "mAsset");
        assert.deepEqual(getAVPasteValueForType(value, "mAsset"), value);
        assert.equal(getAVPasteValueForType(value, "url"), "https://example.com");
        assert.equal(getAVPasteValueForType(value, "text"), "Example");
    });

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

    it("compacts cell updates by database after schema operations", () => {
        const operations = compactAVCellOperations([{
            action: "updateAttrViewColOptions",
            avID: "av1",
        }, {
            action: "updateAttrViewCell",
            id: "cell1",
            avID: "av1",
            keyID: "key1",
            rowID: "row1",
            data: {type: "text", text: {content: "a"}},
        }, {
            action: "updateAttrViewCell",
            id: "cell2",
            avID: "av1",
            keyID: "key2",
            rowID: "row2",
            data: {type: "number", number: {content: 2}},
        }]);

        assert.equal(operations.length, 2);
        assert.equal(operations[0].action, "updateAttrViewColOptions");
        assert.deepEqual(operations[1], {
            action: "updateAttrViewCells",
            avID: "av1",
            cellUpdates: [{
                keyID: "key1",
                rowID: "row1",
                data: {type: "text", text: {content: "a"}},
            }, {
                keyID: "key2",
                rowID: "row2",
                data: {type: "number", number: {content: 2}},
            }],
        });
    });

});
