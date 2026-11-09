import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {genAVDragFillValue, rebindAVCellValue} from "./dragFillValue";

describe("rebindAVCellValue", () => {
    it("rebinds copied values to the target database cell", () => {
        const source = {
            id: "source-value",
            keyID: "source-key",
            blockID: "source-row",
            type: "text",
            createdAt: 100,
            updatedAt: 200,
            renderedContent: "<strong>333</strong>",
            text: {
                content: "333",
            },
        } as IAVCellValue & {
            createdAt: number;
            updatedAt: number;
        };

        assert.deepEqual(rebindAVCellValue(source, {
            id: "target-value",
            keyID: "target-key",
            blockID: "target-row",
        }), {
            id: "target-value",
            keyID: "target-key",
            blockID: "target-row",
            type: "text",
            text: {
                content: "333",
            },
        });
        assert.equal(source.id, "source-value");
        assert.equal(source.keyID, "source-key");
        assert.equal(source.blockID, "source-row");
        assert.equal(source.createdAt, 100);
    });

    it("keeps the drag fill helper aligned with general cell rebinding", () => {
        const source: IAVCellValue = {
            id: "source-value",
            keyID: "source-key",
            blockID: "source-row",
            type: "block",
            isDetached: true,
            block: {
                content: "",
            },
        };
        const target = {
            id: "target-value",
            keyID: "target-key",
            blockID: "target-row",
        };

        const rebound = rebindAVCellValue(source, target);
        assert.deepEqual(rebound, {
            id: "target-value",
            keyID: "target-key",
            blockID: "target-row",
            type: "block",
            isDetached: true,
            block: {
                content: "",
            },
        });
        assert.deepEqual(genAVDragFillValue(source, target), rebound);
        assert.equal(source.blockID, "source-row");
    });
});

describe("empty drag fill values", () => {
    for (const [type, property, empty] of [
        ["select", "mSelect", []], ["mSelect", "mSelect", []], ["mAsset", "mAsset", []],
        ["text", "text", {content: ""}], ["number", "number", {content: 0, isNotEmpty: false}],
        ["checkbox", "checkbox", {checked: false}],
        ["relation", "relation", {blockIDs: [], contents: []}],
    ] as const) {
        it(`clears an existing ${type} value when the source omits its empty payload`, () => {
            const source = {type, keyID: "column", blockID: "source"} as IAVCellValue;
            const value = genAVDragFillValue(source, {id: "target-value", keyID: "column", blockID: "target"});
            const persisted = {type, [property]: {content: "old"}};
            Object.assign(persisted, JSON.parse(JSON.stringify(value)));
            assert.deepEqual(persisted[property], empty);
            assert.equal(value.id, "target-value");
            assert.equal(value.blockID, "target");
            assert.deepEqual(source, {type, keyID: "column", blockID: "source"});
        });
    }
});
