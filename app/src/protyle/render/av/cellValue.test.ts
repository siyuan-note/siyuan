import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    cellValueIsEmpty,
    genRelationAVCellValue,
    getConvertedEmptyAVCellValue,
} from "./cellValue";

describe("getConvertedEmptyAVCellValue", () => {
    const emptyBlockValue: IAVCellValue = {
        type: "block",
        isDetached: true,
        block: {
            content: "",
        },
    };

    it("preserves empty values when converting database cells", () => {
        assert.deepEqual(getConvertedEmptyAVCellValue("number", emptyBlockValue), {
            type: "number",
            number: {
                content: 0,
                isNotEmpty: false,
            },
        });
        assert.deepEqual(getConvertedEmptyAVCellValue("mAsset", emptyBlockValue), {
            type: "mAsset",
            mAsset: [],
        });
        assert.deepEqual(getConvertedEmptyAVCellValue("checkbox", emptyBlockValue), {
            type: "checkbox",
            checkbox: {
                checked: false,
            },
        });
        assert.deepEqual(getConvertedEmptyAVCellValue("relation", emptyBlockValue), {
            type: "relation",
            relation: {
                blockIDs: [],
                contents: [],
            },
        });
    });

    it("leaves same-type and non-empty values to the normal conversion path", () => {
        assert.equal(getConvertedEmptyAVCellValue("block", emptyBlockValue), undefined);
        assert.equal(getConvertedEmptyAVCellValue("number", {
            type: "block",
            block: {
                content: "12",
            },
        }), undefined);
    });

    it("distinguishes an explicit zero from an empty number", () => {
        assert.equal(cellValueIsEmpty({
            type: "number",
            number: {
                content: 0,
                isNotEmpty: true,
            },
        }), false);
    });
});

describe("genRelationAVCellValue", () => {
    it("rejects block values without a row ID", () => {
        assert.deepEqual(genRelationAVCellValue({
            type: "block",
            block: {
                content: "Title",
            },
        }), {
            type: "relation",
            relation: {
                blockIDs: [],
                contents: [],
            },
        });
    });

    it("converts block values with a row ID", () => {
        const blockValue: IAVCellValue = {
            type: "block",
            blockID: "20260727120000-abcdefg",
            block: {
                content: "Title",
            },
        };
        assert.deepEqual(genRelationAVCellValue(blockValue), {
            type: "relation",
            relation: {
                blockIDs: ["20260727120000-abcdefg"],
                contents: [blockValue],
            },
        });
    });
});
