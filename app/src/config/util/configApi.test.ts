import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {mergeRecordByDottedPath} from "./dotPath";

const fixture = (failRefresh = false) => {
    const memory = {editor: {fontSize: 16, markdown: {inlineMath: true}}, sync: {interval: 30}};
    const requests: Array<{body: any; resolve: (response: any) => void}> = [];
    const exports = {} as typeof import("./configApi");
    const source = transpileModule(readFileSync("src/config/util/configApi.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    runInNewContext(source, {exports, window: {siyuan: {config: memory}}, structuredClone, require: (name: string) => {
        if (name === "../../util/fetch") return {fetchSyncPost: (_url: string, body: any) =>
            new Promise(resolve => requests.push({body, resolve}))};
        if (name === "./dotPath") return {mergeRecordByDottedPath};
        if (name === "../setting/pending") return {trackSettingSave: (operation: Promise<void>) => operation};
        if (name === "../setting/sync") return {refreshSettingConfigAfter: async (namespace: keyof typeof memory, save: () => Promise<boolean>) => {
            if (!await save()) return false;
            if (failRefresh) {
                failRefresh = false;
                throw new Error("configuration refresh failed");
            }
            if (namespace === "editor") memory.editor.fontSize = 24;
            return true;
        }};
        throw new Error("unexpected module: " + name);
    }});
    return {memory, requests, config: exports.config};
};

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("config.set queues a namespace, preserves submitted values and returns normalized memory", async () => {
    const f = fixture();
    const markdown = {inlineMath: false};
    let applied: unknown;
    const first = f.config.set("editor.fontSize", 200, data => { applied = data; });
    const second = f.config.set("editor.markdown", markdown);
    markdown.inlineMath = true;
    await settle();
    assert.equal(f.requests.length, 1);
    assert.equal(JSON.stringify(f.requests[0].body), '{"editor":{"fontSize":200}}');
    f.requests[0].resolve({code: 0});
    await first;
    assert.equal(applied, f.memory.editor);
    assert.equal(f.config.get("editor.fontSize"), 24);
    await settle();
    assert.equal(f.requests.length, 2);
    assert.equal(JSON.stringify(f.requests[1].body), '{"editor":{"markdown":{"inlineMath":false}}}');
    f.requests[1].resolve({code: 0});
    await second;
});

test("config.set allows independent namespaces and retries after a rejected save", async () => {
    const f = fixture();
    let applied = false;
    const failed = f.config.set("editor.fontSize", 20, () => { applied = true; });
    const retry = f.config.set("editor.fontSize", 24);
    const independent = f.config.set("sync.interval", 60);
    await settle();
    assert.equal(f.requests.length, 2);
    const rejection = assert.rejects(failed, /refused/);
    f.requests[0].resolve({code: -1, msg: "refused"});
    f.requests[1].resolve({code: 0});
    await rejection;
    await independent;
    assert.equal(applied, false);
    await settle();
    assert.equal(f.requests.length, 3);
    f.requests[2].resolve({code: 0});
    await retry;
});

test("config.set rejects an unconfirmed refresh without its callback and continues the queue", async () => {
    const f = fixture(true);
    let applied = false;
    const first = f.config.set("editor.fontSize", 20, () => { applied = true; });
    const second = f.config.set("editor.fontSize", 24);
    const rejected = assert.rejects(first, /configuration refresh failed/);
    await settle();
    f.requests[0].resolve({code: 0});
    await rejected;
    assert.equal(applied, false);
    assert.equal(f.config.get("editor.fontSize"), 16);
    await settle();
    assert.equal(f.requests.length, 2);
    f.requests[1].resolve({code: 0});
    await second;
    assert.equal(f.config.get("editor.fontSize"), 24);
});
