import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    cellValueIsEmpty,
    cloneAVCellValueSnapshot,
    createAVCellUpdateOperation,
    createAVStableTextCell,
    createEmptyAVValue,
    genRelationAVCellValue,
    getAVBlockRefSubtype,
    getConvertedEmptyAVCellValue,
    hasAVRenderTemplateResult,
    updateAVCachedCellValue,
} from "./cellValue";
import {resolveAVSelectedCell, setAVCellSelection} from "./selectionState";
import {createAVRichTextValue} from "./richTextValue";
import {rebindAVCellValue} from "./dragFillValue";

describe("cached asset cell updates", () => {
    it("preserves consecutive uploads after the selection moves without a data refresh", () => {
        const column = {id: "assets", type: "mAsset"} as IAVColumn;
        const initialValue = {type: "mAsset", mAsset: [{content: "original.png"}]} as IAVCellValue;
        const data = {view: {columns: [column], rows: [
            {id: "row-1", cells: [{id: "cell-1", value: initialValue}]},
            {id: "row-2", cells: [{id: "cell-2", value: cloneAVCellValueSnapshot(initialValue)}]},
        ]}} as unknown as IAV;
        const target = {groupID: "", rowID: "row-1", colID: "assets"};
        const other = {groupID: "", rowID: "row-2", colID: "assets"};
        const block = {} as HTMLElement;
        setAVCellSelection(block, {anchor: other, focus: other, cells: [resolveAVSelectedCell(data, other)]});
        const snapshots: IAVCellValue[] = [];
        for (const content of ["first.png", "second.png"]) {
            const cell = resolveAVSelectedCell(data, target);
            const oldValue = cloneAVCellValueSnapshot(cell.cell.value);
            snapshots.push(oldValue);
            updateAVCachedCellValue(data.view, target.rowID, target.colID, {
                ...oldValue, mAsset: oldValue.mAsset.concat({content} as IAVCellAssetValue),
            });
        }
        assert.deepEqual(resolveAVSelectedCell(data, target).cell.value.mAsset.map(item => item.content),
            ["original.png", "first.png", "second.png"]);
        assert.deepEqual(snapshots[0].mAsset.map(item => item.content), ["original.png"]);
        assert.deepEqual(snapshots[1].mAsset.map(item => item.content), ["original.png", "first.png"]);
        assert.deepEqual(resolveAVSelectedCell(data, other).cell.value.mAsset.map(item => item.content), ["original.png"]);
    });

    it("updates every loaded group occurrence and card without sharing the operation value", () => {
        const tableCell = {id: "old"} as IAVCell;
        const cardCell = {id: "old"} as IAVCell;
        const untouched = {id: "untouched"} as IAVCell;
        const view = {groups: [
            {columns: [{id: "other"}, {id: "assets", hidden: true}], rows: [
                {id: "row", cells: [untouched, tableCell]},
            ]},
            {fields: [{id: "assets"}], cards: [{id: "row", values: [cardCell]}]},
        ]} as unknown as IAVView;
        const value = {id: "new", type: "mAsset", mAsset: [{content: "image.png"}]} as IAVCellValue;
        updateAVCachedCellValue(view, "row", "assets", value);
        for (const cell of [tableCell, cardCell]) {
            assert.equal(cell.id, "new");
            assert.equal(cell.valueType, "mAsset");
            assert.deepEqual(cell.value, value);
            assert.notEqual(cell.value, value);
        }
        updateAVCachedCellValue(view, "missing", "assets", value);
        updateAVCachedCellValue(view, "row", "missing", value);
        assert.deepEqual(untouched, {id: "untouched"});
        value.mAsset[0].content = "changed.png";
        assert.equal(tableCell.value.mAsset[0].content, "image.png");
        assert.equal(cardCell.value.mAsset[0].content, "image.png");
    });
});

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

