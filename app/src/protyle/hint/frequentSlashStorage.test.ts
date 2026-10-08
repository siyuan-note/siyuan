import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as frequentSlash from "./frequentSlash";

const constants = {LOCAL_SLASH_FREQUENT_ENABLED: "enabled", LOCAL_SLASH_USAGE: "usage"};
const compiled = transpileModule(readFileSync(join(__dirname, "frequentSlashStorage.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

type TWrite = {key: string; value: unknown};

const fixture = (values: Record<string, unknown> = {},
                 persist: (write: TWrite) => Promise<unknown> = () => Promise.resolve()) => {
    const writes: TWrite[] = [];
    const storage: Record<string, unknown> = structuredClone(values);
    const siyuan = {storage, config: {readonly: false}, isPublish: false};
    const exports = {} as typeof import("./frequentSlashStorage");
    const settings = {} as typeof import("../../config/setting/pending");
    runInNewContext(transpileModule(readFileSync(join(__dirname, "../../config/setting/pending.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports: settings});
    runInNewContext(compiled, {
        exports,
        window: {siyuan},
        console: {warn() {}, error() {}},
        require: (id: string) => {
            if (id === "../../constants") return {Constants: constants};
            if (id === "./frequentSlash") return frequentSlash;
            if (id === "../../config/setting/pending") return settings;
            assert.equal(id, "../util/compatibility");
            return {setStorageVal: (key: string, value: unknown) => {
                const write = {key, value: structuredClone(value)};
                writes.push(write);
                return persist(write);
            }};
        },
    });
    return {...exports, storage, writes, siyuan, settings};
};

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const entries = [{key: "code"}, {key: "heading1"}];
const getKey = (entry: {key: string}) => entry.key;

test("frequent slash defaults on and honors only an explicit false preference", () => {
    for (const enabled of [undefined, null, true, "false", 0, {}, []]) {
        assert.equal(fixture({enabled}).isFrequentSlashEnabled(), true);
    }
    assert.equal(fixture({enabled: false}).isFrequentSlashEnabled(), false);
});

test("disabled frequent slash preserves history and stops all execution writes", async () => {
    const f = fixture({usage: {code: 4, "plugin:uninstalled:item": 2}});
    f.setFrequentSlashEnabled(false);
    assert.equal(f.isFrequentSlashEnabled(), false);
    assert.equal(f.getFrequentSlashItems(entries, getKey).length, 0);
    f.recordSlashExecution("code");
    f.recordSlashExecution("heading1");
    await settle();
    assert.deepEqual(f.storage.usage, {code: 4, "plugin:uninstalled:item": 2});
    assert.deepEqual(f.writes, [{key: "enabled", value: false}]);
    f.setFrequentSlashEnabled(true);
    assert.deepEqual(f.getFrequentSlashItems(entries, getKey), [entries[0]]);
    f.recordSlashExecution("heading1");
    await settle();
    assert.deepEqual(f.storage.usage, {code: 4, "plugin:uninstalled:item": 2, heading1: 1});
    assert.equal(f.writes.filter(write => write.key === "usage").length, 1);
});

test("usage records stable plugin identities independently and normalizes damaged storage", async () => {
    const f = fixture({usage: {code: "wrong", zero: 0, "plugin:uninstalled:item": 3}});
    for (const key of ["code", "plugin:first:code", "plugin:second:code", "code"]) {
        f.recordSlashExecution(key);
    }
    await settle();
    assert.deepEqual(f.storage.usage, {
        "plugin:uninstalled:item": 3, code: 2, "plugin:first:code": 1, "plugin:second:code": 1,
    });
    assert.equal(f.storage.enabled, undefined);
    assert.ok(f.writes.every(write => write.key === "usage"));
});

test("usage rejects empty or oversized identities and saturates at the safe integer limit", async () => {
    const f = fixture({usage: {code: Number.MAX_SAFE_INTEGER}});
    f.recordSlashExecution("");
    f.recordSlashExecution("x".repeat(1025));
    await settle();
    assert.equal(f.writes.length, 0);
    f.recordSlashExecution("code");
    f.recordSlashExecution("x".repeat(1024));
    await settle();
    assert.deepEqual(f.storage.usage, {code: Number.MAX_SAFE_INTEGER, ["x".repeat(1024)]: 1});
});

test("usage safely records prototype-like own keys without changing object prototypes", async () => {
    const f = fixture();
    for (const key of ["__proto__", "constructor", "toString", "__proto__"]) {
        f.recordSlashExecution(key);
    }
    await settle();
    const usage = f.storage.usage as Record<string, number>;
    assert.equal(Object.getPrototypeOf(usage), Object.prototype);
    assert.equal(usage.__proto__, 2);
    assert.equal(usage.constructor, 1);
    assert.equal(usage.toString, 1);
    assert.deepEqual(Object.keys(usage), ["__proto__", "constructor", "toString"]);
    assert.equal(Object.prototype.hasOwnProperty.call({}, "usage"), false);
});

test("readonly, published, and missing storage contexts do not mutate or persist preferences", async () => {
    for (const mode of ["readonly", "publish", "missing"]) {
        const f = fixture({usage: {code: 3}});
        if (mode === "readonly") f.siyuan.config.readonly = true;
        if (mode === "publish") f.siyuan.isPublish = true;
        if (mode === "missing") f.siyuan.storage = undefined;
        f.setFrequentSlashEnabled(false);
        f.recordSlashExecution("code");
        await settle();
        assert.deepEqual(f.storage, {usage: {code: 3}});
        assert.equal(f.writes.length, 0);
        assert.equal(f.isFrequentSlashEnabled(), true);
    }
});

test("ranking and counting read storage updates from other windows without cached preferences", async () => {
    const f = fixture({enabled: false, usage: {code: 1}});
    f.storage.enabled = true;
    f.storage.usage = {heading1: 6};
    assert.deepEqual(f.getFrequentSlashItems(entries, getKey), [entries[1]]);
    f.recordSlashExecution("heading1");
    assert.deepEqual(f.storage.usage, {heading1: 7});
    f.storage.enabled = false;
    f.recordSlashExecution("code");
    await settle();
    assert.deepEqual(f.storage.usage, {heading1: 7});
    assert.equal(f.getFrequentSlashItems(entries, getKey).length, 0);
});

test("usage persistence serializes and coalesces snapshots so old writes cannot replace newer counts", async () => {
    const release: Array<() => void> = [];
    const f = fixture({}, () => new Promise<void>(resolve => release.push(resolve)));
    f.recordSlashExecution("code");
    f.recordSlashExecution("code");
    f.recordSlashExecution("heading1");
    await settle();
    assert.deepEqual(f.storage.usage, {code: 2, heading1: 1});
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.writes[0].value, {code: 1});
    release.shift()();
    await settle();
    assert.equal(f.writes.length, 2);
    assert.deepEqual(f.writes[1].value, {code: 2, heading1: 1});
    release.shift()();
    await settle();
    assert.equal(f.writes.length, 2);
});

test("disabling while usage is saving preserves both pending counts and the separate preference", async () => {
    const release: Array<() => void> = [];
    const f = fixture({}, () => new Promise<void>(resolve => release.push(resolve)));
    f.recordSlashExecution("code");
    f.recordSlashExecution("code");
    f.setFrequentSlashEnabled(false);
    f.recordSlashExecution("heading1");
    assert.equal(f.storage.enabled, false);
    assert.deepEqual(f.storage.usage, {code: 2});
    for (let index = 0; index < 3; index++) {
        await settle();
        assert.equal(f.writes.length, index + 1);
        release.shift()();
    }
    await settle();
    assert.deepEqual(f.writes, [
        {key: "usage", value: {code: 1}},
        {key: "usage", value: {code: 2}},
        {key: "enabled", value: false},
    ]);
});

test("failed persistence does not poison the queue or discard newer in-memory counts", async () => {
    let fail = true;
    const persisted: TWrite[] = [];
    const f = fixture({}, write => {
        if (fail) {
            fail = false;
            return Promise.reject(new Error("storage unavailable"));
        }
        persisted.push(write);
        return Promise.resolve();
    });
    f.recordSlashExecution("code");
    await settle();
    assert.deepEqual(f.storage.usage, {code: 1});
    f.recordSlashExecution("code");
    await settle();
    assert.deepEqual(persisted, [{key: "usage", value: {code: 2}}]);
    assert.deepEqual(f.storage.usage, {code: 2});
});

test("settings close waits for the complete queued preference drain", async () => {
    const release: Array<() => void> = [];
    const f = fixture({}, () => new Promise<void>(resolve => release.push(resolve)));
    f.setFrequentSlashEnabled(false);
    f.setFrequentSlashEnabled(true);
    let flushed = false;
    const flush = f.settings.flushSettingSaves().then(() => { flushed = true; });
    await settle();
    assert.equal(f.writes.length, 1);
    assert.equal(flushed, false);
    release.shift()();
    await settle();
    assert.equal(f.writes.length, 2);
    assert.equal(flushed, false);
    release.shift()();
    await flush;
    assert.equal(flushed, true);
    assert.deepEqual(f.writes, [{key: "enabled", value: false}, {key: "enabled", value: true}]);
});

test("a rejected storage operation does not poison the drain or make settings flush reject", async () => {
    let reject: (error: Error) => void;
    let release: () => void;
    let first = true;
    const f = fixture({}, () => {
        if (first) {
            first = false;
            return new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
        }
        return new Promise<void>(resolve => { release = resolve; });
    });
    f.recordSlashExecution("code");
    f.recordSlashExecution("code");
    let flushed = false;
    const flush = f.settings.flushSettingSaves().then(() => { flushed = true; });
    reject(new Error("storage failed"));
    await settle();
    assert.equal(f.writes.length, 2);
    assert.equal(flushed, false);
    release();
    await flush;
    assert.deepEqual(f.writes[1], {key: "usage", value: {code: 2}});
    assert.equal(f.settings.settingSaveFailures(), 0);
});

test("the drain preserves failures already tracked by the storage request", async () => {
    let reject: (error: Error) => void;
    const f = fixture({}, () => f.settings.trackSettingSave(new Promise<void>((_resolve, rejectPromise) => {
        reject = rejectPromise;
    })));
    f.setFrequentSlashEnabled(false);
    const flush = f.settings.flushSettingSaves();
    reject(new Error("request failed"));
    await assert.rejects(flush, /request failed/);
    assert.equal(f.settings.settingSaveFailures(), 1);
    await assert.doesNotReject(f.settings.flushSettingSaves());
});
