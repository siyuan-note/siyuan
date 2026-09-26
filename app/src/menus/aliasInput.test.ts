import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {parseAliases, updateAliases} from "./aliasInput";

describe("alias input", () => {
    it("splits ASCII commas, trims whitespace and keeps distinct aliases in order", () => {
        assert.deepEqual(parseAliases(" first, ,second,first, First,中文，别名 "),
            ["first", "second", "First", "中文，别名"]);
        assert.deepEqual(parseAliases(" , , "), []);
    });

    it("adds batches without overwriting existing aliases", () => {
        const original = ["first", "second"];
        assert.deepEqual(updateAliases(original, " second, third,third,fourth "),
            ["first", "second", "third", "fourth"]);
        assert.deepEqual(original, ["first", "second"]);
    });

    it("replaces one alias in place with a batch and merges duplicates", () => {
        assert.deepEqual(updateAliases(["first", "second", "third"], "third,fourth", 1),
            ["first", "third", "fourth"]);
    });

    it("removes an edited alias when cleared, including the last alias", () => {
        assert.deepEqual(updateAliases(["first", "second"], " , ", 0), ["second"]);
        assert.deepEqual(updateAliases(["first"], "", 0), []);
    });

    it("preserves literal markup and quotes as alias text", () => {
        const value = '<img src=x onerror="alert(1)"> & "quoted"';
        assert.deepEqual(updateAliases([], value), [value]);
    });
});
