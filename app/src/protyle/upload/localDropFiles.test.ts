import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getLocalDropFiles, hasDataTransferFiles} from "./localDropFiles";

const createFile = (name: string) => new File(["content"], name);

describe("local drop files", () => {
    it("detects files regardless of data transfer type order", () => {
        assert.equal(hasDataTransferFiles(["text/html", "text/plain", "Files"]), true);
        assert.equal(hasDataTransferFiles(["text/html", "text/plain"]), false);
    });

    it("returns every local file when all paths are available", () => {
        const files = [createFile("a.png"), createFile("b.png")];
        const result = getLocalDropFiles(files, file => `C:/${file.name}`);

        assert.deepEqual(result?.map(item => item.path), ["C:/a.png", "C:/b.png"]);
    });

    it("returns no local batch when any path is unavailable", () => {
        const files = [createFile("a.png"), createFile("b.png")];
        const result = getLocalDropFiles(files, file => file.name === "a.png" ? "C:/a.png" : "");

        assert.equal(result, undefined);
    });
});