describe("hasAVRenderTemplateResult", () => {
    it("distinguishes configured display templates from template fields and blank configuration", () => {
        assert.equal(hasAVRenderTemplateResult({
            type: "number",
            number: {content: 0, isNotEmpty: true},
            renderedContent: "",
        }), true);
        assert.equal(hasAVRenderTemplateResult({
            type: "number",
            number: {content: 0, isNotEmpty: true},
        }, "<strong>.action{.Amount}</strong>"), true);
        assert.equal(hasAVRenderTemplateResult({
            type: "number",
            number: {content: 0, isNotEmpty: true},
        }, "   "), false);
        assert.equal(hasAVRenderTemplateResult({
            type: "template",
            template: {content: "rendered"},
            renderedContent: "rendered",
        }, "ignored"), false);
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

    it("removes transient rendered content from stored snapshots", () => {
        const value = {
            type: "rollup",
            renderedContent: "<strong>outer</strong>",
            rollup: {
                contents: [{
                    type: "text",
                    text: {content: "stored"},
                    renderedContent: "<strong>inner</strong>",
                }],
            },
        } as IAVCellValue;

        assert.deepEqual(cloneAVCellValueSnapshot(value), {
            type: "rollup",
            rollup: {
                contents: [{
                    type: "text",
                    text: {content: "stored"},
                }],
            },
        });
    });
});

describe("empty attribute view text identity", () => {
    it("opens an empty attribute text value using its row and column identity", () => {
        const emptyValue = createEmptyAVValue("text-key", "text", "item-row");
        const stableCell = createAVStableTextCell({
            rowID: emptyValue.blockID,
            colID: emptyValue.keyID,
            value: emptyValue,
        });

        assert.equal(Object.prototype.hasOwnProperty.call(emptyValue, "id"), false);
        assert.ok(stableCell);
        assert.equal(stableCell.rowID, "item-row");
        assert.equal(stableCell.colID, "text-key");
        assert.equal(stableCell.cell.id, "");
        assert.deepEqual(stableCell.cell.value.text, {content: ""});
    });

    it("constructs rich do and undo values without fabricating a value ID", () => {
        const oldValue = createEmptyAVValue("text-key", "text", "item-row");
        const richValue = createAVRichTextValue("**Rich**", "Rich", oldValue);
        const target = {id: "", keyID: "text-key", blockID: "item-row"};
        const doValue = rebindAVCellValue(richValue, target);
        const doOperation = createAVCellUpdateOperation({
            valueID: target.id,
            avID: "attribute-view",
            keyID: target.keyID,
            rowID: target.blockID,
            data: doValue,
        });
        const undoOperation = createAVCellUpdateOperation({
            valueID: target.id,
            avID: "attribute-view",
            keyID: target.keyID,
            rowID: target.blockID,
            data: oldValue,
        });

        assert.equal(doOperation.id, "");
        assert.equal(doOperation.keyID, "text-key");
        assert.equal(doOperation.rowID, "item-row");
        assert.deepEqual((doOperation.data as IAVCellValue).text, {
            content: "Rich",
            rich: {spec: 1, format: "kramdown", content: "**Rich**"},
        });
        assert.equal((doOperation.data as IAVCellValue).id, "");
        assert.equal(undoOperation.id, "");
        assert.deepEqual((undoOperation.data as IAVCellValue).text, {content: ""});
        assert.equal(Object.prototype.hasOwnProperty.call(undoOperation.data, "id"), false);
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

    it("can use rendered content when determining display emptiness", () => {
        const value: IAVCellValue = {
            type: "text",
            text: {content: ""},
            renderedContent: "<strong>fallback</strong>",
        };
        assert.equal(cellValueIsEmpty(value), true);
        assert.equal(cellValueIsEmpty(value, true), false);
    });

    it("treats a configured display template with an empty result as empty", () => {
        const value: IAVCellValue = {
            type: "number",
            number: {
                content: 12,
                isNotEmpty: true,
            },
        };

        assert.equal(cellValueIsEmpty(value), false);
        assert.equal(cellValueIsEmpty(value, true, "{{.action{.Amount}}}"), true);
        value.renderedContent = "visible";
        assert.equal(cellValueIsEmpty(value, true, "{{.action{.Amount}}}"), false);
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
