import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createAvailableMarkdownId, createMarkdownCapabilityToken, createMarkdownInstanceId} from "./identity";

test("native custom-scheme pages create SiYuan IDs without loading Lute or a kernel", () => {
    const source = {getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto)};
    const date = new Date(2026, 10, 2, 9, 8, 7);
    const first = createMarkdownInstanceId(source, date);
    const second = createMarkdownInstanceId(source, date);
    assert.match(first, /^20261102090807-[a-z0-9]{7}$/);
    assert.notEqual(first, second);
});

test("security capabilities retain 256 random bits instead of a short timestamped ID", () => {
    let length = 0;
    const source = {getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        assert.ok(array);
        length = array.byteLength;
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(255);
        return array;
    }};
    assert.equal(createMarkdownCapabilityToken(source), "ff".repeat(32));
    assert.equal(length, 32);
    assert.match(createMarkdownCapabilityToken(), /^[a-f\d]{64}$/);
});

test("ID allocation skips occupied values and fails rather than reusing one", () => {
    let calls = 0;
    assert.equal(createAvailableMarkdownId(id => id === "occupied", () => ++calls === 1 ? "occupied" : "fresh"), "fresh");
    calls = 0;
    assert.throws(() => createAvailableMarkdownId(() => true, () => {calls++; return "occupied";}), /unique Markdown ID/);
    assert.equal(calls, 8);
});
