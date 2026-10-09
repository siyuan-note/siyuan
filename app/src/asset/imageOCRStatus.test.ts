import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const loadCache = () => {
    let now = 1000;
    let requests = 0;
    let events = 0;
    const pending: {resolve: (value: {code: number, data: {text: string}}) => void, reject: (error: Error) => void}[] = [];
    const api = {} as typeof import("./imageOCRStatus");
    runInNewContext(transpileModule(readFileSync("src/asset/imageOCRStatus.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {
        exports: api,
        Date: {now: () => now},
        CustomEvent: class {},
        window: {dispatchEvent: () => events++},
        require: () => ({fetchSyncPost: (url: string, _data: unknown, _headers: unknown, process: boolean) => {
            assert.equal(url, "/api/asset/getImageOCRText");
            assert.equal(process, false);
            requests++;
            return new Promise<{code: number, data: {text: string}}>((resolve, reject) => pending.push({resolve, reject}));
        }}),
    });
    return {api, pending, requests: () => requests, events: () => events, advance: () => now += 60001};
};

test("OCR presence caches text and empty results, merges requests, expires and retries failures", async () => {
    const cache = loadCache();
    const {api, pending} = cache;
    const first = api.getImageOCRStatus("assets/image.png");
    assert.equal(api.getImageOCRStatus("assets/image.png"), first);
    assert.equal(cache.requests(), 1);
    pending.shift().resolve({code: 0, data: {text: "recognized"}});
    assert.equal(await first, true);
    assert.equal(await api.getImageOCRStatus("assets/image.png"), true);
    assert.equal(cache.requests(), 1);
    const empty = api.getImageOCRStatus("assets/empty.png");
    pending.shift().resolve({code: 0, data: {text: " \n "}});
    assert.equal(await empty, false);
    assert.equal(await api.getImageOCRStatus("assets/empty.png"), false);
    assert.equal(cache.requests(), 2);
    cache.advance();
    const expired = api.getImageOCRStatus("assets/empty.png");
    pending.shift().resolve({code: 0, data: {text: "new recognition"}});
    assert.equal(await expired, true);
    const failed = api.getImageOCRStatus("assets/error.png");
    pending.shift().resolve({code: -1, data: {text: ""}});
    assert.equal(await failed, undefined);
    const retry = api.getImageOCRStatus("assets/error.png");
    pending.shift().reject(new Error("Network failure"));
    assert.equal(await retry, undefined);
    const success = api.getImageOCRStatus("assets/error.png");
    pending.shift().resolve({code: 0, data: {text: "success"}});
    assert.equal(await success, true);
    assert.equal(cache.requests(), 6);
});

test("OCR changes invalidate only the resource and stale requests cannot replace the new cache", async () => {
    const {api, pending, requests, events} = loadCache();
    const old = api.getImageOCRStatus("assets/image.png");
    const other = api.getImageOCRStatus("assets/other.png");
    api.invalidateImageOCRStatus("assets/image.png");
    assert.equal(events(), 1);
    const updated = api.getImageOCRStatus("assets/image.png");
    pending[2].resolve({code: 0, data: {text: ""}});
    assert.equal(await updated, false);
    pending[0].resolve({code: 0, data: {text: "stale"}});
    pending[1].resolve({code: 0, data: {text: "other"}});
    await Promise.all([old, other]);
    assert.equal(await api.getImageOCRStatus("assets/image.png"), false);
    assert.equal(await api.getImageOCRStatus("assets/other.png"), true);
    assert.equal(requests(), 3);
});

test("OCR presence cache is bounded", async () => {
    const {api, pending, requests} = loadCache();
    for (let i = 0; i < 129; i++) {
        const result = api.getImageOCRStatus(`assets/${i}.png`);
        pending.shift().resolve({code: 0, data: {text: "text"}});
        await result;
    }
    assert.equal(await api.getImageOCRStatus("assets/128.png"), true);
    assert.equal(requests(), 129);
    const evicted = api.getImageOCRStatus("assets/0.png");
    assert.equal(requests(), 130);
    pending.shift().resolve({code: 0, data: {text: ""}});
    assert.equal(await evicted, false);
});
