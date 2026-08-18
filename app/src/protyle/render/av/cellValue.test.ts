import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    cellValueIsEmpty,
    cloneAVCellValueSnapshot,
    genRelationAVCellValue,
    getAVBlockRefSubtype,
    getConvertedEmptyAVCellValue,
} from "./cellValue";

describe("getAVBlockRefSubtype", () => {
    it("uses only a valid dynamic subtype and safely falls back to static", () => {
        assert.equal(getAVBlockRefSubtype({
            type: "block",
            block: {content: "Dynamic", refSubtype: "d"},
        }), "d");
        assert.equal(getAVBlockRefSubtype({
            type: "block",
            block: {content: "Static", refSubtype: "s"},
        }), "s");
        assert.equal(getAVBlockRefSubtype({
            type: "block",
            block: {content: "Legacy"},
        }), "s");
        assert.equal(getAVBlockRefSubtype({
            type: "block",
            block: {content: "Invalid", refSubtype: "invalid"},
        } as unknown as IAVCellValue), "s");
    });
});

describe("cloneAVCellValueSnapshot", () => {
    it("preserves empty collection values in transaction snapshots", () => {
        const assetValue = {type: "mAsset"} as IAVCellValue;
        const selectValue = {type: "select"} as IAVCellValue;

        assert.deepEqual(cloneAVCellValueSnapshot(assetValue), {
            type: "mAsset",
            mAsset: [],
        });
        assert.deepEqual(cloneAVCellValueSnapshot(selectValue), {
            type: "select",
            mSelect: [],
        });
        assert.equal(assetValue.mAsset, undefined);
        assert.equal(selectValue.mSelect, undefined);
    });

    it("creates an independent snapshot of populated collection values", () => {
        const value = {
            type: "mAsset",
            mAsset: [{
                name: "asset.png",
                content: "assets/asset.png",
                type: "file",
            }],
        } as IAVCellValue;
        const snapshot = cloneAVCellValueSnapshot(value);

        snapshot.mAsset[0].name = "changed.png";
        assert.equal(value.mAsset[0].name, "asset.png");
    });
});

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
