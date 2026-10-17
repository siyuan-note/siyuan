import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const loadCache = () => {
    let now = 1000;
    let requests = 0;
    let events = 0;
    const pending: {resolve: (value: {code: number, data: {text: string, failed?: boolean}}) => void, reject: (error: Error) => void}[] = [];
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
            return new Promise<{code: number, data: {text: string, failed?: boolean}}>((resolve, reject) => pending.push({resolve, reject}));
        }}),
    });
    return {api, pending, requests: () => requests, events: () => events, advance: () => now += 60001};
};

test("OCR presence caches text and empty results, merges requests, expires and retries failures", async () => {
    const cache = loadCache();
    const {api, pending} = cache;
    const first = api.getImageOCRStatus("assets/image.png");
    const text = api.getImageOCRText("assets/image.png");
    assert.equal(api.getImageOCRStatus("assets/image.png"), first);
    assert.equal(cache.requests(), 1);
    pending.shift().resolve({code: 0, data: {text: "recognized"}});
    assert.equal(await first, true);
    assert.equal(await text, "recognized");
    assert.equal(await api.getImageOCRText("assets/image.png"), "recognized");
    assert.equal(await api.getImageOCRStatus("assets/image.png"), true);
    assert.equal(cache.requests(), 1);
    const empty = api.getImageOCRStatus("assets/empty.png");
    pending.shift().resolve({code: 0, data: {text: " \n "}});
    assert.equal(await empty, false);
    assert.equal(await api.getImageOCRText("assets/empty.png"), " \n ");
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

test("OCR changes invalidate shared resource aliases and discard pending stale results", async () => {
    const {api, pending, requests, events} = loadCache();
    const old = api.getImageOCRStatus("assets/image.png");
    const other = api.getImageOCRStatus("assets/image.png?width=100#preview");
    api.invalidateImageOCRStatus("assets/image.png");
    assert.equal(events(), 1);
    const updated = api.getImageOCRStatus("assets/image.png");
    pending[2].resolve({code: 0, data: {text: ""}});
    assert.equal(await updated, false);
    pending[0].resolve({code: 0, data: {text: "stale"}});
    pending[1].resolve({code: 0, data: {text: "other"}});
    assert.deepEqual(await Promise.all([old, other]), [undefined, undefined]);
    assert.equal(await api.getImageOCRStatus("assets/image.png"), false);
    const alias = api.getImageOCRStatus("assets/image.png?width=100#preview");
    pending[3].resolve({code: 0, data: {text: ""}});
    assert.equal(await alias, false);
    assert.equal(requests(), 4);
});

test("OCR result cache retains recognition failures separately from saved text and read failures", async () => {
    const {api, pending, requests} = loadCache();
    const result = api.getImageOCRResult("assets/image.png");
    const text = api.getImageOCRText("assets/image.png");
    const presence = api.getImageOCRStatus("assets/image.png");
    pending.shift().resolve({code: 0, data: {text: "saved", failed: true}});
    assert.deepEqual(await result, {text: "saved", failed: true});
    assert.equal(await text, "saved");
    assert.equal(await presence, true);
    assert.equal(requests(), 1);
    api.invalidateImageOCRStatus("assets/image.png");
    const updated = api.getImageOCRResult("assets/image.png");
    pending.shift().resolve({code: 0, data: {text: "", failed: false}});
    assert.deepEqual(await updated, {text: "", failed: false});
    const unavailable = api.getImageOCRResult("assets/unavailable.png");
    pending.shift().reject(new Error("network"));
    assert.equal(await unavailable, undefined);
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
