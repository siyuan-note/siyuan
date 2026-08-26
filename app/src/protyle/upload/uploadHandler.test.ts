import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {AssetUploadHandlerTimeoutError, waitForUploadHandler} from "./uploadHandler";

describe("custom upload handler", () => {
    it("stops waiting when the editor signal is aborted", async () => {
        const controller = new AbortController();
        const pending = waitForUploadHandler(new Promise<null>(() => undefined), controller.signal, 1_000);
        controller.abort(new Error("The editor was destroyed"));

        await assert.rejects(pending, /The editor was destroyed/);
    });

    it("stops waiting after the handler timeout", async () => {
        const controller = new AbortController();
        await assert.rejects(waitForUploadHandler(new Promise<null>(() => undefined), controller.signal, 1,
            error => controller.abort(error)), AssetUploadHandlerTimeoutError);
        assert.equal(controller.signal.aborted, true);
        assert.equal(controller.signal.reason instanceof AssetUploadHandlerTimeoutError, true);
    });
});
