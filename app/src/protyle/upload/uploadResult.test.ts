import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getAssetUploadPathsByInput, getAssetUploadResult, getAssetUploadSuccesses} from "./uploadResult";

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
        assert.deepEqual(getAssetUploadSuccesses({succMap: {"a.png": "assets/a.png"}}), [
            {index: 0, name: "a.png", path: "assets/a.png"},
        ]);
    });

    it("preserves successful uploads with duplicate filenames", () => {
        const input: IAssetUploadInput = {
            kind: "files",
            files: [createFile("image.png"), createFile("image.png")],
        };
        const succFiles: IAssetUploadSuccess[] = [
            {index: 0, name: "image.png", path: "assets/image-first.png"},
            {index: 1, name: "image.png", path: "assets/image-second.png"},
        ];
        const result = getAssetUploadResult(JSON.stringify({
            code: 0,
            data: {succFiles, succMap: {"image.png": "assets/image-second.png"}, errFiles: []},
        }), input);

        assert.equal(result.status, "success");
        assert.deepEqual(result.succFiles, succFiles);
        assert.deepEqual(getAssetUploadSuccesses({succFiles}), succFiles);
    });

    it("does not report full success for a legacy response with duplicate filenames", () => {
        const input: IAssetUploadInput = {
            kind: "files",
            files: [createFile("image.png"), createFile("image.png")],
        };
        const result = getAssetUploadResult(JSON.stringify({
            code: 0,
            data: {succMap: {"image.png": "assets/image.png"}, errFiles: []},
        }), input);

        assert.equal(result.status, "partial");
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

    it("maps partial successes back to the original input indexes", () => {
        const result = {
            status: "partial" as const,
            rejected: [{index: 1, name: "b.png", reasons: ["size-limit" as const]}],
            succFiles: [
                {index: 0, name: "a.png", path: "assets/a.png"},
                {index: 2, name: "d.png", path: "assets/d.png"},
            ],
        };

        assert.deepEqual(getAssetUploadPathsByInput(4, result), [
            "assets/a.png",
            undefined,
            undefined,
            "assets/d.png",
        ]);
    });

    it("preserves successful and failed files from a partial kernel write", () => {
        const input: IAssetUploadInput = {
            kind: "local-files",
            files: [{path: "a.png", size: 1}, {path: "missing.png", size: 1}],
        };
        const failedFiles: IAssetUploadFailure[] = [{
            index: 1,
            name: "missing.png",
            error: "file not found",
        }];
        const result = getAssetUploadResult(JSON.stringify({
            code: 0,
            data: {
                succFiles: [{index: 0, name: "a.png", path: "assets/a.png"}],
                succMap: {"a.png": "assets/a.png"},
                failedFiles,
                errFiles: ["missing.png"],
            },
        }), input);

        assert.equal(result.status, "partial");
        assert.deepEqual(result.failedFiles, failedFiles);
        assert.equal(result.succFiles[0].index, 0);
    });

    it("reports partial when an error response still contains successful files", () => {
        const input: IAssetUploadInput = {
            kind: "files",
            files: [createFile("a.png"), createFile("b.png")],
        };
        const result = getAssetUploadResult(JSON.stringify({
            code: -1,
            msg: "second file failed",
            data: {
                succFiles: [{index: 0, name: "a.png", path: "assets/a.png"}],
                succMap: {"a.png": "assets/a.png"},
            },
        }), input);

        assert.equal(result.status, "partial");
        assert.equal(result.error, "second file failed");
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
