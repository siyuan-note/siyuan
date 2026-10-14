import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadClear = () => {
    const requests: {path: string, text: string}[] = [];
    const pending: {resolve: (value: {code: number}) => void, reject: (error: Error) => void}[] = [];
    const invalidated: string[] = [];
    const messages: string[] = [];
    const api = {} as typeof import("./imageOCR");
    runInNewContext(transpileModule(readFileSync("src/asset/imageOCR.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {
        exports: api,
        window: {siyuan: {languages: {clearOCRTextDone: "OCR text cleared"}}},
        require: () => ({
            fetchSyncPost: (url: string, body: {path: string, text: string}) => {
                assert.equal(url, "/api/asset/setImageOCRText");
                requests.push({...body});
                return new Promise<{code: number}>((resolve, reject) => pending.push({resolve, reject}));
            },
            invalidateImageOCRStatus: (path: string) => invalidated.push(path),
            showMessage: (message: string) => messages.push(message),
        }),
    });
    return {api, requests, pending, invalidated, messages};
};

test("clearing OCR saves an empty record and refreshes only after success", async () => {
    const {api, requests, pending, invalidated, messages} = loadClear();
    const path = "assets/image.png?box=notebook&width=100#preview";
    const first = api.clearImageOCRText(path);
    await api.clearImageOCRText(path);
    assert.deepEqual(requests, [{path, text: ""}]);
    assert.deepEqual(invalidated, []);
    assert.deepEqual(messages, []);
    pending.shift().resolve({code: 0});
    await first;
    assert.deepEqual(invalidated, [path]);
    assert.deepEqual(messages, ["OCR text cleared"]);
    const again = api.clearImageOCRText(path);
    assert.equal(requests.length, 2);
    pending.shift().resolve({code: 0});
    await again;
});

test("failed OCR clearing does not invalidate or report success and can be retried", async () => {
    const {api, requests, pending, invalidated, messages} = loadClear();
    const failed = api.clearImageOCRText("assets/image.png");
    pending.shift().resolve({code: -1});
    await failed;
    assert.deepEqual(invalidated, []);
    assert.deepEqual(messages, []);
    const disconnected = api.clearImageOCRText("assets/image.png");
    pending.shift().reject(new Error("network unavailable"));
    await disconnected;
    assert.deepEqual(invalidated, []);
    assert.deepEqual(messages, ["network unavailable"]);
    const retry = api.clearImageOCRText("assets/image.png");
    pending.shift().resolve({code: 0});
    await retry;
    assert.equal(requests.length, 3);
    assert.deepEqual(invalidated, ["assets/image.png"]);
});
