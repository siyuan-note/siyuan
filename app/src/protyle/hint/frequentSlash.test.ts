import * as assert from "node:assert/strict";
import {test} from "node:test";
import {normalizeSlashUsage, rankFrequentSlashItems} from "./frequentSlash";

const item = (key: string, value = key) => ({key, value});
const getKey = (entry: ReturnType<typeof item>) => entry.key;

test("frequent slash starts empty and never adds unrecorded or unavailable entries", () => {
    const entries = [item("heading1"), item("code")];
    assert.deepEqual(rankFrequentSlashItems(entries, getKey, {}), []);
    assert.deepEqual(rankFrequentSlashItems(entries, getKey, {unavailable: 100}), []);
    assert.deepEqual(rankFrequentSlashItems([], getKey, {code: 4}), []);
});

test("frequent slash returns at most five items by count and keeps original order on ties", () => {
    const entries = ["a", "b", "c", "d", "e", "f", "g"].map(key => item(key));
    const original = structuredClone(entries);
    const usage = {a: 2, b: 5, c: 5, d: 3, e: 1, f: 4, g: 2};
    const ranked = rankFrequentSlashItems(entries, getKey, usage);
    assert.deepEqual(ranked.map(getKey), ["b", "c", "f", "d", "a"]);
    assert.equal(ranked[0], entries[1]);
    assert.deepEqual(entries, original);
    assert.deepEqual(usage, {a: 2, b: 5, c: 5, d: 3, e: 1, f: 4, g: 2});
});

test("frequent slash uses first identity occurrence and does not deduplicate command values", () => {
    const entries = [item("code", "same"), item("code", "duplicate"), item("plugin:first:code", "same"),
        item("plugin:second:code", "same"), item("", "separator")];
    const ranked = rankFrequentSlashItems(entries, getKey, {
        code: 2, "plugin:first:code": 3, "plugin:second:code": 4, "": 100,
    });
    assert.deepEqual(ranked, [entries[3], entries[2], entries[0]]);
    assert.equal(entries.length, 5);
});

test("frequent slash ignores inherited counts but safely accepts own prototype-like keys", () => {
    const entries = [item("code"), item("toString"), item("constructor"), item("__proto__")];
    assert.deepEqual(rankFrequentSlashItems(entries, getKey, Object.create({code: 5, toString: 8})), []);
    const usage = normalizeSlashUsage(JSON.parse('{"__proto__":7,"constructor":4,"toString":2}'));
    assert.equal(Object.getPrototypeOf(usage), Object.prototype);
    assert.deepEqual(rankFrequentSlashItems(entries, getKey, usage).map(getKey),
        ["__proto__", "constructor", "toString"]);
    assert.equal(Object.prototype.hasOwnProperty.call({}, "code"), false);
});

test("slash usage normalization discards malformed roots and counts without mutating input", () => {
    for (const value of [undefined, null, false, 4, "{}", [], [1, 2]]) {
        assert.deepEqual(normalizeSlashUsage(value), {});
    }
    const source = {
        valid: 3, zero: 0, negative: -2, fraction: 1.5, infinite: Infinity, nan: NaN,
        string: "5", boolean: true, object: {count: 2}, tooLarge: Number.MAX_SAFE_INTEGER + 1,
        max: Number.MAX_SAFE_INTEGER, "": 3, ["a".repeat(1024)]: 1, ["b".repeat(1025)]: 1,
        "plugin:uninstalled:insert": 9,
    };
    const normalized = normalizeSlashUsage(source);
    assert.deepEqual(normalized, {
        valid: 3, max: Number.MAX_SAFE_INTEGER, ["a".repeat(1024)]: 1, "plugin:uninstalled:insert": 9,
    });
    assert.equal(source.string, "5");
    normalized.valid++;
    assert.equal(source.valid, 3);
});

test("slash usage normalization copies only own enumerable entries", () => {
    const source = Object.create({inherited: 9});
    source.code = 2;
    Object.defineProperty(source, "hidden", {value: 8});
    assert.deepEqual(normalizeSlashUsage(source), {code: 2});
});
