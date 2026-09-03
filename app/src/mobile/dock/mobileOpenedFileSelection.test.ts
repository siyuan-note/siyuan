import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {MobileOpenedFileSelection} from "./mobileOpenedFileSelection";

describe("mobile opened file selection", () => {
    it("only resolves the latest selection", async () => {
        const selection = new MobileOpenedFileSelection();
        let resolveFirst!: (value: string) => void;
        const firstValue = new Promise<string>((resolve) => {
            resolveFirst = resolve;
        });

        const firstRequest = selection.resolve(() => firstValue, () => true);
        const secondResult = await selection.resolve(() => Promise.resolve("second"), () => true);
        resolveFirst("first");

        assert.equal(await firstRequest, undefined);
        assert.equal(secondResult, "second");
    });

    it("ignores a selection that is no longer current", async () => {
        const selection = new MobileOpenedFileSelection();
        const result = await selection.resolve(() => Promise.resolve("document"), () => false);

        assert.equal(result, undefined);
    });

    it("cancels a pending selection", async () => {
        const selection = new MobileOpenedFileSelection();
        let resolvePending!: (value: string) => void;
        const pendingValue = new Promise<string>((resolve) => {
            resolvePending = resolve;
        });
        const pendingRequest = selection.resolve(() => pendingValue, () => true);

        selection.cancel();
        resolvePending("document");

        assert.equal(await pendingRequest, undefined);
    });
});
