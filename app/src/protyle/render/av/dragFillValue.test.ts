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
