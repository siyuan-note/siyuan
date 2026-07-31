import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {genAVDragFillValue} from "./dragFillValue";

describe("genAVDragFillValue", () => {
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

        assert.deepEqual(genAVDragFillValue(source, {
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
        assert.equal(source.blockID, "source-row");
        assert.equal(source.createdAt, 100);
    });
});
