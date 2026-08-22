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
        await assert.rejects(waitForUploadHandler(new Promise<null>(() => undefined),
            new AbortController().signal, 1), AssetUploadHandlerTimeoutError);
    });
});
