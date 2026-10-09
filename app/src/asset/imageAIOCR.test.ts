import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

test("AI OCR prevents duplicate requests, refreshes saved results, and recovers from failures", async () => {
    const source = transpileModule(readFileSync("src/asset/imageAIOCR.ts", "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2020},
    }).outputText;
    const paths: string[] = [];
    const refreshed: string[] = [];
    const opened: string[] = [];
    const messages: string[] = [];
    const hidden: string[] = [];
    let resolve: (value: {code: number}) => void;
    let reject: (error: Error) => void;
    const run = new Function("window", "fetchSyncPost", "showMessage", "hideMessage", "genUUID",
        "invalidateImageOCRStatus", "openImageOCR", source + "\nreturn reImageAIOCR;")(
        {siyuan: {languages: {loading: "Loading"}}},
        (url: string, body: {path: string}) => {
            assert.equal(url, "/api/ai/ocr");
            paths.push(body.path);
            return new Promise((done, fail) => { resolve = done; reject = fail; });
        }, (message: string) => messages.push(message), (id: string) => hidden.push(id), () => "progress-id",
        (path: string) => refreshed.push(path), (path: string) => opened.push(path),
    );
    const path = "assets/image.png?box=20261003100000-abcdefg";
    const first = run(path);
    await run(path);
    assert.deepEqual(paths, [path]);
    resolve({code: 0});
    await first;
    assert.deepEqual(refreshed, [path]);
    assert.deepEqual(opened, [path]);
    const failure = run(path);
    resolve({code: -1});
    await failure;
    const networkFailure = run(path);
    reject(new Error("Network failure"));
    await networkFailure;
    assert.equal(paths.length, 3);
    assert.equal(refreshed.length, 1);
    assert.equal(opened.length, 1);
    assert.deepEqual(hidden, ["progress-id", "progress-id", "progress-id"]);
    assert.ok(messages.includes("Network failure"));
});
