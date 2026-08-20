import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getAssetUploadResult} from "./uploadResult";

const createFile = (name: string) => new File(["content"], name, {type: "image/png"});

describe("asset upload result", () => {
    it("reports success when every accepted file is written", () => {
        const input: IAssetUploadInput = {kind: "files", files: [createFile("a.png")]};
        const result = getAssetUploadResult(JSON.stringify({
            code: 0,
            data: {succMap: {"a.png": "assets/a.png"}, errFiles: []},
        }), input);

        assert.equal(result.status, "success");
        assert.deepEqual(result.acceptedInput, input);
        assert.equal(result.rejected, undefined);
    });

    it("reports partial when frontend validation rejected part of the input", () => {
        const acceptedInput: IAssetUploadInput = {kind: "files", files: [createFile("a.png")]};
        const rejected: IAssetUploadRejection[] = [{
            index: 1,
            name: "b.exe",
            reasons: ["type-not-accepted"],
        }];
        const result = getAssetUploadResult(JSON.stringify({
            code: 0,
            data: {succMap: {"a.png": "assets/a.png"}, errFiles: []},
        }), acceptedInput, rejected);

        assert.equal(result.status, "partial");
        assert.deepEqual(result.acceptedInput, acceptedInput);
        assert.deepEqual(result.rejected, rejected);
    });

    it("preserves accepted and rejected details when the server fails", () => {
        const acceptedInput: IAssetUploadInput = {kind: "files", files: [createFile("a.png")]};
        const rejected: IAssetUploadRejection[] = [{
            index: 1,
            name: "b.exe",
            reasons: ["type-not-accepted"],
        }];
        const result = getAssetUploadResult(JSON.stringify({code: 1, msg: "upload failed", data: {}}),
            acceptedInput, rejected);

        assert.equal(result.status, "failed");
        assert.equal(result.error, "upload failed");
        assert.deepEqual(result.acceptedInput, acceptedInput);
        assert.deepEqual(result.rejected, rejected);
    });
});
